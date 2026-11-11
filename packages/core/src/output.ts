/**
 * L6 输出口径（表 0.1 / 0.2 / 9 节）：把单段结算结果折算成六个可比较的伤害量。
 *
 * ```
 * 单弹头伤害 = 合成后总伤 × 暴击期望 × 爆头开关（实弹**不乘多重**）
 * 单次射击   = 单弹头 × 多重
 * 每秒命中   = 单次射击 × 射速（**不含装填**）
 * 持续射击   = 单次 × 弹匣 / (弹匣/射速 + 装填)（口径 B，全文档唯一除法）
 * DoT        = Σ 各类型（每秒叠层 × 每跳），与六秒曲线
 * ```
 */
import type { AttackMode, Weapon } from './weapon.ts';
import { firstSegment, panelStats } from './weapon.ts';
import type { Contribution } from './contributions.ts';
import { sumPct } from './contributions.ts';
import { bucket } from './buckets.ts';
import { spreadTotal } from './damage-types.ts';
import type { Ctx } from './ctx.ts';
import type { SegmentResult } from './segment.ts';
import { factionFor } from './segment.ts';
import type { DoTType } from './dot.ts';
import { DOT_TYPES, multishot, stacksPerShot } from './dot.ts';
import type { DamageType } from './damage-types.ts';
import type { BlastDetail } from './blast.ts';
import { BLAST, blastDetail } from './blast.ts';
import { firingFraction } from './timeline.ts';
import { dotSixSecondCurve, hasDotElement } from './six-second.ts';
import { ammoEfficiencyMultiplier } from './weapon-state.ts';

/**
 * D-107（Q6）：合成元素对应的**来源基础元素**。
 * 用于"这个触发池到底存不存在 / 该分多少份"——合成出来的元素没有面板份，
 * 但它的来源元素出现在基础分布里，就说明它确实会被触发。
 */
const DOT_ELEMENT_SOURCES: Record<DoTType, readonly DamageType[]> = {
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
};

