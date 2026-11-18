/**
 * Mod / 劣化 / 赋能**槽位卡片**与**拖放**。
 *
 * 拖放规则：卡片自己判断「接不接受」某个载荷（`slotAcceptsMod` / `makeDropTarget`）；
 * 放到哪、换成哪一张由外壳的槽位操作函数处理，这里只负责调用。
 *
 * 外壳依赖通过 `wireSlotsDeps()` 注入（避免 `app.js ⇄ 本模块` 成环）。
 */
import { store } from './app-store.js';
import { RIVEN_SLOT_ID, SLOT_COUNT } from './app-store.js';
import { $, el, flash } from './ui-dom.js';
import { gainOf, rivenGain } from './app-compute.js';
import { isArcaneUsableOn, isExilusMod, isModAllowedOnWeapon, modName } from './app-data.js';
import { isRivenInstalled } from './app-riven.js';
import { arcaneStatChips, coSlotGain, gainBadge, rivenSlotChips, statChips } from './ui-chips.js';

/** 外壳注入 */
const injected = {
  arcaneSlotAccepts: () => null,
  arcanesDisabled: () => null,
  dropOnExilus: () => null,
  insertAt: () => null,
  removeByPayload: () => null,
  renderAll: () => null,
  swapSlots: () => null,
};

/** 本次拖放是否已成功落位（dragend 时据此决定要不要卸下） */
let dropHappened = false;

/** 外壳的 drop 处理器放成功后调用它，告诉 dragend「这次拖放已落地，别卸下」 */
export function setDropHappened(v) {
  dropHappened = v;
}

export function wireSlotsDeps(deps) {
  const missing = Object.keys(injected).filter((k) => typeof deps[k] !== 'function');
  if (missing.length) console.error('[ui-slots] 缺少注入：' + missing.join(', '));
for (const k of Object.keys(injected)) {
    if (typeof deps[k] === 'function') injected[k] = deps[k];
  }
}

function _arcaneSlotAccepts(...args) { return injected.arcaneSlotAccepts(...args); }
function _arcanesDisabled(...args) { return injected.arcanesDisabled(...args); }
function _dropOnExilus(...args) { return injected.dropOnExilus(...args); }
function _insertAt(...args) { return injected.insertAt(...args); }
function _removeByPayload(...args) { return injected.removeByPayload(...args); }
function _renderAll(...args) { return injected.renderAll(...args); }
function _swapSlots(...args) { return injected.swapSlots(...args); }
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
export function slotAcceptsMod(payload, targetIndex) {
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
  // 劣化卡**可以**进普通槽（需求方 2026-11-18 确认：游戏内如此）；
  // 反过来不行——普通卡进不了劣化槽，由 dropOnExilus / arcaneSlotAccepts 一侧把关。
  return true;
}

/** 让任意卡片既能作为拖出源，也能作为放置目标（不接受时显示禁止符号） */
export function makeDropTarget(card, accepts, onDrop) {
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

export function makeDraggable(card, payload) {
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
      _removeByPayload(p);
    }
    dropHappened = false;
  });
}

/**
 * 普通 Mod 槽：放 Mod，或作为已有 Mod 的换位/插入目标。
 *
 * 槽里也可能是**裂罅**（D-162）：槽里存占位 id {@link RIVEN_SLOT_ID}，
 * 显示成紫色卡，整张卡只显示一条「整卡收益」，词条小标签也走裂罅的紫色样式。
 */
export function modSlotCard(index) {
  const card = el('div', 'slot');
  card.append(el('div', 'slot-title', '槽位 ' + (index + 1)));
  const body = el('div', 'slot-body');
  const id = store.modSlots[index];

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

/** 劣化槽：只接受功能类 Mod（D-127：与普通 Mod 槽同尺寸，槽名写在卡片右上角） */
export function exilusSlotCard() {
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
    function (p) { _dropOnExilus(p); },
  );
  return card;
}

/** 赋能槽（D-127：与普通 Mod 槽同尺寸，槽名写在卡片右上角） */
export function arcaneSlotCard() {
  const card = el('div', 'slot arcane');
  card.append(el('span', 'slot-chip', '赋能'));
  const body = el('div', 'slot-body');

  // 需求方 2026-11-12：「守护武器的赋能槽禁用掉」→ 槽留着占位，灰掉、不收拖拽、不给装
  // ⚠ 判定必须在上面的空卡判断**之前**：空卡会走 `return card`，
  //   把禁用分支放到后面就永远走不到（页面 shim 没有 CSS，`className` 要直接写）。
  if (_arcanesDisabled()) {
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
    function (p) { return _arcaneSlotAccepts(p, targetPayload); },
    function (p) { dropOnArcane(p); },
  );
  return card;
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
export function dropOnSlot(payload, targetIndex) {
  // ── 裂罅（D-162）──
  if (payload.kind === 'riven') {
    if (payload.from === 'slot') {
      if (payload.index === targetIndex) return;
      _swapSlots(payload.index, targetIndex);
      _renderAll();
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
    _insertAt(RIVEN_SLOT_ID, targetIndex);
    _renderAll();
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
    _swapSlots(payload.index, targetIndex);
  } else {
    _insertAt(payload.id, targetIndex);
  }
  _renderAll();
}

/**
 * 放到赋能槽（D-134）：空槽直接放；已有赋能则**互换**（旧赋能回列表，与劣化槽一致）。
 */
export function dropOnArcane(payload) {
  const arc = store.data.arcaneByKey.get(payload.key);
  if (!arc) return;
  if (_arcanesDisabled()) {
    flash('守护 / 同伴武器不能装赋能');
    return;
  }
  // 本武器能装的赋能（D-138，与 `.slot-wrap` 的禁止符号判定同一套规则）
  if (!isArcaneUsableOn(arc, store.data.weapon, store.data.slotEntry)) {
    flash('这个赋能不能装在本武器上');
    return;
  }
  store.arcaneKey = payload.key;
  _renderAll();
}

export function renderSlots() {
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