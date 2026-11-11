/**
 * 配装页面（D-105）：本文件只留「界面怎么画」。
 *
 * ```
 * app.js            入口 + 渲染编排 + 渲染函数 + 拖拽 + 武器切换
 * app-store.js      共享状态（store.ui / modSlots / data …）+ 中文表 + 数字格式
 * app-data.js       数据层：读 generated/ JSON、挑可装 Mod、劣化槽判定
 * app-compute.js    计算层薄壳：组装 runCompute() 参数、跑计算、算相对提升
 * ui-editor.js      开发态武器编辑器
 * weapon-picker.js  武器选单
 * weapon-override.js override 合并规则
 * ```
 *
 * 每个数值都能对应到 `docs/伤害公式.md` 的某个函数；面板区随 Mod 实时更新；
 * 备选 Mod 区给出装上之后的伤害增幅（增幅基准可选）。
 *
 * ⚠ 写法约束：`packages/demo/src/server.mjs` 用"剥类型"的方式在浏览器里直接跑 `.ts` 源码，
 * 所以这里只用**命名导入**，不要写 `const { a } = ns` 这种解构。
 */
import { critAverage, critTiers, DOT_TYPES, isKuvaFamily, METRIC_OPTIONS, totalProcChance } from '../../core/src/index.ts';
import { WEAPON_GROUPS, groupWeapons, searchWeapons, FIRE_STYLE_OPTIONS, filterByStyle, weaponLabel, weaponGroupId, ISSUE_MARK } from './weapon-picker.js';
import { OVERRIDE_WEAPON_FIELDS as OVERRIDE_FIELDS, mergeWeaponOverride as applyWeaponOverride } from './weapon-override.js';
import { issuesOf } from '../../data/src/manual/weapon-issues.ts';
import { arcaneDisplayStats, arcaneToContributions, isConditionOverloadMod, modStackFactor } from '../../data/src/adapter.ts';
import {
  ELEMENT_COLOR, ELEMENT_LABEL, EXILUS_INDEX, FACTION_OPTIONS, KUVA_ELEMENTS, MAX_SLOTS, SLOT_COUNT,
  bucketLabel, fmt, fmtPct, setData, setDataAll, spreadTotalOf, store,
} from './app-store.js';
import { buildWeaponData, isArcaneUsableOn, isExilusMod, isModAllowedOnWeapon, loadAllWeapons, modName } from './app-data.js';
import {
  coDefaults, coInfo, coModGain, currentContributions, effectiveModeFor, freezeInfo, gainOf, metricValueOf, runCompute,
} from './app-compute.js';
import * as editor from './ui-editor.js';

// ─────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────

/** 默认打开的模式（武器的第一个攻击模式在 boot 时按实际武器取，见 `firstDisplayMode`） */
const MODE_ID = 'primary';

/**
 * 启动时的第一把显示模式：取该武器 `modes` 里的第一个。
 *
 * 之前用写死的 `MODE_ID = 'primary'`，对没有 `primary` 模式的武器会落到 `modes[0]`；
 * 现在统一以"第一个模式"为准，换默认武器时不用再跟着改模式 id。
 */
function firstDisplayMode(weapon) {
  if (!weapon || !weapon.modes || !weapon.modes.length) return MODE_ID;
  const own = weapon.modes.find(function (m) { return m.role !== 'incarnon'; }) || weapon.modes[0];
  return own.id || MODE_ID;
}

/**
 * 默认打开的武器（需求方 2026-11-06：「刚打开的时候默认武器是卡拉克，请改成步枪的第一个」）。
 *
 * 真正的选择在数据加载之后由 `defaultWeaponId()` 按选单顺序取；
 * 这里的 id 只是**兜底**（数据里连步枪分类都没有时才会用到）。
 */
const WEAPON_ID = 'KuvaKarak';

// ─────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────

const STAT_LABEL = {
  accuracy: '精准度',
  ammoEfficiency: '弹药效率',
  ammoMax: '弹药上限',
  baseDamage: '伤害',
  critChance: '暴击几率',
  critMultiplier: '暴击伤害',
  explosionRadius: '爆炸范围',
  faction: '派系伤害',
  fireRate: '射速',
  impactToSlash: '冲击转切割',
  magazine: '弹匣容量',
  meleeRange: '攻击范围',
  movementSpeed: '移动速度',
  multishot: '多重射击',
  projectileSpeed: '弹速',
  punchThrough: '穿透',
  recoil: '后坐力',
  reloadSpeed: '装填速度',
  slashOnCrit: '暴击时触发切割',
  statusChance: '触发几率',
  statusDamage: '异常状态伤害',
  statusDuration: '异常状态持续时间',
  weakpointCritChance: '弱点暴击几率',
  weakpointDamage: '弱点伤害',
  zoom: '变焦',
  healthPerHit: '每次命中回复生命',
};

/** 词条名 → 中文；元素/物理类型走 ELEMENT_LABEL */
function statLabel(stat) {
  if (stat.indexOf('elemental:') === 0) return ELEMENT_LABEL[stat.slice(10)] || stat.slice(10);
  if (stat.indexOf('physical:') === 0) return ELEMENT_LABEL[stat.slice(9)] || stat.slice(9);
  if (stat.indexOf('faction:') === 0) return '派系伤害';
  return STAT_LABEL[stat] || stat;
}

// ─────────────────────────────────────────────────────────────
// 状态（D-105：真实状态在 app-store.js 的 store 里，这里只取常用别名）
// ─────────────────────────────────────────────────────────────

/** 界面选项状态（派系 / 爆头 / 玄骸 / 镀层 / 筛选 / 当前模式与变体） */
const state = store.ui;
/** 8 个 Mod 槽（索引 0..7） */
const modSlots = store.modSlots;

// ─────────────────────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────────────────────

const $ = (s) => document.querySelector(s);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** 百分比格式：带符号、一位小数 */
function fmtGain(g) {
  if (g === null || g === undefined) return '';
  const pct = g * 100;
  const sign = pct > 0.05 ? '+' : pct < -0.05 ? '' : '±';
  return sign + pct.toFixed(1) + '%';
}

/**
 * 一张卡上的「贡献」标签（只有百分比，不加任何说明文字）。
 * @param gain 提升比例；null = 无贡献（不显示）
 */
function gainBadge(gain) {
  if (gain === null || gain === undefined) return null;
  const cls = gain > 0.0005 ? 'up' : gain < -0.0005 ? 'down' : 'flat';
  const wrap = el('div', 'slot-gain');
  wrap.append(el('span', 'slot-gain-val ' + cls, fmtGain(gain)));
  return wrap;
}

/** 当前选中攻击模式（D-042：多面板武器由右上角的模式按钮切换） */
function currentMode() {
  const d = store.data;
  if (!d || !d.weapon) return null;
  const modes = d.weapon.modes;
  return modes[Math.min(state.modeIndex, modes.length - 1)] ?? modes[0];
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
 * 当前模式内的**攻击方式**（D-080 / D-148）。
 *
 * 命中与爆炸是同一模式下的两种攻击方式，各自有自己的段与可选面板覆盖。
 * 需求方 2026-11-12：界面把它们分开显示，每种带一个**复选框**，
 * 用户选哪些参与计算，选中的高亮（像切换统计口径那样）。
 */
function currentVariant() {
  const m = currentMode();
  if (!m) return null;
  const vs = m.variants ?? [];
  if (vs.length === 0) return null;
  return vs[Math.min(state.variantIndex, vs.length - 1)] ?? vs[0];
}

/** 当前模式内勾选了哪些攻击方式（下标数组）；`null` 表示全选 */
function selectedVariantIdx() {
  const m = currentMode();
  if (!m) return [];
  const vs = m.variants ?? [];
  const sel = state.selectedVariants;
  if (!Array.isArray(sel)) return vs.map(function (_, i) { return i; });
  return sel.filter(function (i) { return i >= 0 && i < vs.length; });
}

/** 某一种攻击方式当前是否被勾选 */
function isVariantSelected(i) {
  return selectedVariantIdx().indexOf(i) >= 0;
}

/** 勾选/取消勾选某种攻击方式（至少保留一种，全不选会让面板变成 0，容易误操作） */
function toggleVariant(i) {
  const m = currentMode();
  if (!m) return;
  const vs = m.variants ?? [];
  const cur = selectedVariantIdx();
  const next = cur.indexOf(i) >= 0 ? cur.filter(function (x) { return x !== i; }) : cur.concat([i]).sort(function (a, b) { return a - b; });
  if (next.length === 0) return; // 不允许全部取消
  state.selectedVariants = next.length === vs.length ? null : next;
  // 同步旧字段，保持「当前变体」的其他用途（如拆解展示）不落空
  state.variantIndex = next[0];
  renderAll();
}

/** 当前变体的**生效模式**：把变体的段与 override 合并后交给 core（实现在 app-compute.js） */
function effectiveMode() {
  const d = store.data;
  return d ? effectiveModeFor(d.weapon, state) : null;
}

// ─────────────────────────────────────────────────────────────
// 顶部
// ─────────────────────────────────────────────────────────────

function renderHeader() {
  const w = store.data.weapon;
  // D-101：数据有问题时标题后面挂一个标记，鼠标悬停看原因
  const issues = issuesOf(w.id);
  const titleEl = $('#weapon-title');
  titleEl.textContent = (w.nameZh || w.name) + '（' + w.name + '）' + (issues.length ? ' ' + ISSUE_MARK : '');
  if (issues.length) {
    titleEl.title = issues.map(function (x) { return x.note + '：' + x._source; }).join('\n');
    titleEl.classList.add('has-issue');
  } else {
    titleEl.title = '';
    titleEl.classList.remove('has-issue');
  }
  $('#weapon-meta').textContent =
    (currentMode()._label ? currentMode()._label + ' · ' : '') +
    currentMode().id + ' · ' + currentMode().role + ' · ' + currentMode().trigger +
    ' · 面板多重 ' + currentMode().multishot;

  renderModeSwitch();
  renderKuvaVisibility();
}

/**
 * 多面板武器的模式切换（D-042）：在「武器面板」标题右侧一排按钮。
 * 单模式武器不显示切换栏。
 *
 * D-080：模式内的**面板变体**（直接命中 / 爆炸）作为第二排按钮。
 * 命中与爆炸不再挤在同一个面板里，而是各自独立成一个面板、独立配装；
 * 单变体模式不显示第二排。
 */
function renderModeSwitch() {
  const box = $('#mode-switch');
  if (!box) return;
  box.innerHTML = '';
  const modes = store.data.weapon.modes;

  // 第一排：模式（单模式武器不显示）
  if (modes.length > 1) {
    const row = el('div', 'mode-row');
    for (let i = 0; i < modes.length; i++) {
      const m = modes[i];
      // D-141：数据层给的中文模式名（`_label`）优先，例如重力奇点的「球体融合 / 球体爆炸」
      const btn = el('button', 'mode-btn' + (i === state.modeIndex ? ' active' : ''), m._label || MODE_LABEL[m.id] || m.id);
      btn.type = 'button';
          btn.title = (m._label ? m._label + ' · ' : '') + m.id + ' · ' + m.trigger + (m._note ? '\n' + m._note : '');
      (function (idx) {
        btn.addEventListener('click', function () {
          state.modeIndex = idx;
          // 切模式后攻击方式全部重新勾选（新模式的攻击方式与旧模式无关）
          state.selectedVariants = null;
          state.variantIndex = 0;
          renderAll();
        });
      })(i);
      row.append(btn);
    }
    box.append(row);
  }

  // 第二排：当前模式内的**攻击方式**，多选复选框（需求方 2026-11-12）
  //
  // 一个模式可以有多种攻击方式（弹头命中 / 爆炸 / 射线 / 蓄力），全勾 = 各段相加。
  // 只有一种时不显示（绝大多数武器）。
  const variants = currentMode() ? (currentMode().variants ?? []) : [];
  if (variants.length > 1) {
    const row = el('div', 'variant-row');
    const tip = el('span', 'variant-tip', '参与计算：');
    row.append(tip);
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const on = isVariantSelected(i);
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = on;
      cb.className = 'variant-check';
      cb.title = v.id + ' · ' + v.segments.map(function (s) { return s.kind; }).join(' + ');
      cb.addEventListener('change', function () { toggleVariant(i); });
      // 整块可点（复选框 + 文字），选中时高亮——与统计口径的选中样式一致
      const label = el('label', 'variant-btn' + (on ? ' active' : ''));
      label.append(cb);
      label.append(el('span', '', v.label));
      // 这一种攻击方式自己的扳机（赘骨灵化：射线 / 蓄力），与模式不一致时标出来
      if (v.trigger && currentMode() && v.trigger !== currentMode().trigger) {
        label.append(el('span', 'variant-trig', TRIGGER_ZH[v.trigger] || v.trigger));
      }
      row.append(label);
    }
    box.append(row);
  }
}

