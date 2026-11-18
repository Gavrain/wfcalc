/**
 * 武器区：大类 / 类型 / 弹道 / 装备 **四个下拉** + 搜索面板。
 *
 * 下拉只负责"选哪个"，真正的换枪动作是外壳的 `switchWeapon`（它要顺带换配卡、
 * 重建选单、刷面板），通过 `wireWeaponDeps()` 注入。
 */
import { store } from './app-store.js';
import { $, el } from './ui-dom.js';
import {
  FIRE_STYLE_OPTIONS, WEAPON_GROUPS, filterByStyle, locateWeapon, searchWeapons,
  weaponGroupId, weaponLabel, weaponMatchesStyle,
} from './weapon-picker.js';

/** 外壳注入 */
const injected = {
  switchWeapon: () => null,
  slotOf: () => null,
  currentWeaponGroupId: () => null,
};

/** 搜索结果里的高亮项下标 / 当前渲染出的条数 */
let searchActiveIndex = -1;
let hitsShown = 0;

/** 当前搜索结果（供 ↑↓ 与回车选中用） */
let searchHits = [];

export function wireWeaponDeps(deps) {
  const missing = Object.keys(injected).filter((k) => typeof deps[k] !== 'function');
  if (missing.length) console.error('[ui-weapon] 缺少注入：' + missing.join(', '));
  for (const k of Object.keys(injected)) {
    if (typeof deps[k] === 'function') injected[k] = deps[k];
  }
}

function _switchWeapon(...args) { return injected.switchWeapon(...args); }
function _slotOf(...args) { return injected.slotOf(...args); }
function _currentWeaponGroupId(...args) { return injected.currentWeaponGroupId(...args); }
/**
 * 启动时默认打开的武器：**主要 → 步枪**分类下的第一把（需求方 2026-11-06）。
 *
 * 说明：
 *   · 顺序与「类型 / 武器」下拉栏完全一致（类型内按中文名 `localeCompare` 排序，
 *     见 `groupWeapons`），所以用户看到的第一把就是打开时的那把；
 *   · 兜底：没有步枪分类时取主要的第一个类型；再不行才用写死的 `WEAPON_ID`。
 */
export function defaultWeaponId() {
  const group = store.dataAll && store.dataAll.groups.get('primary');
  if (!group) return WEAPON_ID;
  const rifle = group.types.get('rifle');
  if (rifle && rifle.weapons.length) return rifle.weapons[0].id;
  for (const bucket of group.types.values()) {
    if (bucket.weapons.length) return bucket.weapons[0].id;
  }
  return WEAPON_ID;
}

/** 按类型渲染"武器"下拉栏 */
export function renderWeaponOptions(groupId, typeKey) {
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
  wsel.onchange = function () { _switchWeapon(wsel.value); };
  // 选中值必须等于 store.data.weapon（D-097）：在列表里就选它，不在就补一项"（当前）"。
  // 绝不在这里"默认选第一项"——那会造成"选单显示 A、实际在算 B"。
  syncWeaponSelect();
}

/** 按大类渲染"类型"下拉栏 */
export function renderTypeOptions(groupId) {
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
    if (first) { _switchWeapon(first).catch(function (e) { console.error('[switchWeapon]', e); }); return; }
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

/**
 * 把「武器」下拉栏的选中值同步成**当前实际武器**。
 *
 * 选单只是选择器，真正的状态是 `store.data.weapon`。任何重新渲染选单之后
 * 都要调用这里，避免出现"选单显示 A、实际在算 B"的不一致（D-097）。
 */
export function syncWeaponSelect() {
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
 * 渲染三个下拉栏 + 搜索框。
 *
 * ```
 * 大类：主要 / 次要 / 近战 / 空战   ← 目前只有"主要"可选，其余置灰
 * 类型：该大类下的细分（步枪/霰弹枪/狙击枪/弓 …；近战按剑/锤/匕首…）
 * 武器：该类型下的武器名
 * ```
 */
export function renderWeaponPicker() {
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
  gsel.value = _currentWeaponGroupId() || 'primary';
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
 * 按关键字重画结果面板（**只动画板，不碰下拉框**）。
 * 关键字为空或没有命中时收起面板。
 */
export function renderSearchResults(keyword) {
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
    const list = hits.filter(function (w) { return weaponGroupId(w, _slotOf(w.id)) === g.id; });
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
export function wireWeaponSearch() {
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

export function moveSearchActive(delta) {
  const n = Math.min(searchHits.length, 20);
  if (!n) return;
  let next = searchActiveIndex + delta;
  if (next < 0) next = n - 1;
  if (next >= n) next = 0;
  setSearchActive(next);
}

export function closeSearchPanel() {
  const panel = $('#weapon-search-panel');
  if (!panel) return;
  panel.hidden = true;
  hitsShown = false;
  searchActiveIndex = -1;
}

/**
 * 点选一条搜索结果：清空搜索框、收起面板、切枪。
 * 下拉框在 `switchWeapon` 里跟着跳到那把枪所在的分类（D-119 的既有行为）。
 */
export function pickSearchResult(weaponId) {
  const input = $('#weapon-search');
  if (input) input.value = '';
  searchHits = [];
  closeSearchPanel();
  const panel = $('#weapon-search-panel');
  if (panel) panel.innerHTML = '';
  _switchWeapon(weaponId).catch(function (e) { console.error('[switchWeapon]', e); });
}

export function setSearchActive(i) {
  const panel = $('#weapon-search-panel');
  if (!panel) return;
  const items = panel.children.filter(function (c) { return c.className === 'search-item'; });
  for (let k = 0; k < items.length; k++) items[k].classList.toggle('active', k === i);
  searchActiveIndex = i;
}

export function isSearchPanelOpen() {
  const panel = $('#weapon-search-panel');
  return Boolean(panel) && panel.hidden !== true;
}

/** 结果行的副标注：类型 · 大类 */
export function searchMetaOf(w) {
  const loc = locateWeapon(store.dataAll.groups, w.id);
  if (!loc) return '';
  return loc.typeLabel + ' · ' + loc.groupLabel;
}