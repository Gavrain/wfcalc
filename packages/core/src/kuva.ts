/**
 * 玄骸 / 变体标记。
 *
 * 官方导出里有 `variantType` 字段，可以区分 Prime / Kuva（玄骸）/ Syndicate 等。
 * 玄骸武器（Kuva / Tenet / Coda 系）额外带有一个元素加成，范围 25%~60%，
 * 具体数值在计算器阶段由用户选择，这里只做标记与范围登记。
 */

/**
 * 玄骸类武器可选的元素加成。
 *
 * D-026（2026-11-05 需求方确认）：「玄骸加成类型为冰火毒电磁力辐射冲击」。
 * 依据 `乘区归属表.md` §4.4：加成类型 ∈ { 冰、火、毒、电、**磁力**、**辐射**、冲击 }。
 *
 * ⚠ 之前这里写成了 `impact/puncture/slash/heat/cold/electric/toxin`——
 *   多了穿刺、切割，少了磁力、辐射。修正为下面 7 种。
 */
export const KUVA_ELEMENT_TYPES = ['cold', 'heat', 'toxin', 'electric', 'magnetic', 'radiation', 'impact'];
export type KuvaElement = (typeof KUVA_ELEMENT_TYPES)[number];

/** 玄骸加成的取值范围（需求方确认：25% ~ 60%） */
export const KUVA_BONUS_MIN = 0.25;
export const KUVA_BONUS_MAX = 0.6;

/**
 * 是否属于玄骸类武器（需要元素加成输入）。
 *
 * ⚠ **不能只靠 id 前缀判断**（D-042）：数据里很多玄骸系武器的内部 id
 * 完全不带 `Kuva/Tenet/Coda`，例如：
 * ```
 * GrnBowWeapon              → Kuva Bramma
 * GrnKuvaLichRifleWeapon    → Kuva Chakkhurr
 * CrpBEArcaPlasmor          → Tenet Arca Plasmor
 * 1999InfShotgunWeapon      → Coda Bassocyst
 * ```
 * 只按 id 判断会漏掉 10 把（实测 14 vs 实际 24）。
 * 所以先看 `variantType`，再看**显示名**，最后才回退到 id 前缀。
 */
export function isKuvaFamily(id: string, variantType?: string, name?: string): boolean {
  if (variantType === 'VT_KUVA') return true;
  // 显示名以 Kuva / Tenet / Coda 开头（官方变体命名规则）
  if (name && /^(Kuva|Tenet|Coda)\s/i.test(name)) return true;
  return /^(Kuva|Tenet|Coda)/.test(id);
}
