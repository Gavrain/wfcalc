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

export const DOT_DURATION: Readonly<Record<DoTType, number>> = {
  heat: 6,
  toxin: 6,
  electric: 6,
  gas: 6,
  slash: 6,
};

/**
 * §0.3 ①：单弹头总触发率。
 * 射线额外 ×(1+Σ多重%)（表 2.3）—— `beam` 来自人工表，未确认前按非射线算（D-010）。
 */
export function totalProcChance(procChance: number, contribs: readonly Contribution[], beam: boolean): number {
  const m = 1 + sumPct(contribs, 'statusChance');
  return beam ? procChance * m * (1 + sumPct(contribs, 'multishot')) : procChance * m;
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
  return bucket(panel, 'multishot', contribs);
}

/**
 * §0.3 ③④：单次射击某元素的期望层数 = 总触发率 × 元素占比 × 多重。
 * 射线**不重复乘多重**（多重已并进触发率）。
 *
 * @param multishotValue 当前多重（含面板多重）。不传则按「有面板多重的武器」处理时
 *   必须显式传入——见 {@link multishot}
 */
export function stacksPerShot(
  t: DamageType,
  v: DamageSpread,
  procChance: number,
  contribs: readonly Contribution[],
  beam: boolean,
  multishotValue?: number,
): number {
  const ms = multishotValue ?? multishot(contribs);
  return totalProcChance(procChance, contribs, beam) * share(t, v) * (beam ? 1 : ms);
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
 * DoT 每跳的基础值（D-107 / Q6 定案，需求方 2026-11-06）。
 *
 * ```
 * 每跳基础触发值 = Σ(命中基础分布) × 系数 × (1 + 元素加成按命中占比分摊之和)
 * ```
 *
 * 关键：**元素 % 只作用于"它的类型真的出现在命中分布里"**。
 *   · 火焰 +90% 只放大火焰那一份 → 火被拿去合成毒气后，那一份不存在，
 *     这个 +90% 对毒气 DoT **没有任何贡献**；
 *   · 毒气 % 只放大毒气那一份 → 由火 + 毒合成的毒气有那一份，所以吃得到；
 *   · 效价炼成那种"原生毒气 %"给的就是 `elemental:gas`，同样生效。
 *
 * 这解释了需求方的原话：「火加毒确实是会合成毒气，但是他仍然是火焰加成，
 * 不会对毒气 dot 加成……火冰毒电这种 dot 是不会出现这个问题的，只有毒气有这个问题。」
 *
 * @param base      命中分布（暴击后、未含元素/物理 Mod 加量）
 * @param coef      DoT 该类型的系数
 * @param contribs  全部贡献（用来找元素 %）
 * @param exclude   不给加成的元素类型（例如 `['gas']`：毒气不吃"毒气 %"）
 */
export function dotTickBase(
  base: DamageSpread,
  coef: number,
  contribs: readonly Contribution[],
  exclude: readonly DamageType[] = [],
): number {
  const total = spreadTotal(base);
  if (total === 0) return 0;
  let elementMix = 0;
  for (const key of Object.keys(base)) {
    const t = key as DamageType;
    if (exclude.includes(t)) continue;
    const part = base[t] ?? 0;
    if (part === 0) continue;
    // 只按该类型**自己**的元素 % 加成，且只在它出现在命中分布里才算数
    elementMix += (part / total) * sumPct(contribs, `elemental:${t}`);
  }
  return total * coef * (1 + elementMix);
}

/**
 * §6.2 `dotTick`：DoT 每跳伤害（完整链）。**D-107 / Q6 定案后**：
 *
 * ```
 * ① 基础命中伤 = 命中分布（暴击后，**不含**元素/物理 Mod 加量）
 *                 D-137：这一份**已含派系**（命中结算前的那一次，见 resolveSegment）
 * ② 基础触发值 = Σ① × 系数 × (1 + 元素加成分摊)   ← 见 dotTickBase
 * ③ 每跳伤害 = ② × (1 + Σ异常状态伤害%) × (1 + Σ派系%)      ← 派系**第二次**
 * ```
 *
 * ⚠ **派系乘两次是本项目已确认的口径，不是 bug**（`乘区归属表.md` §5.3、§6.2③）：
 *   ```
 *   第一次：计算 DoT 基础命中伤时，命中伤害已享受一次派系加成（§6.2 ①）
 *   第二次：DoT 每跳时，再乘一次派系加成（§6.2 ③）
 *   ```
 *   「这不是"平方"这种说法」——它是两次先后作用在同一数值上的两个独立乘算。
 *   D-136 我一度把这个第二次乘算删掉了，是**擅自改已确认口径**，D-137 已恢复。
 *
 * ⚠ **① 取的是所有类型之和，不是该类型自己的那一份**（文档 §6.2 原文：
 *   「计入：全部伤害类型（物理 + 元素）」）。
 *   之前错误地取了 `dotBase[t]`，导致：
 *     · 毒气完全由 Mod 合成、`dotBase` 里没有毒气这一项 → 每跳恒为 0；
 *     · 火焰/毒素等也只按自己那部分计，数值偏低。
 */
export function dotTick(
  dotBase: DamageSpread,
  t: DoTType,
  contribs: readonly Contribution[],
  opts: { factionPct: number; headshot?: HeadshotOptions; headshotMul: number },
): DotTickDetail {
  // ① 基础命中伤（已含暴击 / 爆头 / 爆头暴击 / **派系第一次**，见 resolveSegment 的 tickBase）
  const baseValue = spreadTotal(dotBase);
  // ② 该元素自己的那一份，仅用于展示/排查；不参与数值
  const ownTypeValue = dotBase[t] ?? 0;
  // D-107（Q6）：毒气不吃"毒气 %"——它的两份来源早已被火/毒各自的 % 放大过，
  // 命中分布里也没有 `gas` 这一项；其余类型照常按自己的 % 分摊。
  const exclude: DamageType[] = t === 'gas' ? ['gas'] : [];
  const baseTick = dotTickBase(dotBase, DOT_COEF[t] ?? 0, contribs, exclude);
  // 该类型自己的元素 %（只用于展示；数值已按命中占比分摊进 baseTick）
  const elementPct = sumPct(contribs, `elemental:${t}`);
  const statusDamagePct = sumPct(contribs, 'statusDamage');
  // ── D-062 / D-137：DoT 每跳额外吃「异常状态伤害 %」，以及派系的**第二次**乘算 ──
  // （元素 % 已在 baseTick 里按类型分摊；射速与多重影响的是"叠几层"。）
  const tick = baseTick * (1 + statusDamagePct) * (1 + opts.factionPct);
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
