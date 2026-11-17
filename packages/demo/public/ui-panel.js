/**
 * 左侧「面板」区：属性面板、输出口径、伤害分布表、N 秒窗口。
 *
 * 这里只负责**把算好的结果画出来**；数值全部来自 `core.compute()` 的返回，
 * 本模块不做任何口径换算。
 */
import { store } from './app-store.js';
import { ELEMENT_COLOR, ELEMENT_LABEL, bucketLabel, fmt, fmtPct, spreadTotalOf } from './app-store.js';
import { $, el } from './ui-dom.js';
import { statLabel } from './ui-labels.js';
import { renderDotDetail } from './ui-detail.js';
import { DOT_TYPES, bladeShadowGain, critAverage, critTiers, firstTierCritChance, totalProcChance } from '../../core/src/index.ts';
import { currentContributions, effectiveModeFor } from './app-compute.js';

/** 外壳注入 */
let _rerender = () => {};
let _flash = () => {};

export function wirePanelDeps(deps) {
  if (deps.rerender) _rerender = deps.rerender;
  if (deps.flash) _flash = deps.flash;
}
/** 依据列数生成等宽网格模板（首列宽一些） */
function colTemplate(cols) {
  if (cols <= 1) return '1fr';
  const parts = ['1.4fr'];
  for (let i = 1; i < cols; i++) parts.push('1fr');
  return parts.join(' ');
}

/**
 * 该行的「当前」值是否与「基础」值不同（且不是合计行）。
 *
 * ⚠ 这里比的是**显示字符串**，所以两个数值必须先按同一格式格式化（见 `renderPanel`）；
 * 否则 1.00 vs 1.000、70 vs 70.0 这种"其实相等"的行也会被判成"已变化"。
 */
function isChanged(row) {
  if (row[0] === '合计') return false;
  const a = typeof row[1] === 'object' && row[1] ? row[1].text : row[1];
  const b = typeof row[2] === 'object' && row[2] ? row[2].text : row[2];
  if (a === undefined || b === undefined) return false;
  // 数值本身能解析成数时按数值比较（容差 1e-9），避免格式化差异造成误报
  const na = Number(String(a).replace(/[^\d.eE+-]/g, ''));
  const nb = Number(String(b).replace(/[^\d.eE+-]/g, ''));
  if (Number.isFinite(na) && Number.isFinite(nb) && /^[\d.]/.test(String(a)) && /^[\d.]/.test(String(b))) {
    return Math.abs(na - nb) > 1e-9;
  }
  return String(a) !== String(b);
}

/** 暴击分档（D-033：常驻显示在伤害分布下面） */
function renderCritTiers(res) {
  const box = $('#crit-tiers');
  box.innerHTML = '';
  const seg = res.segments[0];
  const tiers = critTiers(seg.critChance, seg.critDamage);
  const head = el('div', 'panel-row panel-head');
  head.append(el('span', 'c-name', '等级'), el('span', 'c-base', '概率'), el('span', 'c-after', '倍率'));
  box.append(head);
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const row = el('div', 'panel-row');
    row.append(el('span', 'c-name', '等级 ' + t.k));
    row.append(el('span', 'c-base', (t.prob * 100).toFixed(2) + '%'));
    row.append(el('span', 'c-after', '×' + t.mul.toFixed(2)));
    box.append(row);
  }
  const avg = el('div', 'panel-row panel-total');
  avg.append(el('span', 'c-name', '平均'));
  avg.append(el('span', 'c-base', ''));
  avg.append(el('span', 'c-after', '×' + critAverage(1, seg.critChance, seg.critDamage).toFixed(3)));
  box.append(avg);

  // D-189：装了刃影时补一行拆解，方便直接核对「增益 = w × 一级暴击概率」
  const bladeW = currentContributions().reduce(function (a, c) {
    return a + (c.stat === 'bladeShadow' ? c.amount : 0);
  }, 0) / 100;
  if (bladeW > 0) {
    const gain = bladeShadowGain(seg.critChance, bladeW);
    const row = el('div', 'panel-row');
    row.append(el('span', 'c-name', '其中刃影'));
    row.append(el('span', 'c-base', '一级 ' + (firstTierCritChance(seg.critChance) * 100).toFixed(2) + '%'));
    row.append(el('span', 'c-after', '+' + (gain * 100).toFixed(2) + '%'));
    box.append(row);
  }
}

