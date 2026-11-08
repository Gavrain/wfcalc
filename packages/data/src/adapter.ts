/**
 * 数据 → 计算内核贡献（Contribution）的适配层。
 *
 * 数据层产出（`packages/data/src/generated/`）是"流水线形状"，内核用的是"贡献表形状"；
 * 这一层只做**形状转换 + 口径归一化**，不引入任何新口径。
 *
 * 归一化规则（`docs/伤害公式.md` §1.1）：
 *   · 武器的 `critChance` / `statusChance` 是 0~1 小数 → 直接用
 *   · `mods.json` 的 `levelValues` 是 0~100 百分数 → 转成内核的百分比口径（原样即可，内核 percent 用 165 表示 +165%）
 *   · 属性键 → `ContribStat`：`elemental:heat` / `physical:impact` / `faction:grineer` …
 */
import type { DamageType } from '../../core/src/damage-types.ts';
import type { Contribution, ContribStat, Faction } from '../../core/src/contributions.ts';

export interface ModStat {
  key: string;
  stat: string;
  bucket: string | null;
  unit: 'percent' | 'flat' | 'multiplier';
  kind: 'normal' | 'conditional' | 'functional' | 'special' | 'skip';
  levelValues: number[];
}

export interface ModRecord {
  id: string;
  name: { en: string; zh?: string };
  slotKind: string;
  category: string;
  maxRank: number;
  drain: number;
  rarity: string;
  polarity: string;
  stats: ModStat[];
  conditions?: unknown[];
  descriptionEn?: string;
  official?: { compatName?: string; uniqueName?: string };
}

const FACTION_BY_MOD_ID: Readonly<Record<string, Faction>> = {
  bane_of_corpus: 'corpus',
  primed_bane_of_corpus: 'corpus',
  bane_of_grineer: 'grineer',
  primed_bane_of_grineer: 'grineer',
  bane_of_infested: 'infested',
  primed_bane_of_infested: 'infested',
  bane_of_orokin: 'orokin',
  primed_bane_of_orokin: 'orokin',
  bane_of_the_murmur: 'murmur',
  primed_bane_of_the_murmur: 'murmur',
};

export function factionOfMod(modId: string): Faction | null {
  return FACTION_BY_MOD_ID[modId] ?? null;
}

export const FACTION_LABELS: Readonly<Record<Faction, string>> = {
  grineer: 'Grineer（格令纳）',
  corpus: 'Corpus',
  infested: 'Infested',
  orokin: 'Orokin',
  murmur: 'Murmur（低语者）',
  none: '不计派系',
};

/**
 * Mod 属性 → 内核贡献。**一个 Mod 可以有多个属性**（如「重口径」= 基伤 +165% / 精准度 -55%）。
 *
 * @param rank 当前等级（0 ~ maxRank）
 */
export function modToContributions(mod: ModRecord, rank = mod.maxRank, slot?: number): Contribution[] {
  const out: Contribution[] = [];
  // D-091：半自动炮轰系列（Semi-*-Cannonade）的负面「Fire Rate cannot be modified」。
  // 标记挂在**每条**贡献上，内核见到就清掉所有射速来源（正的负的都算）。
  const locksFireRate = SEMI_CANNONADE_MODS.has(mod.id);
  // 复合元素 Mod（如「生化弹药」同时给病毒与磁力）只能生效一个，取第一个，另一个标为未生效
  let compoundSeen = false;
  // 无限叠层类（弹能过继等）：数据值是每层值，按满层极限换算
  const stacks = modStackFactor(mod.id);
  for (const s of mod.stats) {
    const stat = toContribStat(s, mod.id);
    if (!stat) continue;
    const value = s.levelValues[Math.min(rank, s.levelValues.length - 1)] ?? 0;
    if (value === 0) continue;
    // 镀层 / 异况类（`co`）的 `levelValues` 是**每层值**（步枪才能 40），内核 `overForStacks`
    // 会乘 「异况数量 a × 叠层上限 y」，所以这里原样传，不再换算。
    const isCo = s.key === 'co';
    const amount = isCo ? value : value * stacks;
    const isCompoundStat = stat.startsWith('elemental:') && isCompoundElement(stat.slice('elemental:'.length));
    const suppressed = isCompoundStat && compoundSeen;
    if (isCompoundStat) compoundSeen = true;
    out.push({
      stat,
      form: s.unit === 'flat' ? 'flat' : s.unit === 'multiplier' ? 'mul' : 'pct',
      amount,
      source: mod.id,
      ...(slot !== undefined ? { slot } : {}),
      ...(suppressed ? { active: false } : {}),
      ...(locksFireRate ? { locksFireRate: true } : {}),
      label: `${mod.name.zh ?? mod.name.en} ${fmtStatValue(s, amount)}${isCo ? ' / 每种异常状态' : ''}${stacks > 1 ? `（满层：每层 ${round(value)}% × ${stacks}）` : ''}${suppressed ? '（复合元素只能生效一个，已忽略）' : ''}`,
    });
  }
  return out;
}

/**
 * 半自动炮轰系列（D-091）：Semi-Pistol / Semi-Rifle / Semi-Shotgun Cannonade。
 *
 * 两条规则来自 Mod 描述 `Only compatible with Semi-Auto Trigger. Fire Rate cannot be modified.`：
 *   1. **射速锁定**：所有射速来源（含负射速）都不生效 → `Contribution.locksFireRate`；
 *   2. **只能装在纯半自动武器上**：武器本身只有 1 个射击模式、且该模式是 semi。
 */
export const SEMI_CANNONADE_MODS: ReadonlySet<string> = new Set([
  'semi_pistol_cannonade',
  'semi_rifle_cannonade',
  'semi_shotgun_cannonade',
]);