/** 模式名的中文 */
const MODE_LABEL = {
  primary: '普通',
  mode2: '副模式',
  charged: '蓄力',
  alt: '切换',
  incarnon: '灵化',
};

/**
 * 扳机的中文名（D-148）。
 *
 * 需求方 2026-11-11 规则 8：「UI 要显示当前模式的扳机与伤害判定类型」。
 * 射线唯一判据就是扳机 `held`，所以界面直接把扳机标出来。
 */
const TRIGGER_ZH = {
  auto: '全自动',
  semi: '半自动',
  burst: '点射',
  charge: '蓄力',
  held: '射线',
  active: '激活',
  unknown: '未知',
};

/**
 * 玄骸加成区块的可见性（D-042）：
 * **非玄骸武器完全隐藏**（连标题一起）。
 */
function renderKuvaVisibility() {
  const isKuva = Boolean(store.data.isKuva);
  const controls = $('#kuva-controls');
  if (controls) {
    controls.style.display = isKuva ? '' : 'none';
    // 标题紧跟在它前面（`index.html` 的结构不会变，用兄弟节点找不到就退回按 id 设置）
    const title = controls.previousElementSibling;
    if (title && title.classList && title.classList.contains('section-title')) {
      title.style.display = isKuva ? '' : 'none';
    } else {
      for (const id of ['kuva-title', 'kuva-section-title']) {
        const t = $('#' + id);
        if (t) t.style.display = isKuva ? '' : 'none';
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 左侧面板
// ─────────────────────────────────────────────────────────────

function renderPanel(res) {
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
    ['弹匣容量', p.magazineSize.base.toFixed(2), p.magazineSize.after.toFixed(2)],
    ['装填时间', p.reloadTime.base.toFixed(3) + ' 秒', p.reloadTime.after.toFixed(3) + ' 秒'],
  ];

  // D-125：弹药效率（主要·准星 / 次要·妨害 / 头颅射击…）体现在「等效弹匣」上。
  // 以前这只在内核 `state.computed.等效弹匣` 里算，**面板没有这一行**，
  // 上了准星左边面板看不出任何变化。有弹药效率时补一行「等效弹匣」。
  {
    const c = res.state && res.state.computed;
    const mul = c && c.弹药效率倍数;
    if (typeof mul === 'number' && Math.abs(mul - 1) > 1e-9) {
      const now = c.等效弹匣;
      const base = p.magazineSize.base;
      rows.push([
        '等效弹匣',
        base.toFixed(2),
        now.toFixed(2) + '（×' + mul.toFixed(3) + '）',
      ]);
    }
  }

  fillRows('#panel-table', ['属性', '基础面板', '当前面板'], rows);

  // 伤害分布三列（Q5 定案，需求方 2026-11-06）：
  //   「基础面板 = 加了玄骸的，当前面板含其他加成。因为玄骸加成这部分表现的就是基础面板加成。」
  //
  // ⚠ 基础列必须取**该变体所有段**的伤害合计，不能只取 segments[0]：
  //   血肢（Hema）的自带病毒在 attack 段、impact 段只有物理三元素，
  //   只读第一段会把自带病毒漏掉（需求方 2026-11-06 反馈）。
  // 基础列 = 每段面板 ⊕ 玄骸加成（`res` 里每段的 `panelWithKuva`）。
  const orig = {};
  for (const s of res.segments || []) {
    for (const [t, v] of Object.entries(s.panelWithKuva || s.panel || {})) {
      if (typeof v === 'number' && v !== 0) orig[t] = (orig[t] || 0) + v;
    }
  }
  // 兜底：内核没给出分段结果时退回原始面板（非玄骸武器两者相同）
  // D-148 / 2026-11-12：只取**勾选了的攻击方式**的段，不能把全部变体都算进来。
  if (!res.segments || res.segments.length === 0) {
    const m = effectiveMode();
    const picked = selectedVariantIdx();
    for (const i of picked) {
      const v = m && m.variants ? m.variants[i] : null;
      if (!v) continue;
      for (const s of v.segments || []) {
        for (const [t, val] of Object.entries(s.damage)) {
          if (typeof val === 'number' && val !== 0) orig[t] = (orig[t] || 0) + val;
        }
      }
    }
  }
  // ⚠ 当前列必须只含**勾选了的攻击方式**，不能用 res.totalSpread：
  //   totalSpread 是所有变体之和，与"当前攻击方式的基础分布"并列会把命中和爆炸混成一个面板
  //   （巴什穆 / 巴兹火枪，需求方 2026-11-06 反馈）。
  // ⚠ D-148 / 2026-11-12：现在支持**多选**——勾选了几种就把这几种的分布相加，
  //   内核已经按 `selectedVariants` 缩过 variants，所以 `spreadByVariant` 里只剩选中的那几个。
  const spread = {};
  for (const s of res.spreadByVariant || []) {
    for (const [t, v] of Object.entries(s)) {
      if (typeof v === 'number' && v !== 0) spread[t] = (spread[t] || 0) + v;
    }
  }
  const typeSet = [];
  const push = function (t) { if (typeSet.indexOf(t) < 0) typeSet.push(t); };
  Object.keys(orig).forEach(push);
  Object.keys(spread).forEach(push);

  // 当前触发几率（含触发几率 Mod，射线另算）——不是面板静态值
  // D-148：段现在在变体里（模式上不再有 segments），取第一个勾选攻击方式的第一段
  const firstVariant = (function () {
    const m = effectiveMode();
    const idx = selectedVariantIdx();
    if (!m || !m.variants) return null;
    return m.variants[idx[0]] ?? m.variants[0] ?? null;
  })();
  const procNow = totalProcChance(
    (firstVariant && firstVariant.segments && firstVariant.segments[0] ? firstVariant.segments[0].procChance : 0),
    currentContributions(),
    false,
  );
  const totalSpread = spreadTotalOf(spread);
  const dmgRows = typeSet.map(function (t) {
    // 某类型的单弹头触发率 = 当前触发几率 × 该类型在伤害分布里的占比
    const s = totalSpread > 0 ? (spread[t] || 0) / totalSpread : 0;
    return [
      { text: ELEMENT_LABEL[t] || t, dot: ELEMENT_COLOR[t] },
      fmt(orig[t] || 0),
      fmt(spread[t] || 0),
      (procNow * s * 100).toFixed(2) + '%',
    ];
  });
  dmgRows.push(['合计', fmt(spreadTotalOf(orig)), fmt(totalSpread), (procNow * 100).toFixed(2) + '%']);
  fillRows('#damage-table', ['伤害类型', '基础', '当前', '触发率'], dmgRows);

  renderCritTiers(res);
  renderOutputs(res);
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

/** 依据列数生成等宽网格模板（首列宽一些） */
function colTemplate(cols) {
  if (cols <= 1) return '1fr';
  const parts = ['1.4fr'];
  for (let i = 1; i < cols; i++) parts.push('1fr');
  return parts.join(' ');
}

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
  const dotBox = $('#dot-detail');
  dotBox.innerHTML = '';
  let any = false;
  for (let i = 0; i < DOT_TYPES.length; i++) {
    const t = DOT_TYPES[i];
    const per = res.output.dotPerType[t] || 0;
    const stacks = res.output.stacksPerType[t] || 0;
    if (per <= 0 && stacks <= 0) continue;
    any = true;
    const r = el('div', 'dot-row');
    const dot = el('span', 'dt-dot');
    dot.style.background = ELEMENT_COLOR[t] || '#888';
    r.append(dot, el('span', 'dot-name', ELEMENT_LABEL[t]),
      el('span', 'dot-stacks', stacks.toFixed(2) + ' 层/秒'),
      el('span', 'dot-val', fmt(per) + ' /层/秒'));
    dotBox.append(r);
  }
  // 爆炸单独一行（D-031）
  const b = res.output.blast;
  const hasBlast = b.stacksPerSecond > 0;
  if (hasBlast) {
    any = true;
    const r = el('div', 'dot-row');
    const dot = el('span', 'dt-dot');
    dot.style.background = ELEMENT_COLOR.blast || '#d98f5a';
    r.append(dot, el('span', 'dot-name', '爆炸'));
    // 爆炸是独立机制（D-031）：perStack 是「每层结算伤害」，不是每秒；
    // 它与其它 DoT 的「每层秒伤」不同语义，所以单独标单位避免混淆。
    r.append(el('span', 'dot-stacks', b.stacksPerSecond.toFixed(2) + ' 层/秒'));
    r.append(el('span', 'dot-val', fmt(b.perStack) + ' /层'));
    dotBox.append(r);
    const note = el('div', 'muted dot-note');
    note.textContent = b.reachesMaxInWindow
      ? '每层 ' + fmt(b.perStack) + (b.splashActive ? '（满层后系数 0.3 → 3）' : '') + '，' + b.timeToMaxSeconds.toFixed(2) + ' 秒叠满'
      : '1.5 秒内未叠满 ' + b.maxStacks + ' 层，按实际层数均摊';
    dotBox.append(note);
  }
  if (!any) dotBox.append(el('div', 'muted', '无持续伤害'));

  renderSplashDamage(res);
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
  const rows = [];
  rows.push(['每秒', fmt(b.splashPerSecond) + ' /秒']);
  rows.push(['六秒合计', fmt(b.splash6s)]);

  const table = el('div', 'panel-table');
  const head = el('div', 'panel-row panel-head');
  head.append(el('span', 'c-name', '对周围敌人'), el('span', 'c-base', ''), el('span', 'c-after', '数值'));
  table.append(head);
  for (let i = 0; i < rows.length; i++) {
    const row = el('div', 'panel-row');
    row.append(el('span', 'c-name', rows[i][0]));
    row.append(el('span', 'c-base', ''));
    row.append(el('span', 'c-after', rows[i][1]));
    table.append(row);
  }
  box.append(table);

  box.append(el('div', 'muted dot-note', b.splashActive
    ? '每层系数 ' + BLAST_DETONATE_COEF + '（基础 ' + fmt(b.perStackDetonated) + ' 每层），范围 5 米'
    : '未叠满 ' + BLAST_MAX_STACKS + ' 层，暂不触发范围伤害'));
}

const BLAST_DETONATE_COEF = 3;
const BLAST_MAX_STACKS = 10;

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
}

// ─────────────────────────────────────────────────────────────
// 槽位（Mod / 劣化 / 赋能），全部可拖拽
// ─────────────────────────────────────────────────────────────

function renderSlots() {
  const grid = $('#slot-grid');
  grid.innerHTML = '';
  for (let i = 0; i < SLOT_COUNT; i++) grid.append(modSlotCard(i));

  const side = $('#side-slots');
  side.innerHTML = '';
  side.append(exilusSlotCard());

  const arcBox = $('#arcane-slots');
  arcBox.innerHTML = '';
  arcBox.append(arcaneSlotCard());
}

/** 让任意卡片既能作为拖出源，也能作为放置目标（不接受时显示禁止符号） */
function makeDropTarget(card, accepts, onDrop) {
  card.addEventListener('dragover', function (e) {
    const ok = Boolean(store.dragPayload) && accepts(store.dragPayload);
    // 不接受时**不** preventDefault → 浏览器显示禁止符号，drop 也不会触发（回位）
    if (!ok) {
      card.classList.remove('drop-target');
      return;
    }
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    card.classList.add('drop-target');
  });
  card.addEventListener('dragleave', function () { card.classList.remove('drop-target'); });
  card.addEventListener('drop', function (e) {
    if (!store.dragPayload || !accepts(store.dragPayload)) return;
    e.preventDefault();
    card.classList.remove('drop-target');
    dropHappened = true; // 成功放进配置区，dragend 时不再卸下
    onDrop(store.dragPayload);
    store.dragPayload = null;
  });
}

function makeDraggable(card, payload) {
  card.draggable = true;
  card.addEventListener('dragstart', function (e) {
    store.dragPayload = payload;
    dropHappened = false;
    card.classList.add('dragging');
    if (e.dataTransfer) e.dataTransfer.setData('text/plain', payload.id || payload.key || '');
  });
  card.addEventListener('dragend', function () {
    card.classList.remove('dragging');
    const p = store.dragPayload;
    store.dragPayload = null;
    // D-040：没能放进配置区 → 视为卸下（拖出配置区 / 拖到备选区 都算）
    if (p && !dropHappened && p.from !== 'list' && p.from !== 'slot-picker') {
      removeByPayload(p);
    }
    dropHappened = false;
  });
}

/** 按拖动载荷卸下对应内容 */
function removeByPayload(p) {
  if (p.kind === 'mod') {
    // 劣化槽里的卡载荷带 `exilus: true`，但 `makeDraggable` 里写的是 `from: 'exilus'`（两种写法都认）
    if (p.from === 'exilus' || p.exilus) { store.exilusModId = null; renderAll(); return; }
    if (typeof p.index === 'number' && modSlots[p.index]) { modSlots[p.index] = null; renderAll(); }
    return;
  }
  if (p.kind === 'arcane') { store.arcaneKey = null; renderAll(); }
}

function statChips(mod) {
  // D-116：无限叠层类（弹能过继等）的值按「每层 × 满层」显示，与内核取的值一致
  const stacks = modStackFactor(mod.id);
  const wrap = el('div', 'slot-stats');
  for (let i = 0; i < mod.stats.length; i++) {
    const s = mod.stats[i];
    if (!s.bucket || s.bucket === 'utility') continue;
    const max = s.levelValues[s.levelValues.length - 1] * stacks;
    wrap.append(el('span', 'slot-stat', statLabel(s.stat) + ' ' + (max > 0 ? '+' : '') + max));
  }
  return wrap;
}

/**
 * 卸下所有 Mod（含劣化槽）。赋能不受影响。
 * 供「一键卸下」按钮与拖拽离开配置区共用。
 */
function unequipAllMods() {
  for (let i = 0; i < SLOT_COUNT; i++) modSlots[i] = null;
  store.exilusModId = null;
  renderAll();
}

/**
 * 「拖出配置区即卸下」的实现说明（D-040）。
 *
 * 判据很简单：**拖拽结束时若没有成功 drop 到任何槽位，就卸下**。
 *   · 拖到另一个槽位并被接受 → `dropHappened = true` → 保留；
 *   · 拖出配置区 / 拖到备选区 / 拖到空白处 → 没有 drop → 卸下；
 *   · 拖到已占用的槽位（被拒） → 没有 drop → 卸下（符合"拖出来就是不要了"的直觉）。
 *
 * 这样不需要精确判断"落点在不在配置区矩形内"，也不需要让用户拖很远。
 */
let dropHappened = false;

/**
 * 已装卡上的贡献徽标（D-117）。
 *
 * 普通卡：`gainOf`（拿掉它重算）。镀层类卡：拿掉后「异况数 × 层数」也没了，
 * 边距贡献的定义依然成立，但 `gainOf` 在"拿掉后指标为 0"时返回 null（界面不显示），
 * 而镀层卡恰恰是唯一能带来"全部基伤"的卡之一——改用 `coModGain` 的口径（装上 vs 当前）。
 */
function coSlotGain(mod) {
  if (mod && isConditionOverloadMod(mod)) {
    const g = coModGain(mod);
    if (g !== null) return g;
  }
  return gainOf(mod ? mod.id : null);
}

/**
 * 普通 Mod 槽：放 Mod，或作为已有 Mod 的换位/插入目标
 */
function modSlotCard(index) {
  const card = el('div', 'slot');
  card.append(el('div', 'slot-title', '槽位 ' + (index + 1)));
  const body = el('div', 'slot-body');
  const id = modSlots[index];

  if (id) {
    const mod = store.data.modById.get(id);
    body.append(el('div', 'slot-name', modName(mod)));
    body.append(statChips(mod));
    // 需求方 2026-11-06：显示这张卡相对「不上它」时当前指标的提升
    // D-117：镀层类卡单独处理——拿掉它连「异况数 × 层数」一起没了，
    //   而 `gainOf` 在"拿掉后指标为 0"时返回 null（界面上就不显示增长了），所以改用同一套推演
    const g = gainBadge(coSlotGain(mod));
    if (g) body.append(g);
    // D-040：去掉「卸下」按钮，改为把卡片拖出 Mod 配置区即卸下
    makeDraggable(card, { kind: 'mod', id: id, from: 'slot', index: index });
  } else {
    body.append(el('div', 'slot-empty', '空'));
  }
  card.append(body);

  makeDropTarget(card, function (p) { return slotAcceptsMod(p, index); }, function (p) { dropOnSlot(p, index); });
  return card;
}

/** 劣化槽：只接受功能类 Mod（D-127：与普通 Mod 槽同尺寸，槽名写在卡片右上角） */
function exilusSlotCard() {
  const card = el('div', 'slot exilus');
  card.append(el('span', 'slot-chip', '劣化槽'));
  const body = el('div', 'slot-body');

  if (store.exilusModId) {
    const mod = store.data.modById.get(store.exilusModId);
    body.append(el('div', 'slot-name', modName(mod)));
    const g = gainBadge(gainOf(store.exilusModId));
    if (g) body.append(g);
    // D-040：去掉「卸下」按钮，改为拖出配置区即卸下
    makeDraggable(card, { kind: 'mod', id: store.exilusModId, exilus: true, from: 'exilus' });
  } else {
    body.append(el('div', 'slot-empty', '拖入功能 Mod'));
  }
  card.append(body);

  /**
   * 劣化槽的**劣化槽内**位置：功能 Mod 从备选区拖进来。
   *   · 劣化槽为空 → 放进去；
   *   · 劣化槽已有卡 → 互换（D-115）：原来那张回备选区，新卡占位。
   * 功能类 Mod 只能出现在劣化槽，所以不会有"槽位之间互换"这一路。
   */
  makeDropTarget(
    card,
    function (p) { return p.kind === 'mod' && p.exilus; },
    function (p) { dropOnExilus(p); },
  );
  return card;
}

/**
 * 放到劣化槽。D-115：劣化槽已有卡时**互换**（那张回备选区），不再静默顶掉。
 */
function dropOnExilus(payload) {
  const mod = store.data.modById.get(payload.id);
  if (!mod) return;
  if (!isModAllowedOnWeapon(mod)) {
    flash('半自动炮轰系列只能装在只有半自动射击模式的武器上');
    return;
  }
  store.exilusModId = payload.id;
  renderAll();
}

/** 赋能槽（D-127：与普通 Mod 槽同尺寸，槽名写在卡片右上角） */
function arcaneSlotCard() {
  const card = el('div', 'slot arcane');
  card.append(el('span', 'slot-chip', '赋能'));
  const body = el('div', 'slot-body');

  if (store.arcaneKey) {
    const arc = store.data.arcaneByKey.get(store.arcaneKey);
    body.append(el('div', 'slot-name', arc.name.zh || arc.name.en));
    // D-116：装备区同样要显示词条（D-127：与普通 Mod 槽一样用 slot-stats 包一层）
    const arcChips = arcaneStatChips(arc);
    if (arcChips.length) {
      const wrap = el('div', 'slot-stats');
      for (const st of arcChips) wrap.append(st);
      body.append(wrap);
    }
    // 赋能同样显示边际贡献（source 用 arcane.key）
    // ⚠ 原来这里误用了不存在的变量 `arcane.key`，有赋能在槽里时每次重渲染都 ReferenceError（D-115 发现）
    const g = gainBadge(gainOf(store.arcaneKey));
    if (g) body.append(g);
    // D-040：赋能同样拖出配置区即卸下
    makeDraggable(card, { kind: 'arcane', key: store.arcaneKey, from: 'arcane' });
  } else {
    body.append(el('div', 'slot-empty', '拖入赋能'));
  }
  card.append(body);

  // ── 赋能槽（D-115 / D-134）：与 Mod 槽 / 劣化槽同一套处理 ——
  //   · 拖「正在算的这把武器所属大类」的赋能进来：空槽就放、已有赋能就**互换**（旧的回列表）；
  //   · 拖别的大类的赋能进来（例如近战赋能拖到主要武器上）：**不接受**（禁止符号），
  //     以前这里只看 `p.kind === 'arcane'`，会静默把槽里那张顶掉并换上不属于本大类的赋能。
  const targetKey = store.arcaneKey;
  const targetArc = targetKey ? store.data.arcaneByKey.get(targetKey) : null;
  const targetPayload = targetKey
    ? { kind: 'arcane', key: targetKey, category: targetArc ? targetArc.category : undefined }
    : null;
  makeDropTarget(
    card,
    function (p) { return arcaneSlotAccepts(p, targetPayload); },
    function (p) { dropOnArcane(p); },
  );
  return card;
}

/**
 * 赋能槽是否接受这次拖拽（D-134）——规则与 Mod 槽一致：
 * 空槽接受、已占用就互换；**但只接受本武器大类可用的赋能**。
 */
function arcaneSlotAccepts(payload, targetPayload) {
  if (!payload || payload.kind !== 'arcane') return false;
  const arc = store.data && store.data.arcaneByKey.get(payload.key);
  // D-138：判定统一走 `isArcaneUsableOn`（主手霰弹 / 弓额外可装专属赋能，副手霰弹只走次要）
  if (arc && !isArcaneUsableOn(arc, store.data.weapon, store.data.slotEntry)) return false;
  // 从别的槽位拖来（目前没有"赋能槽之间"的移动）——占位判断统一交给 `dropOnArcane`
  void targetPayload;
  return true;
}

/**
 * 放到赋能槽（D-134）：空槽直接放；已有赋能则**互换**（旧赋能回列表，与劣化槽一致）。
 */
function dropOnArcane(payload) {
  const arc = store.data.arcaneByKey.get(payload.key);
  if (!arc) return;
  // 本武器能装的赋能（D-138，与 `.slot-wrap` 的禁止符号判定同一套规则）
  if (!isArcaneUsableOn(arc, store.data.weapon, store.data.slotEntry)) {
    flash('这个赋能不能装在本武器上');
    return;
  }
  store.arcaneKey = payload.key;
  renderAll();
}

/** 赋能大类 → 中文（报错文案用） */
const ARCANE_CATEGORY_LABEL = {
  primary: '主要',
  secondary: '次要',
  bow: '弓箭',
  shotgun: '霰弹',
  melee: '近战',
  kitgun: '组合枪',
};

/**
 * 槽位是否接受这次拖拽（决定"允许放置"还是"禁止符号"）。D-115：占用不再一律拒绝。
 *
 * | 拖拽       | 目标空槽 | 目标已占用                          |
 * |------------|----------|-------------------------------------|
 * | 备选区 Mod | 接受     | **互换**（被替换的那张回备选区）     |
 * | 槽位 Mod   | 接受     | **两个槽位互换**                     |
 *
 * 功能类（劣化）Mod 永远只能进劣化槽，普通槽对它一律不接受。
 */
function slotAcceptsMod(payload, targetIndex) {
  // 赋能不能进 Mod 槽
  if (payload.kind !== 'mod') return false;
  // 功能类只能进劣化槽（D-034）
  if (payload.exilus) return false;
  return true;
}

/**
 * 把 Mod 放到目标槽。D-115：**落到哪张卡上就和那张卡互换**。
 *
 * ```
 * · 从其它槽拖来   → 两个槽位直接互换（源槽拿走目标槽原来的那张）；
 * · 从备选区拖来   → 目标槽原来那张退回备选区，新 Mod 占位；
 * · 目标槽是空的   → 直接放进去，其他槽一律不动（D-035，不做自动紧凑）；
 * · 拖的就是目标槽 → 什么都不做（不卸载、不动）。
 * ```
 */
function dropOnSlot(payload, targetIndex) {
  const mod = store.data.modById.get(payload.id);
  if (!mod) return;
  // D-091：武器不满足装备条件
  if (!isModAllowedOnWeapon(mod)) {
    flash('半自动炮轰系列只能装在只有半自动射击模式的武器上');
    return;
  }
  if (isExilusMod(mod)) {
    flash('该 Mod 只能放入劣化槽');
    return;
  }

  if (payload.from === 'slot' && typeof payload.index === 'number') {
    if (payload.index === targetIndex) return; // 拖回原位：不动
    swapSlots(payload.index, targetIndex);
  } else {
    insertAt(payload.id, targetIndex);
  }
  renderAll();
}

/**
 * 两个槽位直接交换（D-035 槽位间移动 / D-115 拖到已占用槽 = 互换，共用这一份）。
 * 不做整体平移、不做自动紧凑；任一侧为空就保持空着。
 */
function swapSlots(from, to) {
  if (from === to) return;
  const a = modSlots[from];
  const b = modSlots[to];
  modSlots[to] = a;
  modSlots[from] = b;
}

/**
 * 「拖到备选区的**某张卡**上」= 与该卡互换（D-115）。
 *
 * 整块备选区才是「拖回来卸下」（D-040）；落在某张卡上时卡片会拦下 drop，这里处理：
 *
 * | 从哪拖来                 | 目标卡    | 结果                                             |
 * |--------------------------|-----------|--------------------------------------------------|
 * | 槽位里的 Mod             | 备选 Mod  | 两张互换：目标卡进源槽，槽里那张回备选区         |
 * | 其它槽位里的 Mod         | 备选 Mod  | 同上（源槽腾空）                                 |
 * | 赋能槽里的赋能           | 备选赋能  | 两个赋能互换                                     |
 * | 从备选区拖来 / 类型不符  | 备选卡    | 不接受 → 交给 `#candidate-list` 的 drop = 卸下   |
 *
 * 目标卡是什么类型只看**卡自己**（`p.kind`），不看它在备选区的哪一栏，避免选单筛选后错配。
 */
function candidateCardAccepts(targetPayload) {
  const p = store.dragPayload;
  if (!p || !targetPayload) return false;
  if (p.kind !== targetPayload.kind) return false;
  if (p.from === 'list') return false;
  if (p.kind === 'mod') {
    // 劣化槽 ↔ 备选**功能类** Mod：直接互换（顺手修掉"旧卡被静默顶掉"）
    if (p.from === 'exilus') return Boolean(targetPayload.exilus);
    // 普通槽 ↔ 普通备选 Mod：互换（功能 Mod 不能进普通槽）
    if (p.from === 'slot') return !targetPayload.exilus;
    return false;
  }
  if (p.kind === 'arcane') {
    // D-134：只允许换到**同一大类**的赋能卡上（近战赋能不能换到主要赋能槽里）
    return p.from === 'arcane' && (!p.category || !targetPayload.category || p.category === targetPayload.category);
  }
  return false;
}

function swapWithCandidateCard(targetPayload) {
  const p = store.dragPayload;
  if (p.kind === 'mod' && p.from === 'exilus') {
    // 劣化槽现有卡 ↔ 备选区功能 Mod
    store.exilusModId = targetPayload.id || null;
  } else if (p.kind === 'mod') {
    // 普通槽 ↔ 备选区 Mod：槽里那张回备选区（= 清空源槽），目标卡占源槽
    insertAt(targetPayload.id, p.index);
  } else if (p.kind === 'arcane') {
    store.arcaneKey = targetPayload.key || null;
  }
  renderAll();
}

/**
 * 从备选区拖入（D-035 / D-115）：**放在哪个位置就是哪个位置**，不做自动紧凑。
 *
 * ```
 * · 目标槽为空     → 直接放进去，其他槽一律不动；
 * · 目标槽已有 Mod → 原来那张退回备选区（换位），新 Mod 占位，其他槽不动。
 * ```
 * 空出来的槽保持空着，后面的 Mod **不会**自动前移填洞（这是 D-035 对 D-034 的修订）。
 */
function insertAt(modId, index) {
  const out = modSlots.slice();
  const existing = out.indexOf(modId);
  if (existing >= 0) out[existing] = null;
  // 目标位原内容退回备选区（不挪到其它槽）
  out[index] = modId;
  for (let i = 0; i < SLOT_COUNT; i++) modSlots[i] = out[i];
}

let toastTimer = null;
function flash(msg) {
  const bar = $('#toast');
  bar.textContent = msg;
  bar.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { bar.classList.remove('show'); }, 1800);
}

// ─────────────────────────────────────────────────────────────
// 备选 Mod：筛选 + 增幅
// ─────────────────────────────────────────────────────────────

/** 筛选按钮：全部 / 伤害 / 多重 / 暴击 / 元素 / 物理 / 射速 / 触发 / 劣化 / 其他 */
const FILTER_OPTIONS = [
  ['all', '全部'],
  ['damage', '伤害'],
  ['multishot', '多重'],
  ['crit', '暴击'],
  ['element', '元素'],
  ['physical', '物理'],
  ['fireRate', '射速'],
  ['status', '触发'],
  ['exilus', '劣化'],
  ['other', '其他'],
];

/**
 * Mod 归类（用于筛选）。
 *
 * ⚠ 「触发」类必须包含**带触发几率词条的元素卡**（如 火/毒 Mod 常带 `+触发几率`），
 *   之前只看 `statusChance` 一条，导致 高触发率元素卡 被归到「元素」而漏在「触发」里。
 * 归类优先级：伤害 > 多重 > 暴击 > 元素 > 射速 > 触发 > 其他。
 */
function filterKeysOf(mod) {
  const keys = new Set();
  for (let i = 0; i < mod.stats.length; i++) {
    const s = mod.stats[i];
    const stat = s.stat;
    if (stat === 'baseDamage' || s.key === 'co') keys.add('damage');
    else if (stat === 'multishot') keys.add('multishot');
    else if (stat === 'critChance' || stat === 'critMultiplier') keys.add('crit');
    else if (stat.indexOf('elemental:') === 0) keys.add('element');
    else if (stat.indexOf('physical:') === 0) keys.add('physical');
    else if (stat === 'fireRate') keys.add('fireRate');
    else if (stat === 'statusChance' || stat === 'statusDamage' || stat === 'statusDuration') keys.add('status');
    else keys.add('other');
  }
  // 「劣化」单独一栏：当前被判为功能类（可进劣化槽）的卡，
  // 便于核对"有没有影响伤害的卡被误判成功能类"（D-040）
  if (isExilusMod(mod)) keys.add('exilus');
  return keys;
}

/** 一张卡归到哪个筛选类（取优先级最高的那一类） */
function filterKeyOf(mod) {
  const keys = filterKeysOf(mod);
  const rank = {
    damage: 0, multishot: 1, crit: 2, element: 3, physical: 4,
    fireRate: 5, status: 6, exilus: 7, other: 8,
  };
  let best = 'other';
  for (const k of keys) if (rank[k] < rank[best]) best = k;
  return best;
}

/** 当前筛选是否命中这张卡 */
function matchesFilter(mod, filter) {
  if (filter === 'all') return true;
  // 「劣化」栏：只看"能否进劣化槽"，与主归类无关
  if (filter === 'exilus') return isExilusMod(mod);

  const base = filterKeyOf(mod);
  if (base === filter) return true;
  // 「触发」这一栏额外收「带触发词条的卡」（不论主归类）
  if (filter === 'status' && filterKeysOf(mod).has('status')) return true;
  return false;
}

/**
 * 模拟"把这张 Mod 装上去"后能得到的贡献，用于计算备选区的增幅。
 *
 * 规则：
 *   · 功能类 → 放进劣化槽（劣化槽空着就直接放；已占用则返回 null，表示装不上）；
 *   · 普通类 → 塞进**第一个空槽**（不动已装备的 Mod，避免把已有收益算成负数）；
 *     8 槽全满则返回 null。
 * 返回 null 表示"这张卡当前装不上"，界面显示为「—」而不是负数。
 */
function simulateEquip(mod, exilus) {
  if (exilus) {
    if (store.exilusModId) return null; // 劣化槽已占用
    const saved = store.exilusModId;
    store.exilusModId = mod.id;
    const c = currentContributions();
    store.exilusModId = saved;
    return c;
  }

  let free = -1;
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (!modSlots[i]) { free = i; break; }
  }
  if (free < 0) return null; // 8 槽全满，装不上

  const saved = modSlots[free];
  modSlots[free] = mod.id;
  const c = currentContributions();
  modSlots[free] = saved;
  return c;
}

