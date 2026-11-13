/**
 * 爆炸（Blast）异常：**独立机制**，不套用通用 DoT 模型（D-031）。
 *
 * ```
 * 主目标：
 *   每一层 = 基础伤害 × 0.3 × (1+派系Mod) × 暴击伤害 × 异常状态伤害 × 伤害弱点
 *   叠几层就结算几层，每层恒定 0.3 倍 —— 叠层快慢、满不满 10 层都不影响主目标
 *
 * 范围（周围敌人）：
 *   只有「1.5 秒内叠满 10 层」或「目标死亡」那一下触发
 *   每层系数由 0.3 提升为 3，5 米范围，**单列展示、不进任何总伤**（D-171）
 * ```
 *
 * ⚠ **系数 0.3 → 3 只属于范围伤害**（需求方 2026-11-13）：
 *   > 「爆炸的系数变化只限于对范围伤害，主目标是不会受到这个范围伤害的。
 *   >   所以爆炸叠层的快慢不影响主目标伤害，只影响会不会触发范围伤害。」
 *   所以主目标**没有**层数上限，也没有"满层跃升"——1.5 秒延迟只决定"什么时候结算"，
 *   不改变结算多少。
 */
export const BLAST = {
  /** 延迟结算：1.5 秒 */
  delaySeconds: 1.5,
  /** 最大层数（一般 10 层；有些敌人有特殊上限，如 4 层）——只用于**范围伤害**的触发判定 */
  maxStacks: 10,
  /** 主目标每层系数：0.3 × 基础伤害 */
  perStackCoef: 0.3,
  /** 满层/击杀后**对周围敌人**的每层系数：3.0 × 基础伤害 */
  detonateCoef: 3.0,
  /** 范围半径（米），不受武器爆炸范围 Mod 影响 */
  radiusMeters: 5,
} as const;

export interface BlastDetail {
  /** 每层伤害（0.3 × 基础 × 派系 × 暴击伤害 × 异常伤害 × 伤害弱点） */
  perStack: number;
  /** 每秒期望叠层（与窗口无关，保留给界面显示"层/秒"） */
  stacksPerSecond: number;
  /**
   * 每秒叠层能否在 1.5 秒内把**范围伤害**触发出来（叠满 10 层）。
   *
   * ⚠ 它只决定"有没有 3 倍范围那一发"，**不影响主目标**。
   */
  reachesMaxInWindow: boolean;
  /** 叠满 10 层所需秒数（达不到则 null） */
  timeToMaxSeconds: number | null;
  /**
   * 窗口内对**主目标**的爆炸总伤（D-171）。
   *
   * = 窗口内叠上的层数 × 每层伤害；不看层数上限、不看结算延迟。
   */
  totalInWindow: number;
  /** 满层触发后**对周围敌人**的每层伤害（系数 0.3 → 3，D-031 修订） */
  perStackDetonated: number;
  /** 触发范围爆炸时，对**周围敌人**的范围伤害合计（未触发为 0，单列、不进总伤） */
  splashOnTrigger: number;
  /** 是否已触发范围伤害（满层或击杀） */
  splashActive: boolean;
  /** 兼容旧字段：对主目标的窗口合计（= {@link totalInWindow}） */
  total6s: number;
  /** 兼容旧字段：范围伤害的窗口合计（= {@link splashOnTrigger}） */
  splash6s: number;
}

/**
 * 爆炸异常（D-031 / D-171）。
 *
 * @param baseValue        每层的伤害基数（命中分布全类型之和，见 output.ts 的说明）
 * @param stacksPerSecond  每秒期望叠层
 * @param opts.stacksInWindow 窗口内**叠上去的层数**（= 每秒叠层 × 开火占比逐秒求和）；
 *   不传则按"窗口内全程开火"折算，即 `stacksPerSecond × window`
 * @param opts.window      窗口长度（秒，默认 6）
 */
export function blastDetail(
  baseValue: number,
  stacksPerSecond: number,
  opts: {
    factionPct: number;
    statusDamagePct: number;
    critDamageMul: number;
    headshotMul: number;
    /** 窗口内叠上去的层数（D-171）；不传则按全程开火折算 */
    stacksInWindow?: number;
    /** 窗口长度（秒，默认 6） */
    window?: number;
  },
): BlastDetail {
  const multiplier =
    (1 + opts.factionPct) * opts.critDamageMul * (1 + opts.statusDamagePct) * opts.headshotMul;

  const window = opts.window ?? 6;
  // 主目标：每层恒 0.3 倍，窗口里叠了几层就结算几层
  const perStack = baseValue * BLAST.perStackCoef * multiplier;
  // 范围：满层/击杀那一下对周围敌人是 3 倍
  const perStackDetonated = baseValue * BLAST.detonateCoef * multiplier;

  const secondsToMax = stacksPerSecond > 0 ? BLAST.maxStacks / stacksPerSecond : Infinity;
  const reachesMax = secondsToMax <= BLAST.delaySeconds;
  const timeToMaxSeconds = reachesMax ? secondsToMax : null;

  // 窗口内叠上的层数：调用方给的是**按真实开火时间逐秒累加**的值
  const stacked = opts.stacksInWindow ?? stacksPerSecond * window;
  const totalInWindow = perStack * stacked;

  // 范围伤害：只有"1.5 秒内能叠满 10 层"才会触发（需求方 2026-11-13：只影响是否触发）
  const splashActive = reachesMax && stacksPerSecond > 0;
  const splashOnTrigger = splashActive ? perStackDetonated * BLAST.maxStacks : 0;

  return {
    perStack,
    stacksPerSecond,
    reachesMaxInWindow: reachesMax,
    timeToMaxSeconds,
    totalInWindow,
    perStackDetonated,
    splashOnTrigger,
    splashActive,
    total6s: totalInWindow,
    splash6s: splashOnTrigger,
  };
}