/** 该 Mod 是否属于"只能装纯半自动武器"的半自动炮轰系列 */
export function isSemiCannonade(mod: { id: string }): boolean {
  return SEMI_CANNONADE_MODS.has(mod.id);
}

/** 判定所需的武器射击模式（只取需求方关心的字段） */
export interface TriggerModeLike {
  trigger: string;
  /** 灵化模式（`role === 'incarnon'`）不参与判定 */
  role?: string;
}

/**
 * 半自动炮轰系列的可装备性：**只考虑武器本身的射击模式**。
 *
 * 需求方 2026-11-06：
 * > 「半自动系列 mod 只能装备在只有一个射击模式，且该射击模式为半自动的武器上。
 * > 注意，只考虑武器本身的射击模式，不考虑灵化模式的射击模式，因为灵化模式是后面附加到武器上的。」
 *
 * 所以先把 `role === 'incarnon'` 的模式**剔掉**，剩下的必须**恰好 1 个**且 `trigger === 'semi'`。
 *
 * 例：Paris（普通/蓄力/灵化）→ 剔掉灵化后仍有 2 个 → 不能装；
 *     Torid（semi + unknown）→ 2 个 → 不能装；Rubico（只有 1 个 semi）→ 能装。
 */
export function isSemiAutoOnlyWeapon(modes: readonly TriggerModeLike[] | undefined): boolean {
  if (!modes) return false;
  const own = modes.filter((m) => m.role !== 'incarnon');
  return own.length === 1 && own[0]?.trigger === 'semi';
}

/**
 * 该 Mod 是否**常驻生效**（不需要击杀叠层）。
 *
 * 背景（2026-11-05 需求方确认）：
 *   · 镀层类 = 「击杀后获得 buff，最多叠加 y 次」→ `conditions[]` 里有 `condition_overload`，`maxStacks` 即 y；
 *   · **异况超量 Condition Overload 是常驻生效，叠层恒为 1** —— 它的 `conditions` 是空数组，
 *     数据层因此没有 `maxStacks`，但这不代表"缺少数据"，而是"本来就只有 1 层"。
 */
export function isAlwaysOnConditionOverload(mod: ModRecord): boolean {
  if (!isConditionOverloadMod(mod)) return false;
  return !(mod.conditions ?? []).some((c) => (c as { group?: string }).group === 'condition_overload');
}

/**
 * 镀层类的叠层上限 y（`conditions[].maxStacks`）。
 * 常驻型的（异况超量）恒为 1；找不到时返回 null，由调用方决定如何提示。
 */
export function conditionOverloadMaxStacks(mod: ModRecord): number | null {
  if (!isConditionOverloadMod(mod)) return null;
  const cond = (mod.conditions ?? []).find((c) => (c as { group?: string }).group === 'condition_overload');
  const maxStacks = (cond as { maxStacks?: number } | undefined)?.maxStacks;
  if (typeof maxStacks === 'number' && maxStacks > 0) return maxStacks;
  // 异况超量：常驻生效，叠层恒为 1
  return isAlwaysOnConditionOverload(mod) ? 1 : null;
}

const COMPOUND_SET = new Set(['blast', 'gas', 'magnetic', 'radiation', 'corrosive', 'viral']);
function isCompoundElement(t: string): boolean {
  return COMPOUND_SET.has(t);
}

/**
 * 镀层 / 异况类基伤（`co` 属性键）的**每张卡满级百分比**（数据层口径，0~100）。
 *
 * 需求方 2026-11-06：「镀层步枪才能应该 80% 伤害/异常状态…其他的镀层基伤 mod 也要修改下」
 * —— 四张卡（异况超量 / 镀层 步枪才能 / 准确射手 / 通晓霰弹枪）统一为满级 +80%。
 * 加量 = `80% × a`（a = 目标身上异常状态种类数），**不乘叠层上限、与配几张卡无关**。
 */
export const CO_OVERLOAD_PERCENT = 80;

/** 数据层用的 `elemental:x` / `physical:x` 字符串 → 内核的模板字面量类型 */
function typedDamageStat(raw: string): ContribStat | null {
  const m = /^(elemental|physical):(.+)$/.exec(raw);
  if (!m) return null;
  return raw as ContribStat;
}

