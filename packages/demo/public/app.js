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
import { defaultWeaponId, renderWeaponOptions, renderWeaponPicker, syncWeaponSelect, wireWeaponDeps } from './ui-weapon.js';
import { MAX_COMBO_MULTIPLIER, WINDOW_SECONDS, renderCoControls, renderControls, renderKuvaVisibility, renderModeSwitch, wireControls, wireControlsDeps } from './ui-controls.js';
import { candidateCardAccepts, matchesFilter, renderCandidates, renderFilterButtons, wireCandidatesDeps } from './ui-candidates.js';
import { makeDraggable, makeDropTarget, renderSlots, setDropHappened, slotAcceptsMod, wireSlotsDeps } from './ui-slots.js';
import { arcaneStatChips, coSlotGain, gainBadge, rivenSlotChips, statChips, wireChipsDeps } from './ui-chips.js';
import { wirePanelDeps, currentMode, effectiveMode, renderPageTitle, renderPanel, renderPendingPanel, selectedVariantIdx } from './ui-panel.js';
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


// ─────────────────────────────────────────────────────────────
// 顶部
// ─────────────────────────────────────────────────────────────


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


/** 模式名的中文 */

/**
 * 扳机的中文名（D-148）。
 *
 * 需求方 2026-11-11 规则 8：「UI 要显示当前模式的扳机与伤害判定类型」。
 * 射线唯一判据就是扳机 `held`，所以界面直接把扳机标出来。
 */


// ─────────────────────────────────────────────────────────────
// 左侧面板
// ─────────────────────────────────────────────────────────────








/** 「N 秒」窗口的候选秒数（D-171：需求方 2026-11-13「6 后面就不要了」） */

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





// ─────────────────────────────────────────────────────────────
// 槽位（Mod / 劣化 / 赋能），全部可拖拽
// ─────────────────────────────────────────────────────────────




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









// ─────────────────────────────────────────────────────────────
// 控件
// ─────────────────────────────────────────────────────────────




/** 当前是否装备了次要·爆发（`MultishotForCombo`）—— 决定是否显示「爆发层数」框 */
function burstEquipped() {
  return store.arcaneKey === 'MultishotForCombo';
}

/**
 * 「异常状态」外层标题与折叠开关已去掉（需求方 2026-11-12：
 * 「外面的异常状态我觉得可以去掉，不要这一层，就里面两层单独折叠就好了」）。
 * 现在只有「伤害型异常 / 非伤害型异常」两个可折叠块，见 `renderDotDetail`。
 */


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
  wireWeaponDeps({
    switchWeapon: switchWeapon,
    slotOf: slotOf,
    currentWeaponGroupId: currentWeaponGroupId,
  });
  wireControlsDeps({
    burstEquipped: burstEquipped,
    isVariantSelected: isVariantSelected,
    removeByPayload: removeByPayload,
    renderAll: renderAll,
    renderDotWindowPicker: renderDotWindowPicker,
    renderFilterButtons: renderFilterButtons,
    toggleVariant: toggleVariant,
    unequipAllMods: unequipAllMods,
  });
  wireCandidatesDeps({
    candidateWindowGain: candidateWindowGain,
    insertAt: insertAt,
    isDotWindowMetric: isDotWindowMetric,
    isDotWindowMetricDetailRoleIsSplit: isDotWindowMetricDetailRoleIsSplit,
    renderAll: renderAll,
    simulateEquip: simulateEquip,
    swapWithCandidateCard: swapWithCandidateCard,
  });
  wireSlotsDeps({
    arcaneSlotAccepts: arcaneSlotAccepts,
    arcanesDisabled: arcanesDisabled,
    dropOnExilus: dropOnExilus,
    insertAt: insertAt,
    removeByPayload: removeByPayload,
    renderAll: renderAll,
    swapSlots: swapSlots,
  });
  wireChipsDeps({ arcaneStackLabel: arcaneStackLabel });
  wirePanelDeps({ rerender: renderAll, flash: flash });
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


/** 上一次渲染的命中项（键盘上下移动用） */
/** 键盘高亮的行号（-1 = 没有高亮） */
/** 面板当前是否开着 */










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
 * 加载一把武器：建 store.data、重置模式索引、重算可装 Mod（取数细节在 app-data.js）
 *
 * D-117：「叠加层数」的默认值（叠层上限）在这里跟着武器重填——每把武器能装的镀层卡
 * 叠层上限可能不同，而且 0 现在是合法的"0 层"，不能再靠"0 = 未指定"来取默认值。
 */
async function loadWeapon(weaponId, modeId) {
  setData(buildWeaponData(weaponId, { modeId: modeId || MODE_ID }));
  state.coStacks = coDefaults().stacks;
}


boot().catch(function (err) {
  console.error(err);
  document.body.innerHTML = '<pre style="color:#e06060;padding:24px">' + (err.stack || err) + '</pre>';
});

// 校对脚本（`packages/demo/src/checks/*.mjs`）通过它切枪：页面里没有"换武器"的 DOM 控件可以点，
// 而 `switchWeapon` 是模块私有函数。只暴露这一个写入口，不改变页面行为。
window.__wfcalcSwitchWeapon = switchWeapon;

