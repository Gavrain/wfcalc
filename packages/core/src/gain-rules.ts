/**
 * 增幅的**取数规则**（原来散在界面层 `app-compute.js`）。
 *
 * 为什么放内核：这些规则决定"分母怎么拼、DoT 要不要算进去"，
 * 与计算方式绑得极紧。留在界面层，其它调用方（验证页、脚本）想算增幅
 * 只能再实现一遍，迟早不一致。
 *
 * ## 分工
 *
 * 内核提供**规则**；"跑一次计算、取某个口径"由调用方以回调传入
 * （`evaluate` / `metricValueOf`）——因为那需要武器、模式、选项这些
 * 只有调用方才知道的东西，内核不替它保管状态。
 *
 * 依赖箭头：`gain-rules.ts → (回调)`，不反向 import 计算模块。
 */
import type { Contribution } from './contributions.ts';
import { ratioGainOf } from './gain.ts';

/** 跑一次计算，返回「当前口径」的数值 */
export type MetricEvaluator = (contribs: readonly Contribution[]) => number;
/** 跑一次计算，返回**指定口径**的数值 */
export type LineEvaluator = (contribs: readonly Contribution[], metric: string) => number;

/**
 * DoT 加权（`dotFactorOfCard`）：一张卡由"元素词条"和"触发率词条"两部分组成，
 * 它们对异常的贡献不是简单相加。
 *
 * 需求方定的式子：两者相乘。
 *   `总增益 = (1 + 元素增益) × (1 + 触发率增益) − 1`
 *
 * ⚠ 基准取「只保留元素词条」那一份——它代表**元素本身**带来的异常，
 *   永远不会因为去掉触发率而变成 0，两个增益都以它为分母才量得准。
 *   （拿"当前配装"或"只留触发率"当分母会撞上 0 或元素结构变化的坑：
 *    病毒火里只有毒时异常是 0 → 触发率增益被算成 100% / 无穷大。）
 *
 * @param own 该卡自己的贡献
 * @param beforeRes 不含该卡时的指标（由调用方先算好）
 * @param withCard 含该卡的全部贡献
 * @param evaluate 跑一次计算取当前口径
 * @param feedsDot 这些元素词条是否形成了伤害型 DoT
 */
export function dotFactorOfCard(
  own: readonly Contribution[],
  beforeMetric: number,
  withCard: readonly Contribution[],
  evaluate: MetricEvaluator,
  feedsDot: boolean,
): number | null {
  const el = own.filter(
    (c) => /^elemental:/.test(c.stat) || c.stat === 'physical:slash',
  );
  const rate = own.filter((c) => c.stat === 'statusChance');

  /** 只保留 `keep` 那几条贡献（其余原样，位置不变 → 元素合成顺序不变） */
  const withoutOthers = (keep: readonly Contribution[]): Contribution[] => {
    const out: Contribution[] = [];
    const keepSet = new Set(keep);
    for (const c of withCard) {
      if (!own.includes(c)) out.push(c);
      else if (keepSet.has(c)) out.push(c);
    }
    return out;
  };

  const baseV = evaluate(withoutOthers(el));

  let elementGain = 0;
  if (el.length && feedsDot) {
    const g = ratioGainOf(baseV, evaluate(withCard));
    if (g === null) return null;
    elementGain = g;
  }

  let rateGain = 0;
  if (rate.length) {
    const g = ratioGainOf(baseV, evaluate(withCard));
    if (g === null) return null;
    rateGain = g;
  }

  if (!el.length && !rate.length) {
    // 既没元素也没触发率词条（纯功能卡）：直接和"不含它"比
    return ratioGainOf(beforeMetric, evaluate(withCard));
  }

  // 元素没形成 DoT → 元素增益 0，结果就是触发率增益；形成了 → 两者相乘
  return (1 + elementGain) * (1 + rateGain) - 1;
}

/**
 * N 秒总量类口径的**分母**：拿掉某张卡之后，那个口径的值是多少。
 *
 * ⚠ 分母直接取内核算好的 `totalInWindow`，**不要自己拼** `续航 × N + dot6s`——
 *   那样拼出来的值和内核那一行不一定相等，于是「装上 ÷ 不装」与
 *   「装着 ÷ 拿掉」会给出两个不同的增幅。
 *
 * 「元素没形成 DoT」的元素卡：DoT 那部分只去掉触发率词条，其余保留。
 *
 * @returns 分母；为 0 时返回 `null`（无从比较）
 */
export function windowDenominator(
  contribs: readonly Contribution[],
  own: readonly Contribution[],
  totalOf: LineEvaluator,
  sustainedOf: LineEvaluator,
  dotOf: LineEvaluator,
  isSplitRole: boolean,
  windowSeconds: number,
): number | null {
  const withoutCard = contribs.filter((c) => !own.includes(c));
  let dot = dotOf(withoutCard, 'dot6s');
  if (isSplitRole) {
    // DoT 那部分只去掉触发率词条
    const keepRate = withoutCard.concat(own.filter((c) => c.stat !== 'statusChance'));
    dot = dotOf(keepRate, 'dot6s');
  }
  const sustained = sustainedOf(withoutCard, 'sustainedDps');
  const total = totalOf(withoutCard, 'totalInWindow') || sustained * windowSeconds + dot;
  return total > 0 ? total : null;
}
