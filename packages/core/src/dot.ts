/**
 * 触发与 DoT 每跳（`docs/伤害公式.md` §0.3 / §6.2 / §7）。
 *
 * ```
 * 触发率（射线额外 ×多重，表 2.3）
 * 元素占比 = 该类型 / 命中分布合计
 * 单发层数 = 触发率 × 占比 × 多重（射线不重复乘）
 * 每跳     = ① 基础值（全类型之和）× 系数
 *            × (1 + 该类型元素%) × (1 + 异常状态伤害%) × (1 + 派系%)
 * ```
 * 基础值里**已经含**暴击 / 爆头 / 爆头暴击（D-062 / D-063），这里不再乘。
 */
import type { DamageSpread, DamageType } from './damage-types.ts';
import { spreadTotal } from './damage-types.ts';
import type { Contribution } from './contributions.ts';
import { sumPct } from './contributions.ts';
import { bucket } from './buckets.ts';
import type { AttackMode, Weapon } from './weapon.ts';
import { panelStats } from './weapon.ts';
import type { HeadshotOptions } from './ctx.ts';

/** 表 6.2 的 DoT 系数 */
export const DOT_COEF: Readonly<Record<string, number>> = {
  heat: 0.5,
  toxin: 0.5,
  electric: 0.5,
  gas: 0.5,
  slash: 0.35,
};

export const DOT_TYPES = ['heat', 'toxin', 'electric', 'gas', 'slash'];
export type DoTType = (typeof DOT_TYPES)[number];

/**
 * **非伤害性异常**（需求方 2026-11-12）：会叠层，但本身不掉血，所以只有「层/秒」，没有每层伤害。
 *
 * > 「把非伤害性异常也加上去，标上 xx 层/秒就行，不需要后面那个伤害。」
 *
 * 顺序即界面顺序（需求方 2026-11-12：「复合元素在前，然后冰，然后冲击穿刺」）：
 *   病毒 → 腐蚀 → 磁力 → 辐射 → 冰冻 → 冲击 → 穿刺
 *
 * ⚠ 这些类型**不参与**任何伤害口径（异常加权单层秒伤、六秒异常总伤都不变）。
 *   冰冻也不改护甲（需求方 2026-11-12：「冰冻不会让护甲减半，这个不搞」）。
 */
export const NON_DAMAGE_STATUS_TYPES = [
  'viral',
  'corrosive',
  'magnetic',
  'radiation',
  'cold',
  'impact',
  'puncture',
] as const;
export type NonDamageStatusType = (typeof NON_DAMAGE_STATUS_TYPES)[number];

export const DOT_DURATION: Readonly<Record<DoTType, number>> = {
  heat: 6,
  toxin: 6,
  electric: 6,
  gas: 6,
  slash: 6,
};

/**
 * §0.3 ①：单弹头总触发率 = `面板触发率 × (1 + Σ触发率%)`。
 *
 * 需求方 2026-11-14（D-195）：**游戏内显示的触发率不会被多重影响**，所以这里
 * 不给射线额外乘多重。以前射线在这里 `×(1+Σ射线多重%)`、又在 {@link stacksPerShot}
 * 里不乘多重，两处抵消；现在统一成「触发率不乘多重，叠层那一侧乘多重」——
 * 射线与实弹走同一条逻辑，算出来的层数与伤害完全不变。
 *
 * 因为不再区分射线与实弹，这里**没有** `beam` 参数。
 */
export function totalProcChance(procChance: number, contribs: readonly Contribution[]): number {
  const m = 1 + sumPct(contribs, 'statusChance');
  return procChance * m;
}

/** §0.3 ②：某元素在触发池里的份额 */
export function share(t: DamageType, v: DamageSpread): number {
  const total = spreadTotal(v);
  return total > 0 ? (v[t] ?? 0) / total : 0;
}