function fmtStatValue(s: ModStat, value: number): string {
  const sign = value > 0 ? '+' : '';
  if (s.unit === 'flat') return `${sign}${round(value)}（绝对值）`;
  if (s.unit === 'multiplier') return `×${round(value)}（乘算）`;
  return `${sign}${round(value)}%`;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 数据层的属性键 → 内核 `ContribStat`；返回 null 表示该属性不参与伤害计算 */
export function toContribStat(s: ModStat, modId: string): ContribStat | null {
  const raw = s.stat;
  // 集团特效（+X Justice / Truth …）不建模（D-116）：见 `isSyndicateEffectStat`
  if (isSyndicateEffectStat(s)) return null;
  if (raw.startsWith('elemental:') || raw.startsWith('physical:')) {
    const typed = typedDamageStat(raw);
    if (typed) return typed;
  }
  switch (raw) {
    case 'baseDamage':
      // 「镀层 / 条件过载」类走独立的 'co'（表 2.1），普通基伤走 'baseDamage'——
      // 数据层保留了 ZK 原始键 `key`，`co` 即条件过载类，见 `research/03-Mod数据抓取.md`
      return s.key === 'co' ? 'co' : 'baseDamage';
    case 'multishot':
      return 'multishot';
    case 'critChance':
      return 'critChance';
    case 'weakpointCritChance':
      return 'weakpointCritChance';
    case 'critMultiplier':
      return 'critMultiplier';
    case 'statusChance':
      return 'statusChance';
    case 'statusDamage':
      return 'statusDamage';
    case 'fireRate':
      return 'fireRate';
    // 装填速度与弹匣容量直接影响「持续伤害」口径（D-037），
    // 虽然数据里标成 functional/utility，但必须进计算。
    case 'reloadSpeed':
      return 'reloadSpeed';
    case 'magazine':
      return 'magazine';
    // 弹药效率（D-084）：不直接乘伤害，由内核换算成等效弹匣/最大弹药
    case 'ammoEfficiency':
      return 'ammoEfficiency';
    case 'faction':
      return `faction:${factionOfMod(modId) ?? 'none'}` as ContribStat;
    case 'weakpointDamage':
    case 'headshotDamage':
      return 'headshotDamage';
    default:
      return null; // utility / special / skip 不影响伤害
  }
}

/** 是否为「镀层 / 条件过载」类（ZK 键 `co`，见 `stat-map.ts` 第 110 行） */
export function isConditionOverloadMod(mod: ModRecord): boolean {
  return mod.stats.some((s) => s.key === 'co');
}

/**
 * 集团特效（`syndRadial`，描述里的 `+X Justice / Truth / Purity …`）**不进伤害计算**。
 *
 * 需求方 2026-11-06 确认：「+1 Justice」这类集团特效的伤害（充满后释放的冲击波）不建模＝不算，
 * 与其它「= 无效果」的集团特效保持一致。
 *
 * 踩过的坑：`stat-map.ts` 把 `syndRadial` 映射成 `baseDamage`，且 `bucket: null`，
 * `toContribStat` 认不出 `stat` 时也没有拦，于是 `modToContributions` 会给**每一张带集团卡的 Mod**
 * 凭空加 +1% 基伤（散射正义 → 收益显示 +203% 而不是 +200%）。
 */
export function isSyndicateEffectStat(s: ModStat): boolean {
  return s.key === 'syndRadial';
}

/**
 * **无限叠层**的武器专属 Mod：数据里的 `levelValues` 是**每层值**，
 * 而描述写的是「每层 X%……无硬性层数上限」（只有弹能过继写了 Max 15 stacks）。
 *
 * 需求方 2026-11-06 定：「固定取满级满层极限」。这里的 `stacks` 是**满级可叠到的层数**：
 *   · 描述里写了上限的，上限 ÷ 每层值（弹能过继 15 × 15% = 225%）；
 *   · 没写上限但给了「Capped at N%」的，满级值就是 N%，所以 = 1（数据里的满级值本身就是极限）。
 *
 * 命中这些 Mod 时，按 `每层值 × stacks` 传入内核（**不是**再乘一次数据里的满级值）。
 */
const UNBOUNDED_STACK_MODS: Readonly<Record<string, number>> = {
  clip_delegation: 15, // 弹能过继：每层 15%（满级） × 15 层 = +225% 触发 / +225% 多重
};

/** 一张 Mod 的叠层倍数（默认 1 = 原样使用数据值） */
export function modStackFactor(modId: string): number {
  return UNBOUNDED_STACK_MODS[modId] ?? 1;
}


// ─────────────────────────────────────────────────────────────
// 可装判定（D-001 / weapon-slots.json）
// ─────────────────────────────────────────────────────────────

export interface WeaponSlotResolution {
  broad: string;
  specific: string[];
  source: string;
  unresolved: boolean;
}

/** 与 `packages/data-build/src/mods/weapon-slots.ts` 的 `compatibleModKinds` 保持一致 */
export function compatibleModKinds(slots: WeaponSlotResolution): string[] {
  const out = new Set<string>([slots.broad]);
  switch (slots.broad) {
    case 'bow':
    case 'sniper':
      out.add('rifle');
      out.add('primary');
      break;
    case 'rifle':
    case 'shotgun':
      out.add('primary');
      break;
    case 'melee':
      for (const s of slots.specific) out.add(s);
      break;
    default:
      break;
  }
  return [...out];
}

/** 该武器的"可装 Mod 种类"集合（数据层已预算好，优先用它，避免两处规则漂移） */
export function modKindsFor(slotEntry: { modKinds: string[] } | undefined, slots: WeaponSlotResolution): string[] {
  return slotEntry?.modKinds ?? compatibleModKinds(slots);
}

// ─────────────────────────────────────────────────────────────
// 武器专属 Mod 过滤（D-029）
// ─────────────────────────────────────────────────────────────

/**
 * 该 Mod 能否装在这把武器上。
 *
 * 数据依据：`mods.json` 每条 `official.compatName`。实测取值分布（步枪池 122 张）：
 *   · `Rifle`    —— 通用步枪，任何步枪都能装（72 张）
 *   · `PRIMARY`  —— 通用主武器（含弓/狙击等，10 张）
 *   · 具体武器名 —— **专属 Mod**，只能装在该武器上（如 `Grakata`、`Soma Prime`、`Ogris`）
 *
 * 需求方 2026-11-05：「有的武器限定 Mod 不应该在这把武器上出现」。
 *
 * 判定规则（不按名字猜，只用数据）：
 *   1. `compatName` 是通用类别（Rifle / PRIMARY / Shotgun / Pistol / MELEE …）→ 允许；
 *   2. `compatName` 是具体武器名 → 与武器名（`name` / `nameZh`）匹配才允许；
 *   3. 缺 `compatName` → 允许（保守，不误杀）。
 */
const GENERIC_COMPAT = new Set([
  'RIFLE', 'PRIMARY', 'SHOTGUN', 'PISTOL', 'SECONDARY', 'MELEE', 'WARFRAME',
  'ARCHWING', 'ARCH-GUN', 'ARCHGUN', 'ARCH-MELEE', 'ARCHMELEE', 'SENTINEL', 'COMPANION',
  'KITGUN', 'RAILJACK', 'NECRAMECH', 'PLEXUS', 'AURA', 'EXILUS',
]);

export interface WeaponLike {
  id: string;
  name?: string;
  nameZh?: string;
  /** 导出里的唯一名，形如 `/Lotus/Weapons/Tenno/Rifle/Rifle` */
  uniqueName?: string;
}

export function isModCompatibleWithWeapon(mod: ModRecord, weapon: WeaponLike): boolean {
  const compat = (mod.official as { compatName?: string } | undefined)?.compatName;
  if (!compat) return true; // 缺字段不误杀
  if (GENERIC_COMPAT.has(compat.toUpperCase())) return true;
  // 具体武器名：与武器的 name / nameZh 比对（大小写不敏感、去空格）
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '');
  const target = norm(compat);
  const candidates = [weapon.name, weapon.nameZh, weapon.id].filter((s): s is string => Boolean(s)).map(norm);
  return candidates.some((c) => c === target || c.includes(target) || target.includes(c));
}

