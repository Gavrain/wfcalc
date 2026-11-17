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
 * 每个数值都能对应到 依据：核心事实 的某个函数；面板区随 Mod 实时更新；
 * 备选 Mod 区给出装上之后的伤害增幅（增幅基准可选）。
 *
 * ⚠ 写法约束：`packages/demo/src/server.mjs` 用"剥类型"的方式在浏览器里直接跑 `.ts` 源码，
 * 所以这里只用**命名导入**，不要写 `const { a } = ns` 这种解构。
 */
/** 连击倍率上限（需求方 2026-11-13：带凯旋之爪满层为 13x） */
const MAX_COMBO_MULTIPLIER = 13;
import { clearDetailTarget, renderDetail, renderDotDetail, selectDetail, wireDetailDeps } from './ui-detail.js';
import { collapsibleBlock, dotRow } from './ui-parts.js';
import { modLockNotes, modStatText, setNoteOf, statLabel } from './ui-labels.js';
import { renderRiven, wireRivenDeps } from './ui-riven.js';
import {
  bladeShadowGain, critAverage, critTiers, DEFAULT_DOT_WINDOW_SECONDS, DOT_TYPES, DOT_WINDOW_MAX_SECONDS, DOT_WINDOW_MIN_SECONDS, firstTierCritChance, isKuvaFamily, METRIC_OPTIONS, metricOptionsFor, NON_DAMAGE_STATUS_TYPES, totalProcChance } from '../../core/src/index.ts';