function renderCandidates(res) {
  const base = currentContributions();
  const baseValue = metricValueOf(res);
  const list = $('#candidate-list');
  list.innerHTML = '';

  const rows = [];
  const mods = store.data.availableMods;
  // 已装备的 Mod 不在备选区重复显示（D-034）
  const installed = new Set();
  for (let i = 0; i < SLOT_COUNT; i++) if (modSlots[i]) installed.add(modSlots[i]);
  if (store.exilusModId) installed.add(store.exilusModId);

  for (let i = 0; i < mods.length; i++) {
    const mod = mods[i];
    if (installed.has(mod.id)) continue;
    // D-091：武器不满足装备条件的 Mod 不出现在备选区
    if (!isModAllowedOnWeapon(mod)) continue;
    if (!matchesFilter(mod, state.filter)) continue;
    const name = modName(mod);
    if (state.search && name.toLowerCase().indexOf(state.search.toLowerCase()) < 0) continue;

    const exilus = isExilusMod(mod);
    // 模拟"装备这张 Mod"：优先空位、没有空位就**替换收益最差的那张**（D-115 之后满槽也能换）。
    // 不能直接替换已装备的 Mod —— 那样会把原有收益一起算掉，出现大把负数。
    // D-117：镀层类卡的收益要吃「异况数 × 层数」，走 `coModGain`（配置区不再显示推演小字）
    const coGain = coModGain(mod);
    const nextContribs = coGain === null ? simulateEquip(mod, exilus) : null;
    let gain = coGain;
    if (nextContribs && baseValue !== 0) {
      gain = metricValueOf(runCompute(nextContribs)) / baseValue - 1;
    }
    rows.push({ mod: mod, gain: gain, exilus: exilus });
  }

  rows.sort(function (a, b) {
    if (a.gain === null) return 1;
    if (b.gain === null) return -1;
    return b.gain - a.gain;
  });

  for (let i = 0; i < rows.length; i++) list.append(candidateCard(rows[i]));
  $('#candidate-count').textContent = rows.length + ' / ' + store.data.availableMods.length;
}