// ─────────────────────────────────────────────────────────────
// 赋能（arcanes.json）源码结束标记：上面还没真正开始
// ─────────────────────────────────────────────────────────────
export interface ArcaneRecord {
  id: string;
  key: string;
  name: { en: string; zh?: string };
  category: 'primary' | 'secondary' | 'bow' | 'shotgun' | 'melee' | 'kitgun';
  maxRank: number;
  effectKind: string;
  bucket: string | null;
  description: { en: string; zh?: string };
  levels: { rank: number; values: Record<string, number> }[];
}

/**
 * 赋能 → 内核贡献。
 *
 * **叠层型赋能按满层给值**（需求方 2026-11-06：「赋能直接设置满层数值，
 * 例如无情就是满层 360% 基伤」）。当前没有"层数/等级"调节 UI，所以一律取满层。
 *
 * 叠层型识别：描述里有 `Stacks up to Nx`，或数值槽里有 `STACKS`。此时
 *   `满层值 = 每层值 × N`（例：主要·无情 每层 30% × 12 层 = 360%）。
 * 非叠层型原样取第一个数值。
 *
 * **单条赋能可以有多个词条**（D-084）：数值槽的键名本身就带词条名，
 * 例如主要·准星 `[0].STATUS_CHANCE=30` + `[0].AMMO_EFF=6`。所以这里按槽名
 * 拆成多条贡献，而不是只取第一个数（旧实现会丢掉弹药效率那一条）。
 */
export function arcaneToContributions(arcane: ArcaneRecord, rank = arcane.maxRank, slot?: number): Contribution[] {
  const level = arcane.levels.find((l) => l.rank === rank) ?? arcane.levels[arcane.levels.length - 1];
  // ⚠ 不能因 `bucket === null` 就整个返回空：双词条赋能（霜冻/毒侵/电压/仇杀/同化）
  //   的 bucket 是 null，但它们的 `BONUS1`/`BONUS2` 由 ARCANE_BONUS_STATS 表给出属性。
  if (!level) return [];
  const perEntries = arcanePerStackValues(arcane, level);
  if (!perEntries.length) return [];
  if (ARCANE_IGNORED.has(arcane.key)) return [];

  const primaryStat = arcane.bucket ? bucketToStat(arcane.bucket) : null;
  const bonusStats = ARCANE_BONUS_STATS[arcane.key];
  /** 该词条映射到的内核属性（与下面循环里同一套优先级） */
  const statOf = (i: number, statKey: string, fullSlot: string): ContribStat | null | undefined => {
    let stat: ContribStat | null | undefined = resolveArcaneStatKey(arcane, statKey, fullSlot);
    if (stat === undefined) {
      const bonusIdx = /^BONUS(\d)$/i.exec(statKey)?.[1];
      if (bonusIdx !== undefined) stat = bonusStats?.[Number(bonusIdx) - 1] ?? null;
      else if (i === 0) stat = primaryStat;
    }
    return stat;
  };

  // D-123：导出槽不是加成值的（堡垒 / 过载），直接给满级值，不再走"每层 × 层数"。
  // ⚠ 死首不在这里：它的基伤照常叠 3 层（+360%），只有**弱点伤害**那一条不叠——
  //   那条由下面的 `flatAmount`（同一张表里只登记了 `weakpointDamage`）单独处理。
  const totalOverride = ARCANE_TOTAL_OVERRIDES[arcane.key];
  const allFlat = totalOverride !== undefined &&
    perEntries.every(([key, , slotName], i) => {
      const stat = statOf(i, key, slotName);
      return stat === null || (typeof stat === 'string' && Object.hasOwn(totalOverride, stat));
    }) && Object.keys(totalOverride).length > 0;
  if (allFlat) {
    return Object.entries(totalOverride!).map(([stat, amount]) => ({
      stat: stat as ContribStat,
      form: 'pct' as const,
      amount,
      source: arcane.key,
      ...(slot !== undefined ? { slot } : {}),
      label: `${arcane.name.zh ?? arcane.name.en} +${amount}%`,
    }));
  }
  const stacks = arcaneStackCount(arcane, level);
  const out: Contribution[] = [];
  // D-138：单数值槽拆多词条（次要·爆发：STAT_VALUE 同时是暴率与暴伤）
  const multi = ARCANE_MULTI_STATS[arcane.key];
  if (multi) {
    for (const [, perStack] of perEntries) {
      for (const stat of multi) {
        out.push({
          stat,
          form: 'pct' as const,
          amount: perStack * stacks,
          source: arcane.key,
          ...(slot !== undefined ? { slot } : {}),
          label: `${arcane.name.zh ?? arcane.name.en} +${perStack * stacks}%`,
        });
      }
    }
    return out;
  }
  for (const [i, [statKey, perStack, fullSlot]] of perEntries.entries()) {
    // 词条 → 内核属性（优先级：覆盖表 → BONUS1/BONUS2 表 → 第一条退回 bucket）
    const stat = statOf(i, statKey, fullSlot);
    // null = 明确不参与伤害计算（覆盖表标的，或 BONUS 表里就是 null）
    if (!stat) continue;

    // D-118：**不随层数叠加**的词条（主要·死首的弱点伤害那条，登记在 `ARCANE_TOTAL_OVERRIDES`）
    const flat = ARCANE_TOTAL_OVERRIDES[arcane.key];
    const flatAmount = flat && Object.hasOwn(flat, stat) ? flat[stat] : undefined;
    const amount = flatAmount !== undefined ? flatAmount : perStack * stacks;
    out.push({
      stat,
      form: 'pct',
      amount,
      source: arcane.key,
      ...(slot !== undefined ? { slot } : {}),
      label:
        flatAmount !== undefined
          ? `${arcane.name.zh ?? arcane.name.en} ${amount > 0 ? '+' : ''}${amount}%（不随层数叠加）`
          : stacks > 1
            ? `${arcane.name.zh ?? arcane.name.en} +${amount}%（满层：每层 ${perStack}% × ${stacks}）`
            : `${arcane.name.zh ?? arcane.name.en} +${amount}%`,
    });
  }
  return out;
}

