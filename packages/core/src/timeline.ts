/**
 * 开火时间线（D-058 / **D-067 改为毫秒精度**）：某个时刻是否在开火。
 *
 * ```
 * 一个循环 = 打空弹匣（mag ÷ 射速 秒）+ 装填（reload 秒）
 * 若 mag ÷ 射速 ≥ 窗口长度 → 全程开火，永不装填
 * 装填期 = [fireDur, cycle)  —— 期间不叠层
 * ```
 */

/** 毫秒精度：1 秒切成 1000 份（D-067）—— 保留常量供兼容，内部已改用精确区间 */
const MS_PER_SECOND = 1000;

/**
 * 第 sec 秒（覆盖 `[sec-1, sec)`）里**开火的区间**（D-058 / D-067）。
 *
 * 与 {@link firingFraction} 的区别：这里返回区间列表而不是占比，
 * 和 `dotSixSecondCurve()` 那个**累加型**模型是等价的（窗口内累计开火时长一致），
 * 但 `six-second.ts` 的**逐秒层数池**（稳态口径）需要按真实时刻算「这一击在不在范围内」，
 * 所以直接拿精确区间。
 *
 * 区间是精确解出来的（不是按毫秒采样），O(1)。
 */
export function firingIntervals(mag: number, fr: number, reload: number, sec: number): [number, number][] {
  const t0 = sec - 1;
  const t1 = sec;
  if (!(mag > 0) || !(fr > 0)) return [[t0, t1]]; // 数据缺失时按全程开火
  const fireDur = mag / fr;
  const cycle = fireDur + Math.max(0, reload);
  if (!(cycle > 0) || fireDur >= cycle) return [[t0, t1]]; // 永不装填
  // 选一个能覆盖 [t0, t1) 的循环：周期内开火区间只有 [0, fireDur)
  // ⚠ 原来取 `k = floor(t0 / cycle)`，但浮点下 t0 可能正好落在周期边界（6.0000000001）
  //   而 k*cycle 算出 5.9999999999，导致这一秒被误判成"整秒装填"。
  //   这里枚举 [k-2, k+1] 并对结果按时间去重合并（不用"相邻循环不会重叠"的假设——
  //   开火段不足 1 秒时，同一秒里可能横跨好几个循环）。
  const kBase = Math.floor(t0 / cycle);
  const raw: [number, number][] = [];
  for (let k = kBase - 2; k <= kBase + 1; k++) {
    const a = Math.max(t0, k * cycle);
    const b = Math.min(t1, k * cycle + fireDur);
    if (b > a + 1e-12) raw.push([a, b]);
  }
  raw.sort((p, q) => p[0] - q[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of raw) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1] + 1e-9) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

/**
 * 某个时刻 `t` **往回推 `age` 秒**是否也在开火（`t - age` ∈ 开火段）。
 *
 * 逐秒层数池用它判断一拍 DoT 是否还在"有效期"内：装填期间 `t` 那一拍照样跳，
 * 但只要这一层已经超过持续时间，就移除（需求方 2026-11-15 A5：「装填期间会掉」）。
 */
export function isFiringAt(mag: number, fr: number, reload: number, t: number): boolean {
  if (!(mag > 0) || !(fr > 0)) return true;
  const fireDur = mag / fr;
  const cycle = fireDur + Math.max(0, reload);
  if (!(cycle > 0)) return true;
  return t % cycle < fireDur;
}

/**
 * 第 sec 秒（覆盖 `[sec-1, sec)`）的**开火时长占比** ∈ [0, 1]（D-067）。
 *
 * 用毫秒精度积分实际开火区间，而不是整秒开关 —— 这样射速提升会**单调**增加叠层。
 * 需求方 2026-11-15：内部改为精确区间（{@link firingIntervals}），数值与毫秒采样一致到 1e-3。
 */
export function firingFraction(mag: number, fr: number, reload: number, sec: number): number {
  const iv = firingIntervals(mag, fr, reload, sec);
  let fired = 0;
  for (const [a, b] of iv) fired += b - a;
  return Math.max(0, Math.min(1, fired));
}

/**
 * 第 sec 秒里**落在一个时间窗口 `[0, until)` 内**的开火区间。
 *
 * 稳态要算「一个循环（5.5 秒这种非整数）里到底打了几拍」：逐秒池是按整数秒出伤害的，
 * 直接取前 floor(cycle) 项会在 `cycle ≈ 整数` 时整拍漏掉（实测循环 6.0000000001 秒时，
 * 第 7 项被截掉、第 6 项又落在循环外，结果少算一整秒）。
 * 所以这里把"循环内"的那部分精确裁出来，最后按区间长度比例补上非整数那一段。
 */
export function firingIntervalsWithin(
  mag: number,
  fr: number,
  reload: number,
  sec: number,
  until: number,
): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of firingIntervals(mag, fr, reload, sec)) {
    const lo = Math.max(a, sec - 1);
    const hi = Math.min(b, until, sec);
    if (hi > lo) out.push([lo, hi]);
  }
  return out;
}

/**
 * 兼容旧签名（D-058）：第 sec 秒是否**整秒都在开火**。
 * 新代码请用 {@link firingFraction}（毫秒精度的占比，D-067）。
 */
export function buildFiringTimeline(mag: number, fr: number, reload: number, window = 6): (sec: number) => boolean {
  if (!(mag > 0) || !(fr > 0)) return () => true;
  const fireDur = mag / fr;
  const cycle = fireDur + Math.max(0, reload);
  if (fireDur >= window || cycle <= 0) return () => true; // 6 秒内打不完，无需装填
  return (sec: number): boolean => {
    // 第 sec 秒覆盖 [sec-1, sec)
    const mid = sec - 0.5;
    return mid % cycle < fireDur;
  };
}
