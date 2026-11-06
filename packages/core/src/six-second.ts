/**
 * 六秒异常状态总伤（§0.2 / §6.3）——**逐秒模拟曲线**。
 *
 * ```
 * 前提：持续射击中，从 t=0 开始按射速与触发期望逐秒叠层
 * 口径：第 t 秒的伤害 = 该秒在场层数 × 每层伤害
 * 六秒总伤 = Σ_{t=1..6} 该秒伤害
 * ```
 */
import type { DoTType } from './dot.ts';
import type { DamageSpread } from './damage-types.ts';

/** **在 0 秒立即跳一拍**的 DoT 类型（D-059）。电击与毒气在触发当下就结算一次，层数取"首发"。 */
export const IMMEDIATE_TICK: ReadonlySet<DoTType> = new Set<DoTType>(['electric', 'gas']);

/**
 * 取该类型的层数上限（`null` = 无上限）。
 * 单独抽出来，避免 `DOT_MAX_STACKS[t]` 在 t 越界时静默返回 undefined。
 */
function DOT_MAX_STOCKS_FIX(t: DoTType): number | null {
  const v = (DOT_MAX_STACKS as Record<string, number | null | undefined>)[t];
  return v === undefined ? null : v;
}

/**
 * 各 DoT 的**层数上限**（§6.3）。`null` = 无上限。
 * 毒气 10 层封顶；火/毒/电/切割均无上限。
 */
export const DOT_MAX_STACKS: Readonly<Record<DoTType, number | null>> = {
  heat: null,
  toxin: null,
  electric: null,
  gas: 10,
  slash: null,
};

/**
 * D-055：该 DoT 类型对应的元素**是否真的出现在命中分布里**。
 *
 * 触发池只由「命中伤害里实际存在的伤害类型」构成（§0.3），
 * 没有的元素永远叠不出层。而 `dotTick` 的 ① 基础值取的是**全类型之和**，
 * 所以必须单独判断，否则毒/火/电这些没配的元素也会算出「每层秒伤」。
 */
export function hasDotElement(spread: DamageSpread, t: DoTType): boolean {
  return (spread[t] ?? 0) > 0;
}

/**
 * 六秒异常状态总伤（§0.2 / §6.3）——**逐秒模拟曲线**。
 *
 * **火焰（§6.3「新出现的火焰异常状态会刷新已有的火焰异常状态持续时间
 * 并叠加灼烧的伤害量，即后续命中的基础值加入到火焰 DoT 的计算」）**：
 * - 火焰**每秒跳一次**，所以按**整数秒**把该秒内新叠的基础值加进去；
 * - 层数是**累加量**而不是"多重叠加"：第 t 秒的每跳 =
 *   `单层伤害 × 该秒结束时累计的层数`；
 * - 刷新持续时间 → 火焰在 6 秒窗口内不会自然结束（只要还在开火）。
 *
 * **装填空窗（D-058）**：如果 6 秒内打不满（弹匣 ÷ 射速 < 6），
 * 每个循环要空出对应的**装填时间**，期间**不叠层**、DoT 也不跳。
 *
 * @param stacksPerSecond 每秒叠层（已含触发率 × 元素占比 × 多重 × 射速）
 * @param perStackPerSecond 单层每秒伤害（= `tick.tick`）
 * @param window 窗口长度（秒，默认 6）
 * @param firing 每秒的开火占比（0~1，由弹匣/射速/装填推出），默认全程开火。
 *   兼容旧的布尔签名：`true` 视为 1、`false` 视为 0（见下方 `frac` 归一化）。
 * @param stacksPerShot 单发期望层数（D-059：电击/毒气第 0 拍用它）
 */
export function dotSixSecondCurve(
  t: DoTType,
  stacksPerSecond: number,
  perStackPerSecond: number,
  window = 6,
  firing?: (second: number) => boolean | number,
  stacksPerShot = 0,
): number {
  const cap = DOT_MAX_STOCKS_FIX(t);
  const isHeat = t === 'heat';
  // 火焰专用的"累计基础值层数"（单调累加，不清零）
  let heatAccum = 0;
  // 非火焰的当场层数（只增不减）
  let stacks = 0;
  let total = 0;

  // ── D-059：电击 / 毒气在 0 秒立即跳一拍，层数取"首发" ──
  // 这一拍额外计入六秒之外（故窗口内共 7 拍）。
  if (IMMEDIATE_TICK.has(t) && stacksPerShot > 0) {
    const firstTick = cap === null ? stacksPerShot : Math.min(stacksPerShot, cap);
    total += perStackPerSecond * firstTick;
    // 这一层已经跳过了，进入 t=1 时不要重复计入 → 记为已存在
    stacks = firstTick;
  }

  for (let sec = 1; sec <= window; sec++) {
    // D-067：开火占比（0~1，毫秒精度）。老调用方传布尔值也能用（true→1 / false→0）。
    const raw = firing ? (firing as (s: number) => boolean | number)(sec) : true;
    const frac = raw === true ? 1 : raw === false ? 0 : Math.max(0, Math.min(1, Number(raw) || 0));

    // 这一秒内新叠上的层，按开火占比折算
    const added = stacksPerSecond * frac;
    if (isHeat) {
      heatAccum += added;
    } else {
      stacks += added;
    }

    // ⚠ 装填期间**不叠层**，但**已有的 DoT 仍在跳伤害**（D-058）。
    // 只有"新增层"被暂停，已叠的层照常每秒结算。
    if (isHeat) {
      // 火焰按整数秒把这一秒叠加的基础值计入 → 每跳 = 单层 × 累计层数
      total += perStackPerSecond * heatAccum;
    } else if (stacks > 0) {
      const capped = cap === null ? stacks : Math.min(stacks, cap);
      total += perStackPerSecond * capped;
    }
  }
  return total;
}

/**
 * 兼容旧签名（D-057 引入）：供测试直接调用。
 * @deprecated 用 {@link dotSixSecondCurve}
 */
export function sixSecondTotal(
  t: DoTType,
  stacksPerSecond: number,
  perStackPerSecond: number,
  window = 6,
  firing?: (second: number) => boolean | number,
): number {
  return dotSixSecondCurve(t, stacksPerSecond, perStackPerSecond, window, firing);
}