/**
 * **导出的数值槽本身不是加成值**的赋能 → 真实满级值（D-123）。
 *
 * 导出的 `GIVE_STAT` / `GIVE_STAT_MAX` / `HAVE_STAT_MIN` 是「每点护甲 +1%、上限 500%」
 * 「能量 ≥90% 时给最大能量的 35%、层数上限 350%」这类**规则参数**，
 * `statForArcaneKey` 却按词条名把它们当成「每层加成」喂给了内核。
 * 需求方 2026-11-06：「堡垒和过载的收益还是不对」—— 这里按描述给出**满级满层值**，
 * 并且界面显示直接读它（`arcaneDisplayStats` 不再单独缩放），保证「显示的 = 算的」。
 *
 * | 赋能 | 导出 | 满级值 |
 * |---|---|---|
 | 主要·堡垒 | `GIVE_STAT:1` `GIVE_STAT_MAX:500` | 基伤 **+500%**（满护甲封顶） |
 * | 主要·过载 | `HAVE_STAT_MIN:90` `GIVE_STAT:35` `GIVE_STAT_CAP:350` | 多重 **+350%**（35% × 10 层） |
 * | 主要·死首 | `[1].val:30`（与基伤共用 3 层） | 弱点伤害 **+30%**（D-118：不随层数叠加） |
 */
const ARCANE_TOTAL_OVERRIDES: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  DamageForBonusArmour: { baseDamage: 500 },
  MultishotForMaxEnergy: { multishot: 350 },
  PrimaryDamageOnNoMelee: { weakpointDamage: 30 },
  SecondaryDamageOnNoMelee: { weakpointDamage: 30 }, // D-138：与主要·死首同口径
};

/**
 * 赋能**在界面上显示的词条**（D-116 / D-123：待选区与装备区都要有词条）。
 *
 * ⚠ D-123 修正：以前这里用一张显示缩放表显示**上限**（堡垒 500、过载 350），
 *   而真正喂给内核的仍是导出里的第一个数（1、35）——「描述改对了，收益还是不对」。
 *   现在数值合并在 `arcaneToContributions` 里完成，这里只是同一份结果的透传，
 *   所以**卡上显示的就是算进内核的**；「明确不生效」的赋能返回空数组，卡上不写任何提示。
 *
 * @returns `[{ stat, amount, label }]`，`amount` 为百分比口径
 */
export function arcaneDisplayStats(arcane: ArcaneRecord, rank = arcane.maxRank): { stat: ContribStat; amount: number; label: string | undefined }[] {
  return arcaneToContributions(arcane, rank).map((c) => ({
    stat: c.stat,
    amount: c.amount,
    label: c.label,
  }));
}

/**
 * `BONUS1` / `BONUS2` 这类**无语义槽名**的赋能 → 每个 BONUS 对应的内核属性。
 *
 * 官方导出的槽名只编号、不带词条含义，必须按 Mod 描述人工对齐（需求方要求
 * 「确认其他赋能是否正期生效所有词条」后逐条核对过）：
 *
 * | 赋能 | BONUS1 | BONUS2 |
 * |---|---|---|
 * | 主要·霜冻 PrimaryCritDmgAndMultishotOnColdProc | 暴伤 | 多重 |
 * | 主要·毒侵 PrimaryHeadshotCritMultOnHeadshot | 暴伤 | 多重 |
 * | 联结·电压 SecondaryReloadSpeedAndMultishotOnElectricProc | 装填速度 | 多重 |
 * | 霰弹·仇杀 ShotgunMultishotAndReloadSpeedOnCloseKill | 多重 | 装填速度 |
 * | 近战·同化 HeavyAttackDamageAndShieldOnShieldBreak | 基伤 | 护盾（不影响伤害） |
 *
 * 注意：**不能按 `bucket` 推断**。霜冻的 `bucket` 是 `multishot`，
 * 若照此推断，+3% 暴伤那条会被错算成多重（旧实现的 bug）。
 */
const ARCANE_BONUS_STATS: Readonly<Record<string, readonly (ContribStat | null)[]>> = {
  PrimaryCritDmgAndMultishotOnColdProc: ['critMultiplier', 'multishot'],
  PrimaryHeadshotCritMultOnHeadshot: ['critMultiplier', 'multishot'],
  SecondaryReloadSpeedAndMultishotOnElectricProc: ['reloadSpeed', 'multishot'],
  ShotgunMultishotAndReloadSpeedOnCloseKill: ['multishot', 'reloadSpeed'],
  HeavyAttackDamageAndShieldOnShieldBreak: ['baseDamage', null],
};

