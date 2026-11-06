/**
 * 暴击与爆头阶段（`docs/伤害公式.md` §3.1 / §3.2）。
 *
 * ```
 * 暴率 / 爆伤 = bucket(面板, …, contribs)      ← D-050：面板取该模式的
 * 平均倍率    = 1 + cc(cd−1)
 * 分档        = 暴率 150% → 50% 二级、50% 三级
 * 爆头        = 敌人爆头倍率 × (1 + Σ爆头Mod%)，且是开关（D-008 / D-020）
 * 命中分行    = 只有「爆头 ∧ 暴击」才额外 ×2（D-020）
 * ```
 */
import type { AttackMode, Weapon } from './weapon.ts';
import { panelStats } from './weapon.ts';
import type { Contribution } from './contributions.ts';
import { bucket } from './buckets.ts';
import { sumPct } from './contributions.ts';

/**
 * §3.1 / 表 2.0：暴率 = (面板 × (1+Σ暴率%) + 固定加算) × Πmul
 *
 * 面板取**该模式**的值（D-050）：模式有 override 时用它，否则回退武器级。
 */
export function critChanceTotal(weapon: Weapon, contribs: readonly Contribution[], mode?: AttackMode): number {
  const panel = mode ? panelStats(weapon, mode).critChance : weapon.critChance;
  return bucket(panel, 'critChance', contribs);
}

/**
 * §3.1：总爆伤 = (面板暴伤 × (1+Σ暴伤%) + 固定加算) × Πmul
 *
 * 同上，面板取该模式的值（D-050）。
 */
export function critDamageTotal(weapon: Weapon, contribs: readonly Contribution[], mode?: AttackMode): number {
  const panel = mode ? panelStats(weapon, mode).critMultiplier : weapon.critMultiplier;
  return bucket(panel, 'critMultiplier', contribs);
}

/** §3.1：平均伤害倍率 = cc(cd−1)+1 */
export function critAverage(v: number, cc: number, cd: number): number {
  return (cc * (cd - 1) + 1) * v;
}

export interface CritTier {
  k: number;
  prob: number;
  mul: number;
}

/** §3.1：上下限分档（暴率 150% → k=1，50% 概率 2 档、50% 概率 3 档） */
export function critTiers(cc: number, cd: number): CritTier[] {
  const k = Math.floor(cc);
  const f = cc - k;
  return [
    { k, prob: 1 - f, mul: 1 + k * (cd - 1) },
    { k: k + 1, prob: f, mul: 1 + (k + 1) * (cd - 1) },
  ];
}

/**
 * §3.2 / D-012 / D-020：爆头倍率 = 敌人配置的爆头倍率 × (1 + Σ爆头Mod%)。
 * **爆头是开关**：不勾选时整项不存在。
 *
 * D-118：`weakpointDamage`（弱点伤害）在目前版本**等同于爆头**，所以与 `headshotDamage`
 * 同一乘区、加算；召唤方（`compute()`）在开关未打开时会把这个分支整段跳过。
 */
export function headshotMultiplier(contribs: readonly Contribution[], base: number): number {
  return base * (1 + sumPct(contribs, 'headshotDamage') + sumPct(contribs, 'weakpointDamage'));
}

export interface DamageLine {
  /** 不暴击行 */
  nonCrit: number;
  /** 暴击行 */
  crit: number;
  /** 期望平均 */
  average: number;
  /** 本行实际使用的爆头倍率（未勾选爆头时为 1） */
  headshotMul: number;
}

/**
 * §3.2：命中伤害的分行。
 *
 * D-020：**只有「爆头 ∧ 暴击」才 ×2**；未暴击不乘、未开爆头整项不存在；与暴击分档线无关。
 * ```
 * 平均 = (1−cc)·base + cc·base·cd·(hitHead ? 2 : 1)
 * ```
 * D-135：第 5 个参数 `factionMul` = 派系伤害倍率（`1 + Σ该派系加成%`）。
 * 派系乘区在命中结算里**先于**暴击/爆头（乘在 `v` 上），并且 DoT 端也各自乘了一次;
 * 这里必须只在 `v` 上乘**一次**，不要同时乘到 `average` 上（会变成平方）。
 */
export function damageLine(
  v: number,
  cc: number,
  cd: number,
  hitHead: boolean,
  headshotMul: number,
  factionMul = 1,
): DamageLine {
  const base = (hitHead ? v * headshotMul : v) * factionMul;
  const crit = base * cd * (hitHead ? 2 : 1);
  return {
    nonCrit: base,
    crit,
    average: (1 - cc) * base + cc * crit,
    headshotMul: hitHead ? headshotMul : 1,
  };
}

/**
 * DoT 基础值的**期望倍率**（D-062 / D-063）。
 *
 * 与 §3.2 的 `damageLine` 同一支口径，只是直接给出倍率：
 *
 * ```
 * 非爆头： (1−cc)·1        + cc·cd
 * 爆头：   (1−cc)·hsM      + cc·hsM·cd·2      ← 那个 ×2 只作用于暴击支
 * ```
 *
 * 关键（需求方 D-063 原文）：
 *   「爆头倍率为 3 的时候如果没暴击，就还是三倍的爆头倍率。爆头暴击这个两倍
 *     只在又暴击又开启了爆头时产生，如果有未暴击白字需要加权计算。」
 * 所以 ×2 **不能**无条件乘上去，必须按暴击率加权。
 *
 * @param cc 暴击率
 * @param cd 爆击倍率
 * @param headshotEnabled 是否勾选爆头
 * @param hsMul 爆头倍率（默认 ×3，含 `+爆头伤害%` Mod）
 */
export function expectedHitMultiplier(
  cc: number,
  cd: number,
  headshotEnabled: boolean,
  hsMul: number,
): number {
  // ── D-064：按**暴击分档**加权，而不是简单的 (1−cc)/cc 两支 ──
  // 暴率可以 >100%（橙暴/红暴），此时 `1−cc` 会变成负数，白字支根本不存在。
  // 所以必须用 §3.1 的 `critTiers()`：k = floor(cc)、f = cc − k，
  // 分档倍率 = `1 + k(cd−1)`，k ≥ 1 都是"暴击"。
  if (cc <= 0) {
    // 完全不暴击：只有白字
    return headshotEnabled ? hsMul : 1;
  }

  const tiers = critTiers(cc, cd);
  let total = 0;
  for (const tier of tiers) {
    if (tier.prob <= 0) continue;
    // k ≥ 1 视为"暴击"（含 2 档、3 档…）
    const isCrit = tier.k >= 1;
    let mul = tier.mul;
    if (headshotEnabled) {
      mul = mul * hsMul;
      // D-020：爆头 ∧ 暴击 → 最终 ×2；只作用于真正暴击的档位
      if (isCrit) mul = mul * 2;
    }
    total += tier.prob * mul;
  }
  return total;
}
