/**
 * L6 输出口径（表 0.1 / 0.2 / 9 节）：把单段结算结果折算成可比较的伤害量。
 *
 * ```
 * 单弹头         = 合成后总伤 × 暴击期望 × 爆头开关（实弹**不乘多重**）
 * 单次射击       = 单弹头 × 多重
 * 连发秒伤       = 单次射击 × 射速（**不含装填**）
 * 续航秒伤       = 单次 × 弹匣 / (弹匣/射速 + 装填)（口径 B，全文档唯一除法）
 * 异常加权单层秒伤 / N 秒异常总伤 = Σ 各类型（每秒叠层 × 每跳），与 N 秒曲线
 * N 秒总伤       = 续航秒伤 × N + N 秒异常总伤          ← D-171
 * ```
 *
 * **D-171（需求方 2026-11-13）**：窗口从写死的 6 秒改成可选的 N 秒（1~6），
 * 并把「续航秒伤 × N + 异常总伤」单列成一个口径（续航秒伤本身含装填）。
 */
import type { AttackMode, Weapon } from './weapon.ts';
import { firstSegment, panelStats } from './weapon.ts';
import type { Contribution } from './contributions.ts';
import { sumPct } from './contributions.ts';
import { bucket } from './buckets.ts';
import { bladeShadowMultiplier } from './crit.ts';
import { spreadTotal } from './damage-types.ts';
import type { Ctx } from './ctx.ts';
import type { SegmentResult } from './segment.ts';
import { factionFor } from './segment.ts';
import type { DoTType, NonDamageStatusType } from './dot.ts';
import { DOT_TYPES, NON_DAMAGE_STATUS_TYPES, multishot, stacksPerShot } from './dot.ts';
import type { DamageType } from './damage-types.ts';
import type { BlastDetail } from './blast.ts';
import { BLAST, blastDetail } from './blast.ts';
import { firingFraction, firingIntervals, firingIntervalsWithin } from './timeline.ts';
import {
  dotSixSecondCurve,
  dotStackPool,
  hasDotElement,
  IMMEDIATE_TICK,
  stacksInWindow,
  steadyDotPerSecond,
} from './six-second.ts';
import { effectiveMagazine } from './weapon-state.ts';
import { DEFAULT_DOT_WINDOW_SECONDS } from './ctx.ts';

/**
 * D-107（Q6）：合成元素对应的**来源基础元素**。
 * 用于"这个触发池到底存不存在 / 该分多少份"——合成出来的元素没有面板份，
 * 但它的来源元素出现在基础分布里，就说明它确实会被触发。
 */
const DOT_ELEMENT_SOURCES: Record<DoTType | NonDamageStatusType, readonly DamageType[]> = {
  blast: ['heat', 'cold'],
  gas: ['heat', 'toxin'],
  radiation: ['heat', 'electric'],
  viral: ['cold', 'toxin'],
  magnetic: ['cold', 'electric'],
  corrosive: ['toxin', 'electric'],
  slash: [],
  heat: [],
  toxin: [],
  electric: [],
  cold: [],
  impact: [],
  puncture: [],
};

/** 输出口径 id（可比较 / 可作为备选区增幅基准的一类伤害量） */
export type OutputId =
  | 'pelletPerHit'
  | 'perShot'
  | 'hitDps'
  | 'sustainedDps'
  | 'dotPerSecond'
  | 'dot6s'
  | 'totalInWindow'
  | 'steadyDps';

/**
 * 口径 id 里「六秒」那个名字（D-171）。
 *
 * 字段名仍是 `dot6s`：它是**字段标识**，不是显示名。改名会让所有读它的测试、校验脚本、
 * 界面代码一起失效，而显示名已经随秒数变了（{@link windowLabel}）。
 */
export const DOT_WINDOW_OUTPUT_ID: OutputId = 'dot6s';

/** 「N 秒总伤」的口径 id（D-171） */
export const WINDOW_TOTAL_OUTPUT_ID: OutputId = 'totalInWindow';

export interface OutputLine {
  id: OutputId;
  label: string;
  description: string;
  /** 数值单位（如 `/弹头`、`/发`、`/秒`），空串表示无单位 */
  unit: string;
  /** 该口径下的伤害数值 */
  value: number;
}

/** 备选区可选的"增幅比较口径"（demo 的单选按钮） */
export const OUTPUT_IDS: readonly OutputId[] = [
  'pelletPerHit', // 单弹头
  'perShot', // 单次射击
  'hitDps', // 连发秒伤
  'sustainedDps', // 续航秒伤
  'dotPerSecond', // 异常加权单层秒伤
  'dot6s', // N 秒异常总伤（字段名沿用旧的 dot6s，显示名随窗口秒数变）
  'totalInWindow', // N 秒总伤（D-179：窗口内直击 + 窗口内异常）
  'steadyDps', // 稳态秒伤（D-180）
];

