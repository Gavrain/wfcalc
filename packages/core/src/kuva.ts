/**
 * 玄骸 / 变体标记。
 *
 * 官方导出里有 `variantType` 字段，可以区分 Prime / Kuva（玄骸）/ Syndicate 等。
 * 玄骸武器（Kuva / Tenet / Coda 系）额外带有一个元素加成，范围 25%~60%，
 * 具体数值在计算器阶段由用户选择，这里只做标记与范围登记。
 */

/** 玄骸类武器可选的元素加成 */
export const KUVA_ELEMENT_TYPES = ['impact', 'puncture', 'slash', 'heat', 'cold', 'electric', 'toxin'] as const;
export type KuvaElement = (typeof KUVA_ELEMENT_TYPES)[number];

/** 玄骸加成的取值范围（需求方确认：25% ~ 60%） */
export const KUVA_BONUS_MIN = 0.25;
export const KUVA_BONUS_MAX = 0.6;

/** 是否属于玄骸类武器（需要元素加成输入） */
export function isKuvaFamily(id: string, variantType?: string): boolean {
  if (variantType === 'VT_KUVA') return true;
  return /^(Kuva|Tenet|Coda)/.test(id);
}