/**
 * §2.2：多重独立乘区，与基伤相乘、绝不相加。
 *
 * ```
 * 当前多重 = 面板多重 × (1 + Σ多重%Mod) + Σ多重绝对值
 * ```
 *
 * ⚠ **面板多重不能写死成 1**：57 把武器自带多重（Twin Rogga 15、Brakk / Tenet Detron /
 * Drakgoon 10、Boar 8…），霰弹枪尤其明显。之前这里从常量 `1` 起算，
 * 等于把这些武器的面板多重整个丢掉（Twin Rogga 单次射击少了 15 倍）。
 * 面板值经 `panelStats(weapon, mode)` 取（D-050：模式 override 优先）。
 *
 * > 放在 `dot.ts` 是因为 `stacksPerShot()` 的默认值要用它；
 * > `segment.ts` 原样转出以保持既有导入路径不变。
 *
 * @param weapon 武器（取面板多重）；不传时退化为"无面板多重"（仅用于旧调用点）
 * @param mode   攻击模式（面板多重在模式上）
 */
export function multishot(
  contribs: readonly Contribution[],
  weapon?: Weapon,
  mode?: AttackMode,
): number {
  const panel = weapon && mode ? panelStats(weapon, mode).multishot : (weapon?.modes[0]?.multishot ?? 1);
  // 需求方 2026-11-13：锁多重（敏锐主武 / 敏锐手枪「Multishot cannot be modified」）——
  // 装上后所有多重来源都不生效，多重恒为面板值。
  if (contribs.some((c) => c.locksMultishot)) return panel;
  return bucket(panel, 'multishot', contribs);
}

/**
 * §0.3 ③④：单次射击某元素的期望层数 = 总触发率 × 元素占比 × 多重。
 *
 * 需求方 2026-11-14（D-195）：**射线与实弹统一**——多重一律在这一步乘，
 * 触发率本身（游戏内显示的那个数）不受多重影响。以前射线把多重并进触发率、
 * 在这里不乘，两者相乘的结果与现在完全相等，只是把倍的"位置"挪到了符合游戏显示的地方。
 *
 * @param multishotValue 当前多重（含面板多重）。不传则按「有面板多重的武器」处理时
 *   必须显式传入——见 {@link multishot}
 */
export function stacksPerShot(
  t: DamageType,
  v: DamageSpread,
  procChance: number,
  contribs: readonly Contribution[],
  multishotValue?: number,
): number {
  const ms = multishotValue ?? multishot(contribs);
  return totalProcChance(procChance, contribs) * share(t, v) * ms;
}

export interface DotTickDetail {
  type: DoTType;
  /** ① 基础值（= dotBase 全类型之和，见 §6.2） */
  baseValue: number;
  /** 该元素自己在 dotBase 里的那一份（仅用于展示，不参与计算） */
  ownTypeValue: number;
  /** ② = ① × 系数 */
  baseTick: number;
  /** ③ 该类型元素 %（6.3：毒气只吃毒气） */
  elementPct: number;
  /** 6.3 异常状态伤害 % */
  statusDamagePct: number;
  /** ③ 派系第二次 */
  factionPct: number;
  /** D-008 每跳的爆头开关倍率 */
  headshotMul: number;
  /** 每跳最终值 */
  tick: number;
}

/**
 * DoT 每跳的基础值（需求方 2026-11-12 定为 **口径 B**）。
 *
 * ```
 * 每跳基础触发值 = dotBase 全部类型之和 × 系数
 * ```
 *
 * **口径 B**（需求方原话：「B，dotbase就是不含元素mod乘区的全部之和」）：
 *   · 基础值取 `dotBase` **所有伤害类型之和**，不是"该元素自己那一份"；
 *     `dotBase` 本身已经剔除了元素 / 物理 Mod 的加量（见 `side='dotBase'`）；
 *   · 所以纯物理武器即使面板上没有火，火 DoT 也有基础值；
 *   · 元素 % 在 {@link dotTick} 的 ③ 单独乘一次（见下）。
 *
 * ⚠ 曾经的错误实现：按「`dotBase` 里各类型占比 × 该类型元素%」做加权分摊。
 *   因为 `dotBase` **不含元素 Mod 加量**，面板上本来就没有元素的武器占比恒为 0，
 *   于是元素 % 对 DoT 完全不起作用（火 / 电 / 毒 / 毒气的上限全被吃掉）。
 *
 * `exclude` 保留给"某些类型不吃自己的元素 %"的场合（目前只有毒气的特例，在 `dotTick` 里处理）。
 *
 * @param base      命中分布（`dotBase`：暴击后、未含元素/物理 Mod 加量）
 * @param coef      DoT 该类型的系数
 */
