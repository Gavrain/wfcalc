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
 *
 * **D-155：重击系攻击上，带 `heavyX2` 的暴击率贡献额外 ×2。**
 * 需求方 2026-11-13：
 * > 「近战的固定暴击率词条例如斩铁或者裂罅mod上都会带有重击时*2，对重击和重型震地生效。」
 *
 * 只放大**这部分贡献**，面板自带暴率（与其它暴击率 Mod）不受影响；
 * 即 pct 支拿两份（×2 的那份 + 普通的），flat / mul 支不变。
 */
export function critChanceTotal(
  weapon: Weapon,
  contribs: readonly Contribution[],
  mode?: AttackMode,
  headshotEnabled = false,
): number {
  return Math.max(0, critChanceRaw(weapon, contribs, mode, headshotEnabled));
}

/**
 * 把「弱点暴击率（开爆头时）」与「重击 ×2」折进暴击率乘区的贡献表。
 *
 * 需求方 2026-11-15：**面板 / 拆解 / 结算必须用同一套折算**，所以这里只写一次，
 * `weapon-state.ts`（面板与拆解）与 {@link critChanceTotal}（结算）都调它。
 *
 * ```
 * ① 弱点暴击率：只认 `weakpointCritChance`，开爆头时换成一条 `critChance` 的副本
 *    （source 变成 `原id#weak`，拆解里能单独看到它）
 * ② 重击 ×2：mode._heavy 时，带 `heavyX2` 的暴率贡献再复制一份（source 加 `#heavy`）
 * ```
 */
export function critBucketContribs(
  contribs: readonly Contribution[],
  heavy: boolean,
  headshotEnabled: boolean,
): readonly Contribution[] {
  const withWeak = headshotEnabled && contribs.some((c) => c.stat === 'weakpointCritChance')
    ? [
      ...contribs,
      ...contribs
        .filter((c) => c.stat === 'weakpointCritChance')
        .map((c) => ({ ...c, stat: 'critChance' as const, source: `${c.source}#weak` })),
    ]
    : contribs;
  if (!heavy) return withWeak;
  const heavyOnes = withWeak.filter((c) => c.heavyX2 === true && c.stat === 'critChance');
  if (heavyOnes.length === 0) return withWeak;
  return [...withWeak, ...heavyOnes.map((c) => ({ ...c, source: `${c.source}#heavy` }))];
}

/**
 * 未截断的暴击率（内部用）。
 *
 * 需求方 2026-11-13：**暴击率最低为 0，不会负** —— 负暴率没有物理意义，
 * 而且会让期望倍率 < 1（= 白字反而打折），所以对外一律经由 {@link critChanceTotal} 截断。
 *
 * 需求方 2026-11-15：**弱点暴击率与普通暴击率是同一个乘区里的 Σ%**：
 * ```
 * 暴率 = (面板暴率 × (1 + Σ普通暴率% + Σ弱点暴率%) + Σ固定暴击率) × Π额外乘区
 * ```
 * 弱点暴击率**只在开启爆头时**计入（它对非弱点命中不生效）。
 */
function critChanceRaw(
  weapon: Weapon,
  contribs: readonly Contribution[],
  mode?: AttackMode,
  headshotEnabled = false,
): number {
  const panel = mode ? panelStats(weapon, mode).critChance : weapon.critChance;
  return bucket(panel, 'critChance', critBucketContribs(contribs, mode?._heavy === true, headshotEnabled));
}

/**
 * 需求方 2026-11-15：**弱点暴击率**（敏锐主武 / 敏锐手枪）已经并进 {@link critChanceTotal}。
 *
 * 它与普通暴击率是**同一个乘区里的 Σ%**：
 * ```
 * 暴率 = (面板暴率 × (1 + Σ普通暴率% + Σ弱点暴率%) + Σ固定暴击率) × Π额外乘区
 * ```
 * 只在开启爆头（打弱点）时计入；关闭爆头时整条不生效。
 *
 * 本函数保留给需要单独展示「弱点暴击率贡献了多少」的调用方，**不参与暴率计算**。
 */