/**
 * 窗口口径的显示名（D-171）。
 *
 * 需求方 2026-11-13：
 * > 「六秒异常总伤改成 n 秒异常总伤」
 * > 「六改成 6 吧」
 *
 * 所以**一律用阿拉伯数字**：「6 秒异常总伤 / 6 秒总伤」，不再用「六秒」这种中文数字。
 */
export function windowLabel(seconds: number): string {
  return `${seconds}秒`;
}

export interface OutputBreakdown {
  lines: OutputLine[];
  /** 单弹头命中（期望，含暴击） */
  pelletPerHit: number;
  multishot: number;
  /** 单次射击（期望） */
  perShot: number;
  fireRate: number;
  hitDps: number;
  sustainedDps: number;
  dotPerSecond: number;
  /** N 秒异常总伤（含爆炸主目标，D-171） */
  dot6s: number;
  /** 本结果的窗口长度（秒，D-171） */
  windowSeconds: number;
  /** N 秒总伤 = 窗口内直击 + N 秒异常总伤（D-179：直击也走开火时间线） */
  totalInWindow: number;
  /** 窗口内直击（= 连发秒伤 × 窗口内开火时长，D-179） */
  directInWindow: number;
  /** 稳态秒伤：续航秒伤 + 各异常按「一个循环内能叠的层数」折算（D-180） */
  steadyDps: number;
  /** 稳态秒伤里的**异常部分**（DoT 五类，不含直击） — 需求方 2026-11-15（A5） */
  steadyDotDps: number;
  steadyBlastDps: number;
  /** 每个 DoT 类型的每秒输出（期望层数 × 每跳）——**各段合并**后的合计 */
  dotPerType: Partial<Record<DoTType, number>>;
  /** 每个 DoT 类型的每秒期望叠层——**各段合并**后的合计 */
  stacksPerType: Partial<Record<DoTType, number>>;
  /** 每个非伤害性异常的每秒期望叠层——**各段合并**后的合计（需求方 2026-11-12） */
  nonDamageStacks: Partial<Record<NonDamageStatusType, number>>;
  /**
   * 逐段的 DoT 明细（需求方 2026-11-12）。
   *
   * > 「由于现在有多个段了，这里也应该分段显示，他们触发的 dot 伤害会根据段的命中伤不一样」
   *
   * 所以每段各一份：该段自己的命中分布决定了它的触发池与每跳伤害，
   * 与别的段无关。界面按段显示，不再只给一个合并值。
   */
  dotBySegment: SegmentDotDetail[];
  /** 爆炸异常明细（D-031），无爆炸元素时 stacksPerSecond = 0 */
  blast: BlastDetail;
}

/** 单段的 DoT 明细 */
export interface SegmentDotDetail {
  /** 段在 `segments` 里的下标 */
  index: number;
  /** 该段每秒输出合计（Σ 各类型 每层秒伤 × 触发占比） */
  dotPerSecond: number;
  /** 该段 N 秒异常总伤（含该段的爆炸主目标） */
  dot6s: number;
  /** 该段每个 DoT 类型的每层秒伤 */
  dotPerType: Partial<Record<DoTType, number>>;
  /** 该段每个 DoT 类型的每秒期望叠层 */
  stacksPerType: Partial<Record<DoTType, number>>;
  /**
   * 该段每个**非伤害性异常**的每秒期望叠层（需求方 2026-11-12）。
   *
   * 它们不掉血，所以只有层/秒，没有每层伤害；也不进任何伤害口径。
   * 判据与 DoT 相同（D-109）：合成结束后面板里有这个元素才算。
   */
  nonDamageStacks: Partial<Record<NonDamageStatusType, number>>;
  /** 该段的爆炸明细 */
  blast: BlastDetail;
}

/**
 * 射速最终值（表 0.1）：`(面板 × (1+Σ射速%) + Σflat) × Πmul`
 *
 * 面板取该模式的值（D-050）：蓄力/灵化模式的射速与普通射击不同。
 */
export function fireRateFinal(weapon: Weapon, contribs: readonly Contribution[], mode?: AttackMode): number {
  const panel = mode ? panelStats(weapon, mode).fireRate : weapon.fireRate;
  return bucket(panel, 'fireRate', contribs);
}

