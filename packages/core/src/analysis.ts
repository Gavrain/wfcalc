/**
 * 增幅分析：某个 Mod 装上之后，伤害相对当前配置提高了多少。
 *
 * 这是 demo 里「备选 Mod 区」的涨幅百分比：
 *   `增幅 = 使用该 Mod 得到的伤害 / 当前伤害 − 1`
 *
 * 关键口径（`docs/decisions.md` D-021）：
 *   · **按槽位模拟**：假设把它放进某个槽位，再按结算链重算；
 *   · **比较口径可切换**：以 `OutputId` 指定（单弹头 / 单次射击 / 每秒命中 / DoT 每秒…），
 *     UI 用单选按钮切换，默认「单次射击」；
 *   · 已有 Mod 从槽位中被替换时，**先移除被替换那张**再计算。
 */
import type { Contribution } from './contributions.ts';
import { compute, OUTPUT_IDS } from './main.ts';
import type { ComputeResult, CtxOptions, OutputId, OutputLine } from './main.ts';
import type { AttackMode, Weapon } from './weapon.ts';

export interface MetricOption {
  id: OutputId;
  label: string;
  description: string;
}

/** 可选的"输出口径"（与 `main.ts` 的 OUTPUT_IDS 一一对应；名称按 D-033 定稿） */
export const METRIC_OPTIONS: readonly MetricOption[] = [
  { id: 'pelletPerHit', label: '单弹头', description: '不乘多重，含暴击期望' },
  { id: 'perShot', label: '单次射击', description: '单弹头 × 多重' },
  { id: 'hitDps', label: '爆发伤害', description: '持续开火、不含装填' },
  { id: 'sustainedDps', label: '持续伤害', description: '含装填' },
  { id: 'dotPerSecond', label: 'DoT 加权每层秒伤', description: '单层 DoT 每秒伤害 × 触发占比（爆炸不计入）' },
  { id: 'dot6s', label: '六秒异常状态总伤', description: '逐秒累加；毒气封顶 10 层、火焰递增；含爆炸' },
];

export const DEFAULT_METRIC: OutputId = 'perShot';

export function metricValue(res: ComputeResult, metric: OutputId): number {
  const line: OutputLine | undefined = res.output.lines.find((l) => l.id === metric);
  return line?.value ?? 0;
}

/** 一组贡献（一个槽位的全部 Mod/赋能贡献）整体替换另一组时的模拟结果 */
export function simulateWith(
  weapon: Weapon,
  mode: AttackMode,
  contribs: readonly Contribution[],
  options: CtxOptions = {},
): ComputeResult {
  return compute(weapon, mode, contribs, options);
}

/**
 * 计算某个候选 Mod 的增幅。
 *
 * @param base      当前配置
 * @param candidate 候选 Mod 的贡献（尚未装上的那一组）
 * @param replaced  若把候选放进槽位，会被替换掉的那组贡献（没占用就传空）
 * @param metric    比较口径
 * @returns 增幅小数（0.35 = +35%）；基准为 0 时返回 `null`（无法计算，UI 显示「—」）
 */
export function gainOf(
  weapon: Weapon,
  mode: AttackMode,
  base: readonly Contribution[],
  candidate: readonly Contribution[],
  replaced: readonly Contribution[],
  metric: OutputId,
  options: CtxOptions = {},
): number | null {
  const currentValue: number = metricValue(simulateWith(weapon, mode, base, options), metric);

  const next: Contribution[] = base.filter((c) => !replaced.includes(c)).concat(candidate);
  const nextValue: number = metricValue(simulateWith(weapon, mode, next, options), metric);

  if (currentValue === 0) return null;
  return nextValue / currentValue - 1;
}

/**
 * 批量计算增幅（备选区里一次算几十上百个 Mod 时用）。
 * 当前值只算一次，候选循环只重算"候选侧"。
 */
export function gainsFor(
  weapon: Weapon,
  mode: AttackMode,
  base: readonly Contribution[],
  candidates: readonly (readonly Contribution[])[],
  replaced: readonly Contribution[],
  metric: OutputId,
  options: CtxOptions = {},
): (number | null)[] {
  const currentValue = metricValue(simulateWith(weapon, mode, base, options), metric);
  const baseWithout: Contribution[] = base.filter((c) => !replaced.includes(c));
  return candidates.map((cand) => {
    if (currentValue === 0) return null;
    const value: number = metricValue(simulateWith(weapon, mode, baseWithout.concat(cand), options), metric);
    return value / currentValue - 1;
  });
}

export { OUTPUT_IDS };
export type { OutputId };