/**
 * **数值槽本身没有词条名**、但描述里其实有**多条加成**的赋能（D-138）。
 *
 * | 赋能 | 导出槽 | 描述 | 处理 |
 * |---|---|---|---|
 * | 次要·爆发 `MultishotForCombo` | `STAT_VALUE:20`（单槽） | 每层消耗的连击倍率 **+20% 暴击几率 和 暴击伤害** | 拆成暴率 +20 / 暴伤 +20 两条 |
 *
 * 之前只有 `bucket = critMultiplier` 兜底，暴率那一条整条丢了。
 * 两条都从同一个导出值取（描述里两个百分比相同）。
 */
const ARCANE_MULTI_STATS: Readonly<Record<string, readonly ContribStat[]>> = {
  MultishotForCombo: ['critChance', 'critMultiplier'],
};

/**
 * **词条名 → 内核属性**的显式覆盖（按赋能 id + 词条名）。
 *
 * 用于两种情况，两种情况都必须按 Mod 描述人工判定：
 * 1. 词条名没有语义（`VAL` 被过滤掉了，只能用 bucket），而 **bucket 是错的**；
 * 2. 词条名有语义但代码认不出（`AMOUNT` / `STAT1` / `CHANCE` …）。
 *
 * | 赋能 | 实际问题 | 处理 |
 * |---|---|---|
 * | 瀑流·耀炎 | 词条是 `BONUS`（基伤），流水线 `bucket` 写成 `statusChance` | 基伤 |
 * | 瀑流·精准 | `BONUS` = +300% **Crit Chance on Weakpoint Hits**，不是全局暴率 | 现无 weakpoint 暴率通路，**不生效** |
 * | 次要·妨害 | `BONUS` 是"二次触发的概率"，不是状态触发率词条 | **不生效** |
 * | 主要·激昂 | `BONUS` 是能量回复，不是状态触发率 | **不生效** |
 * | 次要·冷颤 | 裸 `.val` = "敌人多受 45% 伤害"，是独立终伤倍率 | **不生效**（等待其乘区确认） |
 * | 瀑流·强化 | `[BONUS,AMOUNT]` = +750 固定附加伤害（不是百分比） | **不生效** |
 * | 弓箭·利矢 | `BONUS.DAMAGE`，只作用于"下一发" | 基伤（上限口径已简化） |
 *
 * **D-116（需求方 2026-11-06）**：官方导出的数值槽里混着「条件 / 上限 / 层数 / 概率」，
 * 被 `statForArcaneKey` 按词条名一律当成了**每层加成**，于是算出了下面这些明显错的数：
 *
 * | 赋能 | 导出值 | 旧结果 | 现状 |
 * |---|---|---|---|
 * | 主要·堡垒 `DamageForBonusArmour` | `GIVE_STAT:1` `GIVE_STAT_MAX:500` | 基伤 +1 | **基伤 +500**（需求方：「应该是 500」） |
 * | 主要·过载 `MultishotForMaxEnergy` | `HAVE_STAT_MIN:90` `GIVE_STAT:35` `GIVE_STAT_CAP:350` | 多重 +90 | 多重 +350（35% × 10 层，需求方：按描述满层取） |
 * | 主要·衰弱 `SplitStatusProcsOnStackedStatusHit` | `CHANCE:100` | 触发 +1000 | **不生效**（追加异常的概率，不是触发率词条） |
 * | 主要·滞阻 `PrimaryJamEnemyWeaponsOnMagneticProc` | `JAM_RANGE:15` | 触发 +15 | **不生效**（干扰范围，不是触发率） |
 * | 主要·压缩 `ConvergeRadialAttackOnAim` | `RADIUS:0.2` `STAT1:100` `STAT2:5.5` | 无 | **不生效**（D-123：它会改爆炸范围、并按损失的半径加伤害/弹药效率，涉及半径数据，需求方明确「目前不实现」） |
 * | 主要·镀金弹头 `PrimaryDamagePerAmmoOnReload` | 只有 `DURATION` | 无 | **不生效**（每发弹药的加成按弹匣长度换算，待确认） |
 * | 主要·死首 `PrimaryDamageOnNoMelee` | `[1].val:30` `[2].val:-50` | 无 | 弱点伤害 +30（不随层数叠加，D-118；-50 后坐力仍忽略） |
 */
