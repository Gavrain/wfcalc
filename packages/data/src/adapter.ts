/**
 * 数据 → 计算内核贡献（Contribution）的适配层。
 *
 * 数据层产出（`packages/data/src/generated/`）是"流水线形状"，内核用的是"贡献表形状"；
 * 这一层只做**形状转换 + 口径归一化**，不引入任何新口径。
 *
 * 归一化规则（依据：核心事实）：
 *   · 武器的 `critChance` / `statusChance` 是 0~1 小数 → 直接用
 *   · `mods.json` 的 `levelValues` 是 0~100 百分数 → 转成内核的百分比口径（原样即可，内核 percent 用 165 表示 +165%）
 *   · 属性键 → `ContribStat`：`elemental:heat` / `physical:impact` / `faction:grineer` …
 */
import type { DamageType } from '../../core/src/damage-types.ts';
import type { Contribution, ContribStat, Faction } from '../../core/src/contributions.ts';
import {
  SEMI_CANNONADE_MODS,
  LOCKS_MULTISHOT_MODS,
  COMBO_SCALED_STATS,
  UNBOUNDED_STACK_MODS,
  FACTION_BY_MOD_ID,
  GENERIC_COMPAT,
  COMPAT_CLASS_TO_SPECIFIC,
} from './manual/mods.ts';
import {
  ARCANE_STAT_OVERRIDES,
  ARCANE_BONUS_STATS,
  ARCANE_MULTI_STATS,
  ARCANE_TOTAL_OVERRIDES,
  ARCANE_STACK_OVERRIDES,
  ARCANE_NO_STACKS,
  ARCANE_IGNORED,
  ARCANE_NON_STAT_NAMES,
} from './manual/arcanes.ts';

export interface ModStat {
  key: string;
  stat: string;
  bucket: string | null;
  unit: 'percent' | 'flat' | 'multiplier';
  kind: 'normal' | 'conditional' | 'functional' | 'special' | 'skip';
  levelValues: number[];
  /** D-155：这条例在重击系攻击上 ×2（Mod 描述带 `(x2 for Heavy Attacks)` 或裂罅暴击词条） */
  heavyX2?: boolean;
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

export function factionOfMod(modId: string): Faction | null {
  return FACTION_BY_MOD_ID[modId] ?? null;
}

export const FACTION_LABELS: Readonly<Record<Faction, string>> = {
  grineer: 'Grineer（格令纳）',
  corpus: 'Corpus',
  infested: 'Infested',
  orokin: 'Orokin',
  murmur: 'Murmur（低语者）',
  techrot: 'Techrot（科技孢子）',
  scaldra: 'Scaldra（斯卡德拉）',
  sentient: 'Sentient（S 系）',
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
  // 需求方 2026-11-13：敏锐主武 / 敏锐手枪的「Multishot cannot be modified」，
  // 与锁射速同构，挂到每条贡献上，内核见到就清掉所有多重来源。
  const locksMultishot = LOCKS_MULTISHOT_MODS.has(mod.id);
  // 复合元素 Mod（如「生化弹药」同时给病毒与磁力）只能生效一个，取第一个，另一个标为未生效
  let compoundSeen = false;
  // 无限叠层类（弹能过继等）：数据值是每层值，按满层极限换算
  const stacks = modStackFactor(mod.id);
  for (const s of mod.stats) {
    // 需求方 2026-11-13：**按连击倍率**加成的词条（急进猛突 / 创口溃烂）。
    // 数据里是「每层连击倍率 +X%」，实际加量 = X% × 配置的连击倍率，
    // 所以这里直接换算成最终百分比，交给内核当普通暴击率 / 触发率贡献。
    const perCombo = COMBO_SCALED_STATS[s.stat];
    if (perCombo) {
      const value = s.levelValues[Math.min(rank, s.levelValues.length - 1)] ?? 0;
      if (value === 0) continue;
      const factor = comboFactor();
      const amount = value * factor;
      out.push({
        stat: perCombo,
        form: 'pct',
        amount,
        source: mod.id,
        ...(slot !== undefined ? { slot } : {}),
        ...(locksFireRate ? { locksFireRate: true } : {}),
        ...(locksMultishot ? { locksMultishot: true } : {}),
        label: `${mod.name.zh ?? mod.name.en} ${amount > 0 ? '+' : ''}${round(amount)}%（每层 ${round(value)}% × 连击倍率 ${factor}x）`,
      });
      continue;
    }
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
      // 需求方 2026-11-13：锁多重（敏锐主武 / 敏锐手枪）
      ...(locksMultishot ? { locksMultishot: true } : {}),
      // D-155：重击系攻击上这条暴击率 ×2（斩铁 / 镀层斩铁 / 牺牲斩铁 / 裂罅暴击词条）
      ...(s.heavyX2 && stat === 'critChance' ? { heavyX2: true } : {}),
      label: `${mod.name.zh ?? mod.name.en} ${fmtStatValue(s, amount)}${isCo ? ' / 每种异常状态' : ''}${stacks > 1 ? `（满层：每层 ${round(value)}% × ${stacks}）` : ''}${suppressed ? '（复合元素只能生效一个，已忽略）' : ''}${s.heavyX2 && stat === 'critChance' ? '（重击时 ×2）' : ''}`,
    });
  }
  return out;
}

// 表本身在 manual/mods.ts，这里重导出以保持既有导入路径可用
export { SEMI_CANNONADE_MODS, LOCKS_MULTISHOT_MODS } from './manual/mods.ts';

export function isSemiCannonade(mod: { id: string }): boolean {
  return SEMI_CANNONADE_MODS.has(mod.id);
}

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

export const DEFAULT_COMBO_MULTIPLIER = 12;

