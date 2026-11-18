/**
 * 增幅（两遍计算法）：把它放进内核，是因为"这张卡值多少"的取数规则
 * 与计算方式绑得极紧——放在界面层会导致别处（验证页、脚本）想算增幅时
 * 只能再实现一遍，迟早不一致。
 *
 * 设计见 `docs/specs/架构设计/core-v2-架构设计.md` §8。
 *
 * ## 语义
 *
 * 所有增幅都是同一个问法：**去掉某来源之后会怎样**。
 *
 * ```
 * gain = 当前值 ÷ 去掉后值 − 1
 * ```
 *
 * 分母（去掉后值）怎么取，取决于口径：
 *   · 单次/单发这类：取对应那一行
 *   · N 秒总量类：取内核算好的 `totalInWindow`，**不要自己拼**
 *     （自己拼出来的与内核那一行不一定相等，会出现两个不同的增幅）
 *
 * ## 为什么 `metric` 要显式传
 *
 * 界面层原来靠改全局 `store.ui.metric` 来"临时换个口径看一眼"，
 * 那样一旦忘了还原就会污染后续计算。这里一律显式传参。
 */
import type { Contribution } from './contributions.ts';
import type { OutputBreakdown } from './output.ts';
import { INFINITE_GAIN } from './output.ts';

/** 计算的口径（内核输出里的一行） */
export type MetricKind = string;

/** 取某个口径的数值 */
export function lineValueOf(output: OutputBreakdown, metric: MetricKind): number {
  const line = output.lines.find((l) => l.id === metric);
  return line ? line.value : 0;
}

/**
 * 比值增幅：`after ÷ before − 1`。
 *
 * @param before 分母（**去掉该来源之后**的值）
 * @param after 分子（当前值）
 * @returns 分母为 0 时：分子 > 0 返回 `+∞`，否则 `null`（表示无从比较）
 */
export function ratioGainOf(before: number, after: number): number | null {
  if (!(before > 0)) return after > 0 ? INFINITE_GAIN : null;
  return after / before - 1;
}

/** 去掉某来源的贡献（返回 `null` 表示该来源压根没产出贡献） */
export function removeSource(
  contribs: readonly Contribution[],
  sourceId: string,
): Contribution[] | null {
  const rest: Contribution[] = [];
  let removed = false;
  for (const c of contribs) {
    if (c.source === sourceId) { removed = true; continue; }
    rest.push(c);
  }
  return removed ? rest : null;
}

/** 去掉一组**指定条目**（按对象身份），裂罅词条试算用 */
export function removeEntries(
  contribs: readonly Contribution[],
  own: readonly Contribution[],
): Contribution[] {
  const set = new Set(own);
  return contribs.filter((c) => !set.has(c));
}
