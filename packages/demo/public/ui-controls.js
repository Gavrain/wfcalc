/**
 * 配置区控件：玄骸元素 / 镀层层数 / 射击模式 / 爆头 / N 秒窗口。
 *
 * 控件只改 `store.ui` 里的字段，改完调 `_renderAll()` 重画；
 * 口径换算在 `app-compute` 与内核，这里不碰。
 *
 * ⚠ 注入必须**成套**：`wireControlsDeps()` 里少给一项不会报错，
 *   只会让对应功能静默失效。缺项时这里会打 `console.error`。
 */
import { store } from './app-store.js';
import { FROZEN_FULL_STACKS, KUVA_ELEMENTS } from './app-store.js';
import { $, el, flash } from './ui-dom.js';
import { coInfo, freezeInfo } from './app-compute.js';
import { metricOptionsFor } from '../../core/src/index.ts';
import { currentMode } from './ui-panel.js';
import { setDropHappened } from './ui-slots.js';
import { renderRivenCandidates, rivenFirstFreeSlot } from './ui-riven.js';

/** 外壳注入（缺一不可） */
const injected = {
  burstEquipped: () => null,
  isVariantSelected: () => null,
  removeByPayload: () => null,
  renderAll: () => null,
  renderDotWindowPicker: () => null,
  renderFilterButtons: () => null,
  toggleVariant: () => null,
  unequipAllMods: () => null,
};

export function wireControlsDeps(deps) {
  const missing = Object.keys(injected).filter((k) => typeof deps[k] !== 'function');
  if (missing.length) console.error('[ui-controls] 缺少注入：' + missing.join(', '));
  for (const k of Object.keys(injected)) {
    if (typeof deps[k] === 'function') injected[k] = deps[k];
  }
}

function _burstEquipped(...args) { return injected.burstEquipped(...args); }
function _isVariantSelected(...args) { return injected.isVariantSelected(...args); }
function _removeByPayload(...args) { return injected.removeByPayload(...args); }
function _renderAll(...args) { return injected.renderAll(...args); }
function _renderDotWindowPicker(...args) { return injected.renderDotWindowPicker(...args); }
function _renderFilterButtons(...args) { return injected.renderFilterButtons(...args); }
function _toggleVariant(...args) { return injected.toggleVariant(...args); }
function _unequipAllMods(...args) { return injected.unequipAllMods(...args); }

const MODE_LABEL = {
  primary: '普通',
  mode2: '副模式',
  charged: '蓄力',
  alt: '切换',
  incarnon: '灵化',
};

const TRIGGER_ZH = {
  auto: '全自动',
  semi: '半自动',
  burst: '点射',
  charge: '蓄力',
  held: '射线',
  active: '激活',
  unknown: '未知',
};

export const MAX_COMBO_MULTIPLIER = 13;

export const WINDOW_SECONDS = [1, 2, 3, 4, 5, 6];