let comboMultiplier = DEFAULT_COMBO_MULTIPLIER;

/**
 * 设置当前的连击倍率（界面上的配置框调用它）。
 *
 * 放在适配层而不是内核：这个词条的加量 = 每层值 × 连击倍率，
 * 换算成最终百分比后再当普通暴率 / 触发率贡献传给内核，内核不需要知道「连击」这回事。
 */
export function setComboMultiplier(v: number): void {
  const n = Number(v);
  comboMultiplier = Number.isFinite(n) && n > 0 ? n : DEFAULT_COMBO_MULTIPLIER;
}

/** 当前的连击倍率 */
export function getComboMultiplier(): number {
  return comboMultiplier;
}

function comboFactor(): number {
  return comboMultiplier;
}

/** 次要·爆发的默认层数（需求方 2026-11-13：「默认可以设置成12层」） */
export const DEFAULT_BURST_STACKS = 12;

/** 次要·爆发的层数上限（「最高是带凯旋之爪时的13x连击倍率，即13层」） */
export const MAX_BURST_STACKS = 13;

let burstStacks = DEFAULT_BURST_STACKS;

/**
 * 设置次要·爆发的层数（界面配置框，**只有在装了次要·爆发时才显示**）。
 *
 * 层数 = 被消耗的连击倍率，范围 1~13，非法值回退到默认 12。
 */
export function setBurstStacks(v: number): void {
  const n = Math.round(Number(v));
  burstStacks = Number.isFinite(n) && n > 0 ? Math.min(MAX_BURST_STACKS, n) : DEFAULT_BURST_STACKS;
}

/** 当前的次要·爆发层数 */
export function getBurstStacks(): number {
  return burstStacks;
}

function burstStacksFactor(): number {
  return burstStacks;
}

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
    // 装填速度与弹匣容量直接影响「续航秒伤」口径（D-037），
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
    // 需求方 2026-11-13：处决伤害进**独立的处决伤害乘区**（内核 `finisherDamage`）
    case 'finisherDamage':
      return 'finisherDamage';
    // 需求方 2026-11-13：震地伤害进**独立的震地伤害乘区**，只对震地 / 重型震地生效
    case 'slamDamage':
      return 'slamDamage';
    // 需求方 2026-11-13：「划砍就当百分比暴击就行」
    case 'critOnSlide':
      return 'critChance';
    // 需求方 2026-11-13：细心瞄准的「-45% Bodyshot Damage」，只在关闭爆头时生效
    case 'bodyshotDamage':
      return 'bodyshotDamage';
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

/** 判定所需的武器射击模式（只取关心的字段） */
export interface TriggerModeLike {
  trigger: string;
  /** 灵化模式（`role === 'incarnon'`）不参与判定 */
  role?: string;
}

/** 判定所需的武器字段 */
export interface WeaponLike {
  id: string;
  name?: string;
  nameZh?: string;
  /** 武器槽位上的近战细类（`weapon-slots.json` 的 `slots.specific`，如 dagger / polearm） */
  specifics?: readonly string[];
}

/**
 * 这件 Mod 能不能装到这把武器上。
 *
 * 依据：核心事实 §11（可装判定只读数据给的字段）。
 * 取值顺序：
 * 1. `compatName` 是**通用类别**（Rifle / Primary / Shotgun …）→ 都能装；
 * 2. `compatName` 是**武器类别**（Daggers / Polearms / Whips …）→ 比对武器的槽位细类；
 * 3. 否则视为**具体武器名** → 与 name / nameZh / id 比对（大小写不敏感、去空格）。
 */
export function isModCompatibleWithWeapon(mod: ModRecord, weapon: WeaponLike): boolean {
  const compat = (mod.official as { compatName?: string } | undefined)?.compatName;
  if (!compat) return true; // 缺字段不误杀
  if (GENERIC_COMPAT.has(compat.toUpperCase())) return true;
  // 武器类别（如 Daggers）→ 武器的槽位细类里有对应的一项才算能装
  const classes = COMPAT_CLASS_TO_SPECIFIC[compat];
  if (classes) {
    const specifics = weapon.specifics ?? [];
    return classes.some((c) => specifics.includes(c));
  }
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
    // 需求方 2026-11-13：次要·爆发按**爆发层数**算（界面配置框，默认 12 层、最高 13 层）。
    // 数据值是「每层消耗的连击倍率 +X% 暴率 / +X% 暴伤」，所以满层 = X% × 层数。
    const burst = burstStacksFactor();
    for (const [, perStack] of perEntries) {
      for (const stat of multi) {
        out.push({
          stat,
          form: 'pct' as const,
          amount: perStack * burst,
          source: arcane.key,
          ...(slot !== undefined ? { slot } : {}),
          label: `${arcane.name.zh ?? arcane.name.en} +${Math.round(perStack * burst * 100) / 100}%（每层 ${perStack}% × ${burst} 层）`,
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
/**
 * **导出的数值槽本身不是加成值**的赋能 → 真实满级值。
 *
 * 依据：核心事实 §11（赋能：数据层给出每层值与层数上限）。
 * 换算表在 `manual/arcanes.ts` 的 `ARCANE_TOTAL_OVERRIDES`。
 */
export function arcaneDisplayStats(arcane: ArcaneRecord, rank = arcane.maxRank): { stat: ContribStat; amount: number; label: string | undefined }[] {
  return arcaneToContributions(arcane, rank).map((c) => ({
    stat: c.stat,
    amount: c.amount,
    label: c.label,
  }));
}

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
  // 需求方 2026-11-13：原文没有 STACKS 槽的赋能，层数恒为 1（数值本身就是满值）
  if (ARCANE_NO_STACKS.has(arcane.key)) return 1;
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