function candidateCard(row) {
  const mod = row.mod;
  const card = el('div', 'cand');
  const payload = { kind: 'mod', id: mod.id, exilus: row.exilus, from: 'list' };
  makeDraggable(card, payload);
  // D-115：把已装备的卡拖到**这张备选卡**上 = 互换（槽里那张回到备选区）。
  makeDropTarget(card, function () { return candidateCardAccepts(payload); }, function () { swapWithCandidateCard(payload); });
  // 卡片自己拦下 drop，否则会冒泡到 #candidate-list 被当成"拖回备选区 = 卸下"
  card.addEventListener('drop', function (e) { e.stopPropagation(); });

  const top = el('div', 'cand-top');
  top.append(el('span', 'cand-name', modName(mod)));
  if (row.exilus) top.append(el('span', 'tag', '功能'));
  card.append(top);

  const statText = [];
  for (let i = 0; i < mod.stats.length; i++) {
    const s = mod.stats[i];
    if (!s.bucket) continue;
    const max = s.levelValues[s.levelValues.length - 1] * modStackFactor(mod.id);
    statText.push(statLabel(s.stat) + ' ' + (max > 0 ? '+' : '') + max);
  }
  card.append(el('div', 'cand-stats', statText.join(' · ') || '无伤害加成'));

  const gainEl = el('div', 'cand-gain');
  const cls = row.gain === null ? '' : row.gain >= 0.00005 ? 'pos' : row.gain <= -0.00005 ? 'neg' : '';
  gainEl.append(el('span', 'gain-label', '增幅'));
  gainEl.append(el('span', 'gain-val ' + cls, fmtPct(row.gain)));
  card.append(gainEl);

  card.addEventListener('click', function () { selectDetail({ kind: 'mod', id: mod.id, exilus: row.exilus }); });
  return card;
}

