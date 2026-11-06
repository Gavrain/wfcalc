/**
 * 爆炸（Blast）异常：**独立机制**，不套用通用 DoT 模型（D-031）。
 *
 * ```
 * 每层伤害 = 基础伤害 × 系数 × (1+派系Mod) × 暴击伤害 × 异常状态伤害 × 伤害弱点（乘法叠加）
 *   系数：对主目标 0.3；满层/击杀后对周围敌人 → 3（D-031 修订：系数本身换成 3）
 * 结算时机 = min(1.5 秒延迟, 叠满 maxStacks, 目标死亡)
 * 范围 5 米，不受武器爆炸范围 Mod 影响
 * ```
 */
export const BLAST = {
  /** 延迟结算：1.5 秒 */
  delaySeconds: 1.5,
  /** 最大层数（一般 10 层；有些敌人有特殊上限，如 4 层） */
  maxStacks: 10,
  /** 每层系数：0.3 × 基础伤害 */
  perStackCoef: 0.3,
  /** 满层/击杀后对周围敌人的每层系数：3.0 × 基础伤害 */
  detonateCoef: 3.0,
  /** 范围半径（米），不受武器爆炸范围 Mod 影响 */
  radiusMeters: 5,
} as const;

export interface BlastDetail {
  /** 每层伤害（0.3 × 基础 × 派系 × 暴击伤害 × 异常伤害 × 伤害弱点） */
  perStack: number;
  /** 每秒期望能结算的层数 */
  stacksPerSecond: number;
  /** 每秒叠层是否能在 1.5 秒内达到满层 */
  reachesMaxInWindow: boolean;
  /** 达到满层的耗时（秒），达不到则 null */
  timeToMaxSeconds: number | null;
  /** 对**主目标**的每秒秒伤（未满层时按实际层数均摊到 1 秒） */
  perSecond: number;
  /** 满层触发后每层伤害（**系数 0.3 → 3**，D-031 修订） */
  perStackDetonated: number;
  /** 对**周围敌人**的范围伤害每秒（系数 3，非主目标） */
  splashPerSecond: number;
  /** 是否已触发范围伤害（满层或击杀） */
  splashActive: boolean;
  /** 对主目标 6 秒合计 */
  total6s: number;
  /** 范围伤害 6 秒合计 */
  splash6s: number;
}

/**
 * 爆炸异常（D-031）。
 *
 * 与通用 DoT 的区别：
 *   · 有**层数上限**（其他 DoT 没有上限）；
 *   · 有**延迟结算**与**满层触发的系数跃升**；
 *   · 满层后对周围敌人按系数 3 结算，范围伤害**单列**展示。
 */
export function blastDetail(
  baseValue: number,
  stacksPerSecond: number,
  opts: { factionPct: number; statusDamagePct: number; critDamageMul: number; headshotMul: number },
): BlastDetail {
  const multiplier =
    (1 + opts.factionPct) * opts.critDamageMul * (1 + opts.statusDamagePct) * opts.headshotMul;

  // 系数：0.3（普通）/ 3（满层或击杀后，对周围敌人）
  const perStack = baseValue * BLAST.perStackCoef * multiplier;
  const perStackDetonated = baseValue * BLAST.detonateCoef * multiplier;

  const secondsToMax = stacksPerSecond > 0 ? BLAST.maxStacks / stacksPerSecond : Infinity;
  const reachesMax = secondsToMax <= BLAST.delaySeconds;
  const timeToMaxSeconds = reachesMax ? secondsToMax : null;

  // 对主目标：1.5 秒窗口结束时的层数均摊到 1 秒
  const effectiveStacks = reachesMax ? BLAST.maxStacks : stacksPerSecond * BLAST.delaySeconds;
  const perSecond = perStack * effectiveStacks;

  // 对周围敌人（非主目标）：只有满层/击杀才触发，每秒按系数 3 × 层数
  const splashActive = reachesMax && stacksPerSecond > 0;
  const splashPerSecond = splashActive ? perStackDetonated * BLAST.maxStacks : 0;

  return {
    perStack,
    stacksPerSecond,
    reachesMaxInWindow: reachesMax,
    timeToMaxSeconds,
    perSecond,
    perStackDetonated,
    splashPerSecond,
    splashActive,
    total6s: perSecond * 6,
    splash6s: splashPerSecond * 6,
  };
}
