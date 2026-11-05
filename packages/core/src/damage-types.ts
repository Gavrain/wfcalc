/**
 * 伤害类型：与官方导出 `DT_*` 键一一对应的语义化别名。
 *
 * 注意：物理三元素（impact/puncture/slash）与 11 种元素伤害在模型里地位不同——
 * 前者参与复合元素组合的"来源"，后者部分参与组合。详见 docs/ 下的乘区归属表。
 */
export const DAMAGE_TYPES = [
  // 物理
  'impact',
  'puncture',
  'slash',
  // 基础元素
  'heat',
  'cold',
  'electric',
  'toxin',
  // 复合元素（由基础元素组合而成，不能在面板上直接叠加）
  'blast',
  'gas',
  'magnetic',
  'radiation',
  'corrosive',
  'viral',
  // 特殊
  'void',
  // 第 14 种：Tau（官方导出键 DT_SENTIENT）。
  // 不提供任何伤害类型倍率；其异常状态是"触发几率易受性"，
  // 见 status-resistance.ts 的 tauStatusChanceMultiplier。
  'tau',
];

export type DamageType = (typeof DAMAGE_TYPES)[number];

/** 物理三元素 */
export const PHYSICAL_TYPES: readonly DamageType[] = ['impact', 'puncture', 'slash'];

/** 由基础元素组合得到、不能在面板上直接叠加的复合元素 */
export const COMPOUND_TYPES: readonly DamageType[] = ['blast', 'gas', 'magnetic', 'radiation', 'corrosive', 'viral'];

/** 既非物理、也非复合元素的基础元素 */
export const BASE_ELEMENTAL_TYPES: readonly DamageType[] = ['heat', 'cold', 'electric', 'toxin'];

/**
 * 不提供任何伤害类型倍率的类型（不对任何派系增伤/减伤）。
 * 它们只可能通过异常状态机制影响最终伤害。
 */
export const NO_DAMAGE_MULTIPLIER_TYPES: readonly DamageType[] = ['void', 'tau'];

/** 官方导出中 DT_* 键 → 本项目 DamageType */
export const DT_KEY_MAP: Readonly<Record<string, DamageType>> = {
  DT_IMPACT: 'impact',
  DT_PUNCTURE: 'puncture',
  DT_SLASH: 'slash',
  DT_FIRE: 'heat',
  DT_FREEZE: 'cold',
  DT_ELECTRICITY: 'electric',
  DT_POISON: 'toxin',
  DT_EXPLOSION: 'blast',
  DT_GAS: 'gas',
  DT_MAGNETIC: 'magnetic',
  DT_RADIATION: 'radiation',
  DT_CORROSIVE: 'corrosive',
  DT_VIRAL: 'viral',
  DT_VOID: 'void',
  DT_SENTIENT: 'tau',
};

/** 伤害分布：未出现的类型视为 0 */
export type DamageSpread = Partial<Record<DamageType, number>>;

export const isPhysical = (t: DamageType): boolean => PHYSICAL_TYPES.includes(t);
export const isCompound = (t: DamageType): boolean => COMPOUND_TYPES.includes(t);

/** 分布求和 */
export function spreadTotal(s: DamageSpread): number {
  let total: number = 0;
  const keys = Object.keys(s);
  for (const k of keys) {
    const v = s[k];
    if (v) total += v;
  }
  return total;
}

/**
 * 只合并**伤害分布**的加量（物理 + 元素）。
 *
 * 调用前置条件（口径见 `docs/伤害公式.md` §5 与 `docs/decisions.md` D-017）：
 *   · 玄骸加成**不**在 `spread` 里，也不在 `physical` / `elemental` 里 ——
 *     它必须在基伤之前单独算（`applyKuvaBonus`：面板总伤 × 比例），并随后被基伤括号放大；
 *   · 把玄骸混进 `spread` 会被当成"面板伤害"，导致元素 %Mod 的基数被重复计算。
 *
 * 正确顺序：玄骸 ∈ 面板基伤 → 乘基伤 → 本函数求新面板总伤 → 用它算元素加量 → 再两两合成。
 */
export function spreadTotalAfterMods(
  spread: DamageSpread,
  physical: Readonly<Partial<Record<DamageType, number>>> = {},
  elemental: Readonly<Partial<Record<DamageType, number>>> = {},
): number {
  let total: number = 0;
  const keys = Object.keys(spread);
  for (const k of keys) {
    const t: DamageType = k;
    const v = spread[t];
    if (!v) continue;
    // 物理与元素分别按各自的占比放大（例如 4.1 校验例 1：新面板总伤 = 100×2 + 100×1 = 300）
    if (isPhysical(t)) total += v * (1 + (physical[t] ?? 0));
    else total += v * (1 + (elemental[t] ?? 0));
  }
  return total;
}

/** 分布按比例缩放；总和为 0 时原样返回 */
export function scaleSpread(s: DamageSpread, factor: number): DamageSpread {
  const total: number = spreadTotal(s);
  if (total <= 0) return { ...s };
  const out: DamageSpread = {};
  const keys = Object.keys(s);
  for (const k of keys) {
    const t: DamageType = k;
    const v = s[t];
    if (v) out[t] = (v * factor);
  }
  return out;
}
