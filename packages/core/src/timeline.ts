/**
 * 开火时间线（D-058 / **D-067 改为毫秒精度**）：某个时刻是否在开火。
 *
 * ```
 * 一个循环 = 打空弹匣（mag ÷ 射速 秒）+ 装填（reload 秒）
 * 若 mag ÷ 射速 ≥ 窗口长度 → 全程开火，永不装填
 * 装填期 = [fireDur, cycle)  —— 期间不叠层
 * ```
 */

/** 毫秒精度：1 秒切成 1000 份（D-067） */
const MS_PER_SECOND = 1000;

/**
 * ⚠ 原来的实现用**整秒**判定（看该秒中点落在哪一段），导致开火秒数是阶梯函数：
 *   射速 16.92 → 开火 4 秒，射速 25.08 → 开火 5 秒，射速 30.33 → 又掉回 4 秒，
 *   于是"加射速反而降低总伤"。改成按**真实时间**判定后就单调了。
 *
 * @param t 时刻（秒）
 */
export function isFiringAt(mag: number, fr: number, reload: number, t: number): boolean {
  if (!(mag > 0) || !(fr > 0)) return true; // 数据缺失时按全程开火
  const fireDur = mag / fr;
  const cycle = fireDur + Math.max(0, reload);
  if (cycle <= 0) return true;
  return t % cycle < fireDur;
}

/**
 * 第 sec 秒（覆盖 `[sec-1, sec)`）的**开火时长占比** ∈ [0, 1]（D-067）。
 *
 * 用毫秒精度积分实际开火区间，而不是整秒开关 —— 这样射速提升会**单调**增加叠层。
 */
export function firingFraction(mag: number, fr: number, reload: number, sec: number): number {
  if (!(mag > 0) || !(fr > 0)) return 1;
  const fireDur = mag / fr;
  const cycle = fireDur + Math.max(0, reload);
  if (fireDur >= cycle || cycle <= 0) return 1; // 永不装填

  let fired = 0;
  const t0 = sec - 1;
  for (let ms = 0; ms < MS_PER_SECOND; ms++) {
    const t = t0 + ms / MS_PER_SECOND;
    if (t % cycle < fireDur) fired++;
  }
  return fired / MS_PER_SECOND;
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
