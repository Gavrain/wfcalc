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
import type { Contribution, ContribStat } from '../../core/src/contributions.ts';
import type { Faction } from '../../core/src/main.ts';

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
  // 复合元素 Mod（如「生化弹药」同时给病毒与磁力）只能生效一个，取第一个，另一个标为未生效
  let compoundSeen = false;
  for (const s of mod.stats) {
    const stat = toContribStat(s, mod.id);
    if (!stat) continue;
    const value = s.levelValues[Math.min(rank, s.levelValues.length - 1)] ?? 0;
    if (value === 0) continue;
    const isCompoundStat = stat.startsWith('elemental:') && isCompoundElement(stat.slice('elemental:'.length));
    const suppressed = isCompoundStat && compoundSeen;
    if (isCompoundStat) compoundSeen = true;
    out.push({
      stat,
      form: s.unit === 'flat' ? 'flat' : s.unit === 'multiplier' ? 'mul' : 'pct',
      amount: value,
      source: mod.id,
      ...(slot !== undefined ? { slot } : {}),
      ...(suppressed ? { active: false } : {}),
      label: `${mod.name.zh ?? mod.name.en} ${fmtStatValue(s, value)}${suppressed ? '（复合元素只能生效一个，已忽略）' : ''}`,
    });
  }
  return out;
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
  if (raw.startsWith('elemental:')) return raw;
  if (raw.startsWith('physical:')) return raw;
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
    case 'faction':
      return `faction:${factionOfMod(modId) ?? 'none'}`;
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
// 赋能（arcanes.json）
// ─────────────────────────────────────────────────────────────

export interface ArcaneRecord {
  id: string;
  key: string;
  name: { en: string; zh?: string };
  category: 'primary' | 'secondary' | 'melee' | 'kitgun';
  maxRank: number;
  effectKind: string;
  bucket: string | null;
  description: { en: string; zh?: string };
  levels: { rank: number; values: Record<string, number> }[];
}

/**
 * 赋能 → 内核贡献。
 *
 * ⚠ 目前只处理**结构明确**的几类（百分比加成到某个乘区）；条件型/叠层型（如"击杀时 +30%，最多 12 层"）
 * 需要用户输入实际叠层数，A-04 已确认用"三选一 + 勾选"解决，这里先给出**满层上限**并把 `active` 置 false，
 * 由 demo 的勾选控制——不擅自替用户假设层数。
 */
export function arcaneToContributions(arcane: ArcaneRecord, rank = arcane.maxRank, slot?: number): Contribution[] {
  const level = arcane.levels.find((l) => l.rank === rank) ?? arcane.levels[arcane.levels.length - 1];
  if (!level || !arcane.bucket) return [];
  const values = Object.values(level.values).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!values.length) return [];
  // 取第一个数值作为该赋能的主数值（其余是上限/叠加层数，见 level.values）
  const amount = values[0]!;
  const stat = bucketToStat(arcane.bucket);
  if (!stat) return [];
  return [
    {
      stat,
      form: 'pct',
      amount,
      source: arcane.key,
      ...(slot !== undefined ? { slot } : {}),
      label: `${arcane.name.zh ?? arcane.name.en} +${amount}%`,
    },
  ];
}

function bucketToStat(bucket: string): ContribStat | null {
  switch (bucket) {
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
