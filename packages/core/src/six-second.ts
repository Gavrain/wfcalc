/**
 * 异常总伤（§0.2 / §6.3）——**逐秒模拟曲线**（D-057 / D-058 / D-059 / D-171）。
 *
 * ```
 * 前提：持续射击中，从 t=0 开始按射速与触发期望逐秒叠层
 * 口径：第 t 秒的伤害 = 该秒在场层数 × 每层伤害
 * N 秒总伤 = Σ_{t=1..N} 该秒伤害
 * ```
 *
 * **D-171（需求方 2026-11-13）**：窗口从写死的 6 秒改成可选的 N 秒（1~6），
 * 算法本身不变，`window` 参数一直就在那里，只是以前调用点写死成 6。
 *
 * ⚠ 文件名仍是 `six-second.ts`（历史名）：函数体对任意 N 都成立，
 *   改文件名会让 `main.ts` 的 re-export 与所有旧导入路径一起失效，收益不抵成本。
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
 * N 秒异常总伤（§0.2 / §6.3）——**逐秒模拟曲线**。
 *
 * **火焰（§6.3「新出现的火焰异常状态会刷新已有的火焰异常状态持续时间
 * 并叠加灼烧的伤害量，即后续命中的基础值加入到火焰 DoT 的计算」）**：
 * - 火焰**每秒跳一次**，所以按**整数秒**把该秒内新叠的基础值加进去；
 * - 层数是**累加量**而不是"多重叠加"：第 t 秒的每跳 =
 *   `单层伤害 × 该秒结束时累计的层数`；
 * - 刷新持续时间 → 火焰在 N 秒窗口内不会自然结束（只要还在开火）。
 *
 * **装填空窗（D-058）**：如果 N 秒内打不满（弹匣 ÷ 射速 < N），
 * 每个循环要空出对应的**装填时间**，期间**不叠层**、DoT 也不跳。
 *
 * **D-059 的第 0 拍**：电击 / 毒气在 0 秒立即跳一拍，这一拍额外计入窗口之外
 * （窗口内共 N+1 拍）。`window ≥ 1` 时它就存在，窗口多短都不变。
 * 它用的层数是**单发期望层数**（已含多重、与射速无关），不是"每秒叠层"——
 * 这是 D-059 已确认的口径，D-171 没有改它。
 *
 * @param stacksPerSecond 每秒叠层（已含触发率 × 元素占比 × 多重 × 射速）
 * @param perStackPerSecond 单层每秒伤害（= `tick.tick`）
 * @param window 窗口长度（秒，默认 6；D-171 起由界面选择，取值 1~6）
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
  // 这一拍额外计入 N 秒之外（故窗口内共 N+1 拍）。
  if (IMMEDIATE_TICK.has(t) && stacksPerShot > 0 && window > 0) {
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
 * 窗口内**叠上去的期望层数**（D-171 用它算主目标的爆炸总伤）。
 *
 * ```
 * 窗口内叠上的层数 = Σ_{t=1..N} 每秒叠层 × 第 t 秒开火占比
 * ```
 *
 * 只有**开火时**才叠层，装填期间不叠（D-058）；与 DoT 曲线用的是同一条开火时间线。
 *
 * ⚠ **不受层数上限约束**：这是"叠上去多少"，封顶是各类异常自己的规则
 *   （毒气 10 层封顶在 {@link dotSixSecondCurve} 里处理；爆炸主目标**没有**上限概念）。
 */
