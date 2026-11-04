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
] as const;

export type DamageType = (typeof DAMAGE_TYPES)[number];

/** 物理三元素 */
export const PHYSICAL_TYPES: readonly DamageType[] = ['impact', 'puncture', 'slash'];

/** 由基础元素组合得到、不能在面板上直接叠加的复合元素 */
export const COMPOUND_TYPES: readonly DamageType[] = ['blast', 'gas', 'magnetic', 'radiation', 'corrosive', 'viral'];

/** 既非物理、也非复合元素的基础元素 */
export const BASE_ELEMENTAL_TYPES: readonly DamageType[] = ['heat', 'cold', 'electric', 'toxin'];

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
};

/** 伤害分布：未出现的类型视为 0 */
export type DamageSpread = Partial<Record<DamageType, number>>;

export const isPhysical = (t: DamageType): boolean => PHYSICAL_TYPES.includes(t);
export const isCompound = (t: DamageType): boolean => COMPOUND_TYPES.includes(t);

/** 分布求和 */
export function spreadTotal(s: DamageSpread): number {
  let total = 0;
  for (const k in s) {
    const v = s[k as DamageType];
    if (v) total += v;
  }
  return total;
}

/** 分布按比例缩放；总和为 0 时原样返回 */
export function scaleSpread(s: DamageSpread, factor: number): DamageSpread {
  const total = spreadTotal(s);
  if (total <= 0) return { ...s };
  const out: DamageSpread = {};
  for (const k in s) {
    const t = k as DamageType;
    const v = s[t];
    if (v) out[t] = (v * factor);
  }
  return out;
}