/**
 * 范围伤害（D-031 修订）：仅当配置含爆炸元素时显示。
 * 满层/击杀后对**周围敌人（非主目标）**按每层系数 3 结算，不需要周围目标数量。
 */
function renderSplashDamage(res) {
  const box = $('#splash-damage');
  box.innerHTML = '';
  const b = res.output.blast;
  if (!b || b.stacksPerSecond <= 0) return; // 没有爆炸就不显示

  box.append(el('h2', 'section-title', '范围伤害'));
  // 需求方 2026-11-12：「这里的六秒合计没删啊」——只留一个数，不再显示六秒合计。
  // 需求方 2026-11-15（C1）：以前这里读的 `splashPerSecond` 字段内核已经删掉了
  //（D-171 改成 `splashOnTrigger`），所以这一行一直是空的。范围伤害是**触发一次的合计**，
  // 不是每秒产出，单位也改成「/次」。
  const row = el('div', 'panel-row');
  row.append(el('span', 'c-name', '对周围敌人'));
  const splash = b.splashOnTrigger || 0;
  row.append(el('span', 'c-val', fmt(splash) + ' /次'));
  row.title = '1.5 秒内叠满 10 层（或目标死亡）时对周围敌人的一次范围伤害，不进任何总伤';
  const table = el('div', 'panel-table');
  table.append(row);
  box.append(table);
}

/**
 * 浏览器标签页标题（D-170，需求方 2026-11-12）。
 *
 * 需求方原话：「然后标题也改一下，他现在始终是赤毒卡拉克」——
 * 标签页以前在 `index.html` 里写死 `wfcalc · 赤毒·卡拉克`，换到别的枪也不变。
 * 现在跟着**当前武器**走：`wfcalc · 艾弗旺-5 木星（LasGooAKPlayerWeapon）`。
 *
 * 兜底：数据还没加载 / 没有当前武器时保留 `index.html` 里的占位标题，不要停在上把枪的名字。
 */
export function renderPageTitle() {
  const w = store.data && store.data.weapon;
  if (!w) return;
  const nameZh = w.nameZh || w.name;
  document.title = 'wfcalc · ' + nameZh + (w.name && w.name !== nameZh ? '（' + w.name + '）' : '');
}

/** 当前变体的**生效模式**：把变体的段与 override 合并后交给 core（实现在 app-compute.js） */
export function effectiveMode() {
  const d = store.data;
  return d ? effectiveModeFor(d.weapon, store.ui) : null;
}

/** 当前模式内勾选了哪些攻击方式（下标数组）；`null` 表示全选 */
export function selectedVariantIdx() {
  const m = currentMode();
  if (!m) return [];
  const vs = m.variants ?? [];
  const sel = store.ui.selectedVariants;
  if (!Array.isArray(sel)) return vs.map(function (_, i) { return i; });
  return sel.filter(function (i) { return i >= 0 && i < vs.length; });
}

/** 当前选中攻击模式（D-042：多面板武器由右上角的模式按钮切换） */
export function currentMode() {
  const d = store.data;
  if (!d || !d.weapon) return null;
  const modes = d.weapon.modes;
  return modes[Math.min(store.ui.modeIndex, modes.length - 1)] ?? modes[0];
}