import { WEAPON_GROUPS, groupWeapons, searchWeapons, FIRE_STYLE_OPTIONS, filterByStyle, weaponLabel, weaponGroupId, locateWeapon, weaponMatchesStyle } from './weapon-picker.js';
import { OVERRIDE_WEAPON_FIELDS as OVERRIDE_FIELDS, mergeWeaponOverride as applyWeaponOverride } from './weapon-override.js';
import { arcaneDisplayStats, arcaneToContributions, DEFAULT_BURST_STACKS, isConditionOverloadMod, MAX_BURST_STACKS, modStackFactor, modToContributions } from '../../data/src/adapter.ts';
import { SET_BONUS_EFFECTS } from '../../data/src/manual/mods.ts';
import {
  ELEMENT_COLOR, ELEMENT_LABEL, EXILUS_INDEX, FACTION_OPTIONS, KUVA_ELEMENTS, MAX_SLOTS, RIVEN_SLOT_ID, SLOT_COUNT,
  bucketLabel, fmt, fmtPct, getSavedLoadout, lastUiState, lastWeaponId, makeLoadoutEntry, saveLoadout,
  setData, setDataAll, spreadTotalOf, store,
} from './app-store.js';
import { buildWeaponData, isArcaneUsableOn, isExilusMod, isModAllowedOnWeapon, loadAllWeapons, modName } from './app-data.js';
import {
  formatRivenRange, formatRivenValue, isRivenInstalled, placeRivenEntry,
  rivenComboNow, rivenDefOf, rivenFilledCount, rivenInstalledSlot, rivenRawRange, rivenScopeOf,
  rivenSliderScale, rivenSlotKind, rivenTableNow, rivenValueFor, setRivenCombo, setRivenEntry, setRivenEntryValue,
} from './app-riven.js';
import {
  RIVEN_COMBOS, RIVEN_SCOPE_LABEL, rivenDisplayUnit,
} from '../../data/src/manual/riven.ts';
import {
  coDefaults, coInfo, coModGain, currentContributions, gainOfPair, dotGainForCandidate, dotMetricRoleOf, effectiveModeFor,
  freezeInfo, gainOf, INFINITE_GAIN, isDotMetric, isTotalLikeMetric, metricValueOf, ratioGainOf, runCompute,
  rivenCandidateGain, rivenEntryGain, rivenGain, trialSlotNow,
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

/** `weapon-slots.json` 里某把武器的记录（守护 / 同伴武器的分类与赋能判定都要它） */
function slotOf(weaponId) {
  const all = store.dataAll;
  return (all && all.slotFile && all.slotFile.weapons[weaponId]) || undefined;
}

/**
 * 当前这把武器能不能装赋能（需求方 2026-11-12：「守护武器的赋能槽禁用掉」）。
 *
 * 守护 / 同伴武器一律不行——分离 / 分离 Prime 虽是近战、能吃近战 Mod，也不吃赋能。
 * 判定放在取数层（`arcaneCategoriesFor` 对 `companion` 直接返回空），这里只读结果；
 * 其余武器沿用 D-119 的老口径：没有可用赋能就当作没有赋能槽（空战武器就属于这种）。
 */
function arcanesDisabled() {
  const d = store.data;
  if (!d || !d.weapon) return false;
  return !(d.primaryArcanes && d.primaryArcanes.length);
}

/** 百分比格式：带符号、一位小数 */
function fmtGain(g) {
  if (g === null || g === undefined) return '';
  // 无穷大（这张卡让该指标从无到有，D-171）
  if (!Number.isFinite(g)) return '∞';
  const pct = g * 100;
  const sign = pct > 0.05 ? '+' : pct < -0.05 ? '' : '±';
  return sign + pct.toFixed(1) + '%';
}

/**
 * 一张卡上的「贡献」标签。
 *
 * 在 DoT 相关口径（异常加权单层秒伤 / 六秒异常总伤）下，数值后面跟一个 `to dot` 小字，
 * 说明这是「对异常伤害」的口径（D-171）；`∞` 表示这张卡让该异常从无到有。
 *
 * @param gain 提升比例；null = 无贡献（不显示）
 */
function gainBadge(gain) {
  if (gain === null || gain === undefined) return null;
  const cls = gain > 0.0005 ? 'up' : gain < -0.0005 ? 'down' : 'flat';
  const wrap = el('div', 'slot-gain');
  wrap.append(el('span', 'slot-gain-val ' + cls, fmtGain(gain)));
  if (isDotMetric()) wrap.append(el('span', 'gain-to-dot', 'to dot'));
  // D-175：N 秒总伤下的增幅是「续航 / 异常」加权拼出来的，标个小字说明来源
  else if (isTotalLikeMetric()) wrap.append(el('span', 'gain-to-dot', 'to total'));
  return wrap;
}

/** 当前指标是不是「N 秒异常总伤」（D-176 的拆法只在这一个口径生效） */
function isDotWindowMetric() {
  return state.metric === 'dot6s';
}

/**
 * 备选卡在「N 秒总伤」下的增幅（D-177）。
 *
 * ```
 * 总伤增幅 = "装上这张卡后的总伤" ÷ "不装它的总伤" − 1
 * ```
 *
 * 但"不装它"这一侧，**元素没形成 DoT 的元素卡**（病毒火里的冰 / 毒）在 **DoT 部分**
 * 只去掉触发率词条（相当于分母是"…60 冰冻"），直伤部分照常整张拿掉。
 * 所以这里构造一个"分母配装"：直伤取「不带这张卡」、DoT 取「带元素但不带触发率」。
 *
 * @param base     当前贡献
 * @param next     装上这张卡之后的贡献
 * @param own      这张卡自己的贡献
 * @param baseRes  当前配装的计算结果
 */
function candidateWindowGain(base, next, own, baseRes) {
  // 需求方 2026-11-18：分母/分子的构造与"已装卡"共用同一份实现（见 app-compute 的 gainOfPair）。
  // 以前这里自己拼 `sustainedDps × N + dot6s`，与内核的 totalInWindow 不等，两处会给出不同的增幅。
  return gainOfPair(base, next, 'candidate');
}

/** 这张卡是不是"元素没形成 DoT、但带触发率"的元素卡（D-177 的分母构造要用）。
 * ⚠ 固定按「N 秒异常总伤」口径判断，不受当前指标影响。 */
function isDotWindowMetricDetailRoleIsSplit(own, next) {
  const saved = state.metric;
  state.metric = 'dot6s';
  try {
    return dotMetricRoleOf(own, next).kind === 'split';
  } finally {
    state.metric = saved;
  }
}

/** 某次结果的某口径值（找不到返回 0） */
function lineValue(res, id) {
  const lines = res.output.lines;
  for (let i = 0; i < lines.length; i++) if (lines[i].id === id) return lines[i].value;
  return 0;
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

/**
 * 浏览器标签页标题（D-170，需求方 2026-11-12）。
 *
 * 需求方原话：「然后标题也改一下，他现在始终是赤毒卡拉克」——
 * 标签页以前在 `index.html` 里写死 `wfcalc · 赤毒·卡拉克`，换到别的枪也不变。
 * 现在跟着**当前武器**走：`wfcalc · 艾弗旺-5 木星（LasGooAKPlayerWeapon）`。
 *
 * 兜底：数据还没加载 / 没有当前武器时保留 `index.html` 里的占位标题，不要停在上把枪的名字。
 */
function renderPageTitle() {
  const w = store.data && store.data.weapon;
  if (!w) return;
  const nameZh = w.nameZh || w.name;
  document.title = 'wfcalc · ' + nameZh + (w.name && w.name !== nameZh ? '（' + w.name + '）' : '');
}

function renderHeader() {
  const w = store.data.weapon;
  // D-148 / 需求方 2026-11-12：换源到 WFCD 后，原先「灵化面板复用 / 扳机未识别」这类
  // 数据缺陷都已消除，所以标题后的 ⚠ 错误标记整个去掉。
  const titleEl = $('#weapon-title');
  titleEl.textContent = (w.nameZh || w.name) + '（' + w.name + '）';
  titleEl.title = '';
  // D-170：标签页标题也跟着当前武器走
  renderPageTitle();
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

  // 一排搞定：模式 + 当前模式内的**攻击方式**（需求方 2026-11-12）
  //
  // > 「这ui太丑了，跟切换攻击模式一样做成扁扁的，他们可以放在同一行。」
  // > 「（没有多段时）也显示一行提示」
  //
  // 所以两种控件做成同一种扁平胶囊，排在同一条 `.mode-row` 里：
  //   模式是单选；攻击方式是多选（复选框），全勾 = 各段相加。
  // **只有一种攻击方式时也显示这一行**（置灰、不可点），让用户知道有这个功能。
  const variants = currentMode() ? (currentMode().variants ?? []) : [];
  const singleVariant = variants.length <= 1;

  if (modes.length > 1 || variants.length > 0) {
    const row = el('div', 'mode-row');
    for (let i = 0; i < modes.length; i++) {
      const m = modes[i];
      // D-141：数据层给的中文模式名（`_label`）优先，例如重力奇点的「球体融合 / 球体爆炸」
      const btn = el('button', 'mode-btn' + (i === state.modeIndex ? ' active' : ''), m._label || MODE_LABEL[m.id] || m.id);
      btn.type = 'button';
      btn.title = (m._label ? m._label + ' · ' : '') + m.id + ' · ' + (TRIGGER_ZH[m.trigger] || m.trigger) + (m._note ? '\n' + m._note : '');
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

    if (variants.length > 0) {
      // 分隔符：让「模式」与「攻击方式」两段在视觉上分开，但仍在同一行
      row.append(el('span', 'mode-sep'));
      for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        const on = isVariantSelected(i);
        // 只有一种攻击方式时：显示但**置灰不可点**，让用户知道有这个功能
        const locked = singleVariant;
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.className = 'variant-check';
        cb.disabled = locked;
        cb.title = locked
          ? '这个模式只有一种攻击方式'
          : v.id + ' · ' + v.segments.map(function (s) { return s.kind; }).join(' + ');
        if (!locked) cb.addEventListener('change', function () { toggleVariant(i); });
        // 与模式按钮同一种扁平胶囊，选中时高亮
        const label = el('label', 'mode-btn variant-btn' + (on && !locked ? ' active' : '') + (locked ? ' is-locked' : ''));
        label.append(cb);
        label.append(el('span', '', v.label));
        // 这一种攻击方式自己的扳机与模式不同时标出来（赘骨灵化：射线 / 蓄力）
        if (v.trigger && currentMode() && v.trigger !== currentMode().trigger) {
          label.append(el('span', 'variant-trig', TRIGGER_ZH[v.trigger] || v.trigger));
        }
        row.append(label);
      }
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

/** 「N 秒」窗口的候选秒数（D-171：需求方 2026-11-13「6 后面就不要了」） */
const WINDOW_SECONDS = [1, 2, 3, 4, 5, 6];

/**
 * 秒数下拉框（D-171）：画在**增幅基准那一排**（`#dot-window-picker`）。
 *
 * 需求方 2026-11-13：
 * > 「你怎么放到左边去了啊，肯定是放到增幅基准那边啊。」
 *
 * 所以它和「增幅基准」的按钮组并排；改它 → 重算整页 →
 * 左栏「N 秒异常总伤 / N 秒总伤」两行的名字与数值、以及增幅基准里那两项的名字一起刷新。
 */
function renderDotWindowPicker() {
  const box = $('#dot-window-picker');
  if (!box) return;
  box.innerHTML = '';
  const sel = el('select', 'dot-window-select');
  sel.title = '异常总伤统计几秒';
  for (const n of WINDOW_SECONDS) {
    const o = el('option', '', n + ' 秒');
    o.value = String(n);
    sel.append(o);
  }
  sel.value = String(state.dotWindowSeconds);
  sel.addEventListener('change', function (e) {
    state.dotWindowSeconds = Number(e.target.value) || DEFAULT_DOT_WINDOW_SECONDS;
    renderAll();
  });
  box.append(sel);
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



// ─────────────────────────────────────────────────────────────
// 折叠块（需求方 2026-11-12：「折叠起来以后只是内部项隐藏，标题还是要展示出来」）
// ─────────────────────────────────────────────────────────────



function writeCollapse(state) {
  try {
    window.localStorage.setItem(COLLAPSE_STORE_KEY, JSON.stringify(state));
  } catch (e) {
    /* 存储不可用时就不存，页面照常工作 */
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
    // 裂罅：从待选区（'riven-list'）拖出来的不卸下；从裂罅词条槽（'riven-slot'）拖出去 = 卸下
    if (p && !dropHappened && p.from !== 'list' && p.from !== 'slot-picker' && p.from !== 'riven-list') {
      removeByPayload(p);
    }
    dropHappened = false;
  });
}

/** 按拖动载荷卸下对应内容 */
function removeByPayload(p) {
  // 裂罅里的词条（拖出裂罅区 = 卸下，回到待选区）
  if (p.kind === 'rivenEntry') {
    placeRivenEntry(p.index, '');
    renderAll();
    return;
  }
  if (p.kind === 'riven') {
    // 裂罅（D-162）：只是从槽位卸下，裂罅本身和它的词条仍然留在下方裂罅区
    const i = rivenInstalledSlot();
    if (i >= 0) modSlots[i] = null;
    renderAll();
    return;
  }
  if (p.kind === 'mod') {
    // 劣化槽里的卡载荷带 `exilus: true`，但 `makeDraggable` 里写的是 `from: 'exilus'`（两种写法都认）
    if (p.from === 'exilus' || p.exilus) { store.exilusModId = null; renderAll(); return; }
    if (typeof p.index === 'number' && modSlots[p.index]) { modSlots[p.index] = null; renderAll(); }
    return;
  }
  if (p.kind === 'arcane') { store.arcaneKey = null; renderAll(); }
}

/**
 * 卡面上的词条小标签。
 *
 * 需求方 2026-11-13：**弹匣容量 / 换弹速度也要显示**——它们影响「续航秒伤」，不是功能卡，
 * 以前因为 `bucket === 'utility'` 被整行跳过，于是「装了野火只看得到 +60% 火焰」，
 * 看起来像只算了一条。
 */
function statChips(mod) {
  // D-116：无限叠层类（弹能过继等）的值按「每层 × 满层」显示，与内核取的值一致
  const stacks = modStackFactor(mod.id);
  const wrap = el('div', 'slot-stats');
  for (let i = 0; i < mod.stats.length; i++) {
    const s = mod.stats[i];
    if (!s.bucket) continue;
    const max = s.levelValues[s.levelValues.length - 1] * stacks;
    wrap.append(el('span', 'slot-stat', statLabel(s.stat) + ' ' + modStatText(s, max, mod.descriptionEn)));
  }
  // 需求方 2026-11-13：锁射速 / 锁多重写进卡面（原文就是这两句）
  for (const note of modLockNotes(mod)) wrap.append(el('span', 'slot-stat slot-lock', note));
  // 套装提示：只标本卡所属那一套（需求方 2026-11-18）
  const setNote = setNoteOf(mod);
  if (setNote) wrap.append(el('span', 'slot-stat slot-set', setNote));
  return wrap;
}


/**
 * 卡面上的**套装提示**（需求方 2026-11-18）。
 *
 * 只标**本卡所属那一套**的效果，绝不显示别的套装（不同套装不能混用）。
 * 每张卡都标（牺牲这种「×1.25 只算一次」的也每张都标，但计算上不会重复乘）。
 *
 * 依据：核心事实 §11（套装效果属于数据结构化事实）。
 */


/**
 * 卸下所有 Mod（含劣化槽）。赋能不受影响。
 * 供「一键卸下」按钮与拖拽离开配置区共用。
 *
 * D-157：卸下的结果会在下一次 `renderAll` 时写进配卡存档——刷新后就是空配卡。
 */
function unequipAllMods() {
  for (let i = 0; i < SLOT_COUNT; i++) modSlots[i] = null;
  store.exilusModId = null;
  renderAll();
}

// ─────────────────────────────────────────────────────────────
// 配卡存档（D-157，需求方 2026-11-12）
//
// 「刷新页面要能恢复到刚才的配卡」。按武器分开存，换枪时各恢复各的；
// 没存过的枪照旧清空。读写细节在 `app-store.js`，这里只负责
//   ① 把界面状态整理成存档形状（`captureLoadout`）；
//   ② 存档 → 界面，并**核对每一项在当前武器上是否还存在**（`restoreLoadout`）。
// ─────────────────────────────────────────────────────────────

/**
 * 把当前界面状态整理成存档形状。
 *
 * 只收**跟配卡有关**的东西：8 个槽、劣化槽、赋能槽、模式索引、攻击方式勾选，
 * 以及配置区（派系 / 爆头 / 玄骸 / 镀层 / 冷颤）。「镀层：假设装备推演」这种纯界面开关也不存，
 * 刷新后用品默认值更省心。
 */
function captureLoadout() {
  const entry = makeLoadoutEntry(modSlots, store.exilusModId, store.arcaneKey);
  // 裂罅（D-162）：槽位用占位 id，真实词条单独存一份
  entry.riven = store.riven
    ? { combo: store.riven.combo, entries: store.riven.entries.map(function (e) { return e && e.key ? { key: e.key, value: e.value } : null; }) }
    : null;
  entry.ui = {
    modeIndex: state.modeIndex,
    // `null` = 全选（D-148），要原样存下来，不能当成"空"
    selectedVariants: Array.isArray(state.selectedVariants) ? state.selectedVariants.slice() : null,
    faction: state.faction,
    headshot: Boolean(state.headshot),
    headshotMult: state.headshotMult,
    kuvaType: state.kuvaType,
    kuvaRatio: state.kuvaRatio,
    coStatusTypes: state.coStatusTypes,
    coStacks: state.coStacks,
    coFreezeStacks: state.coFreezeStacks,
    // 需求方 2026-11-13：连击倍率 / 次要·爆发层数（跟这套配装一起存）
    comboMultiplier: state.comboMultiplier,
    burstStacks: state.burstStacks,
    // D-171：异常总伤的窗口秒数（跟这套配装一起存，刷新后还是你选的秒数）
    dotWindowSeconds: state.dotWindowSeconds,
  };
  return entry;
}

/** 把当前配卡写进存档（解析错误 / 存储不可用时静默失败） */
function persistLoadout() {
  const w = store.data && store.data.weapon;
  if (!w || !w.id) return;
  try {
    const entry = captureLoadout();
    saveLoadout(w.id, entry, entry.ui);
  } catch (e) {
    /* 存档坏不了页面 */
  }
}

/**
 * 把一把存的配卡应用到当前武器上。
 *
 * ⚠ 存档是**旧数据**：数据更新后某张卡可能已经不存在、赋能换了 key、
 * 模式数量变了。所以每一项都要先在该武器当前的可选集合里查一遍，查不到就跳过（留空）。
 *
 * @param saved  `{ slots, exilus, arcane, ui }`；为 null 表示这把枪没有存档 → 清空
 */
function restoreLoadout(saved) {
  const data = store.data;
  const w = data && data.weapon;
  // ── 槽位 ──
  const empty = makeLoadoutEntry([], null, null);
  const src = saved || empty;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const id = src.slots[i];
    // 裂罅占位 id（D-162）：保留，真实数据在下一段恢复
    if (id === RIVEN_SLOT_ID) { modSlots[i] = id; continue; }
    modSlots[i] = id && data && data.modById.get(id) ? id : null;
  }
  // 劣化槽只认本武器能装的劣化 Mod。
  //
  // 需求方 2026-11-13：劣化槽资格改成官方 `isUtility` 口径后，旧存档里可能有卡不再符合
  // （例如烈焰风暴 +爆炸范围）——**直接卸下，不出提示**。
  store.exilusModId = src.exilus && data && data.modById.get(src.exilus) && isExilusMod(data.modById.get(src.exilus))
    ? src.exilus
    : null;
  // 赋能槽只认本武器大类的赋能；守护 / 同伴武器一律不认（需求方 2026-11-12）
  store.arcaneKey = !arcanesDisabled() && src.arcane && data && data.arcaneByKey && data.arcaneByKey.get(src.arcane) ? src.arcane : null;

  // ── 模式与攻击方式 ──
  const ui = (saved && saved.ui) || {};
  const modes = (w && w.modes) || [];
  const idx = Number(ui.modeIndex);
  state.modeIndex = Number.isInteger(idx) && idx >= 0 && idx < modes.length ? idx : 0;
  const sel = Array.isArray(ui.selectedVariants) ? ui.selectedVariants.filter(function (v) {
    return Number.isInteger(v) && v >= 0;
  }) : null;
  state.selectedVariants = sel && sel.length ? sel : null;

  // ── 配置区（D-157：只恢复跟"算出来的数"有关的项）──
  //
  // ⚠ 每项都**先回默认、存档里有合法值才覆盖**（需求方 2026-11-18）。
  //   以前这里写的是「有值才覆盖」——那等于**沿用上一把武器的值**：
  //   在 A 枪开了爆头，切到从没存过的 B 枪，B 枪会接着显示开爆头。
  //   这与 `dotWindowSeconds` 当年修的是同一个毛病（见下方那段说明）。
  // 没有存档项 → 回到"无派系"，而不是沿用上一把枪的派系
  state.faction = 'none';
  if (FACTION_OPTIONS.some(function (o) { return o[0] === ui.faction; })) state.faction = ui.faction;
  state.headshot = false;
  if (typeof ui.headshot === 'boolean') state.headshot = ui.headshot;
  state.headshotMult = 3;
  if ([1, 2, 3].indexOf(Number(ui.headshotMult)) >= 0) state.headshotMult = Number(ui.headshotMult);
  state.kuvaType = 'none';
  if (KUVA_ELEMENTS.indexOf(ui.kuvaType) >= 0) state.kuvaType = ui.kuvaType;
  // 玄骸滑条有上下限（25%~60%），默认取中间值 60%
  state.kuvaRatio = 0.6;
  if (Number.isFinite(Number(ui.kuvaRatio))) {
    state.kuvaRatio = Math.min(0.6, Math.max(0.25, Number(ui.kuvaRatio)));
  }
  state.coStatusTypes = 0;
  if (Number.isFinite(Number(ui.coStatusTypes))) state.coStatusTypes = Math.max(0, Math.floor(Number(ui.coStatusTypes)));
  // ⚠ `coStacks` / `coFreezeStacks` **不在这里重置**：它们的默认值是「叠层上限」，
  //   由 `coDefaults()` 在 boot 与切枪时按当前武器填（D-112 / D-117）。
  //   这里只覆盖存档里的合法值，没存过就交给调用方填默认。
  if (Number.isFinite(Number(ui.coStacks))) state.coStacks = Math.max(0, Math.floor(Number(ui.coStacks)));
  if (Number.isFinite(Number(ui.coFreezeStacks))) state.coFreezeStacks = Math.max(0, Math.floor(Number(ui.coFreezeStacks)));
  // 需求方 2026-11-13：连击倍率 1~13，爆发层数 1~13（越界夹回去，缺省回默认值）
  if (Number.isFinite(Number(ui.comboMultiplier))) {
    state.comboMultiplier = Math.min(MAX_COMBO_MULTIPLIER, Math.max(1, Math.round(Number(ui.comboMultiplier))));
  } else {
    state.comboMultiplier = 12;
  }
  if (Number.isFinite(Number(ui.burstStacks))) {
    state.burstStacks = Math.min(MAX_BURST_STACKS, Math.max(1, Math.round(Number(ui.burstStacks))));
  } else {
    state.burstStacks = DEFAULT_BURST_STACKS;
  }
  // D-171：窗口秒数只认 1~6。
  //
  // ⚠ 修过的 bug（需求方 2026-11-13：「换武器时没有触发读取这个秒数？我换来换去都是 1 秒」）：
  //   以前这里写的是「旧存档没有这个字段就保持默认 6 秒」——**保持**等于**沿用上一把枪的值**，
  //   于是从 A 枪（比如 4 秒）换到从没存过秒数的 B 枪，B 枪会跟着显示 4 秒，
  //   下一次存档还把 4 写进 B 枪的档案，越滚越乱。
  //   现在：**每次恢复都先回到默认 6 秒**，存档里有合法值才覆盖。
  state.dotWindowSeconds = DEFAULT_DOT_WINDOW_SECONDS;
  const win = Math.round(Number(ui.dotWindowSeconds));
  if (Number.isFinite(win) && win >= DOT_WINDOW_MIN_SECONDS && win <= DOT_WINDOW_MAX_SECONDS) {
    state.dotWindowSeconds = win;
  }

  // ── 裂罅（D-162）──
  // 存档里带 riven 就恢复它；词条按当前武器的词条表核对，对不上的丢掉。
  // 槽位里的裂罅占位 id 若同时存在但没有 riven 数据，就把占位也清掉（避免空壳）。
  store.riven = restoreRiven(saved && saved.riven);
  if (!store.riven) {
    const i = rivenInstalledSlot();
    if (i >= 0) modSlots[i] = null;
  }

  return Boolean(saved);
}

/**
 * 从存档恢复一张裂罅（D-162）。
 *
 * 存档是旧数据：词条表可能已经变了（例如只做步枪 → 以后补别的类），
 * 所以逐条核对「这个 key 在**当前武器这一类**的词条表里还存不存在」，查不到就丢弃该条。
 */
function restoreRiven(saved) {
  if (!saved || typeof saved !== 'object') return null;
  const table = rivenTableNow();
  if (!table) return null; // 这类武器还没有裂罅数据
  const comboIds = RIVEN_COMBOS.map(function (c) { return c.id; });
  const combo = comboIds.indexOf(saved.combo) >= 0 ? saved.combo : '2pos';
  const entries = [];
  if (Array.isArray(saved.entries)) {
    for (const e of saved.entries) {
      if (!e || typeof e.key !== 'string' || !e.key) { entries.push(null); continue; }
      const def = rivenDefOf(table, e.key);
      if (!def) { entries.push(null); continue; }
      const v = Number(e.value);
      entries.push({ key: e.key, value: Number.isFinite(v) && v >= 0 ? v : 0 });
    }
  }
  return { combo, entries };
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
 * 普通 Mod 槽：放 Mod，或作为已有 Mod 的换位/插入目标。
 *
 * 槽里也可能是**裂罅**（D-162）：槽里存占位 id {@link RIVEN_SLOT_ID}，
 * 显示成紫色卡，整张卡只显示一条「整卡收益」，词条小标签也走裂罅的紫色样式。
 */
function modSlotCard(index) {
  const card = el('div', 'slot');
  card.append(el('div', 'slot-title', '槽位 ' + (index + 1)));
  const body = el('div', 'slot-body');
  const id = modSlots[index];

  if (id === RIVEN_SLOT_ID) {
    // ── 裂罅卡（D-162）──
    card.className += ' riven';
    const rivenChips = rivenSlotChips();
    body.append(el('div', 'slot-name', '裂罅 Mod'));
    if (rivenChips.length) {
      const wrap = el('div', 'slot-stats');
      for (const c of rivenChips) wrap.append(c);
      body.append(wrap);
    }
    const g = gainBadge(rivenGain());
    if (g) body.append(g);
    // 拖出槽位 = 卸下（D-040）；下方裂罅区那张也随之可以再拖上去
    makeDraggable(card, { kind: 'riven', from: 'slot', index: index });
  } else if (id) {
    const mod = store.data.modById.get(id);
    body.append(el('div', 'slot-name', modName(mod)));
    // 需求方 2026-11-13：「劣化 mod 有单独的 tag」——可进劣化槽的卡在普通槽里也标出来
    if (mod && mod.exilus === true) body.append(el('span', 'tag', '劣化'));
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

/** 裂罅卡上的词条小标签（紫色样式，与普通 Mod 的 `slot-stat` 区分） */
function rivenSlotChips() {
  const out = [];
  const table = rivenTableNow();
  const r = store.riven;
  if (!table || !r) return out;
  const combo = rivenComboNow();
  for (let i = 0; i < r.entries.length; i++) {
    const e = r.entries[i];
    if (!e || !e.key) continue;
    const def = rivenDefOf(table, e.key);
    if (!def) continue;
    const kind = i < combo.pos ? 'pos' : 'neg';
    out.push(el('span', 'slot-stat riven-stat', def.label + ' ' + formatRivenValue(def, kind, rivenValueFor(def, kind, e.value))));
  }
  return out;
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

  // 需求方 2026-11-12：「守护武器的赋能槽禁用掉」→ 槽留着占位，灰掉、不收拖拽、不给装
  // ⚠ 判定必须在上面的空卡判断**之前**：空卡会走 `return card`，
  //   把禁用分支放到后面就永远走不到（页面 shim 没有 CSS，`className` 要直接写）。
  if (arcanesDisabled()) {
    card.className += ' disabled';
    body.append(el('div', 'slot-empty', '不可装赋能'));
    card.append(body);
    return card;
  }

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
  // 需求方 2026-11-12：守护 / 同伴武器没有赋能槽，不许放
  if (arcanesDisabled()) return false;
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
  if (arcanesDisabled()) {
    flash('守护 / 同伴武器不能装赋能');
    return;
  }
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
  // 裂罅（D-162）：已经装进某个槽时，**不允许再从下方拖上去**——它是同一个实体，
  // 再拖一次没有意义（需求方：「下面拖上去以后下方的实体就不允许拖动上去了」）。
  // 允许在槽位之间挪动（从槽 A 拖到槽 B），等价于换位置。
  if (payload.kind === 'riven') {
    if (payload.from === 'slot') return payload.index !== targetIndex;
    // from 'riven'（下方裂罅区拖来的）：已经装了就不收
    return !isRivenInstalled();
  }
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
  // ── 裂罅（D-162）──
  if (payload.kind === 'riven') {
    if (payload.from === 'slot') {
      if (payload.index === targetIndex) return;
      swapSlots(payload.index, targetIndex);
      renderAll();
      return;
    }
    // 从下方裂罅区拖上去：已经装了就不收（同一个实体）
    if (isRivenInstalled()) {
      flash('裂罅只能装一张：先把槽位里那张卸下');
      return;
    }
    if (!store.riven) {
      flash('先在下方裂罅区拼一条词条');
      return;
    }
    insertAt(RIVEN_SLOT_ID, targetIndex);
    renderAll();
    return;
  }

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

  // 槽里原来是裂罅：被普通 Mod 顶掉 = 裂罅卸下（它回到下方裂罅区，仍可再拖上去）
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
    // 弱点暴击率（敏锐主武 / 敏锐手枪）：开爆头时并进暴击率乘区，所以算「暴击」类
    // 依据：核心事实 §3.2（弱点暴击率与普通暴击率同一个乘区）
    else if (stat === 'critChance' || stat === 'critMultiplier' || stat === 'weakpointCritChance') keys.add('crit');
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
 * 模拟"把这张 Mod 装上去"后能得到的贡献，用于计算备选区的增幅（D-169）。
 *
 * 规则（需求方 2026-11-12 选 2A）：
 *   · 功能类 → 放进劣化槽（劣化槽空着就直接放；已占用则返回 null，表示装不上——劣化槽确实只有一格）；
 *   · 普通类 → **临时占一个额外槽位**（`SLOT_COUNT`），不动用户的 8 个槽，
 *     所以**8 槽全满也照样能算增幅**（以前满槽直接返回 null，界面显示「—」）。
 *
 * 放到额外槽位还带来一个正确性上的好处：元素合成按槽位号从小到大配对，
 * 额外槽位排在所有已有槽之后，新卡**不会抢走已有卡的配对对象**，
 * 算出来的就是"多这张卡会怎样"，与用户实际装上它的效果一致。
 */
function simulateEquip(mod, exilus) {
  if (exilus) {
    if (store.exilusModId) return null; // 劣化槽已占用（只有一格，确实装不上）
    const saved = store.exilusModId;
    store.exilusModId = mod.id;
    const c = currentContributions();
    store.exilusModId = saved;
    return c;
  }

  // 临时占一个额外槽位：`currentContributions()` 只遍历 0..SLOT_COUNT-1，
  // 所以这里临时把数组拉长一格再还原。
  const saved = modSlots[SLOT_COUNT];
  modSlots[SLOT_COUNT] = mod.id;
  const c = currentContributions();
  if (saved === undefined) modSlots.length = SLOT_COUNT; else modSlots[SLOT_COUNT] = saved;
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
    // 模拟"装备这张 Mod"（D-169，需求方 2026-11-12 选 2A）：
    // 普通卡**临时占一个额外槽位**，不动用户的 8 个槽，所以满槽也能算出增幅；
    // 额外槽位排在所有已有槽之后，不会抢走已有卡的元素配对对象。
    // D-117：镀层类卡的收益要吃「异况数 × 层数」，走 `coModGain`（配置区不再显示推演小字）
    // 模拟"装备这张 Mod"（D-169，需求方 2026-11-12 选 2A）：
    // 普通卡**临时占一个额外槽位**，不动用户的 8 个槽，所以满槽也能算出增幅；
    // 额外槽位排在所有已有槽之后，不会抢走已有卡的元素配对对象。
    // D-117：镀层类卡的收益要吃「异况数 × 层数」，走 `coModGain`（配置区不再显示推演小字）
    const coGain = coModGain(mod);
    const nextContribs = coGain === null ? simulateEquip(mod, exilus) : null;
    let gain = coGain;
    if (nextContribs) {
      // D-171：DoT 口径下的规则要用「**装上之后**」的配装判断
      //（待选卡还没进配装，用当前配装算合成看不到它的元素）
      // 试算槽号由内核给（需求方 2026-11-15 B2：排在自带 / 玄骸元素之后），不要写死 8
      const own = modToContributions(mod, mod.maxRank, trialSlotNow());
      if (isTotalLikeMetric()) {
        // D-177 / D-180：总量类口径（N 秒总伤 / 稳态秒伤）
        gain = candidateWindowGain(base, nextContribs, own, res);
      } else {
        const after = metricValueOf(runCompute(nextContribs));
        if (isDotWindowMetric() && after > 0 && isDotWindowMetricDetailRoleIsSplit(own, nextContribs)) {
          // D-176：N 秒异常总伤下，元素没形成 DoT 的元素卡只算触发率那部分
          gain = dotGainForCandidate(own, nextContribs, res);
        } else if (baseValue > 0) {
          // 其余口径如实算：包括「加电把火 DoT 打散」这种 −100%
          gain = after / baseValue - 1;
        } else {
          // 当前为 0、装上后 > 0 → 这张卡让该指标从无到有，增幅 +∞
          gain = after > 0 ? INFINITE_GAIN : 0;
        }
      }
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
  // 需求方 2026-11-13：「劣化 mod 有单独的 tag」——可进劣化槽的卡单独标出来
  if (mod.exilus === true) top.append(el('span', 'tag', '劣化'));
  card.append(top);

  const statText = [];
  for (let i = 0; i < mod.stats.length; i++) {
    const s = mod.stats[i];
    // 卡面只显示**会影响结算**的属性：判据是内核键 `contribStat`（不是 `bucket`）。
    // 状态持续（statusDuration）不属于任何伤害乘区（bucket 为 null），但它影响
    // DoT 的存活时长，必须显示——以前按 bucket 判会把它当成「无伤害加成」。
    // 依据：核心事实 §6.3（异常状态持续时间）
    if (!s.bucket && !s.contribStat) continue;
    const max = s.levelValues[s.levelValues.length - 1] * modStackFactor(mod.id);
    statText.push(statLabel(s.stat) + ' ' + modStatText(s, max, mod.descriptionEn));
  }
  for (const note of modLockNotes(mod)) statText.push(note);
  const setNote = setNoteOf(mod);
  if (setNote) statText.push(setNote);
  card.append(el('div', 'cand-stats', statText.join(' · ') || '无伤害加成'));

  const gainEl = el('div', 'cand-gain');
  gainEl.append(el('span', 'gain-label', '增幅'));
  const cls = row.gain === null ? '' : !Number.isFinite(row.gain) ? 'pos' : row.gain >= 0.00005 ? 'pos' : row.gain <= -0.00005 ? 'neg' : '';
  gainEl.append(el('span', 'gain-val ' + cls, fmtGain(row.gain) || '—'));
  // DoT 口径下的 `to dot` 小字（D-171）；N 秒总伤下是加权拼出来的，标 `to total`（D-175）
  if (isDotMetric() && row.gain !== null) gainEl.append(el('span', 'gain-to-dot', 'to dot'));
  else if (isTotalLikeMetric() && row.gain !== null) gainEl.append(el('span', 'gain-to-dot', 'to total'));
  card.append(gainEl);

  card.addEventListener('click', function () { selectDetail({ kind: 'mod', id: mod.id, exilus: row.exilus }); });
  return card;
}







// ─────────────────────────────────────────────────────────────
// 控件
// ─────────────────────────────────────────────────────────────

function renderControls() {
  // 增幅基准：与备选 Mod 的筛选按钮组同一样式（D-042）
  //
  // D-171：两个窗口口径（N 秒异常总伤 / N 秒总伤）的名字要跟着**同一个秒数**走，
  //   否则会出现「基准写着 6 秒、实际按 3 秒算」的错位。
  const metricOptions = metricOptionsFor(state.dotWindowSeconds);
  const mbox = $('#metric-options');
  mbox.innerHTML = '';
  mbox.className = 'filter-group';
  for (let i = 0; i < metricOptions.length; i++) {
    const opt = metricOptions[i];
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
  // D-171：秒数选择器也挂在「增幅基准」这一排上（需求方 2026-11-13）
  renderDotWindowPicker();

  $('#faction-select').value = state.faction;
  $('#kuva-element').value = state.kuvaType;
  // D-157：换枪会恢复每把枪自己的配置，控件必须跟着回填（否则界面上还是上一把的值）
  const ratio = $('#kuva-ratio');
  if (ratio) {
    ratio.value = String(Math.round(state.kuvaRatio * 100));
    const ratioVal = $('#kuva-ratio-val');
    if (ratioVal) ratioVal.textContent = Math.round(state.kuvaRatio * 100) + '%';
  }
  const hsToggle = $('#headshot-toggle');
  if (hsToggle) hsToggle.checked = Boolean(state.headshot);
  const hsMult = $('#headshot-mult');
  if (hsMult) hsMult.value = String(state.headshotMult);
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
  //   （没装时下面的数值全为 0，计算层也不加成；依据：核心事实 §3）
  //
  // 需求方 2026-11-12：「镀层加成要变成配置的次级」——它是**配置区里的第二行**，
  // 不再是一个独立标题块：小标签「镀层」+ 两个控件跟派系、爆头排在同一组里。
  const row = el('span', 'co-row');

  row.append(el('span', 'section-title', '镀层'));

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
    nInput.style.width = '56px';
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
  // 数值本身仍然可复算：每层 % × 异况数 × 层数，见核心事实与 D-112。
  if (fc.active) {
    const n = FROZEN_FULL_STACKS;
    row.append(el('span', 'muted', fc.sources.join('、') + '：每层 ' + fc.perStack + '% × ' + n + ' 层冰冻（固定满层）= ' + (fc.perStack * n) + '%（只吃直接非灵化伤害）'));
  }

  // ── 连击倍率 / 爆发层数（需求方 2026-11-13）──
  //
  // · 近战武器：**始终**显示「连击倍率」框，默认 12x（带凯旋之爪满层 13x）。
  //   急进猛突 / 创口溃烂按它放大（每层 X% × 连击倍率）。
  // · 装上次要·爆发时才显示「爆发层数」框，默认 12 层，最高 13 层。
  const weapon = store.data && store.data.weapon;
  const isMelee = Boolean(weapon && weapon.category === 'melee');
  if (isMelee || burstEquipped()) {
    const row2 = el('span', 'co-row');
    if (isMelee) {
      const label = el('label', '', '连击倍率');
      label.title = '急进猛突 / 创口溃烂为「每层连击倍率 +X%」，按此值放大；凯旋之爪满层为 13x';
      const sel = el('select');
      for (let i = 1; i <= MAX_COMBO_MULTIPLIER; i++) {
        const o = el('option', '', i + 'x');
        o.value = String(i);
        sel.append(o);
      }
      sel.value = String(Math.min(Math.max(1, Math.round(state.comboMultiplier)), MAX_COMBO_MULTIPLIER));
      sel.addEventListener('change', function (e) { state.comboMultiplier = Number(e.target.value); renderAll(); });
      label.append(sel);
      row2.append(label);
    }
    if (burstEquipped()) {
      const label = el('label', '', '爆发层数');
      label.title = '次要·爆发：消耗的连击倍率层数，每层 +20% 暴率 / +20% 暴伤';
      const sel = el('select');
      for (let i = 1; i <= MAX_BURST_STACKS; i++) {
        const o = el('option', '', i + ' 层');
        o.value = String(i);
        sel.append(o);
      }
      sel.value = String(Math.min(Math.max(1, Math.round(state.burstStacks)), MAX_BURST_STACKS));
      sel.addEventListener('change', function (e) { state.burstStacks = Number(e.target.value); renderAll(); });
      label.append(sel);
      row2.append(label);
    }
    box.append(row2);
  }
}

/** 当前是否装备了次要·爆发（`MultishotForCombo`）—— 决定是否显示「爆发层数」框 */
function burstEquipped() {
  return store.arcaneKey === 'MultishotForCombo';
}

/**
 * 「异常状态」外层标题与折叠开关已去掉（需求方 2026-11-12：
 * 「外面的异常状态我觉得可以去掉，不要这一层，就里面两层单独折叠就好了」）。
 * 现在只有「伤害型异常 / 非伤害型异常」两个可折叠块，见 `renderDotDetail`。
 */

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

  // ── 裂罅区（D-162）──
  // 折叠条：点标题或按回车展开/收起
  const rivenToggle = $('#riven-toggle');
  if (rivenToggle) {
    const toggleRiven = function () { state.rivenOpen = !state.rivenOpen; renderAll(); };
    rivenToggle.addEventListener('click', toggleRiven);
    rivenToggle.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRiven(); }
    });
  }
  // 搜索框：只重建待选区，不丢焦点
  const rivenSearch = $('#riven-search');
  if (rivenSearch) {
    rivenSearch.addEventListener('input', function (e) {
      state.rivenSearch = e.target.value;
      const table = rivenTableNow();
      if (table) renderRivenCandidates(table);
    });
  }
  // 清空词条（保留组合，只清掉已选）
  const rivenClear = $('#riven-clear');
  if (rivenClear) {
    rivenClear.addEventListener('click', function () {
      if (!store.riven) return;
      store.riven.entries = [];
      renderAll();
    });
  }

  // ── 裂罅词条的拖拽容器（D-165）──
  // 右栏整块待选区 = 「拖回来卸下」；左栏整块组合区 = 「拖进来放进第一个同类空槽」。
  const rivenCandBox = $('#riven-candidates');
  if (rivenCandBox) {
    rivenCandBox.addEventListener('dragover', function (e) {
      if (!store.dragPayload || store.dragPayload.from === 'riven-list') return;
      e.preventDefault();
      rivenCandBox.classList.add('drop-target');
    });
    rivenCandBox.addEventListener('dragleave', function () { rivenCandBox.classList.remove('drop-target'); });
    rivenCandBox.addEventListener('drop', function (e) {
      e.preventDefault();
      rivenCandBox.classList.remove('drop-target');
      if (!store.dragPayload) return;
      dropHappened = true; // 已在 drop 里处理，dragend 不要重复卸下
      removeByPayload(store.dragPayload);
      store.dragPayload = null;
    });
  }
  const rivenComposeBox = $('#riven-compose');
  if (rivenComposeBox) {
    rivenComposeBox.addEventListener('dragover', function (e) {
      const p = store.dragPayload;
      if (!p || p.kind !== 'rivenStat') return;
      e.preventDefault();
      rivenComposeBox.classList.add('drop-target');
    });
    rivenComposeBox.addEventListener('dragleave', function () { rivenComposeBox.classList.remove('drop-target'); });
    rivenComposeBox.addEventListener('drop', function (e) {
      const p = store.dragPayload;
      if (!p || p.kind !== 'rivenStat') return;
      e.preventDefault();
      rivenComposeBox.classList.remove('drop-target');
      dropHappened = true;
      const target = rivenFirstFreeSlot(p.statKind);
      if (target < 0) {
        flash((p.statKind === 'pos' ? '正面' : '负面') + '词条已经选满');
      } else {
        placeRivenEntry(target, p.key);
      }
      store.dragPayload = null;
      renderAll();
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
  renderRiven();
  renderArcaneList();
  // 不再显示"可装 N 张"（信息噪音），保留元素留空
  $('#slot-info').textContent = '';
  // D-128：拆解挂在渲染**末尾**重算——任何让输出变化的状态（异况/叠层/玄骸/基准/换卡/换枪）
  //        走完 renderAll 后，右边拆解都跟着刷新。以前它只在"点击"时算一次，之后全是旧数。
  renderDetail();
  // D-157：所有改动（装卡 / 卸卡 / 换枪 / 调配置）都会走到这里，所以存档统一挂在这——
  // 放最后，保证存的是**这一轮渲染完**的真实状态。
  persistLoadout();
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
function renderPendingPanel() {
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

/**
 * 赋能列表（D-032 / D-034 / D-123）：按**增幅**从高到低排；「无伤害词条」的排在最后。
 *
 * 需求方 2026-11-06：「赋能也要按收益顺序排列」。
 * 没有增益的卡（收益为 null 或 0）统一垫底，卡上不显示「增幅 —」这种噪音。
 */
function renderArcaneList() {
  const box = $('#arcane-list');
  box.innerHTML = '';
  // 需求方 2026-11-12：「守护武器的赋能槽禁用掉」→ 这把枪没有赋能槽时，赋能用不上，
  // 右侧「赋能」整块（含列表）一起收起，不留一个能拖但拖不进去的空列表。
  const area = $('#arcane-area');
  if (area) area.hidden = arcanesDisabled();
  if (arcanesDisabled()) {
    $('#arcane-count').textContent = '';
    return;
  }
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
  // 需求方 2026-11-13：叠加类赋能不再只显示「每层值」——
  // 卡面上写满层值，数值与计算一致（霜冻 / 毒侵 / 电压 / 耀炎）。
  const stacks = arcaneStackLabel(arc);
  if (stacks) out.push(el('span', 'slot-stat slot-stack', stacks));
  return out;
}


/**
 * 叠加类赋能的「满层」说明（需求方 2026-11-13：「叠加类赋能不再只显示单层，要显示满层」）。
 *
 * 这些赋能的**数值已经是满层值**（每层值 × 层数，见 `arcaneStackCount`），
 * 只是卡面上以前看起来像单层值，所以补一句"满层"的来源说明。
 */
function arcaneStackLabel(arc) {
  const STACKED = { PrimaryCritDmgAndMultishotOnColdProc: 40, PrimaryHeadshotCritMultOnHeadshot: 40, SecondaryReloadSpeedAndMultishotOnElectricProc: 40, SecondaryDamageOnHeatProc: 40 };
  const n = STACKED[arc.key];
  if (!n) return '';
  return '满层 ' + n + ' 层';
}

/**
 * 赋能装上后的增幅（D-116）：与已装卡的 `gainOf` 同口径，
 * 只是在当前贡献列表上**追加**这个赋能的贡献再比较，而不是从配置里拿掉。
 *
 * ⚠ D-126（需求方 2026-11-06 纠正）：**只算当前选中的口径**，不敏感就是 +0.00%。
 *   上一轮（D-124）曾在增幅为 0 时改用"最敏感口径"的数显示，那是错的——
 *   那个数不属于当前口径（默认「单次射击」下准星的弹药效率本来就不该有收益），
 *   卡上显示它等于凭空多报收益。要看弹药效率的效果：把基准切到「续航秒伤」，
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
  // 把外壳能力注入裂罅模块（避免互相 import 成环）
  wireRivenDeps({ rerender: renderAll, makeDraggable: makeDraggable, simulateEquip: simulateEquip });
  wireDetailDeps({
    rerender: renderAll,
    effectiveMode: effectiveMode,
    selectedVariantIdx: selectedVariantIdx,
    simulateEquip: simulateEquip,
  });
  // D-093：所有类别的武器都加载进来，供切换用（当前只有"主要"可选）
  // 取数细节在 app-data.js 的 loadAllWeapons()
  setDataAll(await loadAllWeapons(groupWeapons));

  // D-157（需求方 2026-11-12）：刷新页面要回到**上次的那把枪和那套配卡**。
  //   · 存档里有上次的武器、而且它现在还在数据里 → 打开它；
  //   · 否则（没存档 / 那把枪被删了）→ 用默认的"主要 → 步枪第一把"。
  const savedId = lastWeaponId();
  const resumeId = savedId && store.dataAll && store.dataAll.weaponById.get(savedId) ? savedId : null;
  const firstId = resumeId || defaultWeaponId();
  const firstW = store.dataAll && store.dataAll.weaponById.get(firstId);
  await loadWeapon(firstId, firstDisplayMode(firstW));
  // 恢复配卡；`getSavedLoadout` 为 null 时 `restoreLoadout` 只做"清空 + 默认"
  restoreLoadout(getSavedLoadout(firstId));

  // D-169（需求方 2026-11-12）：选单必须**在武器装好之后再画**。
  //   以前这里排在 `loadWeapon` 之前，画的时候还没有"当前武器"可比：
  //   大类被写死"主要"、类型栏落在第一个类型、武器栏跟着选第一个——
  //   于是刷新后明明算的是上次那把枪，三个下拉却显示重置后的默认值。
  renderWeaponPicker();

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

  // D-157：控件回填**恢复后的**值（否则存档里的派系 / 玄骸元素在界面上看不到）
  fsel.value = state.faction;
  ksel.value = state.kuvaType;
  $('#kuva-ratio').value = String(Math.round(state.kuvaRatio * 100));
  $('#kuva-ratio-val').textContent = Math.round(state.kuvaRatio * 100) + '%';
  $('#headshot-mult').value = String(state.headshotMult);
  $('#headshot-toggle').checked = Boolean(state.headshot);

  wireControls();
  // 外层「异常状态」折叠开关已去掉（D-156 修订，需求方 2026-11-12）：只有内部两个块各自折叠
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
  // 默认停在大类：**当前武器所在的大类**（D-169），没有当前武器才回到"主要"。
  // 以前写死 'primary'，刷新到一把近战时大类栏还停在"主要"，
  // 类型栏就被画成主要下的第一个类型，三个下拉与真实武器全对不上。
  gsel.value = currentWeaponGroupId() || 'primary';
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

  // 类型栏按上面选中的大类画（它自己会停在当前武器所属的类型，D-097），武器栏再同步到当前武器
  renderTypeOptions(gsel.value);
  wireWeaponSearch();
}

/**
 * 当前武器落在选单的哪个大类（D-169）。
 *
 * 判据与 `switchWeapon()` 里回写大类用的是同一个（`weaponGroupId`），
 * 保证"启动时预选的大类"和"换枪后回写的大类"永远一致。
 * 没有当前武器 / 找不到归属 → null（调用方回退到"主要"）。
 */
function currentWeaponGroupId() {
  const weapon = store.dataAll && store.data && store.data.weapon;
  if (!weapon) return null;
  return weaponGroupId(weapon, store.data && store.data.slotEntry) || null;
}

/**
 * 搜索框（D-151）：**全部四类**一起搜，结果浮在搜索框下方，像搜索引擎那样列出来。
 *
 * 需求方 2026-11-13：
 * > 「ui搜索结果改一下，应该是搜索框下面列出结果，就像搜索引擎那样。
 * >  现在变成输入以后筛选了，这不对。」→ 选 A：搜全部四类，结果面板每行标明
 * >  「中文名 · 类型 · 大类」，点哪把就把上面的大类/类型/弹道下拉跳过去。
 *
 * 关键：**打字时一个字都不动下拉框**——那是"当前武器"的选择器，内容一变，
 * 选中的枪就跟着丢（旧实现把命中项塞进下拉框，才显得像"筛选"）。
 */
function wireWeaponSearch() {
  const input = $('#weapon-search');
  const panel = $('#weapon-search-panel');
  if (!input || !panel) return;

  input.addEventListener('input', function () { renderSearchResults(input.value); });
  input.addEventListener('focus', function () {
    if (String(input.value || '').trim()) renderSearchResults(input.value);
  });
  input.addEventListener('keydown', function (e) {
    const key = e.key;
    if (key === 'Escape') { closeSearchPanel(); return; }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      if (!hitsShown) return;
      if (typeof e.preventDefault === 'function') e.preventDefault();
      moveSearchActive(key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (key === 'Enter') {
      const hit = searchHits[searchActiveIndex];
      if (hit) pickSearchResult(hit.id);
    }
  });
  // 点面板以外的地方收起（面板内的点击由结果行自己处理）
  document.addEventListener('mousedown', function (e) {
    if (!isSearchPanelOpen()) return;
    const t = e && e.target;
    if (t === input || (panel.contains && panel.contains(t))) return;
    closeSearchPanel();
  });
}

/** 上一次渲染的命中项（键盘上下移动用） */
let searchHits = [];
/** 键盘高亮的行号（-1 = 没有高亮） */
let searchActiveIndex = -1;
/** 面板当前是否开着 */
let hitsShown = false;

function isSearchPanelOpen() {
  const panel = $('#weapon-search-panel');
  return Boolean(panel) && panel.hidden !== true;
}

function closeSearchPanel() {
  const panel = $('#weapon-search-panel');
  if (!panel) return;
  panel.hidden = true;
  hitsShown = false;
  searchActiveIndex = -1;
}

/**
 * 按关键字重画结果面板（**只动画板，不碰下拉框**）。
 * 关键字为空或没有命中时收起面板。
 */
function renderSearchResults(keyword) {
  const panel = $('#weapon-search-panel');
  if (!panel) return;
  const hits = searchWeapons(store.dataAll.weapons, keyword);
  if (!String(keyword || '').trim() || !hits.length) {
    closeSearchPanel();
    panel.innerHTML = '';
    searchHits = [];
    return;
  }

  searchHits = hits;
  searchActiveIndex = -1;
  panel.innerHTML = '';

  // 汇总：「主 3 · 次 1 · 近战 2」——一眼看到命中的都在哪些大类
  const counts = new Map();
  const rows = [];
  for (const g of WEAPON_GROUPS) {
    // 守护 / 同伴武器的大类看槽位宽类，必须把 weapon-slots 记录一起传（需求方 2026-11-12）
    const list = hits.filter(function (w) { return weaponGroupId(w, slotOf(w.id)) === g.id; });
    if (list.length) counts.set(g.id, list.length);
    rows.push.apply(rows, list);
  }
  const parts = [];
  for (const [gid, n] of counts) {
    const g = WEAPON_GROUPS.find(function (x) { return x.id === gid; });
    parts.push((g ? g.label : gid) + ' ' + n);
  }
  panel.append(el('div', 'search-summary', '共 ' + hits.length + ' 项 · ' + parts.join(' · ')));

  // 最多列 20 条（再多也没人翻），超出时末尾注明
  const LIMIT = 20;
  const shownRows = rows.slice(0, LIMIT);
  for (let i = 0; i < shownRows.length; i++) {
    const w = shownRows[i];
    const btn = el('button', 'search-item');
    btn.type = 'button';
    btn.dataset.weaponId = w.id;
    btn.title = weaponLabel(w) + '（' + String(w.name || '') + '）';
    btn.append(el('span', 'search-item-name', weaponLabel(w)));
    btn.append(el('span', 'search-item-meta', searchMetaOf(w)));
    btn.addEventListener('click', (function (id) {
      return function () { pickSearchResult(id); };
    })(w.id));
    // 鼠标移上去 = 键盘高亮跟着走，两种操作不打架
    btn.addEventListener('mouseenter', (function (k) {
      return function () { setSearchActive(k); };
    })(i));
    panel.append(btn);
  }
  if (rows.length > LIMIT) {
    panel.append(el('div', 'search-empty', '… 还有 ' + (rows.length - LIMIT) + ' 个，请多输几个字'));
  }
  panel.hidden = false;
  hitsShown = true;
}

/** 结果行的副标注：类型 · 大类 */
function searchMetaOf(w) {
  const loc = locateWeapon(store.dataAll.groups, w.id);
  if (!loc) return '';
  return loc.typeLabel + ' · ' + loc.groupLabel;
}

function setSearchActive(i) {
  const panel = $('#weapon-search-panel');
  if (!panel) return;
  const items = panel.children.filter(function (c) { return c.className === 'search-item'; });
  for (let k = 0; k < items.length; k++) items[k].classList.toggle('active', k === i);
  searchActiveIndex = i;
}

function moveSearchActive(delta) {
  const n = Math.min(searchHits.length, 20);
  if (!n) return;
  let next = searchActiveIndex + delta;
  if (next < 0) next = n - 1;
  if (next >= n) next = 0;
  setSearchActive(next);
}

/**
 * 点选一条搜索结果：清空搜索框、收起面板、切枪。
 * 下拉框在 `switchWeapon` 里跟着跳到那把枪所在的分类（D-119 的既有行为）。
 */
function pickSearchResult(weaponId) {
  const input = $('#weapon-search');
  if (input) input.value = '';
  searchHits = [];
  closeSearchPanel();
  const panel = $('#weapon-search-panel');
  if (panel) panel.innerHTML = '';
  switchWeapon(weaponId).catch(function (e) { console.error('[switchWeapon]', e); });
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
    const o = el('option', '', weaponLabel(w));
    o.value = w.id;
    wsel.append(o);
  }
  wsel.onchange = function () { switchWeapon(wsel.value); };
  // 选中值必须等于 store.data.weapon（D-097）：在列表里就选它，不在就补一项"（当前）"。
  // 绝不在这里"默认选第一项"——那会造成"选单显示 A、实际在算 B"。
  syncWeaponSelect();
}

/** 名称搜索结果（D-151：实现在 `wireWeaponSearch` 附近，画到搜索框下方的面板里） */

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


  // 清空配置：换枪后原来的 Mod 可能已不适用。
  // D-157 之后紧跟着 `restoreLoadout`：这把枪以前存过就把它的配卡放回来，没存过就保持清空。
  for (let i = 0; i < SLOT_COUNT; i++) modSlots[i] = null;
  store.exilusModId = null;
  store.arcaneKey = null;
  // 换枪后右侧拆解必须回到提示文案：`detailTarget` 记的是**上一把枪**上的那张卡，
  // 不清掉会继续显示旧武器的「输出口径」表（本次重跑数据暴露出来的既有缺陷）。
  // 只重置目标、不改渲染逻辑——拆解区本来就靠 `detailTarget === null` 显示占位文案。
  clearDetailTarget();

  await loadWeapon(weaponId);
  // D-157：换到这把枪 → 换到**它自己的**配卡；从没存过就是空配卡
  restoreLoadout(getSavedLoadout(weaponId));
  // D-119：四个大类都开放了，换枪后让"大类"下拉停在**当前武器所在的大类**
  // （例如从选单直接切到一把近战，大类不应还停在"主要"）
  const groupSel = $('#weapon-group');
  const groupOf = currentWeaponGroupId();
  if (groupSel && groupOf) groupSel.value = groupOf;
  // D-151：搜索能跨大类直接选枪，所以「类型」栏必须跟着换到新武器所在类型
  // （以前只 renderWeaponOptions 当前类型，跨大类时类型栏会停在一个不属于该大类的类型上）。
  // 用 locateWeapon 而不是看 weaponGroupId：显赫刀剑这类"文件类别与槽位类别不一致"的武器，
  // 在类型树里的落点是 `groupWeapons` 判出来的，不是 category。
  const typeSel = $('#weapon-type');
  const loc = store.dataAll && locateWeapon(store.dataAll.groups, weaponId);
  if (typeSel && loc && loc.groupId === (groupSel ? groupSel.value : loc.groupId)) typeSel.value = loc.typeKey;
  // 弹道栏若正筛着别的扳机，从搜索结果跳过来的这把会不在列表里 → 回到"全部弹道"
  const styleSel = $('#weapon-style');
  if (styleSel && styleSel.value !== 'all' && !weaponMatchesStyle(weapon, styleSel.value)) styleSel.value = 'all';
  renderWeaponOptions($('#weapon-group').value, $('#weapon-type').value);
  renderAll();
  // 依据：核心事实 §10（刷新后回到上次的武器与配卡）。
  //   换枪流程先 persistLoadout() 存**旧枪**，再 loadWeapon 换新枪；
  //   renderAll 末尾那次 persistLoadout() 用的还是换枪前的材料，
  //   所以这里必须再存一次，把「上次是哪把枪」落到新武器上。
  persistLoadout();
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
  const opt = el('option', '', weaponLabel(w) + '（当前）');
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

// 校对脚本（`packages/demo/src/checks/*.mjs`）通过它切枪：页面里没有"换武器"的 DOM 控件可以点，
// 而 `switchWeapon` 是模块私有函数。只暴露这一个写入口，不改变页面行为。
window.__wfcalcSwitchWeapon = switchWeapon;