// ─────────────────────────────────────────────────────────────
// 拆解
// ─────────────────────────────────────────────────────────────

/**
 * 拆解（D-038 / D-125）：展示当前选中的那只**装备**（Mod 或赋能）装上后的影响。
 *
 * 需求方 2026-11-06：「拆解也对赋能生效」——以前只有备选 Mod 有拆解，
 * 赋能点不动。现在两者共用这一份：
 *   · Mod：沿用「装到空位 / 换掉收益最差那张」的模拟（`simulateEquip`）；
 *   · 赋能：在贡献列表上追加它的贡献（与 `arcanePreviewGain` 同一口径），
 *     并且**不比整体指标** —— 逐口径列出，看得见"这个赋能到底改了哪些数"。
 * 结束时恢复 overrides 文件。
 */
const DETAIL_PLACEHOLDER = '点击备选 Mod 或赋能查看拆解';

/**
 * 当前拆解的对象（D-128）。
 *
 * ⚠ 以前拆解是"点一下算一次、算完就固定在 DOM 里"：之后任何**输出变化**
 * （调敌人异况层数 / 叠层 / 玄骸元素 / 暴击基准 / 装别的卡 / 换枪）都不会让它重算，
 * 右边停着的是旧配置下的数。
 *
 * 现在只记住"拆解的是谁"（稳定的定位信息，不是行对象——那一行下次渲染就没了），
 * 拆解本身挂在 `renderAll()` 的最后重算一次，所以它总是跟着当前配装走。
 * 这就是"收益变动监听"的位置：绑在**渲染末尾**（所有状态变化的唯一汇合点），
 * 而不是绑在某个控件上。
 */
let detailTarget = null;

/** 记下要点开拆解的对象 */
function selectDetail(target) {
  detailTarget = target;
  renderDetail();
}

/** 按当前配装重算拆解；没有选中对象就显示提示 */
function renderDetail() {
  const box = $('#detail');
  if (!box) return;
  box.innerHTML = '';
  if (!detailTarget) {
    box.append(el('div', 'muted', DETAIL_PLACEHOLDER));
    return;
  }
  const row = resolveDetailTarget(detailTarget);
  if (!row) {
    detailTarget = null;
    box.append(el('div', 'muted', DETAIL_PLACEHOLDER));
    return;
  }
  paintDetail(box, row);
}

/**
 * 把"拆解对象"还原成当前配装下的那一行。
 *   · Mod：按 id 从当前武器的可装列表里重新取（换枪后取不到 → 自动清空拆解）；
 *   · 赋能：按 key 从当前武器的赋能列表里取。
 */
function resolveDetailTarget(target) {
  if (target.kind === 'arcane') {
    const arc = store.data && store.data.arcaneByKey ? store.data.arcaneByKey.get(target.key) : null;
    return arc ? { kind: 'arcane', arc: arc, key: target.key } : null;
  }
  const mod = store.data && store.data.modById ? store.data.modById.get(target.id) : null;
  if (!mod) return null;
  return { kind: 'mod', mod: mod, id: target.id, exilus: target.exilus };
}

