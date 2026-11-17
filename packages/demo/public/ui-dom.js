/**
 * UI 共享的 DOM 小工具。
 *
 * 这里只放**纯 DOM 操作**：查元素、建元素、格式化数值、弹提示。
 * 任何与业务（Mod / 裂罅 / 套装…）有关的东西都不放这里，
 * 这样所有 `ui-*.js` 都能依赖它、而它不依赖任何业务模块（无环）。
 */

/** `document.querySelector` 的简写 */
export const $ = (s) => document.querySelector(s);

/**
 * 建一个元素。
 *
 * @param tag  标签名
 * @param cls  类名（可省略）
 * @param text 文本（可省略；用 `textContent` 赋值，不解析 HTML）
 */
export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** 把小数增幅格式化成 `+12.3%` / `−4.5%` / `∞`；`null` 显示为空 */
export function fmtGain(g) {
  if (g === null || g === undefined) return '';
  // 无穷大（这张卡让该指标从无到有，D-171）
  if (!Number.isFinite(g)) return '∞';
  const pct = g * 100;
  const sign = pct > 0.05 ? '+' : pct < -0.05 ? '' : '±';
  return sign + pct.toFixed(1) + '%';
}

let toastTimer = null;

/** 右下角弹一条提示（1.8 秒后自动消失） */
export function flash(msg) {
  const bar = $('#toast');
  if (!bar) return;
  bar.textContent = msg;
  bar.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    bar.classList.remove('show');
  }, 1800);
}