function fillRows(sel, head, rows) {
  const box = $(sel);
  box.innerHTML = '';
  const h = el('div', 'panel-row panel-head');
  h.style.gridTemplateColumns = colTemplate(head.length);
  for (let i = 0; i < head.length; i++) {
    h.append(el('span', i === 0 ? 'c-name' : 'c-val', head[i]));
  }
  box.append(h);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const div = el('div', 'panel-row' + (row[0] === '合计' ? ' panel-total' : ''));
    div.style.gridTemplateColumns = colTemplate(head.length);
    // 哪一列是「当前」：有「基础/当前」两列的表格取第 3 列（索引 2），否则不高亮
    const changed = isChanged(row);
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (c === 0 && cell && cell.dot) {
        const span = el('span', 'c-name');
        const dot = el('span', 'dt-dot');
        dot.style.background = cell.dot;
        span.append(dot, document.createTextNode(cell.text));
        div.append(span);
      } else if (c === 2 && changed) {
        // 只高亮「当前」列（索引 2），不碰「基础」列
        div.append(el('span', 'c-val c-after changed', String(cell)));
      } else {
        div.append(el('span', c === 0 ? 'c-name' : 'c-val', String(cell)));
      }
    }
    box.append(div);
  }
}

/**
 * 一个模式内**全部变体的全部段**（D-080：模式上不再有 segments）。
 *
 * ⚠ app.js 不是模块（没有 import/export 之外的模块语法以外的包装），
 *   ui-editor.js 里有一份同义实现，改这里要同步改那边。
 */
function modeSegments(m) {
  if (!m) return [];
  const out = [];
  for (const v of m.variants || []) for (const s of v.segments || []) out.push(s);
  return out;
}

/**
 * 逐段的面板对照（需求方 2026-11-15，C2）。
 *
 * 「多段武器每段的暴率 / 触发率可以不一样，面板只显示第一段会误导」——
 * 所以除主段之外，凡是有差异的段都补一张小表：
 * ```
 * 段名        暴击几率        触发几率
 *            基础 / 当前     基础 / 当前
 * ```
 * 单段武器、或各段与主段完全一致时**不画**（不制造噪音）。
 *
 * @param res `compute()` 结果（`segmentPanelPairs` 已按勾选的攻击方式切好）
 */
function renderSegmentPanels(res) {
  const pairs = res.segmentPanelPairs || [];
  if (pairs.length <= 1) return;
  const main = pairs[0];
  const differs = pairs.slice(1).some(function (p) {
    return Math.abs(p.critChance.base - main.critChance.base) > 1e-9
      || Math.abs(p.critChance.after - main.critChance.after) > 1e-9
      || Math.abs(p.statusChance.base - main.statusChance.base) > 1e-9
      || Math.abs(p.statusChance.after - main.statusChance.after) > 1e-9;
  });
  if (!differs) return;

  const wrap = el('div', 'dmg-table');
  const table = el('div', 'panel-table');
  const head = el('div', 'panel-row panel-head');
  head.style.gridTemplateColumns = colTemplate(3);
  head.append(el('span', 'c-name', '逐段面板'));
  for (const h of ['暴击几率', '触发几率']) head.append(el('span', 'c-val', h));
  table.append(head);
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const row = el('div', 'panel-row');
    row.style.gridTemplateColumns = colTemplate(3);
    row.append(el('span', 'c-name', '第 ' + (p.index + 1) + ' 段 · ' + p.kind));
    row.append(el('span', 'c-val',
      (p.critChance.base * 100).toFixed(2) + '% / ' + (p.critChance.after * 100).toFixed(2) + '%'));
    row.append(el('span', 'c-val',
      (p.statusChance.base * 100).toFixed(2) + '% / ' + (p.statusChance.after * 100).toFixed(2) + '%'));
    table.append(row);
  }
  wrap.append(table);
  const host = $('#panel-table');
  (host.parentElement || host).append(wrap);
}

