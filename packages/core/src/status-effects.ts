/**
 * 异常状态（proc）相关机制。
 *
 * 目前只收录已确认的 Tau 机制；其他元素异常（病毒、腐蚀、热、切割…）
 * 待确认后逐条加入 docs/乘区归属表.md 并在本文件实现。
 */

/**
 * Tau 异常状态：触发几率易受性。
 *
 * 规则（需求方确认）：
 *   - 每层使目标受到的触发几率提高 10%。
 *   - 最多 10 层，即最多 +100%。
 *   - 每层持续 8 秒。
 *   - 对所有敌人类型**没有**伤害倍率加减，只作用于触发几率乘区。
 *
 * 公式：effectiveStatusChance = baseStatusChance × (1 + stacks × 0.1)
 * 例：5 层 Tau、实时触发 210% → 210% × (1 + 5×0.1) = 315%。
 */
export const TAU_STACK_BONUS_PER_STACK = 0.1;
export const TAU_MAX_STACKS = 10;
export const TAU_STACK_DURATION_SECONDS = 8;

/** 触发布尔上限：面板触发率是否封顶 100% —— 待确认，见 docs/乘区归属表.md */
export const STATUS_CHANCE_HARD_CAP = 3;

/**
 * 把 Tau 层数换算成触发几率的额外乘数。
 * @param stacks 目标身上的 Tau 异常层数（会被夹在 0..10）
 * @returns 乘数，无异常时为 1
 */
export function tauStatusChanceMultiplier(stacks: number): number {
  const clamped = Math.min(TAU_MAX_STACKS, Math.max(0, Math.floor(stacks)));
  return 1 + clamped * TAU_STACK_BONUS_PER_STACK;
}

/** 便于展示：给定层数，返回该层数提供的额外百分比 */
export function tauBonusPercent(stacks: number): number {
  return (tauStatusChanceMultiplier(stacks) - 1) * 100;
}

/** 计算叠加 Tau 后的实际触发几率（输入输出均为百分比口径，如 210 表示 210%） */
export function applyTauToStatusChance(statusChancePercent: number, stacks: number): number {
  return statusChancePercent * tauStatusChanceMultiplier(stacks);
}