/**
 * §9：把结算结果折算成六个输出口径。
 *
 * **需求方 2026-11-12**：
 * > 「不同段的伤害分布是不一样的，检查 core 计算流程中他们有没有混在一起。
 * >  应该是走完元素合成啥的，到最后计算 dps 才把各自的统计口径加起来。」
 *
 * 所以这里的口径是：
 * ```
 * 每段：各自走完 ①玄骸 → ②基伤 → ③④⑤元素合成 → 暴击 → DoT 每跳 → 爆炸
 *        得到该段自己的「单弹头 / 异常加权单层秒伤 / 六秒异常总伤」
 * 最后：命中类口径（单弹头 / 单次射击 / 连发秒伤 / 续航秒伤）把各段**单弹头相加再乘多重与射速**
 *       异常与爆炸类口径把各段的**每秒叠层与每跳**各自累加后统一积分
 * ```
 *
 *   多段武器（巴什穆的电击+火焰、伯斯顿 Prime 灵化的命中+爆炸、幻离子的子母弹…）
 *   的第二段起**完全没进 DPS**。巴什穆因此少算一半（44.85 而实际 66.70）。
 *
 * @param segmentResults 参与计算的全部段（按变体顺序，已按用户的勾选筛过）
 */
/**
 * 单段的 DoT 与爆炸口径（需求方 2026-11-12）。
 *
 * 「走完元素合成啥的，到最后计算 dps 才把各自的统计口径加起来」——
 * 所以每段**各自**跑一遍 DoT 每跳与爆炸异常，再在 `buildOutput` 里把各段结果相加。
 *
 * 多段武器（巴什穆电击+火焰、伯斯顿 Prime 灵化命中+爆炸）因此漏算后面的段。
 */
/**
 * 稳态秒伤里的**异常部分**（D-180；需求方 2026-11-15 重做，A4 + A5）。
 *
 * > 「加一个稳态秒伤……用来体现连续射击下弹匣装填的影响」
 * > 「全部按一个循环」
 *
 * ```
 * 循环 = 打空弹匣（弹匣 ÷ 射速）+ 装填
 * 异常 = 逐秒推进层数池（层数会到期清除，装填期间虽然不新增、但照样掉）
 *       循环内逐秒伤害之和 ÷ 循环时长
 * ```
 *
 * 高射速、大弹匣的武器会被算得虚高。
 */
/**
 * 本节 DoT 的持续时间（秒）。
 *
 * 依据：核心事实 §6.3 —— 每层独立计时，活满 `6 × (1 + Σ异常状态持续%)` 才掉。
 * 持续时间翻倍 → 跳数与总伤随之上涨，**单跳伤害不变**。
 */
function durationOfDot(contribs: readonly Contribution[]): number {
  const pct = sumPct(contribs, 'statusDuration');
  return Math.max(0.1, 6 * (1 + pct));
}

function steadyStateDot(
  segmentResults: readonly SegmentResult[],
  contribs: readonly Contribution[],
  ms: number,
  fr: number,
  mag: number,
  reload: number,
  window: number,
): { dot: number; blast: number } {
  const fireDur = fr > 0 && mag > 0 ? mag / fr : window;
  const cycle = fireDur + Math.max(0, reload);
  if (!(cycle > 0)) return { dot: 0, blast: 0 };
  // 与窗口无关的**真实时间线**：循环 + 6 秒尾巴（让循环末尾挂着的层结算完）
  const intervalsOf = (sec: number) => firingIntervals(mag, fr, reload, sec);
  let dotTotal = 0;
  let blastTotal = 0;
  for (const segRes of segmentResults) {
    const seg = segmentDotAndBlast(segRes, contribs, ms, fr, (sec: number) => {
      // 窗口型入参这里不用；给一个占位实现避免类型分叉（稳态不读 window）
      void sec;
      return 1;
    }, window);
    const items: {
      type: DoTType;
      stacksPerSecond: number;
      perStackPerSecond: number;
      immediateFirst?: boolean;
      stacksPerShot?: number;
    }[] = [];
    for (const tick of segRes.dotTicks) {
      const rate = seg.stacksPerType[tick.type] ?? 0;
      if (!(rate > 0) || !(tick.tick > 0)) continue;
      if (!((segRes.finalHit[tick.type] ?? 0) > 0)) continue; // 这一段没有这个元素
      items.push({
        type: tick.type,
        stacksPerSecond: rate,
        perStackPerSecond: tick.tick,
        immediateFirst: IMMEDIATE_TICK.has(tick.type),
        stacksPerShot: stacksPerShot(tick.type, segRes.finalHit, segRes.procChance, contribs, ms),
      });
    }
    dotTotal += steadyDotPerSecond(
      items,
      cycle,
      intervalsOf,
      (sec: number) => firingIntervalsWithin(mag, fr, reload, sec, cycle),
      // 依据：核心事实 §6.3 —— 持续时间 = 6 × (1 + Σ异常状态持续%)
      () => durationOfDot(contribs),
    );
    const blastSps = seg.blast.stacksPerSecond;
    if (blastSps > 0 && seg.blast.perStack > 0) {
      const series = dotStackPool('blast', blastSps, seg.blast.perStack, Math.ceil(cycle) + 6, intervalsOf, {
        duration: BLAST.delaySeconds,
        immediateFirst: false,
      });
      let sum = 0;
      for (const v of series) sum += v;
      blastTotal += sum / cycle;
    }
  }
  return { dot: dotTotal, blast: blastTotal };
}