function paintDetail(box, row) {
  const isArcane = row.kind === 'arcane';
  const mod = isArcane ? null : row.mod;
  const arc = isArcane ? row.arc : null;
  const name = isArcane ? (arc.name.zh || arc.name.en) : modName(mod);
  box.append(el('h3', '', name));

  // ── 词条列表：只列真正参与计算的（与内核贡献同源） ──
  const ul = el('ul', 'detail-list');
  if (isArcane) {
    const stats = arcaneDisplayStats(arc);
    for (let i = 0; i < stats.length; i++) {
      ul.append(el('li', '', statLabel(stats[i].stat) + ' +' + (Math.round(stats[i].amount * 100) / 100) + '%'));
    }
    if (!stats.length) ul.append(el('li', 'muted', '无伤害词条（不参与伤害计算）'));
  } else {
    for (let i = 0; i < mod.stats.length; i++) {
      const s = mod.stats[i];
      const max = s.levelValues[s.levelValues.length - 1];
      ul.append(el('li', '', statLabel(s.stat) + '：' + (max > 0 ? '+' : '') + max));
    }
  }
  box.append(ul);

  // ── 当前 / 装备后 ──
  const curContribs = currentContributions();
  const cur = runCompute(curContribs);
  let next = null;
  let nextContribs = null;
  if (isArcane) {
    const extra = arcaneToContributions(arc);
    // 与卡上收益同一口径：没装镀层卡时，镀层类贡献要连带层次数一起模拟
    nextContribs = curContribs.concat(extra);
    next = runCompute(nextContribs);
  } else {
    // 用与备选区一致的模拟方式（装到空位，不顶掉已有 Mod）
    nextContribs = simulateEquip(mod, row.exilus);
    if (!nextContribs) {
      box.append(el('div', 'muted', '当前配置已满，无法装备这张 Mod'));
      return;
    }
    next = runCompute(nextContribs);
  }

  const out = el('table', 'detail-table');
  const oh = el('tr');
  ['输出口径', '当前', '装备后', '增幅'].forEach(function (h) { oh.append(el('th', '', h)); });
  out.append(oh);
  for (let i = 0; i < cur.output.lines.length; i++) {
    const c = cur.output.lines[i];
    const n = next.output.lines[i];
    const g = c.value === 0 ? null : n.value / c.value - 1;
    const tr = el('tr');
    if (c.id === state.metric) tr.classList.add('highlight');
    tr.append(el('td', '', c.label));
    tr.append(el('td', '', fmt(c.value)));
    tr.append(el('td', '', fmt(n.value)));
    tr.append(el('td', g === null ? '' : g >= 0 ? 'pos' : 'neg', fmtPct(g)));
    out.append(tr);
  }
  box.append(out);

  // ── 面板（D-130 / D-132）：一张表，行按「依赖顺序」排：
  //   暴击几率 → 暴击伤害 → 平均暴击倍率 → 触发几率 → 多重 → 射速 → 弹匣 → 装填 → 等效弹匣。
  //   以前暴击几率/暴击伤害既在「面板」表里、又在「暴击」表里出现一次（D-132：合到一张表）。
  //   只列**真的会变**的行；没变化的行不出现（拆解本身就是"装上它之后"）。
  {
    const cn = cur.state && cur.state.computed;
    const nn = next.state && next.state.computed;
    const curSeg = cur.segments[0];
    const seg = next.segments[0];
    const pairs = [
      ['暴击几率', curSeg.critChance, seg.critChance, 'pct'],
      ['暴击伤害', curSeg.critDamage, seg.critDamage, 'x'],
      ['平均暴击倍率', critAverage(1, curSeg.critChance, curSeg.critDamage), critAverage(1, seg.critChance, seg.critDamage), 'x'],
      ['触发几率', cur.panelPairs.statusChance.after, next.panelPairs.statusChance.after, 'pct'],
      ['多重射击', cur.panelPairs.multishot.after, next.panelPairs.multishot.after, 'num3'],
      ['射速', cur.panelPairs.fireRate.after, next.panelPairs.fireRate.after, 'num3'],
      ['弹匣容量', cur.panelPairs.magazineSize.after, next.panelPairs.magazineSize.after, 'num2'],
      ['装填时间', cur.panelPairs.reloadTime.after, next.panelPairs.reloadTime.after, 'num3'],
      // D-129：等效弹匣的「当前」取面板弹匣（未乘弹药效率），装备后取加成后的等效弹匣
      ['等效弹匣', cur.panelPairs.magazineSize.base, nn && nn.等效弹匣, 'num2'],
    ];
    const show = function (v, kind) {
      if (!Number.isFinite(v)) return '—';
      if (kind === 'pct') return (v * 100).toFixed(2) + '%';
      if (kind === 'x') return '×' + v.toFixed(2);
      return v.toFixed(kind === 'num2' ? 2 : 3);
    };
    const rows = [];
    for (const [label, a, b, kind] of pairs) {
      if (!Number.isFinite(b) || Math.abs(b - a) <= 1e-9) continue;
      rows.push([label, a, b, kind]);
    }
    if (rows.length) {
      const pbox = el('div', 'merge-box');
      pbox.append(el('div', 'section-title', '面板'));
      const pt = el('table', 'detail-table');
      const ph = el('tr');
      ['', '当前', '装备后', '增幅'].forEach(function (h) { ph.append(el('th', '', h)); });
      pt.append(ph);
      for (const [label, a, b, kind] of rows) {
        const tr = el('tr');
        tr.append(el('td', '', label));
        tr.append(el('td', '', show(a, kind)));
        tr.append(el('td', '', show(b, kind)));
        const g = a > 0 ? b / a - 1 : null;
        tr.append(el('td', g === null ? '' : g >= 0 ? 'pos' : 'neg', fmtPct(g)));
        pt.append(tr);
      }
      pbox.append(pt);
      box.append(pbox);
    }
    // 显式读一遍 `cn`，避免"当前状态"在将来被误用来算变化率（口径见 D-084）
    void cn;
  }

  // 暴击分档（D-033 / D-038）：按**装上它之后**的暴击参数重新分档。
  // （D-132：暴击几率/暴击伤害已并进上面的「面板」表，这里只剩分档。）
  const nextSeg = next.segments[0];
  const ct = critTiers(nextSeg.critChance, nextSeg.critDamage);
  const tierBox = el('div', 'merge-box');
  tierBox.append(el('div', 'section-title', '暴击分档'));
  tierBox.append(el('div', 'merge-src', ct.map(function (t) {
    return '等级 ' + t.k + '：' + (t.prob * 100).toFixed(1) + '% × ' + t.mul.toFixed(2);
  }).join('　')));
  tierBox.append(el('div', 'merge-src', '平均 ' + critAverage(1, nextSeg.critChance, nextSeg.critDamage).toFixed(3) + ' 倍'));
  box.append(tierBox);
}

// ─────────────────────────────────────────────────────────────
// 控件
// ─────────────────────────────────────────────────────────────

function renderControls() {
  // 增幅基准：与备选 Mod 的筛选按钮组同一样式（D-042）
  const mbox = $('#metric-options');
  mbox.innerHTML = '';
  mbox.className = 'filter-group';
  for (let i = 0; i < METRIC_OPTIONS.length; i++) {
    const opt = METRIC_OPTIONS[i];
    const btn = el('button', 'filter-btn' + (state.metric === opt.id ? ' active' : ''), opt.label);
    btn.type = 'button';
    btn.title = opt.description;
    (function (id) {
      btn.addEventListener('click', function () {
        state.metric = id;
        renderAll();
      });
    })(opt.id);
    mbox.append(btn);
  }

  $('#faction-select').value = state.faction;
  $('#kuva-element').value = state.kuvaType;
  renderFilterButtons();
  renderCoControls();
}

/** 筛选按钮组：单选语义，当前项高亮 */
function renderFilterButtons() {
  const box = $('#candidate-filter');
  box.innerHTML = '';
  for (let i = 0; i < FILTER_OPTIONS.length; i++) {
    const id = FILTER_OPTIONS[i][0];
    const btn = el('button', 'filter-btn' + (state.filter === id ? ' active' : ''), FILTER_OPTIONS[i][1]);
    btn.type = 'button';
    btn.addEventListener('click', function () {
      state.filter = id;
      renderAll();
    });
    box.append(btn);
  }
}

function renderCoControls() {
  const box = $('#co-controls');
  box.innerHTML = '';
  const co = coInfo();
  const fc = freezeInfo();
  // 需求方 2026-11-06：这个框**始终显示**，不随是否装了镀层类 Mod 隐藏
  //   （没装时下面的数值全为 0，计算层也不加成；理由见 decisions.md D-114）

  box.append(el('div', 'section-title', '镀层加成'));

  const row = el('div', 'controls-row');

  {
    // 敌人身上的**异况层数**（需求方 2026-11-06：配置里加一个框，默认 0）
    //   · 只服务**镀层系列**（co）：读它当"敌人身上的异常状态数量"
    //   · 冷颤（coFreeze）**不读这个框**，固定满层 10 层（需求方 2026-11-06 澄清）
    const nLabel = el('label', '', '敌人异况层数');
    const nInput = el('input');
    nInput.type = 'number';
    nInput.min = '0';
    nInput.max = '999';
    nInput.step = '1';
    nInput.value = String(state.coStatusTypes);
    nInput.style.width = '64px';
    nInput.addEventListener('input', function (e) {
      const v = Number(e.target.value);
      state.coStatusTypes = Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
      state.coPreview = true;
      renderAll();
    });
    nLabel.append(nInput);
    row.append(nLabel);
  }

  if (co.active) {
    // 装了镀层类 Mod：可选 0 ~ 叠层上限。`state.coStacks = 0` 现在是**真正的 0 层**（D-117），
    // 不再是「未指定，取上限」——默认值在 store 里是上限（见 app-store.js 的 coStacksDefault）
    const yLabel = el('label', '', '叠加层数');
    const ySel = el('select');
    for (let i = 0; i <= co.maxStacks; i++) {
      const o = el('option', '', String(i));
      o.value = String(i);
      ySel.append(o);
    }
    ySel.value = String(Math.min(state.coStacks, co.maxStacks));
    ySel.addEventListener('change', function (e) { state.coStacks = Number(e.target.value); renderAll(); });
    yLabel.append(ySel);
    row.append(yLabel);
  } else {
    // 未装备也**可编辑**（需求方 2026-11-06）：默认最大值（装上时按假设的镀层卡推演收益）
    const yLabel = el('label', '', '叠加层数');
    const ySel = el('select');
    const maxY = Math.max(1, co.maxStacks);
    for (let i = 0; i <= maxY; i++) {
      const o = el('option', '', String(i));
      o.value = String(i);
      ySel.append(o);
    }
    ySel.value = String(Math.min(state.coStacks, maxY));
    ySel.addEventListener('change', function (e) {
      state.coStacks = Number(e.target.value);
      state.coPreview = true;
      renderAll();
    });
    yLabel.append(ySel);
    row.append(yLabel);
  }

  box.append(row);

  // ⚠ 这里**不再**显示推演小字（D-117，需求方 2026-11-06）：
  //   「镀层加成那边的小字推演去掉，这应该是放到镀层 mod 本身上显示的」
  //   → 收益改由备选/槽位上的那张镀层 Mod 卡片显示（`coModGain` 付给它，`gainBadge` 画在卡上）；
  //     只有「装了冷颤」这种与镀层 Mod 无关的说明仍留在底部。
  // 数值本身仍然可复算：每层 % × 异况数 × 层数，见《乘区归属表》与 D-112。
  if (fc.active) {
    const n = FROZEN_FULL_STACKS;
    box.append(el('div', 'muted', fc.sources.join('、') + '：每层 ' + fc.perStack + '% × ' + n + ' 层冰冻（固定满层）= ' + (fc.perStack * n) + '%（只吃直接非灵化伤害）'));
  }
}