const ARCANE_STAT_OVERRIDES: Readonly<Record<string, Readonly<Record<string, ContribStat | null>>>> = {
  // ── bucket 标错、词条其实是基伤 ──
  SecondaryDamageOnHeatProc: { BONUS: 'baseDamage' },
  // ── D-116：上限 / 条件 / 概率被当成加成 ──
  // 主要·堡垒：每点护甲 +1%，上限 +500% —— 满护甲时就是 500%（需求方 2026-11-06）
  DamageForBonusArmour: { GIVE_STAT: 'baseDamage', GIVE_STAT_MAX: null },
  // 主要·过载：能量 ≥90% 时「最大能量的 35%」作为多重，上限 350% —— 按满层取 350%
  MultishotForMaxEnergy: { HAVE_STAT_MIN: null, GIVE_STAT: 'multishot', GIVE_STAT_CAP: null },
  // 主要·衰弱：100% 是「追加基本异常」的概率，不是触发几率
  SplitStatusProcsOnStackedStatusHit: { CHANCE: null },
  // 主要·滞阻：15 是干扰半径（米），不是触发几率
  PrimaryJamEnemyWeaponsOnMagneticProc: { JAM_RANGE: null },
  // 主要·压缩（D-123 需求方：「记下他改变爆炸范围增加伤害和弹药效率这件事，
  //   但是由于这个赋能过于复杂，涉及爆炸范围，目前不实现」）：
  //   描述 = 瞄准时爆炸半径 ×0.2，**每损失 1 米** +100% 伤害、+5.5% 弹药效率。
  //   要算它必须知道该武器的爆炸半径与"损失了多少米"，而半径目前不在内核里 → 整条不生效。
  ConvergeRadialAttackOnAim: { RADIUS: null, STAT1: null, STAT2: null },
  // 主要·镀金弹头：数值槽里没有任何加成值，只有持续时间
  PrimaryPlatedRound: { DURATION: null },
  // 主要·死首：裸 .val 放行后按顺序对齐 —— [1] **弱点伤害** +30%（D-118：不随层数叠加），[2] 后坐力 -50%
  // D-138：次要·死首同样登记（以前只登记了主要版，次要版这 30% 被当"裸 val"丢掉）。
  //   需求方 2026-11-06：「现版本游戏，弱点==爆头，请全部改为弱点描述」
  PrimaryDamageOnNoMelee: { VAL: 'weakpointDamage', VAL2: null },
  SecondaryDamageOnNoMelee: { VAL: 'weakpointDamage', VAL2: null },
  // 次要·低温：NUM_PROCS 是"施加 3 层冰冻异常"的层数，不是触发几率（D-138：不生效）
  SecondaryColdOnPuncture: { NUM_PROCS: null },
  // ── 不是伤害词条 / 没有对应通路 → 明确不生效（null 覆盖 bucket 推断，避免误算） ──
  SecondaryOnRollCritChanceOnHeadshot: { BONUS: null }, // +300% 暴率**仅对弱点命中**生效
  ExtraProcOnProc: { BONUS: null }, // +24% 是"二次触发的概率"，不是状态触发率词条
  PrimaryEnergyRegenOnImpactProc: { BONUS: null }, // 能量回复
  // 次要·冷颤：类镀层加成，**只对冰冻层数生效**（需求方 2026-11-06）
  SecondaryExtraDamagePerFreezeStack: { VAL: 'coFreeze' },
  // ── 词条名可识别，但指向的乘区要人工确认 ──
  LongbowDamageOnHeadshot: { DAMAGE: 'baseDamage' }, // "下一发"+300%
  StatusTriggerRadialDamage: { CHANCE: null, STAT1: null, RANGE: null }, // 需求方：设置成无效果
  BurningCystOnKill: { CHANCE: null, DAMAGE: null }, // DAMAGE 是触发物伤害，不是武器加成
  IceMistOnKill: { CHANCE: null, DAMAGE: null },
  LightningStrikeOnKill: { CHANCE: null, DAMAGE: null },
  ToxicBloodOnKill: { CHANCE: null, DAMAGE: null },
};

/**
 * 整个赋能**不参与伤害计算**的清单（数值根本不是武器伤害词条）。
 * 用整表排除，避免"第一个词条走 bucket 兜底"又把它们算进去。
 */
/**
 * **官方 \`STACKS\` 槽不可信**时的层数覆写（赋能 id → 真实层数）。
 *
 * 瀑流·耀炎（瀑流·耀炎）的导出是 \`[0].STACKS = 480\`，和描述 \`Stacks up to 480%\` 同源——
 * 那是**累加上限**（每层 12% → 40 层），不是层数。需求方 2026-11-06 确认：「耀炎是 480」
 * 指的就是那个 480%（40 层 × 12%）。
 */
const ARCANE_STACK_OVERRIDES: Readonly<Record<string, number>> = {
  SecondaryDamageOnHeatProc: 40, // 每层 12% × 40 = 480%
};

const ARCANE_IGNORED = new Set<string>(['SecondaryOnStatusProcBonusDamage']);

/** 解析单个赋能的某个词条 → 内核属性（null = 不参与伤害计算） */
function resolveArcaneStatKey(
  arcane: ArcaneRecord,
  statKey: string,
  fullSlot?: string,
): ContribStat | null | undefined {
  const override = ARCANE_STAT_OVERRIDES[arcane.key];
  if (override) {
    // 先按完整槽名（BONUS.AMOUNT），再按第一段（BONUS）。
    // ⚠ 只有**表里确实登记了这个键**才返回（含显式的 null = 明确不生效）；
    //   没登记 → undefined（未知），交给调用方继续兜底（BONUS1/BONUS2 表 / bucket）。
    const full = fullSlot?.toUpperCase();
    if (full !== undefined && Object.hasOwn(override, full)) return override[full];
    const upper = statKey.toUpperCase();
    if (Object.hasOwn(override, upper)) return override[upper];
  }
  return statForArcaneKey(statKey);
}

/**
 * 赋能满级数值槽 → 每个词条的**每层值**。
 *
 * 槽名的结构是 `[编号].<词条名>[.<后缀>]`，**同一编号下可以有多个词条**：
 * ```
 * 主要·准星  [0].STATUS_CHANCE=30  [0].AMMO_EFF=6  [0].DURATION=10  [0].MAX_STACKS=10
 * 主要·无情  [0].BONUS.val=30  [1].val=30                      ← 前者基伤、后者装填速度
 * 弓箭·利矢  [0].BONUS.DAMAGE=300                              ← 两段都是词条名
 * 神威·气力  [0].BONUS.CHANCE=50  [0].BONUS.STAT1=200  [0].BONUS.RANGE=6
 * ```
 * 规则：
 * - 词条名取**第一段**（`BONUS` / `STATUS_CHANCE` / `AMMO_EFF` …）；单段名非词条则退到第二段
 *   （`BONUS.DAMAGE` → `DAMAGE`）；
 * - **裸 `.val`**（`[1].val` 这种没有任何词条名的）无法判定，默认忽略——
 *   否则会把「主要·无情」的装填速度当成基伤再加一遍；只有在覆盖表里**显式登记**了
 *   `VAL`（第一个）/ `VAL2`（第二个）… 的赋能才放行（D-116：主要·死首的 `[1].val` 是爆头倍率）；
 * - 层数 / 持续时间 / 范围 / 冷却这类名字不是词条，过滤掉。
 */