function segmentDotAndBlast(
  res: SegmentResult,
  contribs: readonly Contribution[],
  ms: number,
  fr: number,
  firingTimeline: (sec: number) => number,
  window: number,
): {
  dotPerSecond: number;
  dot6s: number;
  dotPerType: Partial<Record<DoTType, number>>;
  stacksPerType: Partial<Record<DoTType, number>>;
  nonDamageStacks: Partial<Record<NonDamageStatusType, number>>;
  blast: BlastDetail;
} {
  const dotPerType: Partial<Record<DoTType, number>> = {};
  const stacksPerType: Partial<Record<DoTType, number>> = {};
  const nonDamageStacks: Partial<Record<NonDamageStatusType, number>> = {};

  /**
   * **D-189：近战·刃影只放大叠层**（需求方 2026-11-13）。
   *
   * > 「DoT/爆炸基础值 × (1 + w·P1)；这里不对，不放大 dot 基础值。只放大叠层」
   *
   * 追加那一下是一次**独立攻击**，它自己也会触发异常，所以：
   * ```
   * 单发叠层期望 × 刃影倍率      ← 本函数的唯一接入点
   * 每跳伤害（tick） × 1        ← 不放大
   * ```
   * 倍率由这一段自己的暴率 `res.critChance` 算（`P1 = 一级暴击概率`）。
   */
  const bladeMul = bladeShadowMultiplier(res.critChance, sumPct(contribs, 'bladeShadow'));

  // D-109（需求方 2026-11-06）：**该异常是否存在，只看「当前面板」里有没有这个元素**。
  //
  //   原话：「是否有这个异常应该看当前面板复合后有没有这个元素，而不是看他分解的，
  //          否则会出现电毒火复合成腐蚀火但是你也加上了毒气。」
  //   所以判据回到**这一段自己的**命中分布：合成结束后面板里有这个元素才算。
  const elementPresent = (t: DoTType): boolean => (res.finalHit[t] ?? 0) > 0;

  /**
   * 该类型分多少触发份。
   *
   * ⚠ 合成元素（毒气/腐蚀/辐射…）在命中分布里**没有单独的一份**——它是由来源元素
   *   合成出来的，那些份已经计入来源元素本身了。这里用**来源元素之和**只是为了让
   *   加权分母里仍能体现"这个触发池有多大"，**不代表它存在**（存在与否由 elementPresent 判）。
   */
  const dotShareOf = (t: DoTType): number => {
    const direct: number = res.finalHit[t] ?? 0;
    if (direct > 0) return direct;
    return (DOT_ELEMENT_SOURCES[t] ?? []).reduce(
      (sum: number, src: DamageType) => sum + (res.finalHit[src] ?? 0),
      0,
    );
  };

  // D-061：加权**只在有 DoT 的类型之间**分配。
  let dotSpreadTotal = 0;
  for (const t of DOT_TYPES) {
    if (!elementPresent(t as DoTType)) continue;
    dotSpreadTotal += dotShareOf(t as DoTType);
  }

  let dotPerSecond = 0;
  let dot6s = 0;
  for (const tick of res.dotTicks) {
    // ── D-055 / D-109：该元素**不在这一段里**就完全不参与 ──
    if (!elementPresent(tick.type)) {
      stacksPerType[tick.type] = 0;
      dotPerType[tick.type] = 0;
      continue;
    }

    // ── 口径一：**加权每层秒伤**（D-043 / D-060 / D-061）──
    const perStackPerSecond = tick.tick;
    const shareOfType = dotSpreadTotal > 0 ? dotShareOf(tick.type) / dotSpreadTotal : 0;
    dotPerType[tick.type] = perStackPerSecond;
    dotPerSecond += perStackPerSecond * shareOfType;

    // ── 口径二：**N 秒异常总伤**（D-043 / D-057 修订 / D-171）──
    // 单发层数 = 触发率 × 元素占比 × 多重；每秒叠层 = 单发层数 × 射速。
    // D-107：占比取自**这一段自己的**命中分布（`res.finalHit`）。
    // D-189：单发叠层期望再乘刃影倍率（追加那一下自己也会触发异常）。
    const stacksPerShotOfType =
      stacksPerShot(tick.type, res.finalHit, res.kind ? res.procChance : 0, contribs, ms) * bladeMul;
    const stacksPerSecond = stacksPerShotOfType * fr;
    stacksPerType[tick.type] = stacksPerSecond;

    // **逐秒曲线**（§0.2 / D-057 / D-058 / D-059）/ 窗口长度由需求方选（D-171）
    dot6s += dotSixSecondCurve(
      tick.type, stacksPerSecond, perStackPerSecond, window, firingTimeline, stacksPerShotOfType,
      durationOfDot(contribs),
    );
  }

  // ── 非伤害性异常（需求方 2026-11-12）：只要层/秒，不掉血 ──
  //
  // > 「把非伤害性异常也加上去，标上 xx 层/秒就行，不需要后面那个伤害。」
  //
  // 层数算法与上面完全同一套：触发率 × 元素占比 × 多重 × 射速。
  // 存在性判据也与 DoT 相同（D-109）：**合成结束后面板里有这个元素**才算，
  // 所以「电毒火复合成腐蚀火」不会凭空多出一行毒气/病毒。
  //
  // ⚠ 这些值**不进**任何伤害口径：异常加权、N 秒异常总伤、爆炸都不读它。
  //   冰冻不改护甲（需求方 2026-11-12：「冰冻不会让护甲减半，这个不搞」）。
  for (const t of NON_DAMAGE_STATUS_TYPES) {
    const present = (res.finalHit[t] ?? 0) > 0;
    if (!present) {
      nonDamageStacks[t] = 0;
      continue;
    }
    nonDamageStacks[t] = stacksPerShot(t, res.finalHit, res.kind ? res.procChance : 0, contribs, ms) * fr * bladeMul;
  }

  // 爆炸异常（D-031 / D-171）：独立机制。
  //
  //   · **主目标**：每层恒 0.3 倍，窗口里叠了几层就结算几层 —— 不看层数上限、不看 1.5 秒延迟
  //     （需求方 2026-11-13：「爆炸叠层的快慢不影响主目标伤害」）；
  //   · **范围**：只有 1.5 秒内叠满 10 层才触发，系数 0.3 → 3，单列展示、**不进任何总伤**。
  //
  // ⚠ 基础值**不能**取 `res.tickBaseScaled.blast`（D-056 修复）：
  //   tickBaseScaled 是"剔除元素/物理 Mod 加量"后的分布，而爆炸几乎总是由 Mod 合成
  //   （火+冰、火+电），那里根本没有 blast 这一项 → 恒为 0。
  //   按 §6.2 ①，DoT 基础值是「**全类型之和**」，爆炸同样适用。
  //
  // 收敛后统一读 `tickBaseScaled`（DoT 每跳与爆炸基础值本来就是同一份）。
  const blastBase = hasDotElement(res.finalHit, 'blast') ? spreadTotal(res.tickBaseScaled) : 0;
  // D-189：爆炸叠层同样乘刃影倍率（每层基础值 `blastBase` 不动）
  const blastStacks = stacksPerShot('blast', res.finalHit, res.procChance, contribs, ms) * bladeMul;
  const blastSps = blastStacks * fr;
  // D-171：窗口内叠上的层数按**真实开火时间**逐秒累加（装填期间不叠）
  const blastStacksInWindow = stacksInWindow(blastSps, window, firingTimeline);
  const detail = blastDetail(blastBase, blastSps, {
    factionPct: factionFor(res.faction, contribs),
    statusDamagePct: sumPct(contribs, 'statusDamage'),
    // ⚠ 这里要的是**暴击倍率**，不是命中伤害的绝对值（D-056 修复）。
    //   D-063：爆炸的 baseValue 取自 `res.tickBaseScaled`，而它**已经含**完整的期望倍率，
    //   所以这里传 1，否则会重复乘。
    critDamageMul: 1,
    headshotMul: 1,
    stacksInWindow: blastStacksInWindow,
    window,
  });

  return {
    dotPerSecond,
    dot6s,
    dotPerType,
    stacksPerType,
    nonDamageStacks,
    blast: {
      ...detail,
      // D-055：这一段没有爆炸元素时，爆炸根本不会触发 → 总伤归 0
      totalInWindow: blastStacks > 0 ? detail.totalInWindow : 0,
      total6s: blastStacks > 0 ? detail.totalInWindow : 0,
      splashOnTrigger: blastStacks > 0 ? detail.splashOnTrigger : 0,
      splash6s: blastStacks > 0 ? detail.splashOnTrigger : 0,
      // 逐段口径：这一段的每秒叠层（不是整个模式的）
      stacksPerSecond: blastSps,
    },
  };
}