export function dotTickBase(base: DamageSpread, coef: number): number {
  const total = spreadTotal(base);
  if (total === 0) return 0;
  return total * coef;
}

/**
 * §6.2 `dotTick`：DoT 每跳伤害（完整链）。
 *
 * ```
 * ① 基础命中伤 = dotBase 全部类型之和（暴击后、**不含**元素/物理 Mod 加量）
 *                 D-137：这一份**已含派系**（命中结算前的那一次，见 resolveSegment）
 * ② 基础触发值 = ① × 系数                                  ← 见 dotTickBase（口径 B）
 * ③ 每跳伤害 = ② × (1 + 该类型元素%) × (1 + Σ异常状态伤害%) × (1 + Σ派系%)
 * ```
 *
 * ⚠ **派系乘两次是本项目已确认的口径，不是 bug**（`乘区归属表.md` §5.3、§6.2③）：
 *   ```
 *   第一次：计算 DoT 基础命中伤时，命中伤害已享受一次派系加成（§6.2 ①）
 *   第二次：DoT 每跳时，再乘一次派系加成（§6.2 ③）
 *   ```
 *
 * ⚠ **毒气吃「毒气 %」，不吃火 % / 毒 %**（需求方 2026-11-12 确认）：
 *   毒气由火 + 毒合成，合成之后它**自己的类型是毒气**；
 *   每跳的 ③ 只能按「毒气 %」放大，火 / 毒的元素 % 在合成阶段就已经结算完，
 *   不会再去放大毒气 DoT。所以这里**不再对毒气做特殊排除**——
 *   和其它 DoT 类型一样，各自吃自己那一份元素 %。
 *
 * ⚠ **爆炸不吃元素 %**（需求方 2026-11-12：「爆炸应该不生效」）：爆炸走 `blast.ts` 独立结算，
 *   那里只有派系 / 暴击 / 异常状态伤害 / 爆头，没有元素 %。
 */
export function dotTick(
  dotBase: DamageSpread,
  t: DoTType,
  contribs: readonly Contribution[],
  opts: { factionPct: number; headshot?: HeadshotOptions; headshotMul: number },
): DotTickDetail {
  // ① 基础命中伤 = 全部类型之和（口径 B）
  const baseValue = spreadTotal(dotBase);
  // 该元素自己在 dotBase 里的那一份，仅用于展示 / 排查
  const ownTypeValue = dotBase[t] ?? 0;
  // ② 基础触发值 = ① × 系数（不含任何元素 %）
  const baseTick = dotTickBase(dotBase, DOT_COEF[t] ?? 0);
  // ③ 该类型自己的元素 %（毒气吃「毒气 %」，与其它类型一致）
  const elementPct = sumPct(contribs, `elemental:${t}`);
  const statusDamagePct = sumPct(contribs, 'statusDamage');
  // ③ 元素 % → 异常状态伤害 % → 派系第二次
  // （射速与多重影响的是"叠几层"，不在这条链上。）
  //
  // 需求方 2026-11-14：三个乘区**各自最低 0**（负词条不能让每跳变负）：
  //   元素 % / 异常状态伤害 % / 派系 %（派系那一份在 `factionFor()` 已压到 −1 以上）
  const elementMul = Math.max(0, 1 + elementPct);
  const statusDamageMul = Math.max(0, 1 + statusDamagePct);
  const factionMul = Math.max(0, 1 + opts.factionPct);
  const tick = baseTick * elementMul * statusDamageMul * factionMul;
  return {
    type: t,
    baseValue,
    ownTypeValue,
    baseTick,
    elementPct,
    statusDamagePct,
    // 展示用：这一份是派系的**第二次**乘算（第一次已含在 baseValue 里）
    factionPct: opts.factionPct,
    headshotMul: 1, // 已并进基础值，此处恒为 1（保留字段供界面显示）
    tick,
  };
}