/** 造一张伤害分布小表；`title` 用作第一列表头（攻击方式名） */
function buildDamageTable(title, base, spread, procNow) {
  const wrap = el('div', 'dmg-table');
  const table = el('div', 'panel-table');
  const typeSet = [];
  const push = function (t) { if (typeSet.indexOf(t) < 0) typeSet.push(t); };
  Object.keys(base || {}).forEach(push);
  Object.keys(spread || {}).forEach(push);
  const total = spreadTotalOf(spread || {});
  const rows = typeSet.map(function (t) {
    const share = total > 0 ? ((spread || {})[t] || 0) / total : 0;
    return [
      { text: ELEMENT_LABEL[t] || t, dot: ELEMENT_COLOR[t] },
      fmt((base || {})[t] || 0),
      fmt((spread || {})[t] || 0),
      (procNow * share * 100).toFixed(2) + '%',
    ];
  });
  rows.push(['合计', fmt(spreadTotalOf(base || {})), fmt(total), (procNow * 100).toFixed(2) + '%']);

  const head = el('div', 'panel-row panel-head');
  head.style.gridTemplateColumns = colTemplate(4);
  head.append(el('span', 'c-name', title));
  for (const h of ['基础', '当前', '触发率']) head.append(el('span', 'c-val', h));
  table.append(head);
  for (const r of rows) {
    const row = el('div', 'panel-row' + (r[0] === '合计' ? ' panel-total' : ''));
    row.style.gridTemplateColumns = colTemplate(4);
    // D-041 / D-045：只在「当前」列高亮变化（与 `fillRows` 同一判定）
    const changed = isChanged(r);
    for (let i = 0; i < r.length; i++) {
      const cell = r[i];
      if (i === 0 && cell && typeof cell === 'object' && cell.dot) {
        // 与 `fillRows` 同一套写法（DOM shim 不支持 prepend）
        const span = el('span', 'c-name');
        const dot = el('span', 'dt-dot');
        dot.style.background = cell.dot;
        span.append(dot, document.createTextNode(cell.text));
        row.append(span);
      } else if (i === 2 && changed) {
        row.append(el('span', 'c-val c-after changed', typeof cell === 'string' ? cell : cell.text));
      } else {
        const text = typeof cell === 'string' ? cell : cell.text;
        row.append(el('span', i === 0 ? 'c-name' : 'c-val', text));
      }
    }
    table.append(row);
  }
  wrap.append(table);
  return wrap;
}

/**
 * 渲染伤害分布表（每种攻击方式一张）。
 *
 * **需求方 2026-11-12**：
 * > 「不同段的伤害分布是不一样的，为什么没有多个伤害分布表」
 * > 「不需要合计啊，而且他们的触发是各自算的，你把他们合到一个表然后均摊触发率显然不对」
 *
 * 所以：
 *   · 每种勾选的攻击方式**各一张表**，表头第一列写攻击方式名（直接命中 / 范围伤害 / 射线…）；
 *   · **不做合计表**——各段伤害类型不同、触发率也各自独立，合起来再均摊触发率是错的；
 *   · 触发率**逐段各算**：用该段自己的面板触发率 + 当前 Mod，而不是整个模式共用一个数。
 *
 * @param res  compute 结果（`spreadByVariant` 已按勾选的攻击方式切好）
 */
function renderDamageTables(res) {
  const box = $('#damage-table');
  box.innerHTML = '';

  const m = effectiveMode();
  const picked = selectedVariantIdx();
  const variants = m && m.variants ? picked.map(function (i) { return m.variants[i]; }).filter(Boolean) : [];
  const perVariant = res.spreadByVariant || [];
  const contribs = currentContributions();
  const beam = Boolean(m && m.trigger === 'held');

  // `res.segments` 是按变体顺序拼接的（与 `spreadByVariant` 同一游标），
  // 这里算出每个变体占哪一段区间，好把「基础」列按段取到。
  const segStarts = [];
  {
    let cursor = 0;
    for (const v of variants) {
      segStarts.push(cursor);
      cursor += (v.segments || []).length;
    }
  }

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    const spread = perVariant[i] || {};
    const segCount = (v.segments || []).length;
    const segStart = segStarts[i];
    // 「基础」列 = 该攻击方式各段的**面板**（Q5 定案 2026-11-06：
    //   「基础面板 = 加了玄骸的，当前面板含其他加成」）。
    // 所以优先用内核算好的 `panelWithKuva`，取不到再退回面板原始伤害
    // （血肢那类自带元素在别的段上的武器，按段取才不会漏）。
    const base = {};
    for (let k = segStart; k < segStart + segCount; k++) {
      const r = res.segments ? res.segments[k] : null;
      if (!r) continue;
      for (const [t, val] of Object.entries(r.panelWithKuva || r.panel || {})) {
        if (typeof val === 'number' && val !== 0) base[t] = (base[t] || 0) + val;
      }
    }
    if (Object.keys(base).length === 0) {
      for (const s of v.segments || []) {
        for (const [t, val] of Object.entries(s.damage || {})) {
          if (typeof val === 'number' && val !== 0) base[t] = (base[t] || 0) + val;
        }
      }
    }
    // 触发率**逐段各算**：取该攻击方式第一段的面板触发率，加上当前 Mod
    const seg0 = (v.segments && v.segments[0]) || null;
    const proc = totalProcChance(seg0 ? seg0.procChance : 0, contribs, beam);
    box.append(buildDamageTable(v.label || '伤害', base, spread, proc));
  }
}