/** 输出口径 id（可比较 / 可作为备选区增幅基准的一类伤害量） */
export type OutputId = 'pelletPerHit' | 'perShot' | 'hitDps' | 'sustainedDps' | 'dotPerSecond' | 'dot6s';

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
  'hitDps', // 爆发伤害
  'sustainedDps', // 持续伤害
  'dotPerSecond', // DoT 每层秒伤
  'dot6s', // DoT 六秒总伤
];

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
  dot6s: number;
  /** 每个 DoT 类型的每秒输出（期望层数 × 每跳） */
  dotPerType: Partial<Record<DoTType, number>>;
  /** 每个 DoT 类型的每秒期望叠层 */
  stacksPerType: Partial<Record<DoTType, number>>;
  /** 爆炸异常明细（D-031），无爆炸元素时 stacksPerSecond = 0 */
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
 *        得到该段自己的「单弹头 / DoT 每层 / 六秒总伤」
 * 最后：命中类口径（单弹头 / 单次射击 / 爆发 / 持续）把各段**单弹头相加再乘多重与射速**
 *       DoT 与爆炸类口径把各段的**每秒叠层与每跳**各自累加后统一积分
 * ```
 *
 * ⚠ 修掉的 bug：以前 `compute()` 只把 `segments[0]` 传进来，
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
 * 这一段逻辑以前写在 `buildOutput` 里、只对 `segments[0]` 生效，
 * 多段武器（巴什穆电击+火焰、伯斯顿 Prime 灵化命中+爆炸）因此漏算后面的段。
 */
function segmentDotAndBlast(
  res: SegmentResult,
  contribs: readonly Contribution[],
  ms: number,
  fr: number,
  firingTimeline: (sec: number) => number,
): {
  dotPerSecond: number;
  dot6s: number;
  dotPerType: Partial<Record<DoTType, number>>;
  stacksPerType: Partial<Record<DoTType, number>>;
  blast: { perStack: number; perStackDetonated: number; perSecond: number; splashPerSecond: number; splashActive: boolean; total6s: number; stacksPerSecond: number; reachesMaxInWindow: boolean };
} {
  const dotPerType: Partial<Record<DoTType, number>> = {};
  const stacksPerType: Partial<Record<DoTType, number>> = {};

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

    // ── 口径二：**六秒异常状态总伤**（D-043 / D-057 修订）──
    // 单发层数 = 触发率 × 元素占比 × 多重；每秒叠层 = 单发层数 × 射速。
    // D-107：占比取自**这一段自己的**命中分布（`res.finalHit`）。
    const stacksPerShotOfType = stacksPerShot(tick.type, res.finalHit, res.kind ? res.procChance : 0, contribs, res.beam, ms);
    const stacksPerSecond = stacksPerShotOfType * fr;
    stacksPerType[tick.type] = stacksPerSecond;

    // **逐秒曲线**（§0.2 / D-057 / D-058 / D-059）
    dot6s += dotSixSecondCurve(
      tick.type, stacksPerSecond, perStackPerSecond, 6, firingTimeline, stacksPerShotOfType,
    );
  }

  // 爆炸异常（D-031）：独立机制，有 1.5 秒延迟、10 层上限、满层 3 倍。
  //
  // ⚠ 基础值**不能**取 `res.dotBase.blast`（D-056 修复）：
  //   dotBase 是"剔除元素/物理 Mod 加量"后的分布，而爆炸几乎总是由 Mod 合成
  //   （火+冰、火+电），dotBase 里根本没有 blast 这一项 → 恒为 0。
  //   按 §6.2 ①，DoT 基础值是「**全类型之和**」，爆炸同样适用。
  const blastBase = hasDotElement(res.finalHit, 'blast') ? spreadTotal(res.dotBase) : 0;
  const blastStacks = stacksPerShot('blast', res.finalHit, res.procChance, contribs, res.beam, ms);
  const detail = blastDetail(blastBase, blastStacks * fr, {
    factionPct: factionFor(res.faction, contribs),
    statusDamagePct: sumPct(contribs, 'statusDamage'),
    // ⚠ 这里要的是**暴击倍率**，不是命中伤害的绝对值（D-056 修复）。
    //   D-063：爆炸的 baseValue 取自 `res.dotBase`，而 dotBase **已经含**完整的期望倍率，
    //   所以这里传 1，否则会重复乘。
    critDamageMul: 1,
    headshotMul: 1,
  });

  return {
    dotPerSecond,
    dot6s,
    dotPerType,
    stacksPerType,
    blast: {
      perStack: detail.perStack,
      perStackDetonated: detail.perStackDetonated,
      perSecond: detail.perSecond,
      splashPerSecond: detail.splashPerSecond,
      splashActive: detail.splashActive,
      total6s: blastStacks > 0 ? detail.total6s : 0,
      stacksPerSecond: blastStacks * fr,
      reachesMaxInWindow: detail.reachesMaxInWindow,
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
  const res: SegmentResult = segmentResults[0]!;
  const pelletPerHit = segmentResults.reduce((sum, r) => sum + r.line.average, 0);
  const perShot = pelletPerHit * ms;
  const hitDps = perShot * fr;

  // 弹匣与装填：吃 Mod 加成（D-037）。
  //   · `magazine` 是**弹匣容量**的加法 %；
  //   · `reloadSpeed` 是**装填速度**的加法 %，装填**时间** = 面板时间 ÷ (1 + Σ装填速度%)；
  //   · **弹药效率**（D-084 / D-123）：每发实际只消耗 `1-x`，
  //     打空同一份弹药能开 `1/(1-x)` 次 → 持续伤害里的弹匣要乘这个倍数
  //     （之前只写进了 `state.computed.等效弹匣`，`sustainedDps` 根本没有读它，
  //      所以主要·准星 / 次要·妨害 / 头盔射击这类弹药效率词条"看起来没生效"）。
  //   这些词条都直接影响"持续伤害"口径，所以它们不算纯功能类 Mod。
  //   面板值同样取该模式的（D-050）。
  const magBase: number = ps.magazineSize ?? 0;
  const mag: number = bucket(magBase, 'magazine', contribs) * ammoEfficiencyMultiplier(contribs);
  const reloadBase: number = ps.reloadTime ?? 0;
  const reloadSpeedMul: number = 1 + sumPct(contribs, 'reloadSpeed');
  const reload: number = reloadBase > 0 && reloadSpeedMul > 0 ? reloadBase / reloadSpeedMul : reloadBase;
  const sustained: number = mag > 0 && fr > 0 ? (perShot * mag) / (mag / fr + reload) : 0;

  const seg = firstSegment(mode)!;
  const dotPerType: Partial<Record<DoTType, number>> = {};
  const stacksPerType: Partial<Record<DoTType, number>> = {};
  // 开火时间线（D-058 / D-067）：打满弹匣后要装填，期间不叠层。
  // D-067 改为**毫秒精度的开火占比**，否则射速提升会产生阶梯式负收益。
  const firingTimeline = (sec: number): number => firingFraction(mag, fr, reload, sec);
  // D-061：加权**只在有 DoT 的类型之间**分配。
  // 冲击/穿刺/辐射/腐蚀/病毒等没有 DoT 的类型**不参与**加权 ——
  // 它们虽然也占触发池，但不会产生持续伤害，不该摊薄 DoT 的份。
  //
  // D-107（Q6）把"占比"拆成了两件事，必须分开算：
  //   ① **触发占比**（划分母/叠层用）→ 看**命中分布 `finalHit`**。
  //      元素 Mod 撑出来的份也算触发池：纯切割 + 火 Mod 就是 50/50。
  //   ② **DoT 基础值**（每跳多少）→ 看 `tickBase`，元素 Mod 的加量不进这里。
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
    perSecond: 0,
    splashPerSecond: 0,
    splashActive: false,
    dot6s: 0,
    stacksPerSecond: 0,
    reachesMaxInWindow: false,
  };
  for (const segRes of segmentResults) {
    const segOut = segmentDotAndBlast(segRes, contribs, ms, fr, firingTimeline);
    dotPerSecond += segOut.dotPerSecond;
    dot6s += segOut.dot6s;
    for (const [t, v] of Object.entries(segOut.dotPerType)) {
      dotPerType[t as DoTType] = (dotPerType[t as DoTType] ?? 0) + (v ?? 0);
    }
    for (const [t, v] of Object.entries(segOut.stacksPerType)) {
      stacksPerType[t as DoTType] = (stacksPerType[t as DoTType] ?? 0) + (v ?? 0);
    }
    blastAcc.perStack += segOut.blast.perStack;
    blastAcc.perStackDetonated += segOut.blast.perStackDetonated;
    blastAcc.perSecond += segOut.blast.perSecond;
    blastAcc.splashPerSecond += segOut.blast.splashPerSecond;
    blastAcc.splashActive = blastAcc.splashActive || segOut.blast.splashActive;
    blastAcc.dot6s += segOut.blast.total6s;
    blastAcc.stacksPerSecond += segOut.blast.stacksPerSecond;
    blastAcc.reachesMaxInWindow =
      blastAcc.reachesMaxInWindow || segOut.blast.reachesMaxInWindow;
  }
  // 爆炸是**非 DoT 机制**（D-057）：不计入「DoT 每层秒伤」，但计入「六秒异常状态总伤」。
  // 范围伤害（系数 3）依旧单独列出，不进合计（D-031 修订）。
  dot6s += blastAcc.dot6s;

  const blast: BlastDetail = {
    perStack: blastAcc.perStack,
    stacksPerSecond: blastAcc.stacksPerSecond,
    reachesMaxInWindow: blastAcc.reachesMaxInWindow,
    timeToMaxSeconds: blastAcc.reachesMaxInWindow && blastAcc.stacksPerSecond > 0
      ? BLAST.maxStacks / blastAcc.stacksPerSecond
      : null,
    perSecond: blastAcc.perSecond,
    perStackDetonated: blastAcc.perStackDetonated,
    splashPerSecond: blastAcc.splashPerSecond,
    splashActive: blastAcc.splashActive,
    total6s: blastAcc.perSecond * 6,
    splash6s: blastAcc.splashPerSecond * 6,
  };

  const lines: OutputLine[] = [
    { id: 'pelletPerHit', label: '单弹头', description: '合成后总伤 × 暴击期望 × 爆头开关', unit: '/弹头', value: pelletPerHit },
    { id: 'perShot', label: '单次射击', description: '单弹头 × 多重', unit: '/发', value: perShot },
    { id: 'hitDps', label: '爆发伤害', description: '单次射击 × 射速（不含装填）', unit: '/秒', value: hitDps },
    { id: 'sustainedDps', label: '持续伤害', description: '单次射击 × 弹匣 ÷ (弹匣÷射速 + 装填)', unit: '/秒', value: sustained },
    { id: 'dotPerSecond', label: 'DoT 加权每层秒伤', description: '单层 DoT 每秒伤害 × 该类型触发占比（爆炸不计入）', unit: '/层/秒', value: dotPerSecond },
    { id: 'dot6s', label: '六秒异常状态总伤', description: 'Σ 各类型逐秒累加（毒气封顶 10 层、火焰递增）；含爆炸', unit: '', value: dot6s },
  ];

  return {
    lines: lines,
    pelletPerHit: pelletPerHit,
    multishot: ms,
    perShot: perShot,
    fireRate: fr,
    hitDps: hitDps,
    sustainedDps: sustained,
    dotPerSecond: dotPerSecond,
    dot6s: dot6s,
    dotPerType: dotPerType,
    stacksPerType: stacksPerType,
    blast: blast,
  };
}