export function weakpointCritChanceAdd(contribs: readonly Contribution[], headshotEnabled: boolean): number {
  if (!headshotEnabled) return 0;
  return sumPct(contribs, 'weakpointCritChance');
}

/**
 * 需求方 2026-11-13：**打身体伤害的倍率**（细心瞄准的 `-45% Bodyshot Damage`）。
 *
 * 原话：「-45% 身体伤害就是减少未开启爆头配置的情况下，伤害总降」——
 * 所以只在**关闭爆头**（= 打身体）时乘上去；开启爆头时恒为 1（不享受，也不吃这个负面）。
 *
 * ```
 * 关闭爆头：命中伤害 ×(1 + Σ身体伤害%)      ← 细心瞄准时 ×(1 − 0.45)
 * 开启爆头：不变
 * ```
 */
export function bodyshotMultiplier(contribs: readonly Contribution[], headshotEnabled: boolean): number {
  if (headshotEnabled) return 1;
  return Math.max(0, 1 + sumPct(contribs, 'bodyshotDamage'));
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

/**
 * **主命中正好是一级暴击**的概率（D-189，刃影的触发概率）。
 *
 * 需求方 2026-11-13：「一级暴击才触发，二级暴击时刃影可是不触发的」。
 *
 * ```
 * cc ≤ 0        → 0
 * 0 < cc ≤ 1    → cc           （小数部分就是升到一级的概率）
 * 1 ≤ cc ≤ 2    → 2 − cc       （小数部分已是二级，一级只剩 1 − 小数）
 * cc ≥ 2        → 0            （已经全是二级及以上，永远不是一级暴击）
 * ```
 */
export function firstTierCritChance(cc: number): number {
  if (!(cc > 0)) return 0;
  if (cc <= 1) return cc;
  return Math.max(0, 2 - cc);
}

/**
 * **刃影收益关于暴击率的式子**（D-189，需求方 2026-11-13 逐轮确认）。
 *
 * ```
 * cc = 暴击率（1 = 100%），cd = 暴击伤害，w = 刃影等级概率，d = cd − 1
 * P1(cc) = 一级暴击概率                  ← firstTierCritChance
 *
 * 主命中期望倍率 B = 1 + cc·d
 * 追加那一下期望 A = 1 + cc·d             ← 同一暴击率独立再判，含二级
 * 本次挥砍期望     E = B + P1·w·A         ← 需求方实例（cd=4, cc=110%）= 8.17
 *
 * 增益（相对同一配装去掉刃影）= E/B − 1 = w · P1(cc)
 * ```
 *
 * `A` 与 `B` 相等（追加与主命中**同分布**），所以 `cd` 在增益里被约掉：
 * **收益只由「一级暴击出现概率」决定**，100% 暴击率处最高（满级 = +100%），
 * 越过 100% 后二级暴击挤掉一级，线性降到 200% 处的 0。
 *
 * @param cc 当前暴击率（1 = 100%）
 * @param w  刃影概率（0~1；未装刃影传 0）
 */
export function bladeShadowGain(cc: number, w: number): number {
  return w * firstTierCritChance(cc);
}

/**
 * **刃影倍率** = `1 + w·P1(cc)`（D-189）：同时乘到**命中平均**与**异常叠层期望**上。
 *
 * 需求方 2026-11-13 最终口径：
 * > 「DoT/爆炸基础值 × (1 + w·P1)；这里不对，不放大 dot 基础值。只放大叠层」
 *
 * ```
 * 命中平均       × 刃影倍率
 * 异常叠层期望   × 刃影倍率        ← 追加是独立攻击，自己也触发异常
 * DoT 每跳基础值 × 1             ← 不放大
 * ```
 *
 * 未装刃影（w = 0）、暴率 ≤ 0、暴率 ≥ 200% 时恒为 1，行为与改动前逐位一致。
 */
export function bladeShadowMultiplier(cc: number, w: number): number {
  if (!(w > 0)) return 1;
  return 1 + bladeShadowGain(cc, w);
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
  // 需求方 2026-11-14：乘区最低 0（负弱点伤害词条不能把爆头倍率压成负数）
  return Math.max(0, base * (1 + sumPct(contribs, 'headshotDamage') + sumPct(contribs, 'weakpointDamage')));
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