/**
 * 输出口径列表（左栏「伤害」）。
 *
 * **D-171（需求方 2026-11-13）**：
 * > 「六秒异常总伤，改成 n 秒异常总伤，然后右侧加一个选择秒数的。
 * >   然后加一个 n 秒总伤，这个总伤是续航秒伤 × n + n 秒异常总伤。」
 * > 「你怎么放到左边去了啊，肯定是放到增幅基准那边啊。」
 *
 * 所以：左栏这两行**只显示名字与数值**，名字随秒数变；
 * 秒数下拉框在**增幅基准那一排**（见 `renderDotWindowPicker`）。
 */
function renderOutputs(res) {
  // 左栏只读展示每种口径的数值与单位；单选框移到 Mod 槽位上方
  const box = $('#output-list');
  box.innerHTML = '';
  const lines = res.output.lines;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const row = el('div', 'output-row');
    const name = el('span', 'output-name');
    name.append(document.createTextNode(line.label));
    if (line.unit) name.append(el('span', 'output-unit', line.unit));
    row.append(name);
    row.append(el('span', 'output-val', fmt(line.value)));
    box.append(row);
  }

  // 异常状态明细（含爆炸）
  //
  // **需求方 2026-11-12**：  // > 「把异常状态 爆炸那边的灰色小字注释去掉」
  // > 「由于现在有多个段了，这里也应该分段显示，他们触发的 dot 伤害会根据段的命中伤不一样」
  //
  // 所以：不再给爆炸挂一行灰色说明；每种攻击方式各一块，各段显示自己的异常状态
  // （每段用自己的命中分布算触发池与每跳，见内核的 `output.dotBySegment`）。
  renderDotDetail(res);

  renderSplashDamage(res);
}

export function renderPanel(res) {
  const p = res.panelPairs;
  const w = store.data.weapon;

  // ⚠ 两列必须用**同一套格式**：「当前」列的差异高亮是拿显示串比较的（`isChanged`），
  //   基础列写 1.00、当前列写 1.000，就会把"没变化"判成"变了"。
  const rows = [
    ['暴击几率', (p.critChance.base * 100).toFixed(2) + '%', (p.critChance.after * 100).toFixed(2) + '%'],
    ['暴击伤害', '×' + p.critMultiplier.base.toFixed(2), '×' + p.critMultiplier.after.toFixed(2)],
    ['触发几率', (p.statusChance.base * 100).toFixed(2) + '%', (p.statusChance.after * 100).toFixed(2) + '%'],
    ['多重射击', p.multishot.base.toFixed(3), p.multishot.after.toFixed(3)],
    ['射速', p.fireRate.base.toFixed(3), p.fireRate.after.toFixed(3)],
    // D-066：弹匣与装填各占一行，改用**核心算出的面板对照**（之前直接读武器原始值，
    // 导致弹匣/装填 Mod 在面板上看不出任何效果）
    // D-084：弹匣保留两位小数（弹药效率会算出非整数弹匣）
    // 需求方 2026-11-15（A6）：弹匣这一行**直接显示等效弹匣**（已含弹药效率，上限 0.75），
    // 不再单列「等效弹匣」行——计算用的就是它。
    ['弹匣容量', p.magazineSize.base.toFixed(2), p.magazineSize.after.toFixed(2)],
    ['装填时间', p.reloadTime.base.toFixed(3) + ' 秒', p.reloadTime.after.toFixed(3) + ' 秒'],
  ];

  // 需求方 2026-11-15（A6）：「等效弹匣」**不再单列一行**——
  // 上面「弹匣容量」的当前值就是等效弹匣（已乘弹药效率，上限 0.75），
  // 这里只在有两处算法可能分叉时给出提示。

  fillRows('#panel-table', ['属性', '基础面板', '当前面板'], rows);

  // 需求方 2026-11-15（C2）：**多段武器的每段面板不同**（暴率 / 触发率可以逐段不一样），
  // 上面那张表只反映主段。这里按勾选的攻击方式把每一段再各列一张，
  // 只在「有不止一段、且各段的暴率 / 触发率与主段不一致」时才画，避免单段武器多出一张重复表。
  renderSegmentPanels(res);

  // ── 伤害分布：**每种攻击方式一张表，不做合计**（需求方 2026-11-12）──
  //
  // > 「伤害分布下面挂多张表，伤害类型那个表头可以不要，改成命中类型，例如直接命中，范围伤害」
  // > 「不需要合计啊，而且他们的触发是各自算的，你把他们合到一个表然后均摊触发率显然不对」
  //
  // 所以「基础列 / 当前列 / 触发率」三者都**逐段在 `renderDamageTables` 里算**，
  // 这里不再预先合并成一份，避免把不同段的伤害类型与触发率混在一起。
  renderDamageTables(res);

  renderCritTiers(res);
  renderOutputs(res);
}

