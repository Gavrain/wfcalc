/**
 * 伤害类型：与官方导出 `DT_*` 键一一对应的语义化别名。
 *
 * 注意：物理三元素（impact/puncture/slash）与 11 种元素伤害在模型里地位不同——
 * 前者参与复合元素组合的"来源"，后者部分参与组合。详见 docs/ 下的核心事实。
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
  // 第 14 种：Tau。
  //
  // 官方导出的键名是 **`DT_SENTIENT`**（游戏内部按 S 系命名），游戏内显示为「Tau」——
  // 需求方 2026-11-13：「游戏内是 tau 类型伤害，但是我们都知道他跟 s 系有关」。
  //
  // ⚠ **Tau 伤害 ≠ 对 Sentient 派系的加成**：它对任何派系都没有伤害倍率
  //   （见下方 `NO_DAMAGE_MULTIPLIER_TYPES`），只通过「触发几率易受性」影响输出，
  //   见 `status-effects.ts` 的 `tauStatusChanceMultiplier`。
  //   键名用 `tau` 而不是 `sentient`，就是为了避免和「派系歧视 / Sentient 切口」混淆。
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
 *
 * - `void`（虚空）：需求方 2026-11-13 确认「目前只有指挥官武器能造成这个伤害类型，
 *   跟武器还没关联上」——名称留在表里备用，但武器配装用不到。
 * - `tau`：游戏内名为 Tau（官方导出键 `DT_SENTIENT`），只影响触发几率易受性。
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
 * 调用前置条件（口径见 依据：核心事实 与 依据：核心事实）：
 *   · 玄骸加成**不**在 `spread` 里，也不在 `physical` / `elemental` 里 ——
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