export function buildOutput(
  weapon: Weapon,
  mode: AttackMode,
  contribs: readonly Contribution[],
  segmentResults: readonly SegmentResult[],
  ctx: Ctx,
): OutputBreakdown {
  // D-050：面板数值一律取**该模式**的（模式 override → 武器级回退）——多重同理，
  // 面板多重来自 `mode.multishot`，不能写死 1
  const ps = panelStats(weapon, mode);
  const ms = multishot(contribs, weapon, mode);
  const fr = fireRateFinal(weapon, contribs, mode);
  // ── 命中类口径：各段单弹头**相加**（每段已各自做完元素合成与暴击）──
  //
  // 需求方 2026-11-12：「射线的多重就是合成一跳」。所以射线段的 `singlePelletSpread`
  // 在 `resolveSegment` 里**已经乘过当前多重**，这里不能再乘一次——否则射线的命中伤害 / DPS
  // 会比 DoT 基础值多乘一次多重（两条口径对不上）。
  // 实弹段的单弹头不含多重，仍由这里的 `× ms` 统一折算成「单次射击」。
  const res: SegmentResult = segmentResults[0]!;
  const pelletPerHit = segmentResults.reduce((sum, r) => sum + r.line.average, 0);
  const perShot = segmentResults.reduce(
    (sum, r) => sum + (r.beam ? r.line.average : r.line.average * ms),
    0,
  );
  const hitDps = perShot * fr;

  // 弹匣与装填：吃 Mod 加成（D-037）。
  //   · `magazine` 是**弹匣容量**的加法 %；
  //   · `reloadSpeed` 是**装填速度**的加法 %，装填**时间** = 面板时间 ÷ (1 + Σ装填速度%)；
  //   · **弹药效率**（D-084 / D-123）：每发实际只消耗 `1-x`，
  //     打空同一份弹药能开 `1/(1-x)` 次 → 续航秒伤里的弹匣要乘这个倍数
  //      所以主要·准星 / 次要·妨害 / 头盔射击这类弹药效率词条"看起来没生效"）。
  //   这些词条都直接影响"续航秒伤"口径，所以它们不算纯功能类 Mod。
  //   面板值同样取该模式的（D-050）。
  const magBase: number = ps.magazineSize ?? 0;
  // 需求方 2026-11-15（A6+A7）：**等效弹匣**统一由 `effectiveMagazine()` 算——
  // = 桶弹匣 × 1/(1−弹药效率)，弹药效率上限 0.75。面板「弹匣容量」、拆解、这里三处同一个数。
  const mag: number = effectiveMagazine(magBase, contribs);
  const reloadBase: number = ps.reloadTime ?? 0;
  const reloadSpeedMul: number = 1 + sumPct(contribs, 'reloadSpeed');
  const reload: number = reloadBase > 0 && reloadSpeedMul > 0 ? reloadBase / reloadSpeedMul : reloadBase;
  /**
   * 续航秒伤（需求方 2026-11-13）。
   *
   * ```
   * 弹匣 > 0：续航秒伤 = 单次射击 × 弹匣 ÷ (弹匣 ÷ 射速 + 装填时间)
   * 弹匣 = 0：续航秒伤 = 连发秒伤        ← 弹匣内无限子弹，不需要装填
   * ```
   *
   * 弹匣 0 的武器（魔典等）在游戏里是「弹匣内无限子弹」，没有装填这回事。
   * 连带弹药效率类赋能在它上面也恒为 0 收益（需求方：「直接等于连发秒伤」）。
   */
  const sustained: number = mag > 0 && fr > 0 ? (perShot * mag) / (mag / fr + reload) : hitDps;

  // D-171：窗口长度由需求方选（1~6 秒），缺省 6 秒。
  const window = ctx.dotWindowSeconds ?? DEFAULT_DOT_WINDOW_SECONDS;

  const seg = firstSegment(mode)!;
  const dotPerType: Partial<Record<DoTType, number>> = {};
  const stacksPerType: Partial<Record<DoTType, number>> = {};
  const nonDamageStacks: Partial<Record<NonDamageStatusType, number>> = {};
  // 开火时间线（D-058 / D-067）：打满弹匣后要装填，期间不叠层。
  // D-067 改为**毫秒精度的开火占比**，否则射速提升会产生阶梯式负收益。
  const firingTimeline = (sec: number): number => firingFraction(mag, fr, reload, sec);
  // D-061：加权**只在有 DoT 的类型之间**分配。
  // 冲击/穿刺/辐射/腐蚀/病毒等没有 DoT 的类型**不参与**加权 ——
  // 它们虽然也占触发池，但不会产生 DoT，不该摊薄 DoT 的份。
  //
  // D-107（Q6）把"占比"拆成了两件事，必须分开算：
  //   ① **触发占比**（划分母/叠层用）→ 看**命中分布 `finalHit`**。
  //      元素 Mod 撑出来的份也算触发池：纯切割 + 火 Mod 就是 50/50。
  //   ② **DoT 基础值**（每跳多少）→ 看 `tickBaseScaled`（不含元素加量），元素 Mod 的加量不进这里。
  //   合成出来的类型（毒气/爆炸…）没有自己的面板份，用**来源元素**之和来代替，
  //   这样"火+毒 → 毒气"仍按 200 计入分母（切割 100 + 毒气 200）。
  //
  // D-109（需求方 2026-11-06 反馈）：**该异常是否存在，只看「当前面板」里有没有这个元素**。
  //
  //   原话：「是否有这个异常应该看当前面板复合后有没有这个元素，而不是看他分解的，
  //          否则会出现电毒火复合成腐蚀火但是你也加上了毒气。」
  //
  //   反例（用"来源元素还在不在"推会错）：玄骸火 + 电 Mod + 毒 Mod，
  //   按槽位顺序电和火先合成辐射 → 命中是「辐射 + 毒」，**没有毒气**；
  //   但"火的来源还在（辐射里）+ 毒在"会推出一个 0 层的毒气行。
  //
  //   所以判据回到命中分布本身：合成结束后面板里有这个元素才算。
  //   玄骸元素参与合成没问题（D-025：玄骸与自带元素排在 8 个 Mod 槽位之后），
  //   合成结果已经体现在 `finalHit` 里了。
  const elementPresent = (t: DoTType): boolean => (res.finalHit[t] ?? 0) > 0;

  /**
   * 该类型分多少触发份。
   *
   * ⚠ 合成元素（毒气/腐蚀/辐射…）在命中分布里**没有单独的一份**——它是由来源元素
   *   合成出来的，那些份已经计入来源元素本身了。这里用**来源元素之和**只是为了让
   *   加权分母里仍能体现"这个触发池有多大"，**不代表它存在**（存在与否由 elementPresent 判）。
   */
  const dotShareOf = (t: DoTType): number => {
    const direct: number = res.finalHit[t] ?? 0;
    if (direct > 0) return direct;
    return (DOT_ELEMENT_SOURCES[t] ?? []).reduce(
      (sum: number, src: DamageType) => sum + (res.finalHit[src] ?? 0),
      0,
    );
  };

  let dotSpreadTotal = 0;
  for (const t of DOT_TYPES) {
    if (!elementPresent(t as DoTType)) continue;
    dotSpreadTotal += dotShareOf(t as DoTType);
  }

  let dotPerSecond = 0;
  let dot6s = 0;
  // ⚠ 需求方 2026-11-12：「走完元素合成…到最后计算 dps 才把各自的统计口径加起来」。
  //   所以 DoT / 爆炸这两类口径**逐段各算一遍，再把结果累加**：
  //   每段的命中分布不同（巴什穆是电击 39 + 火焰 19），触发池与每跳都不能混。
  const blastAcc = {
    perStack: 0,
    perStackDetonated: 0,
    totalInWindow: 0,
    splashOnTrigger: 0,
    splashActive: false,
    stacksPerSecond: 0,
    reachesMaxInWindow: false,
  };
  const dotBySegment: SegmentDotDetail[] = [];
  for (let segIdx = 0; segIdx < segmentResults.length; segIdx++) {
    const segRes = segmentResults[segIdx]!;
    const segOut = segmentDotAndBlast(segRes, contribs, ms, fr, firingTimeline, window);
    // 逐段各留一份（需求方 2026-11-12：异常状态要按段显示，各段触发自己的 DoT）
    dotBySegment.push({
      index: segIdx,
      dotPerSecond: segOut.dotPerSecond,
      dot6s: segOut.dot6s + segOut.blast.totalInWindow,
      dotPerType: segOut.dotPerType,
      stacksPerType: segOut.stacksPerType,
      nonDamageStacks: segOut.nonDamageStacks,
      blast: segOut.blast,
    });
    dotPerSecond += segOut.dotPerSecond;
    dot6s += segOut.dot6s;
    for (const [t, v] of Object.entries(segOut.dotPerType)) {
      dotPerType[t as DoTType] = (dotPerType[t as DoTType] ?? 0) + (v ?? 0);
    }
    for (const [t, v] of Object.entries(segOut.stacksPerType)) {
      stacksPerType[t as DoTType] = (stacksPerType[t as DoTType] ?? 0) + (v ?? 0);
    }
    for (const [t, v] of Object.entries(segOut.nonDamageStacks)) {
      nonDamageStacks[t as NonDamageStatusType] = (nonDamageStacks[t as NonDamageStatusType] ?? 0) + (v ?? 0);
    }
    blastAcc.perStack += segOut.blast.perStack;
    blastAcc.perStackDetonated += segOut.blast.perStackDetonated;
    blastAcc.totalInWindow += segOut.blast.totalInWindow;
    blastAcc.splashOnTrigger += segOut.blast.splashOnTrigger;
    blastAcc.splashActive = blastAcc.splashActive || segOut.blast.splashActive;
    blastAcc.stacksPerSecond += segOut.blast.stacksPerSecond;
    blastAcc.reachesMaxInWindow =
      blastAcc.reachesMaxInWindow || segOut.blast.reachesMaxInWindow;
  }
  // 爆炸是**非 DoT 机制**（D-057）：不计入「异常加权单层秒伤」，但计入「N 秒异常总伤」。
  // 进总伤的**只有主目标**；范围伤害（满层后对周围敌人系数 3）单列展示、不进任何总伤（D-171）。
  dot6s += blastAcc.totalInWindow;

  const blast: BlastDetail = {
    perStack: blastAcc.perStack,
    stacksPerSecond: blastAcc.stacksPerSecond,
    reachesMaxInWindow: blastAcc.reachesMaxInWindow,
    timeToMaxSeconds: blastAcc.reachesMaxInWindow && blastAcc.stacksPerSecond > 0
      ? BLAST.maxStacks / blastAcc.stacksPerSecond
      : null,
    totalInWindow: blastAcc.totalInWindow,
    perStackDetonated: blastAcc.perStackDetonated,
    splashOnTrigger: blastAcc.splashOnTrigger,
    splashActive: blastAcc.splashActive,
    total6s: blastAcc.totalInWindow,
    splash6s: blastAcc.splashOnTrigger,
  };

  // D-179（需求方 2026-11-13）：**N 秒总伤的直击部分也走开火时间线**。
  //
  // > 「需要把 n 秒总伤的直击部分也一样改为计算装填窗口，射击窗口使用爆发伤害」
  //
  // 现在与异常用**同一条** `firingFraction` 时间线：
  //   窗口内直击 = 连发秒伤 × Σ 每秒开火占比     （发射即命中，装填期间不产生新伤害）
  let firingSecondsInWindow = 0;
  for (let sec = 1; sec <= window; sec++) firingSecondsInWindow += firingTimeline(sec);
  const directInWindow = hitDps * firingSecondsInWindow;
  const totalInWindow = directInWindow + dot6s;

  // D-180 / 需求方 2026-11-15（A4 + A5）：稳态秒伤（长期平均）——
  //   直击：续航秒伤（已含装填摊薄）
  //   异常：**逐秒层数池**（层数会到期清除、装填期间照样掉）按一个循环摊平；爆炸也算进去
  // ⚠ 稳态的"一个循环"必须用**真实的循环控制变量**，不能拿窗口 1 秒去积分开火占比。
  const steadyParts = steadyStateDot(segmentResults, contribs, ms, fr, mag, reload, window);
  // 稳态秒伤 = 直击（续航秒伤，已含装填摊薄）+ 异常稳态（DoT + 爆炸）
  const steady = sustained + steadyParts.dot + steadyParts.blast;
  const win = windowLabel(window);
  const lines: OutputLine[] = [
    { id: 'pelletPerHit', label: '单弹头', description: '合成后总伤 × 暴击期望 × 爆头开关', unit: '/弹头', value: pelletPerHit },
    { id: 'perShot', label: '单次射击', description: '单弹头 × 多重', unit: '/发', value: perShot },
    { id: 'hitDps', label: '连发秒伤', description: '单次射击 × 射速（不含装填）', unit: '/秒', value: hitDps },
    { id: 'sustainedDps', label: '续航秒伤', description: '单次射击 × 弹匣 ÷ (弹匣÷射速 + 装填)', unit: '/秒', value: sustained },
    { id: 'dotPerSecond', label: '异常加权单层秒伤', description: '单层 DoT 每秒伤害 × 该类型触发占比（爆炸不计入）', unit: '/层/秒', value: dotPerSecond },
    {
      id: 'dot6s',
      label: `${win}异常总伤`,
      description: `Σ 各类型逐秒累加（毒气封顶 10 层、火焰递增）；含爆炸${win}对主目标的合计（不含范围伤害）`,
      unit: '',
      value: dot6s,
    },
    {
      id: 'totalInWindow',
      label: `${win}总伤`,
      description: `窗口内直击（开火时长 × 连发秒伤）+ ${win}异常总伤`,
      unit: '',
      value: totalInWindow,
    },
    {
      id: 'steadyDps',
      label: '稳态秒伤',
      description: '长期平均：续航秒伤 + 各异常按「一个循环内能叠的层数」折算',
      unit: '/秒',
      value: steady,
    },
  ];

  return {
    lines: lines,
    pelletPerHit: pelletPerHit,
    /** 稳态秒伤（D-180；需求方 2026-11-15 A4+A5：层数池 + 爆炸） */
    steadyDps: steady,
    /** 稳态秒伤里的**异常部分**（DoT，不含直击） */
    steadyDotDps: steadyParts.dot,
    /** 稳态秒伤里的**爆炸主目标**部分 */
    steadyBlastDps: steadyParts.blast,
    /** 窗口内直击（D-179：开火时长 × 连发秒伤） */
    directInWindow: directInWindow,
    multishot: ms,
    perShot: perShot,
    fireRate: fr,
    hitDps: hitDps,
    sustainedDps: sustained,
    dotPerSecond: dotPerSecond,
    dot6s: dot6s,
    windowSeconds: window,
    totalInWindow: totalInWindow,
    dotPerType: dotPerType,
    stacksPerType: stacksPerType,
    nonDamageStacks: nonDamageStacks,
    // 需求方 2026-11-12：异常状态按段显示，各段触发自己的 DoT
    dotBySegment: dotBySegment,
    blast: blast,
  };
}