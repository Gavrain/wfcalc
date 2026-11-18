/**
 * DoT 口径下的**增幅角色**判定：一张卡在"异常"口径里该按哪种方式算增幅。
 *
 * 原来在界面层 `app-compute.js`，且靠**临时改全局 `store.ui.metric`** 来"换个口径看一眼"
 * （`dotRoleForWindow` 那种写法）。现在一律**显式传 `metric`**：没有隐藏状态，
 * 也就不会忘了还原而污染后续计算。
 *
 * ## 四种角色
 *
 * | kind | 含义 | 增幅怎么算 |
 * |---|---|---|
 * | `normal` | 照常算 | 拿掉后重算，比 |
 * | `zero` | 该卡在这个口径下没有贡献 | 0 |
 * | `split` | 元素没形成 DoT，但带触发率 | 只算触发率那部分（`dotFactorOfCard`） |
 *
 * 依据：需求方 2026-11-18 的 DoT 模型（每个 DoT 只吃自己的元素 %）。
 */
import type { Contribution } from './contributions.ts';

/** 与内核输出行 id 同名 */
export const DOT_METRICS: readonly string[] = ['dotPerSecond', 'dot6s'];
export const DOT_WINDOW_METRIC = 'dot6s';
export const WINDOW_TOTAL_METRIC = 'totalInWindow';
export const STEADY_METRIC = 'steadyDps';
export const SUSTAINED_METRIC = 'sustainedDps';

/** 该口径是否属于 DoT 类 */
export function isDotMetric(metric: string): boolean {
  return DOT_METRICS.indexOf(metric) >= 0;
}

/** 该口径是否是"单层"（每层伤害，触发率不影响它） */
export function isPerStackMetric(metric: string): boolean {
  return metric === 'dotPerSecond';
}

export type DotRoleKind = 'normal' | 'zero' | 'split';

export interface DotRole {
  kind: DotRoleKind;
  /** 这些元素词条是否形成了伤害型 DoT */
  feedsDot?: boolean;
}

/**
 * 判定一张卡在 DoT 口径下的角色。
 *
 * @param own 该卡自己的贡献
 * @param contribs 全部贡献（判断元素是否形成 DoT 要用）
 * @param metric 当前口径
 * @param feedsDotFn 这些元素词条是否形成了伤害型 DoT（由内核 DoT 模块提供）
 */
export function dotMetricRoleOf(
  own: readonly Contribution[],
  contribs: readonly Contribution[],
  metric: string,
  feedsDotFn: (own: readonly Contribution[], contribs: readonly Contribution[]) => boolean,
): DotRole {
  if (!isDotMetric(metric)) return { kind: 'normal' };
  if (!own.length) return { kind: 'normal' };

  const hasElement = own.some(
    (c) => /^elemental:/.test(c.stat) || c.stat === 'physical:slash',
  );
  const hasRate = own.some((c) => c.stat === 'statusChance');

  // ① 单层口径：触发几率不影响"每层伤害"
  //   （需求方：「在单层口径下，触发率无贡献，所以白霜弹头显示 0」）
  if (isPerStackMetric(metric) && !hasElement && hasRate) return { kind: 'zero' };

  // ② 非元素卡（触发率 / 异常状态伤害 / 基伤…）→ 照常算
  if (!hasElement) return { kind: 'normal', feedsDot: false };

  // ③ 元素卡：它给某个伤害型 DoT 提供了**该 DoT 自己的元素**吗
  //   有 → 正常重算；拿掉后为 0 时由调用方显示 ∞（这张卡让该异常从无到有）
  //   没有 → 元素部分 0；带触发率时只算触发率那部分，否则 0
  if (feedsDotFn(own, contribs)) return { kind: 'normal', feedsDot: true };
  if (isPerStackMetric(metric)) return { kind: 'zero', feedsDot: false };
  return hasRate ? { kind: 'split', feedsDot: false } : { kind: 'zero', feedsDot: false };
}