export function arcanePerStackValues(
  arcane: ArcaneRecord,
  level: { values: Record<string, number> },
): [string, number, string][] {
  const out: [string, number, string][] = [];
  // 覆盖表里明确登记了 `VAL` 的赋能（如次要·冷颤）：裸 .val 就是唯一词条，放行
  const override = ARCANE_STAT_OVERRIDES[arcane.key];
  let bareSeen = 0;
  for (const [k, v] of Object.entries(level.values)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const rest = /^\[\d+\]\.(.+)$/.exec(k)?.[1];
    if (rest === undefined) continue;
    const parts = rest.split('.').filter((p) => !/^val$/i.test(p));
    if (!parts.length) {
      // 裸 .val：按出现顺序编号 VAL / VAL2 / VAL3 …，只有覆盖表登记过的才放行
      bareSeen += 1;
      const name = bareSeen === 1 ? 'VAL' : `VAL${bareSeen}`;
      if (override !== undefined && Object.hasOwn(override, name)) out.push([name, v, name]);
      continue;
    }
    const first = parts[0]!.toUpperCase();
    if (ARCANE_NON_STAT_NAMES.has(first) || first === 'VAL') continue;
    // `BONUS` 是容器名，真正的词条在后一段
    const name = first === 'BONUS' ? (parts[1] ?? 'BONUS') : parts[0]!;
    const upper = name.toUpperCase();
    if (upper === 'VAL' || ARCANE_NON_STAT_NAMES.has(upper)) continue;
    out.push([name, v, parts.join('.')]);
  }
  return out;
}

/** 数值槽里"不是词条"的名字 */
const ARCANE_NON_STAT_NAMES = new Set(['STACKS', 'MAX_STACKS', 'DURATION', 'MAX', 'TIME', 'RANGE', 'RADIUS', 'COOLDOWN']);

/** 赋能的数值槽名 → 内核属性（认不出返回 null） */
function statForArcaneKey(key: string): ContribStat | null | undefined {
  switch (key.toUpperCase()) {
    case 'BONUS':
    case 'DAMAGE':
    case 'BASE_DAMAGE':
      return 'baseDamage';
    case 'STATUS_CHANCE':
      return 'statusChance';
    case 'CRIT_DMG':
    case 'CRIT_DAMAGE':
    case 'CRITICAL_DAMAGE':
      return 'critMultiplier';
    case 'CRIT_CHANCE':
    case 'CRITICAL_CHANCE':
      return 'critChance';
    case 'MULTISHOT':
      return 'multishot';
    case 'FIRE_RATE':
      return 'fireRate';
    case 'AMMO_EFF':
    case 'AMMO_EFFICIENCY':
      return 'ammoEfficiency';
    case 'RELOAD':
    case 'RELOAD_SPEED':
      return 'reloadSpeed';
    default:
      // ⚠ 必须返回 undefined 表示"未知"：null 保留给覆盖表的"明确不生效"。
      //   两者混淆会让 BONUS1/BONUS2 之类的槽被误判成"已确定不生效"。
      return undefined;
  }
}

/**
 * 叠层型赋能的层数上限。
 *
 * 取值顺序（每一步都要过合理性校验）：
 * 1. 数值槽里的 `STACKS` / `MAX_STACKS`（官方导出的结构化字段）；
 * 2. 描述里的 `Stacks up to Nx`（带 `x` 才是层数）；
 * 3. 描述里的 `Stacks up to N%`——那是**总加成上限**，用 `上限 ÷ 每层值` 反推层数
 *    （瀑流·耀炎：每层 12%、上限 480% → 40 层）。
 *
 * ⚠ 官方导出的 `STACKS` **不是每一条都填层数**：瀑流·耀炎的 `[0].STACKS` 写的是 **480**
 * （和描述里的 480% 同源，是累加上限）。所以这里用「`STACKS` × 每层值」是否明显超过
 * 10000% 来判断它是不是层数，不合理就回退到描述。
 */
export function arcaneStackCount(arcane: ArcaneRecord, level?: { values: Record<string, number> }): number {
  const forced = ARCANE_STACK_OVERRIDES[arcane.key];
  if (forced !== undefined) return forced;
  const lv = level ?? arcane.levels[arcane.levels.length - 1];
  const desc = arcane.description?.en ?? '';
  const perStack = lv ? (arcanePerStackValues(arcane, lv)[0]?.[1] ?? 1) : 1;

  if (lv) {
    const key = Object.keys(lv.values).find((k) => /STACKS/i.test(k));
    const n = key ? lv.values[key] : undefined;
    // 层数 × 每层值 = 满层加成；超过 10000% 基本可以断定这个数是"上限"而不是"层数"
    if (typeof n === 'number' && n > 1 && n * perStack <= 10000) return n;
  }
  const times = /Stacks up to (\d+)x/i.exec(desc);
  if (times?.[1]) {
    const n = Number(times[1]);
    if (n > 1) return n;
  }
  const pct = /Stacks up to (\d+(?:\.\d+)?)%/i.exec(desc);
  if (pct?.[1] && perStack > 0) {
    const n = Math.round(Number(pct[1]) / perStack);
    if (n > 1) return n;
  }
  return 1;
}


function bucketToStat(bucket: string): ContribStat | null {  switch (bucket) {
    case 'baseDamage':
      return 'baseDamage';
    case 'multishot':
      return 'multishot';
    case 'critChance':
      return 'critChance';
    case 'critMultiplier':
      return 'critMultiplier';
    case 'statusChance':
      return 'statusChance';
    case 'fireRate':
      return 'fireRate';
    default:
      return null;
  }
}

export type { DamageType };