export function stacksInWindow(
  stacksPerSecond: number,
  window: number,
  firing?: (second: number) => boolean | number,
): number {
  let sum = 0;
  for (let sec = 1; sec <= window; sec++) {
    const raw = firing ? (firing as (s: number) => boolean | number)(sec) : true;
    const frac = raw === true ? 1 : raw === false ? 0 : Math.max(0, Math.min(1, Number(raw) || 0));
    sum += stacksPerSecond * frac;
  }
  return sum;
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

// ─────────────────────────────────────────────────────────────
// 逐秒层数池（需求方 2026-11-15，A5：稳态秒伤要按「清除」算）
//
// 上面 `dotSixSecondCurve()` 是**累加型**：层数只增不减，用来算 N 秒异常总伤。
// 稳态秒伤算的是「长期平均」，必须让层数真正**到期清除**：
//
// ```
// 每种 DoT 一个队列，每一项是一次触发（时刻、层数）
// 每拍（整数秒 t）：
//   ① 移除 t − 触发时刻 > 6 秒的项            ← 装填期间照样移除（「装填期间会掉」）
//   ② 伤害：
//        · 火 / 毒气 = 持续伤害，每拍按当场层数跳（毒气 10 层封顶）
//        · 毒 / 电 / 切割 = 每层只跳 1 拍，所以每拍只结算「本秒新叠的那一批」
//   ③ 本秒新叠的层按开火区间摊进来              ← 装填期间不新增
// ```
// ─────────────────────────────────────────────────────────────

/** 层数池的默认持续时间（秒），与 `dot.ts` 的 `DOT_DURATION` 一致 */
const POOL_DURATION = 6;

/** 一次触发的在场记录 */
export interface PoolEntry {
  /** 触发时刻（秒，可以是小数——取开火区间的起点） */
  firedAt: number;
  /** 这一项贡献的层数 */
  layers: number;
}

const POOL_EPS = 1e-9;

/** 第 sec 秒内新叠的层数 = 该秒各开火区间时长之和 × 每秒叠层 */
function addedInSecond(
  intervalsOf: (sec: number) => readonly [number, number][],
  sec: number,
  stacksPerSecond: number,
): number {
  let added = 0;
  for (const [a, b] of intervalsOf(sec)) added += stacksPerSecond * (b - a);
  return Math.max(0, added);
}

/**
 * 逐秒推进层数池，返回**每一拍的伤害**（长度 = `seconds`）。
 *
 * @param t                 DoT 类型
 * @param stacksPerSecond   每秒期望叠层（已含触发率 × 占比 × 多重 × 射速 × 刃影）
 * @param perStackPerSecond 单层每拍伤害（= `dotTick().tick`）
 * @param seconds           推进多少拍
 * @param intervalsOf       `sec → [[a,b), …]` 该秒内的开火区间（`timeline.firingIntervals`）
 * @param options.immediateFirst 电击 / 毒气：t=0 立即跳一拍（D-059），层数取单发期望
 * @param options.stacksPerShot  单发期望层数（`immediateFirst` 用）
 * @param options.duration       持续时间（秒，默认 6）
 */
export function dotStackPool(
  t: DoTType,
  stacksPerSecond: number,
  perStackPerSecond: number,
  seconds: number,
  intervalsOf: (sec: number) => readonly [number, number][],
  options: { immediateFirst?: boolean | undefined; stacksPerShot?: number | undefined; duration?: number | undefined } = {},
): number[] {
  const duration = options.duration ?? POOL_DURATION;
  const cap = DOT_MAX_STOCKS_FIX(t);
  // 火焰 / 毒气是持续伤害（每拍都跳）；毒 / 电 / 切割是每层只跳一拍
  const persistent = t === 'heat' || t === 'gas';
  /** 队列按触发时刻升序（先到先删） */
  const pool: PoolEntry[] = [];
  const out: number[] = [];

  /** 把新增层摊到本秒的开火区间上（区间中点作为触发时刻） */
  const addStacks = (sec: number): void => {
    for (const [a, b] of intervalsOf(sec)) {
      const layers = stacksPerSecond * (b - a);
      if (layers > POOL_EPS) pool.push({ firedAt: (a + b) / 2, layers });
    }
    if (cap !== null) {
      // 封顶：超出部分替换**最早**的层
      let total = 0;
      for (const e of pool) total += e.layers;
      let overflow = total - cap;
      for (let i = 0; i < pool.length && overflow > POOL_EPS; i++) {
        const take = Math.min(pool[i]!.layers, overflow);
        pool[i]!.layers -= take;
        overflow -= take;
      }
      for (let i = pool.length - 1; i >= 0; i--) {
        if (pool[i]!.layers <= POOL_EPS) pool.splice(i, 1);
      }
    }
  };

  /** 移除超过持续时间的层（装填期间也照做） */
  const expire = (tNow: number): void => {
    for (let i = pool.length - 1; i >= 0; i--) {
      if (tNow - pool[i]!.firedAt > duration + POOL_EPS) pool.splice(i, 1);
    }
  };

  let startSec = 1;
  // ① 第 0 拍：电击 / 毒气立即结算（D-059），这一层从 0 秒起计时
  if (options.immediateFirst && seconds > 0) {
    const first = options.stacksPerShot ?? 0;
    if (first > 0) {
      const layers = cap === null ? first : Math.min(first, cap);
      // 这一拍在窗口开始前（t=0）
      out.push(perStackPerSecond * layers);
      pool.push({ firedAt: 0, layers });
      startSec = 2;
    } else {
      out.push(0);
      startSec = 1;
    }
  }

  for (let sec = startSec; sec <= seconds; sec++) {
    // ① 到期清除（在这一秒开始时做）
    expire(sec);
    if (persistent) {
      // ② 持续伤害：先按本秒开始时的层数跳，再叠本秒新增（与端点无关，这里取"先跳后叠"）
      let layers = 0;
      for (const e of pool) layers += e.layers;
      out.push(perStackPerSecond * (cap === null ? layers : Math.min(layers, cap)));
      addStacks(sec);
    } else {
      // ② 每层只跳一拍：本拍伤害 = 本秒新叠的层数
      const added = addedInSecond(intervalsOf, sec, stacksPerSecond);
      out.push(perStackPerSecond * added);
      // 队列只用来记录「这些层还在不在」（到期后自然消失），对每层一跳型不影响伤害
      addStacks(sec);
    }
  }
  return out;
}

/**
 * **一个循环内的稳态异常每秒伤害**（需求方 2026-11-15，A4 + A5）。
 *
 * 循环 = 打空弹匣（`mag ÷ fr`）+ 装填（`reload`）。DoT 的持续时间是 6 秒，逐秒池只推进到
 * **循环长度 + 6 秒**：循环末尾刚刚叠上、到期时刻晚于这个窗口的层**不会被结算**（A5 的「清除」）。
 *
 * ```
 * 稳态异常每秒 = 循环内各拍伤害之和 ÷ 循环时长
 *   整拍：取 t < floor(循环) 的那几拍
 *   零头：最后一个不完整拍按「落在循环内的开火时长占该秒开火时长」折算
 * ```
 *
 * ⚠ 改写前的实现是「层/秒 × 开火段时长 ÷ 循环」，层数永不到期；
 *   中途还试过 `ceil(循环)+6` 的窗口，会把窗口外的层也算进来（已改回 `ceil(循环 + 6)`）。
 */
export function steadyDotPerSecond(
  types: readonly {
    type: DoTType;
    stacksPerSecond: number;
    perStackPerSecond: number;
    immediateFirst?: boolean;
    stacksPerShot?: number;
  }[],
  cycleSeconds: number,
  intervalsOf: (sec: number) => readonly [number, number][],
  /** 第 sec 秒里**落在 `[0, 循环长度)` 内**的开火区间（timeline.firingIntervalsWithin） */
  withinCycle?: (sec: number) => readonly [number, number][],
): number {
  const cycle = Math.max(0, cycleSeconds);
  if (!(cycle > 0)) return 0;
  /** 窗口 = 循环 + 持续时间：这之后的拍属于下一圈，不算进来 */
  const window = Math.ceil(cycle + POOL_DURATION);
  let sum = 0;
  for (const it of types) {
    if (!(it.perStackPerSecond > 0)) continue;
    const series = dotStackPool(it.type, it.stacksPerSecond, it.perStackPerSecond, window, intervalsOf, {
      immediateFirst: it.immediateFirst,
      stacksPerShot: it.stacksPerShot,
    });
    const whole = Math.floor(cycle);
    let acc = 0;
    for (let i = 0; i < whole; i++) acc += series[i]!;
    // 零头那一拍（第 whole+1 拍覆盖 [whole, whole+1)）：
    // 池里这一拍是"整秒"的量，这里只取循环内那一段，按开火时长比例折算。
    const frac = cycle - whole;
    if (frac > 1e-9) {
      const last = whole + 1;
      const full = intervalsOf(last).reduce((a, [x, y]) => a + (y - x), 0);
      const part = withinCycle
        ? withinCycle(last).reduce((a, [x, y]) => a + (y - x), 0)
        : full * frac;
      if (full > 0 && part > 0) acc += series[whole]! * (part / full);
    }
    sum += acc;
  }
  return sum / cycle;
}