/**
 * 「面板待补」武器的渲染（D-141）。
 *
 * 这类武器是**骨架**：分类、暴击、射速有了，但伤害段还没录（例如暗黑分合剑的重剑 / 双剑两版）。
 * 界面要让用户一眼看出「这把武器还不能算」，而不是显示一片空表或 NaN。
 *
 * ⚠ 需求方 2026-11-12：数据错误标记（⚠）已全部去掉，这里只用**文字**说明状态，
 *   因为它描述的是「这把武器还没有可算的数据」，而不是「数据有错」。
 */
export function renderPendingPanel() {
  const w = store.data.weapon;
  const titleEl = $('#weapon-title');
  const name = (w.nameZh || w.name) + '（' + w.name + '）';
  titleEl.textContent = name;
  titleEl.title = w._note || '面板未收录';
  // D-170：面板待补的武器同样要把标签页标题换成它自己的名字
  renderPageTitle();
  const metaEl = $('#weapon-meta');
  if (metaEl) metaEl.textContent = '面板待补 · 暂不可计算';
  const switchBox = $('#mode-switch');
  if (switchBox) switchBox.innerHTML = '';
  const tipText = '这把武器的面板数据尚未收录，暂不能计算。' + (w._note ? '（' + w._note + '）' : '');
  const tipInto = function (sel) {
    const box = $(sel);
    if (!box) return;
    box.innerHTML = '';
    const tip = el('div', 'panel-pending-tip');
    tip.textContent = tipText;
    box.append(tip);
  };
  // 面板 / 伤害分布 / 输出：全部换成提示，不留旧武器的残值
  tipInto('#panel-table');
  tipInto('#damage-table');
  tipInto('#output-list');
  // 配装区清空（不渲染可装 Mod，避免"能拖却没数"）
  for (const sel of ['#slot-grid', '#arcane-slots', '#side-slots', '#candidate-list', '#arcane-list', '#co-controls', '#dot-detail', '#splash-damage', '#crit-tiers', '#riven-compose', '#riven-candidates', '#riven-combo', '#riven-value-mode']) {
    const box = $(sel);
    if (box) box.innerHTML = '';
  }
  const slotInfo = $('#slot-info');
  if (slotInfo) slotInfo.textContent = '';
  const detail = $('#detail');
  if (detail) {
    detail.innerHTML = '';
    const tip = el('div', 'panel-pending-tip');
    tip.textContent = '面板待补：没有伤害段，无法拆解乘区。补上数值后这里会自动出现拆解。';
    detail.append(tip);
  }
}