function wireControls() {
  $('#faction-select').addEventListener('change', function (e) { state.faction = e.target.value; renderAll(); });
  $('#kuva-element').addEventListener('change', function (e) { state.kuvaType = e.target.value; renderAll(); });
  $('#kuva-ratio').addEventListener('input', function (e) {
    state.kuvaRatio = Number(e.target.value) / 100;
    $('#kuva-ratio-val').textContent = e.target.value + '%';
    renderAll();
  });
  $('#headshot-toggle').addEventListener('change', function (e) { state.headshot = e.target.checked; renderAll(); });
  $('#headshot-mult').addEventListener('change', function (e) { state.headshotMult = Number(e.target.value) || 3; renderAll(); });

  // 筛选是可反复重建的按钮组（不放这里）
  $('#candidate-search').addEventListener('input', function (e) { state.search = e.target.value; renderAll(); });

  // 拖回备选区 = 卸下（D-040）；但落在**某张备选卡**上时由卡片自己处理成互换（D-115）
  const list = $('#candidate-list');
  list.addEventListener('dragover', function (e) {
    if (!store.dragPayload) return;
    if (store.dragPayload.from === 'list') return; // 从备选区内部拖，不处理
    e.preventDefault();
    list.classList.add('drop-target');
  });
  list.addEventListener('dragleave', function () { list.classList.remove('drop-target'); });
  list.addEventListener('drop', function (e) {
    e.preventDefault();
    list.classList.remove('drop-target');
    if (!store.dragPayload) return;
    dropHappened = true; // 已在 drop 里处理，dragend 不要重复卸下
    removeByPayload(store.dragPayload);
    store.dragPayload = null;
  });

  // 赋能列表同理：拖回整块赋能列表 = 卸下；落在某张赋能卡上 = 互换（D-115）
  const arcList = $('#arcane-list');
  arcList.addEventListener('dragover', function (e) {
    if (!store.dragPayload || store.dragPayload.from === 'list') return;
    e.preventDefault();
    arcList.classList.add('drop-target');
  });
  arcList.addEventListener('dragleave', function () { arcList.classList.remove('drop-target'); });
  arcList.addEventListener('drop', function (e) {
    e.preventDefault();
    arcList.classList.remove('drop-target');
    if (!store.dragPayload) return;
    dropHappened = true;
    removeByPayload(store.dragPayload);
    store.dragPayload = null;
  });

  // 一键全部卸下（D-040）
  const unequipBtn = $('#unequip-all');
  if (unequipBtn) {
    unequipBtn.addEventListener('click', function () {
      unequipAllMods();
      flash('已卸下全部 Mod');
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 主渲染
// ─────────────────────────────────────────────────────────────

function renderAll() {
  // D-141：面板尚未收录的武器（如暗黑分合剑的巨刃 / 双剑）没有 modes，无法结算。
  // 这种武器**只渲染头部与「面板待补」提示**，不跑计算、不渲染配装区，避免半截 UI 与 NaN。
  if (!currentMode()) {
    renderPendingPanel();
    return;
  }
  const contribs = currentContributions();
  const res = runCompute(contribs);
  // 每件装备的边际贡献（需求方 2026-11-06）只算一次，供槽位卡片复用
  store.gainCtx = {
    contribs: contribs,
    current: metricValueOf(res),
  };
  renderHeader();
  renderPanel(res);
  renderSlots();
  renderControls();
  renderCandidates(res);
  renderArcaneList();
  // 不再显示"可装 N 张"（信息噪音），保留元素留空
  $('#slot-info').textContent = '';
  // D-128：拆解挂在渲染**末尾**重算——任何让输出变化的状态（异况/叠层/玄骸/基准/换卡/换枪）
  //        走完 renderAll 后，右边拆解都跟着刷新。以前它只在"点击"时算一次，之后全是旧数。
  renderDetail();
}



/**
 * 「面板待补」武器的渲染（D-141）。
 *
 * 这类武器是**骨架**：分类、暴击、射速有了，但伤害段还没录（例如暗黑分合剑的重剑 / 双剑两版）。
 * 界面要让用户一眼看出「这把武器还不能算」，而不是显示一片空表或 NaN。
 */
function renderPendingPanel() {
  const w = store.data.weapon;
  const titleEl = $('#weapon-title');
  const name = (w.nameZh || w.name) + '（' + w.name + '）';
  titleEl.textContent = name + ' ' + ISSUE_MARK;
  titleEl.title = w._note || '面板未收录';
  titleEl.classList.add('has-issue');
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
  for (const sel of ['#slot-grid', '#arcane-slots', '#side-slots', '#candidate-list', '#arcane-list', '#co-controls', '#dot-detail', '#splash-damage', '#crit-tiers']) {
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

/**
 * 赋能列表（D-032 / D-034 / D-123）：按**增幅**从高到低排；「无伤害词条」的排在最后。
 *
 * 需求方 2026-11-06：「赋能也要按收益顺序排列」。
 * 没有增益的卡（收益为 null 或 0）统一垫底，卡上不显示「增幅 —」这种噪音。
 */
function renderArcaneList() {
  const box = $('#arcane-list');
  box.innerHTML = '';
  const list = store.data.primaryArcanes;
  const rows = [];
  for (let i = 0; i < list.length; i++) {
    // 已装备的赋能不在列表里重复显示（D-034）
    if (store.arcaneKey === list[i].key) continue;
    rows.push({ arc: list[i], gain: arcanePreviewGain(list[i]) });
  }
  rows.sort(function (a, b) {
    const ga = a.gain === null ? -Infinity : a.gain;
    const gb = b.gain === null ? -Infinity : b.gain;
    if (ga === gb) return (a.arc.name.zh || a.arc.name.en).localeCompare(b.arc.name.zh || b.arc.name.en, 'zh-CN');
    return gb - ga;
  });
  for (let i = 0; i < rows.length; i++) box.append(arcaneCard(rows[i].arc, rows[i].gain));
  $('#arcane-count').textContent = rows.length + ' 个';
}

function arcaneCard(arc, gain) {
  const card = el('div', 'cand arcane-cand');
  const payload = { kind: 'arcane', key: arc.key, from: 'list' };
  makeDraggable(card, payload);
  // D-115：已装备的赋能拖到**这张赋能卡**上 = 互换（旧赋能回列表）。
  makeDropTarget(card, function () { return candidateCardAccepts(payload); }, function () { swapWithCandidateCard(payload); });
  card.addEventListener('drop', function (e) { e.stopPropagation(); });

  const top = el('div', 'cand-top');
  top.append(el('span', 'cand-name', arc.name.zh || arc.name.en));
  card.append(top);
  // D-116：词条 + 收益（收益口径与备选 Mod 一致：模拟装上后相对当前的指标提升）
  // D-123：没有伤害词条的卡不再写任何提示（需求方：「没有效果的赋能请删掉括号里面的提示」）
  const stats = arcaneStatChips(arc);
  if (stats.length) {
    const wrap = el('div', 'slot-stats');
    for (const chip of stats) wrap.append(chip);
    card.append(wrap);
    if (gain === undefined) gain = arcanePreviewGain(arc);
    const gainEl = el('div', 'cand-gain');
    const cls = gain === null ? '' : gain >= 0.00005 ? 'pos' : gain <= -0.00005 ? 'neg' : '';
    gainEl.append(el('span', 'gain-label', '增幅'));
    gainEl.append(el('span', 'gain-val ' + cls, fmtPct(gain)));
    card.append(gainEl);
  }
  // D-125：赋能也能点开拆解（与备选 Mod 一样）
  card.addEventListener('click', function () { selectDetail({ kind: 'arcane', key: arc.key }); });
  return card;
}

/**
 * 赋能 → 卡片上的词条小标签（D-116）。**只列真正参与伤害计算的词条**，
 * 与内核拿到的贡献同一份来源（`arcaneDisplayStats`），所以"显示的"就是"算的"。
 */
function arcaneStatChips(arc) {
  const out = [];
  const stats = arcaneDisplayStats(arc);
  for (let i = 0; i < stats.length; i++) {
    const st = stats[i];
    out.push(el('span', 'slot-stat', statLabel(st.stat) + ' +' + (Math.round(st.amount * 100) / 100) + '%'));
  }
  return out;
}

/**
 * 赋能装上后的增幅（D-116）：与已装卡的 `gainOf` 同口径，
 * 只是在当前贡献列表上**追加**这个赋能的贡献再比较，而不是从配置里拿掉。
 *
 * ⚠ D-126（需求方 2026-11-06 纠正）：**只算当前选中的口径**，不敏感就是 +0.00%。
 *   上一轮（D-124）曾在增幅为 0 时改用"最敏感口径"的数显示，那是错的——
 *   那个数不属于当前口径（默认「单次射击」下准星的弹药效率本来就不该有收益），
 *   卡上显示它等于凭空多报收益。要看弹药效率的效果：把基准切到「持续伤害」，
 *   或点开拆解（那里逐口径列出）。
 */
function arcanePreviewGain(arc) {
  const ctx = store.gainCtx;
  if (!ctx) return null;
  const extra = arcaneToContributions(arc);
  if (!extra.length) return null;
  if (!(ctx.current > 0)) return null;
  const after = metricValueOf(runCompute(ctx.contribs.concat(extra)));
  if (!(after > 0)) return null;
  return after / ctx.current - 1;
}

// ─────────────────────────────────────────────────────────────
// 启动
// ─────────────────────────────────────────────────────────────

async function boot() {
  // D-093：所有类别的武器都加载进来，供切换用（当前只有"主要"可选）
  // 取数细节在 app-data.js 的 loadAllWeapons()
  setDataAll(await loadAllWeapons(groupWeapons));

  renderWeaponPicker();
  // 默认武器 = 主要 → 步枪的第一把；模式取其第一个攻击模式（需求方 2026-11-06）
  const firstId = defaultWeaponId();
  const firstW = store.dataAll && store.dataAll.weaponById.get(firstId);
  await loadWeapon(firstId, firstDisplayMode(firstW));

  // 下拉：派系 / 玄骸元素 / 筛选
  const fsel = $('#faction-select');
  for (let i = 0; i < FACTION_OPTIONS.length; i++) {
    const o = el('option', '', FACTION_OPTIONS[i][1]);
    o.value = FACTION_OPTIONS[i][0];
    fsel.append(o);
  }
  const ksel = $('#kuva-element');
  for (let i = 0; i < KUVA_ELEMENTS.length; i++) {
    const o = el('option', '', ELEMENT_LABEL[KUVA_ELEMENTS[i]]);
    o.value = KUVA_ELEMENTS[i];
    ksel.append(o);
  }

  $('#kuva-ratio').value = String(Math.round(state.kuvaRatio * 100));
  $('#kuva-ratio-val').textContent = Math.round(state.kuvaRatio * 100) + '%';
  $('#headshot-mult').value = String(state.headshotMult);

  wireControls();
  editor.setEditorDeps({ flash, renderAll });
  editor.wireEditor();
  renderAll();

  // 开发态才显示「编辑」按钮（D-044）；静态部署没有后端，不渲染
  const dev = await editor.detectDevMode();
  const openBtn = $('#open-editor');
  if (openBtn) openBtn.style.display = dev ? '' : 'none';
  // D-046：开发态首屏就把 overrides 合进武器数据
  if (dev) await editor.reloadWeaponOverrides(true);
  // D-122：启动/重启后也要按当前武器刷新「已修改」标记
  editor.renderModifiedBadge();
}

// ─────────────────────────────────────────────────────────────
// 武器切换（D-093）
// ─────────────────────────────────────────────────────────────

/** 全部武器的索引（boot 时填充） */

/**
 * 渲染三个下拉栏 + 搜索框。
 *
 * ```
 * 大类：主要 / 次要 / 近战 / 空战   ← 目前只有"主要"可选，其余置灰
 * 类型：该大类下的细分（步枪/霰弹枪/狙击枪/弓 …；近战按剑/锤/匕首…）
 * 武器：该类型下的武器名
 * ```
 */
function renderWeaponPicker() {
  const gsel = $('#weapon-group');
  gsel.innerHTML = '';
  for (const g of WEAPON_GROUPS) {
    const o = el('option', '', g.label + (g.enabled ? '' : '（未开放）'));
    o.value = g.id;
    o.disabled = !g.enabled;
    gsel.append(o);
  }
  // 默认停在"主要"
  gsel.value = 'primary';
  gsel.addEventListener('change', function () { renderTypeOptions(gsel.value); });
  // 弹道筛选（D-099 A）：第二层筛选器，不改变类型树
  const ssel = $('#weapon-style');
  ssel.innerHTML = '';
  for (const o of FIRE_STYLE_OPTIONS) {
    const opt = el('option', '', o.label);
    opt.value = o.id;
    ssel.append(opt);
  }
  ssel.value = 'all';
  ssel.onchange = function () { renderWeaponOptions($('#weapon-group').value, $('#weapon-type').value); };

  renderTypeOptions('primary');

  $('#weapon-search').addEventListener('input', function (e) {
    renderSearchResults(e.target.value);
  });
}

/** 按大类渲染"类型"下拉栏 */
function renderTypeOptions(groupId) {
  const tsel = $('#weapon-type');
  tsel.innerHTML = '';
  const group = store.dataAll.groups.get(groupId);
  if (!group) return;
  const types = Array.from(group.types.entries());
  types.sort(function (a, b) { return a[1].label.localeCompare(b[1].label, 'zh-CN'); });
  for (const [key, bucket] of types) {
    const o = el('option', '', bucket.label + '（' + bucket.weapons.length + '）');
    o.value = key;
    tsel.append(o);
  }
  // 切类型 = 切到该类型下第一把枪（若与当前武器不同才切）——需求方 2026-11-06 的口径：
  // 「可以选中第一个，但是与当前武器是同一个的时候不切换」（D-097）
  tsel.onchange = function () {
    const bucket = group.types.get(tsel.value);
    const first = bucket && bucket.weapons.length ? bucket.weapons[0].id : null;
    if (first) { switchWeapon(first).catch(function (e) { console.error('[switchWeapon]', e); }); return; }
    renderWeaponOptions(groupId, tsel.value);
  };
  if (!types.length) { $('#weapon-select').innerHTML = ''; return; }
  // 默认类型：当前武器所属的那个类型（找不到就用第一个）
  // 这样切回大类时，界面上仍停在"我刚选的那把枪"所在的分类，而不是跳回第一类（D-097）
  const curId = store.data && store.data.weapon ? store.data.weapon.id : null;
  let pick = types[0][0];
  if (curId) {
    for (const [key, bucket] of types) {
      if (bucket.weapons.some(function (w) { return w.id === curId; })) { pick = key; break; }
    }
  }
  tsel.value = pick;
  renderWeaponOptions(groupId, pick);
}

/** 按类型渲染"武器"下拉栏 */
function renderWeaponOptions(groupId, typeKey) {
  const wsel = $('#weapon-select');
  wsel.innerHTML = '';
  const group = store.dataAll.groups.get(groupId);
  const bucket = group && group.types.get(typeKey);
  if (!bucket) return;
  // 弹道筛选（D-099 A）
  const styleSel = $('#weapon-style');
  const list = filterByStyle(bucket.weapons, styleSel ? styleSel.value : 'all');
  for (const w of list) {
    const issues = issuesOf(w.id);
    const o = el('option', '', weaponLabel(w, issues));
    o.value = w.id;
    if (issues.length) o.title = issues.map(function (x) { return x.note; }).join('；');
    wsel.append(o);
  }
  wsel.onchange = function () { switchWeapon(wsel.value); };
  // 选中值必须等于 store.data.weapon（D-097）：在列表里就选它，不在就补一项"（当前）"。
  // 绝不在这里"默认选第一项"——那会造成"选单显示 A、实际在算 B"。
  syncWeaponSelect();
}

/** 名称搜索结果（替换"类型 + 武器"两个下拉栏的内容） */
function renderSearchResults(keyword) {
  const tsel = $('#weapon-type');
  const wsel = $('#weapon-select');
  const hits = searchWeapons(store.dataAll.weapons, keyword);
  if (!String(keyword || '').trim()) {
    // 清空搜索 → 回到分类浏览
    renderTypeOptions($('#weapon-group').value);
    return;
  }
  // 搜索时把类型栏改成"搜索结果"，武器栏列出命中项
  tsel.innerHTML = '';
  const o = el('option', '', '搜索结果（' + hits.length + '）');
  o.value = '__search__';
  tsel.append(o);
  tsel.onchange = null;

  wsel.innerHTML = '';
  const shown = hits.slice(0, 200);
  for (const w of shown) {
    const issues = issuesOf(w.id);
    const opt = el('option', '', weaponLabel(w, issues));
    opt.value = w.id;
    if (issues.length) opt.title = issues.map(function (x) { return x.note; }).join('；');
    wsel.append(opt);
  }
  wsel.onchange = function () { switchWeapon(wsel.value); };
  // 搜索结果里不含当前武器时，syncWeaponSelect 会补一项"（当前）"
  syncWeaponSelect();
  if (hits.length > shown.length) {
    const more = el('option', '', '… 还有 ' + (hits.length - shown.length) + ' 个，请细化搜索');
    more.disabled = true;
    wsel.append(more);
  }
}

/**
 * 切换到另一把武器。
 *
 * ⚠ 切换后必须重算"可装 Mod 列表"（`modKindsFor` 依赖武器槽位），
 *    并按 D-052 的约定**清空已装 Mod**，避免把步枪 Mod 留在霰弹枪上。
 */
async function switchWeapon(weaponId) {
  if (!store.dataAll || !weaponId || weaponId === '__search__') return;
  const weapon = store.dataAll.weaponById.get(weaponId);
  if (!weapon) return;
  // 与当前武器相同 → 不重算，但要把选单同步回当前值
  // （否则切换类型/搜索后选单停在"第一项"，与实际武器不一致）
  if (store.data && store.data.weapon && store.data.weapon.id === weaponId) {
    syncWeaponSelect();
    return;
  }

  // 清空配置：换枪后原来的 Mod 可能已不适用
  for (let i = 0; i < SLOT_COUNT; i++) modSlots[i] = null;
  store.exilusModId = null;
  store.arcaneKey = null;
  // 换枪后右侧拆解必须回到提示文案：`detailTarget` 记的是**上一把枪**上的那张卡，
  // 不清掉会继续显示旧武器的「输出口径」表（本次重跑数据暴露出来的既有缺陷）。
  // 只重置目标、不改渲染逻辑——拆解区本来就靠 `detailTarget === null` 显示占位文案。
  detailTarget = null;

  await loadWeapon(weaponId);
  // D-119：四个大类都开放了，换枪后让"大类"下拉停在**当前武器所在的大类**
  // （例如从选单直接切到一把近战，大类不应还停在"主要"）
  const groupSel = $('#weapon-group');
  const groupOf = weaponGroupId(weapon);
  if (groupSel && groupOf) groupSel.value = groupOf;
  renderWeaponOptions($('#weapon-group').value, $('#weapon-type').value);
  renderAll();
  // D-122：编辑器里属于上一把枪的草稿与"已保存到 …"提示都要清掉，
  //        「已修改」标记必须按**新武器**重新判断（以前只有 reloadWeaponOverrides 会刷新它）
  editor.resetEditorForWeaponSwitch();
  editor.renderModifiedBadge();
  // D-119：非玄骸武器隐藏玄骸加成区块（D-042）。这里不走 renderAll（重）而要单独刷一次，
  //   否则从选单/搜索结果换枪时，玄骸控件会停在上一把武器的可见状态。
  renderKuvaVisibility();
}

/**
 * 把「武器」下拉栏的选中值同步成**当前实际武器**。
 *
 * 选单只是选择器，真正的状态是 `store.data.weapon`。任何重新渲染选单之后
 * 都要调用这里，避免出现"选单显示 A、实际在算 B"的不一致（D-097）。
 */
function syncWeaponSelect() {
  const wsel = $('#weapon-select');
  const cur = store.data && store.data.weapon ? store.data.weapon.id : null;
  if (!wsel || !cur) return;
  for (const o of wsel.children) {
    if (o.value === cur) { wsel.value = cur; return; }
  }
  // 当前武器不在本选单里（例如切到了别的类型）：把它补到列表**末尾**并选中，
  // 让用户看得见"我现在在哪把枪上"，且随时能切回来。
  // （用 append 而不是 insertBefore：顺序其实无所谓，但 append 兼容性更好）
  const w = store.dataAll && store.dataAll.weaponById.get(cur);
  if (!w) return;
  const opt = el('option', '', weaponLabel(w, issuesOf(cur)) + '（当前）');
  opt.value = cur;
  wsel.append(opt);
  wsel.value = cur;
}

/**
 * 加载一把武器：建 store.data、重置模式索引、重算可装 Mod（取数细节在 app-data.js）
 *
 * D-117：「叠加层数」的默认值（叠层上限）在这里跟着武器重填——每把武器能装的镀层卡
 * 叠层上限可能不同，而且 0 现在是合法的"0 层"，不能再靠"0 = 未指定"来取默认值。
 */
async function loadWeapon(weaponId, modeId) {
  setData(buildWeaponData(weaponId, { modeId: modeId || MODE_ID }));
  state.coStacks = coDefaults().stacks;
}

/**
 * 启动时默认打开的武器：**主要 → 步枪**分类下的第一把（需求方 2026-11-06）。
 *
 * 说明：
 *   · 顺序与「类型 / 武器」下拉栏完全一致（类型内按中文名 `localeCompare` 排序，
 *     见 `groupWeapons`），所以用户看到的第一把就是打开时的那把；
 *   · 兜底：没有步枪分类时取主要的第一个类型；再不行才用写死的 `WEAPON_ID`。
 */
function defaultWeaponId() {
  const group = store.dataAll && store.dataAll.groups.get('primary');
  if (!group) return WEAPON_ID;
  const rifle = group.types.get('rifle');
  if (rifle && rifle.weapons.length) return rifle.weapons[0].id;
  for (const bucket of group.types.values()) {
    if (bucket.weapons.length) return bucket.weapons[0].id;
  }
  return WEAPON_ID;
}

boot().catch(function (err) {
  console.error(err);
  document.body.innerHTML = '<pre style="color:#e06060;padding:24px">' + (err.stack || err) + '</pre>';
});
