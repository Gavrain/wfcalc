/**
 * 可复用的 UI 小组件。
 *
 * 「可复用」= 这些组件不认识业务：给它们数据与回调，它们只负责生成 DOM。
 * 折叠块的展开状态存在 `localStorage`，与配卡存档无关。
 */
import { ELEMENT_COLOR, ELEMENT_LABEL, fmt } from './app-store.js';
import { el } from './ui-dom.js';

const COLLAPSE_STORE_KEY = 'wfcalc.collapse.v1';
/** 一行异常状态：色点 + 名称 + 层/秒 +（伤害型才有）伤害数 */
export function dotRow(r, withValue) {
  const row = el('div', 'dot-row');
  const dot = el('span', 'dt-dot');
  dot.style.background = ELEMENT_COLOR[r.type] || '#888';
  row.append(dot, el('span', 'dot-name', ELEMENT_LABEL[r.type] || r.type),
    el('span', 'dot-stacks', r.stacks.toFixed(2) + ' 层/秒'));
  // 需求方 2026-11-12：非伤害型异常「不需要后面那个伤害」
  if (withValue) row.append(el('span', 'dot-val', fmt(r.per) + r.unit));
  return row;
}

/**
 * 折叠状态（`localStorage`）。
 *
 * 需求方 2026-11-12：「折叠状态能保存到浏览器储存里面吗，可以就存」。
 * 只存「哪个块展开 / 收起」，与武器、配装无关，所以换枪也保持。
 * 读失败（隐私模式 / 存储被禁）时退回默认值，不影响页面。
 *
 * ⚠ 老版本存的 `dot-detail`（外层"异常状态"那一层）已随外层标题一起去掉，
 * 这里不再读它——旧存档里多出来的键会被忽略。
 */
function readCollapse() {
  const def = { 'dot-dmg': true, 'dot-nondmg': false };
  try {
    const raw = window.localStorage.getItem(COLLAPSE_STORE_KEY);
    if (!raw) return def;
    const saved = JSON.parse(raw);
    for (const k of Object.keys(def)) {
      if (typeof saved[k] === 'boolean') def[k] = saved[k];
    }
    return def;
  } catch (e) {
    return def;
  }
}

/** 切换一个块的展开状态并持久化 */
function toggleCollapse(key) {
  const state = readCollapse();
  state[key] = !state[key];
  writeCollapse(state);
}

/**
 * 可折叠块：**标题永远显示**，收起只隐藏内部项。
 *
 * @param key      折叠状态的键（存 `localStorage`）
 * @param title    标题文字
 * @param count    内部项数量（显示在标题右边）
 * @param fill     (bodyEl) => void，往内部容器里填内容
 * @param suffix   可选后缀（多段武器时带上段名，免得三段的重名块分不清）
 */
export function collapsibleBlock(key, title, count, fill, suffix) {
  const wrap = el('div', 'collapse-block');
  const open = readCollapse()[key] !== false;
  if (!open) wrap.classList.add('collapsed');

  const head = el('button', 'collapse-head');
  head.type = 'button';
  const caret = el('span', 'collapse-caret', open ? '▾' : '▸');
  head.append(caret);
  head.append(el('span', 'collapse-title', suffix ? (suffix + ' · ' + title) : title));
  head.append(el('span', 'collapse-count', count > 0 ? String(count) : '无'));
  head.addEventListener('click', function () {
    toggleCollapse(key);
    // 只切本块的显示，不重算整页（避免重算时滚动位置跳动）
    const collapsed = wrap.classList.toggle('collapsed');
    caret.textContent = collapsed ? '▸' : '▾';
  });

  const body = el('div', 'collapse-body');
  fill(body);
  wrap.append(head, body);
  return wrap;
}