export function renderCoControls() {
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
    nInput.value = String(store.ui.coStatusTypes);
    nInput.style.width = '56px';
    nInput.addEventListener('input', function (e) {
      const v = Number(e.target.value);
      store.ui.coStatusTypes = Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
      store.ui.coPreview = true;
      _renderAll();
    });
    nLabel.append(nInput);
    row.append(nLabel);
  }

  if (co.active) {
    // 装了镀层类 Mod：可选 0 ~ 叠层上限。`store.ui.coStacks = 0` 现在是**真正的 0 层**（D-117），
    // 不再是「未指定，取上限」——默认值在 store 里是上限（见 app-store.js 的 coStacksDefault）
    const yLabel = el('label', '', '叠加层数');
    const ySel = el('select');
    for (let i = 0; i <= co.maxStacks; i++) {
      const o = el('option', '', String(i));
      o.value = String(i);
      ySel.append(o);
    }
    ySel.value = String(Math.min(store.ui.coStacks, co.maxStacks));
    ySel.addEventListener('change', function (e) { store.ui.coStacks = Number(e.target.value); _renderAll(); });
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
    ySel.value = String(Math.min(store.ui.coStacks, maxY));
    ySel.addEventListener('change', function (e) {
      store.ui.coStacks = Number(e.target.value);
      store.ui.coPreview = true;
      _renderAll();
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
  if (isMelee || _burstEquipped()) {
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
      sel.value = String(Math.min(Math.max(1, Math.round(store.ui.comboMultiplier)), MAX_COMBO_MULTIPLIER));
      sel.addEventListener('change', function (e) { store.ui.comboMultiplier = Number(e.target.value); _renderAll(); });
      label.append(sel);
      row2.append(label);
    }
    if (_burstEquipped()) {
      const label = el('label', '', '爆发层数');
      label.title = '次要·爆发：消耗的连击倍率层数，每层 +20% 暴率 / +20% 暴伤';
      const sel = el('select');
      for (let i = 1; i <= MAX_BURST_STACKS; i++) {
        const o = el('option', '', i + ' 层');
        o.value = String(i);
        sel.append(o);
      }
      sel.value = String(Math.min(Math.max(1, Math.round(store.ui.burstStacks)), MAX_BURST_STACKS));
      sel.addEventListener('change', function (e) { store.ui.burstStacks = Number(e.target.value); _renderAll(); });
      label.append(sel);
      row2.append(label);
    }
    box.append(row2);
  }
}

/**
 * 多面板武器的模式切换（D-042）：在「武器面板」标题右侧一排按钮。
 * 单模式武器不显示切换栏。
 *
 * D-080：模式内的**面板变体**（直接命中 / 爆炸）作为第二排按钮。
 * 命中与爆炸不再挤在同一个面板里，而是各自独立成一个面板、独立配装；
 * 单变体模式不显示第二排。
 */
export function renderModeSwitch() {
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
      const btn = el('button', 'mode-btn' + (i === store.ui.modeIndex ? ' active' : ''), m._label || MODE_LABEL[m.id] || m.id);
      btn.type = 'button';
      btn.title = (m._label ? m._label + ' · ' : '') + m.id + ' · ' + (TRIGGER_ZH[m.trigger] || m.trigger) + (m._note ? '\n' + m._note : '');
      (function (idx) {
        btn.addEventListener('click', function () {
          store.ui.modeIndex = idx;
          // 切模式后攻击方式全部重新勾选（新模式的攻击方式与旧模式无关）
          store.ui.selectedVariants = null;
          store.ui.variantIndex = 0;
          _renderAll();
        });
      })(i);
      row.append(btn);
    }

    if (variants.length > 0) {
      // 分隔符：让「模式」与「攻击方式」两段在视觉上分开，但仍在同一行
      row.append(el('span', 'mode-sep'));
      for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        const on = _isVariantSelected(i);
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
        if (!locked) cb.addEventListener('change', function () { _toggleVariant(i); });
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

/**
 * 玄骸加成区块的可见性（D-042）：
 * **非玄骸武器完全隐藏**（连标题一起）。
 */
export function renderKuvaVisibility() {
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

export function renderControls() {
  // 增幅基准：与备选 Mod 的筛选按钮组同一样式（D-042）
  //
  // D-171：两个窗口口径（N 秒异常总伤 / N 秒总伤）的名字要跟着**同一个秒数**走，
  //   否则会出现「基准写着 6 秒、实际按 3 秒算」的错位。
  const metricOptions = metricOptionsFor(store.ui.dotWindowSeconds);
  const mbox = $('#metric-options');
  mbox.innerHTML = '';
  mbox.className = 'filter-group';
  for (let i = 0; i < metricOptions.length; i++) {
    const opt = metricOptions[i];
    const btn = el('button', 'filter-btn' + (store.ui.metric === opt.id ? ' active' : ''), opt.label);
    btn.type = 'button';
    btn.title = opt.description;
    (function (id) {
      btn.addEventListener('click', function () {
        store.ui.metric = id;
        _renderAll();
      });
    })(opt.id);
    mbox.append(btn);
  }
  // D-171：秒数选择器也挂在「增幅基准」这一排上（需求方 2026-11-13）
  _renderDotWindowPicker();

  $('#faction-select').value = store.ui.faction;
  $('#kuva-element').value = store.ui.kuvaType;
  // D-157：换枪会恢复每把枪自己的配置，控件必须跟着回填（否则界面上还是上一把的值）
  const ratio = $('#kuva-ratio');
  if (ratio) {
    ratio.value = String(Math.round(store.ui.kuvaRatio * 100));
    const ratioVal = $('#kuva-ratio-val');
    if (ratioVal) ratioVal.textContent = Math.round(store.ui.kuvaRatio * 100) + '%';
  }
  const hsToggle = $('#headshot-toggle');
  if (hsToggle) hsToggle.checked = Boolean(store.ui.headshot);
  const hsMult = $('#headshot-mult');
  if (hsMult) hsMult.value = String(store.ui.headshotMult);
  _renderFilterButtons();
  renderCoControls();
}

export function wireControls() {
  $('#faction-select').addEventListener('change', function (e) { store.ui.faction = e.target.value; _renderAll(); });
  $('#kuva-element').addEventListener('change', function (e) { store.ui.kuvaType = e.target.value; _renderAll(); });
  $('#kuva-ratio').addEventListener('input', function (e) {
    store.ui.kuvaRatio = Number(e.target.value) / 100;
    $('#kuva-ratio-val').textContent = e.target.value + '%';
    _renderAll();
  });
  $('#headshot-toggle').addEventListener('change', function (e) { store.ui.headshot = e.target.checked; _renderAll(); });
  $('#headshot-mult').addEventListener('change', function (e) { store.ui.headshotMult = Number(e.target.value) || 3; _renderAll(); });

  // 筛选是可反复重建的按钮组（不放这里）
  $('#candidate-search').addEventListener('input', function (e) { store.ui.search = e.target.value; _renderAll(); });

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
    setDropHappened(true); // 已在 drop 里处理，dragend 不要重复卸下
    _removeByPayload(store.dragPayload);
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
    setDropHappened(true);
    _removeByPayload(store.dragPayload);
    store.dragPayload = null;
  });

  // 一键全部卸下（D-040）
  const unequipBtn = $('#unequip-all');
  if (unequipBtn) {
    unequipBtn.addEventListener('click', function () {
      _unequipAllMods();
      flash('已卸下全部 Mod');
    });
  }

  // ── 裂罅区（D-162）──
  // 折叠条：点标题或按回车展开/收起
  const rivenToggle = $('#riven-toggle');
  if (rivenToggle) {
    const doToggleRiven = function () { store.ui.rivenOpen = !store.ui.rivenOpen; _renderAll(); };
    rivenToggle.addEventListener('click', doToggleRiven);
    rivenToggle.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doToggleRiven(); }
    });
  }
  // 搜索框：只重建待选区，不丢焦点
  const rivenSearch = $('#riven-search');
  if (rivenSearch) {
    rivenSearch.addEventListener('input', function (e) {
      store.ui.rivenSearch = e.target.value;
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
      _renderAll();
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
      setDropHappened(true); // 已在 drop 里处理，dragend 不要重复卸下
      _removeByPayload(store.dragPayload);
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
      setDropHappened(true);
      const target = rivenFirstFreeSlot(p.statKind);
      if (target < 0) {
        flash((p.statKind === 'pos' ? '正面' : '负面') + '词条已经选满');
      } else {
        placeRivenEntry(target, p.key);
      }
      store.dragPayload = null;
      _renderAll();
    });
  }
}