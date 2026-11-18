/**
 * 内核素材池验证页。
 *
 * 目的：**把内核内部的素材池摊开给人看**——每个乘区键下有哪些素材、各来自哪张卡、
 * 汇总出来是多少。重写内核期间，这是唯一需要的人工验证工具
 * （设计见 `docs/specs/架构设计/core-v2-架构设计.md` §7）。
 *
 * 数据来源：`compute()` 返回值里的 `materials`（素材池快照）与 `statusTypes`。
 * **页面不重算任何东西**——显示的每个数都直接取自内核。
 *
 * 访问：`npm run demo` 后打开 `/check`
 */
import { compute, setBonusContributions } from '../../core/src/index.ts';
import {
  arcaneDisplayStats, arcaneStackCount, arcaneToContributions, isModCompatibleWithWeapon,
  modKindsFor, modToContributions,
} from '../../data/src/adapter.ts';
import { arcaneCategoriesFor, isArcaneUsableOn } from './app-data.js';
import { groupWeapons, weaponLabel } from './weapon-picker.js';
import { STYLE } from './core-inspector.css.js';

const $ = (s) => document.querySelector(s);
const SLOT_COUNT = 8;

/** 筛选类别（与主页面一致） */
const FILTERS = [
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

const state = {
  weaponId: null,
  modeIndex: 0,
  slots: new Array(SLOT_COUNT).fill(null),
  exilusId: null,
  arcaneKey: null,
  statusTypes: null,
  coStacks: null,
  combo: null,
  kuvaType: 'heat',
  kuvaRatio: 0.6,
  filter: 'all',
  search: '',
};

let all = null;

/** 配装存档（键名与主页面区分开） */
const STORE_KEY = 'wfcalc.inspector.loadout';

function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      weaponId: state.weaponId,
      modeIndex: state.modeIndex,
      slots: state.slots,
      exilusId: state.exilusId,
      arcaneKey: state.arcaneKey,
      statusTypes: state.statusTypes,
      coStacks: state.coStacks,
      combo: state.combo,
      filter: state.filter,
    }));
  } catch { /* 隐私模式 / 配额满：记不住就算了，不影响计算 */ }
}

function restoreState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return false;
    if (saved.slots && Array.isArray(saved.slots)) {
      state.slots = new Array(SLOT_COUNT).fill(null)
        .map((_, i) => (typeof saved.slots[i] === 'string' ? saved.slots[i] : null));
    }
    if (typeof saved.exilusId === 'string') state.exilusId = saved.exilusId;
    if (typeof saved.arcaneKey === 'string') state.arcaneKey = saved.arcaneKey;
    if (typeof saved.modeIndex === 'number') state.modeIndex = saved.modeIndex;
    if (typeof saved.statusTypes === 'number') state.statusTypes = saved.statusTypes;
    if (typeof saved.coStacks === 'number') state.coStacks = saved.coStacks;
    if (typeof saved.combo === 'number') state.combo = saved.combo;
    if (typeof saved.filter === 'string') state.filter = saved.filter;
    if (typeof saved.weaponId === 'string') state.weaponId = saved.weaponId;
    return true;
  } catch { return false; }
}

/** 存档里的 id 可能已经失效（数据更新后），校验一遍 */
function validateState() {
  if (state.weaponId && !all.weaponById.has(state.weaponId)) state.weaponId = null;
  const w = state.weaponId ? all.weaponById.get(state.weaponId) : null;
  if (w) {
    const n = (w.modes || []).length;
    if (!(state.modeIndex >= 0 && state.modeIndex < n)) state.modeIndex = 0;
  }
  state.slots = state.slots.map((id) => (id && modById(id) ? id : null));
  if (state.exilusId && !modById(state.exilusId)) state.exilusId = null;
  if (state.arcaneKey && !all.arcaneById.has(state.arcaneKey)) state.arcaneKey = null;
}

// ── 数据 ──
async function getJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(path + ' → HTTP ' + res.status);
  return res.json();
}

async function loadData() {
  const files = await Promise.all([
    getJSON('/packages/data/src/generated/mods/weapon-slots.json'),
    getJSON('/packages/data/src/generated/mods/mods.json'),
    getJSON('/packages/data/src/generated/mods/arcanes.json'),
    getJSON('/packages/data/src/generated/weapons/primary.json'),
    getJSON('/packages/data/src/generated/weapons/secondary.json'),
    getJSON('/packages/data/src/generated/weapons/melee.json'),
    getJSON('/packages/data/src/generated/weapons/archgun.json'),
    getJSON('/packages/data/src/generated/weapons/archmelee.json'),
  ]);
  const [slotFile, modFile, arcaneFile, ...weaponFiles] = files;
  const flat = (x) => (Array.isArray(x) ? x : (x.weapons || x.arcanes || []));
  const weapons = weaponFiles.flatMap(flat);
  const weaponById = new Map(weapons.map((w) => [w.id, w]));
  return {
    slotFile,
    modFile,
    arcaneById: new Map(flat(arcaneFile).map((a) => [a.key, a])),
    arcaneList: flat(arcaneFile),
    weaponById,
    groups: groupWeapons(weapons, slotFile),
  };
}

/** 当前武器的槽位记录 */
function slotEntry() {
  return all.slotFile.weapons[state.weaponId] || { slots: {}, modKinds: [] };
}
function slotKinds() {
  const e = slotEntry();
  return modKindsFor(e, e.slots);
}
/** 武器 + 它的槽位细类（可装判定要按细类比，如 Daggers / Polearms） */
function weaponWithSpecifics() {
  const w = all.weaponById.get(state.weaponId) || {};
  const e = slotEntry();
  return { ...w, specifics: (e.slots && e.slots.specific) || [] };
}

function modById(id) {
  return all.modFile.mods.find((m) => m.id === id);
}
function isExilusMod(mod) {
  return Boolean(mod && mod.exilus === true);
}

/** 该武器能装的赋能（判据与主界面同一套函数） */
function usableArcanes() {
  const e = slotEntry();
  const w = all.weaponById.get(state.weaponId);
  if (!w) return [];
  const cats = arcaneCategoriesFor(w, e);
  if (!cats.length) return []; // 守护 / 同伴武器没有赋能槽
  return all.arcaneList.filter((a) => isArcaneUsableOn(a, w, e));
}

// ── 配装 → 贡献 ──
function currentContributions() {
  const kinds = slotKinds();
  const out = [];
  const installed = new Set();
  state.slots.forEach((id, i) => {
    if (!id || installed.has(id)) return;
    installed.add(id);
    const mod = modById(id);
    if (!mod || kinds.indexOf(mod.slotKind) < 0) return;
    out.push(...modToContributions(mod, mod.maxRank, i));
  });
  if (state.exilusId) {
    const mod = modById(state.exilusId);
    if (mod) out.push(...modToContributions(mod, mod.maxRank, 8));
  }
  if (state.arcaneKey) {
    const arc = all.arcaneById.get(state.arcaneKey);
    if (arc) out.push(...arcaneToContributions(arc));
  }
  // 套装效果：与主界面**同一份实现**（内核 set-bonus.ts）。
  //   这里只负责数件数——内核要的是「套名 → 张数」这个纯数据。
  const installedIds = [...state.slots.filter(Boolean), state.exilusId].filter(Boolean);
  const counts = {};
  for (const id of installedIds) {
    const m = modById(id);
    const set = m && m.set;
    if (!set) continue;
    counts[set] = (counts[set] || 0) + 1;
  }
  out.push(...setBonusContributions({
    counts,
    comboMultiplier: state.combo ?? 12,
    // 牺牲要放大本套卡自己的数值，把它们的贡献交给内核
    contributionsOfSet: function (setId) {
      const list = [];
      installedIds.forEach((id, i) => {
        const m = modById(id);
        if (!m || m.set !== setId) return;
        list.push(...modToContributions(m, m.maxRank, i));
      });
      return list;
    },
  }));
return out;
}

// ── 渲染：页头 ──
/** 玄骸加成一行（页面顶部的 `#kuva`）：玄骸武器显示「玄骸 <元素> <比例>」，其余武器整体隐藏 */
function renderKuvaChip(w) {
  const box = $('#kuva');
  if (!box) return;
  box.innerHTML = '';
  if (!w || !w.kuva) return;
  const chip = document.createElement('span');
  chip.textContent = '玄骸 ' + (ELEM_ZH[state.kuvaType] || state.kuvaType) + ' ' + Math.round(state.kuvaRatio * 100) + '%';
  chip.title = '玄骸加成：元素 ' + (ELEM_ZH[state.kuvaType] || state.kuvaType)
    + '，比例 ' + Math.round(state.kuvaRatio * 100) + '%（玄骸武器默认火 60%）';
  box.append(chip);
}

function renderWeaponSelect() {
  const sel = $('#weapon');
  sel.innerHTML = '';
  const list = [...all.weaponById.values()].sort((a, b) =>
    String(a.nameZh || a.name).localeCompare(String(b.nameZh || b.name), 'zh-CN'));
  for (const w of list) {
    const o = document.createElement('option');
    o.value = w.id;
    o.textContent = weaponLabel(w);
    sel.append(o);
  }
  sel.value = state.weaponId;
}

function renderModeSelect() {
  const w = all.weaponById.get(state.weaponId);
  // 玄骸加成：这个页面原来没有元素控件，只能按内核默认（火）算，界面上却**一个数字都不显示**——
  // 需求方 2026-11-18：「我看了很多玄骸武器，还是没有选择默认元素」。
  // 主页面在「面板」标题下已有「玄骸加成」输入层卡片；这里照同一口径补一块。
  renderKuvaChip(w);
  const sel = $('#mode');
  sel.innerHTML = '';
  (w.modes || []).forEach((m, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = (i + 1) + '. ' + (m.nameZh || m.name || m.id || ('模式 ' + (i + 1)));
    sel.append(o);
  });
  sel.value = String(state.modeIndex);
}

// ── 渲染：槽位 ──
function slotLabel(id, isArcane) {
  if (!id) return null;
  if (isArcane) {
    const a = all.arcaneById.get(id);
    return a ? String(a.name.zh || a.name.en) : id;
  }
  const m = modById(id);
  return m ? String(m.name.zh || m.name.en) : id;
}

function makeSlot({ id, isArcane, onClear, onDrop, title, dragPayload }) {
  const el = document.createElement('div');
  el.className = 'slot' + (id ? ' filled' : '');
  const lbl = document.createElement('span');
  lbl.className = 'lbl';
  lbl.textContent = id ? slotLabel(id, isArcane) : (title || '空');
  el.append(lbl);

  if (id) {
    const x = document.createElement('span');
    x.className = 'x';
    x.textContent = '×';
    x.title = '卸下';
    x.addEventListener('click', (e) => { e.stopPropagation(); onClear(); });
    el.append(x);

    // 已装的卡可以拖动：拖到别的槽 = 换位，拖出配置区 = 卸下
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      state.drag = { ...dragPayload, from: 'slot' };
      state.draggingFrom = state.drag;
      el.classList.add('dragging');
      if (e.dataTransfer) e.dataTransfer.setData('text/plain', id);
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      const from = state.draggingFrom;
      state.draggingFrom = null;
      state.drag = null;
      // 没有落进任何目标 → 视为拖出配置区 = 卸下
      if (from && !state.dropLanded) {
        if (from.index !== undefined) state.slots[from.index] = null;
        else if (from.kind === 'arcane') state.arcaneKey = null;
        else if (from.exilus) state.exilusId = null;
        render();
      }
      state.dropLanded = false;
    });
  }

  el.addEventListener('dragover', (e) => {
    const p = state.drag;
    if (!p) return;
    const ok = p.kind === 'mod' ? true : p.kind === 'arcane' ? Boolean(isArcane) : false;
    if (!ok) return;
    e.preventDefault();
    el.classList.add('dropover');
  });
  el.addEventListener('dragleave', () => el.classList.remove('dropover'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('dropover');
    const p = state.drag;
    if (!p) return;
    state.dropLanded = true;

    // 带 from 的（从别的槽拖来）先清源槽
    const clearSource = () => {
      if (p.from !== 'slot') return;
      if (p.index !== undefined && state.slots[p.index]) state.slots[p.index] = null;
      else if (p.kind === 'arcane') state.arcaneKey = null;
      else if (p.exilus) state.exilusId = null;
    };

    if (isArcane) {
      if (p.kind !== 'arcane') return;
      clearSource();
      state.arcaneKey = p.key;
      state.drag = null;
      render();
      return;
    }
    if (p.kind !== 'mod') return;
    clearSource();
    onDrop(p);
    state.drag = null;
    render();
  });
  return el;
}

function renderSlots() {
  const grid = $('#slotGrid');
  grid.innerHTML = '';
  for (let i = 0; i < SLOT_COUNT; i++) {
    const id = state.slots[i];
    const m = id ? modById(id) : null;
    grid.append(makeSlot({
      id,
      title: '槽 ' + (i + 1),
      dragPayload: id ? { kind: 'mod', id, exilus: Boolean(m && m.exilus === true), index: i } : null,
      onClear: () => { state.slots[i] = null; render(); },
      // 劣化卡也能进普通槽（需求方 2026-11-18 确认）
      onDrop: (pl) => { if (pl.kind === 'mod') state.slots[i] = pl.id; },
    }));
  }

  const ex = $('#exilusRow');
  ex.innerHTML = '';
  const em = state.exilusId ? modById(state.exilusId) : null;
  ex.append(makeSlot({
    id: state.exilusId,
    title: '劣化槽',
    dragPayload: state.exilusId ? { kind: 'mod', id: state.exilusId, exilus: true } : null,
    onClear: () => { state.exilusId = null; render(); },
    // 只有劣化卡能进劣化槽（需求方 2026-11-18 确认）
    onDrop: (pl) => { if (pl.kind === 'mod' && em !== undefined && pl.exilus) state.exilusId = pl.id; },
  }));

  const arc = $('#arcaneRow');
  arc.innerHTML = '';
  arc.append(makeSlot({
    id: state.arcaneKey,
    isArcane: true,
    title: '赋能',
    dragPayload: state.arcaneKey ? { kind: 'arcane', key: state.arcaneKey } : null,
    onClear: () => { state.arcaneKey = null; render(); },
    onDrop: (pl) => { if (pl.kind === 'arcane') state.arcaneKey = pl.key; },
  }));
}

// ── 渲染：备选区 ──
function filterKeyOf(mod) {
  const keys = new Set();
  for (const s of mod.stats || []) {
    const st = s.stat;
    if (st === 'baseDamage' || s.key === 'co') keys.add('damage');
    else if (st === 'multishot') keys.add('multishot');
    else if (st === 'critChance' || st === 'critMultiplier' || st === 'weakpointCritChance') keys.add('crit');
    else if (String(st).startsWith('elemental:')) keys.add('element');
    else if (String(st).startsWith('physical:')) keys.add('physical');
    else if (st === 'fireRate') keys.add('fireRate');
    else if (st === 'statusChance' || st === 'statusDamage' || st === 'statusDuration') keys.add('status');
    else keys.add('other');
  }
  if (isExilusMod(mod)) keys.add('exilus');
  return keys;
}

function matchesFilter(mod, f) {
  if (f === 'all') return true;
  const keys = filterKeyOf(mod);
  if (f === 'exilus') return keys.has('exilus');
  // 「触发」额外收带触发词条的卡
  if (f === 'status' && keys.has('status')) return true;
  const rank = { damage: 0, multishot: 1, crit: 2, element: 3, physical: 4, fireRate: 5, status: 6, other: 7 };
  let best = 'other';
  for (const k of keys) if (rank[k] !== undefined && rank[k] < rank[best]) best = k;
  return best === f;
}

function renderFilters() {
  const box = $('#filters');
  box.innerHTML = '';
  for (const [id, label] of FILTERS) {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = state.filter === id ? 'active' : '';
    b.addEventListener('click', () => { state.filter = id; renderFilters(); renderMods(); });
    box.append(b);
  }
}

/** 属性键 → 中文（验证页用的简表，主界面的更全） */
const STAT_ZH = {
  baseDamage: '基伤', multishot: '多重射击', critChance: '暴击几率', critMultiplier: '暴击伤害',
  statusChance: '触发几率', statusDamage: '异常伤害', statusDuration: '异常持续',
  fireRate: '射速', reloadSpeed: '装填速度', magazine: '弹匣容量', ammoEfficiency: '弹药效率',
  ammoMax: '弹药上限', punchThrough: '穿透', recoil: '后坐力', zoom: '变焦',
  projectileSpeed: '弹速', accuracy: '精准度',
  headshotDamage: '爆头伤害', weakpointDamage: '弱点伤害', weakpointCritChance: '弱点暴击几率',
  finisherDamage: '处决伤害', slamDamage: '震地伤害', bodyshotDamage: '身体伤害',
  bladeShadow: '刃影伤害', meleeRange: '攻击范围', comboDuration: '连击持续',
  comboChance: '连击几率', heavyDamage: '重击伤害', heavyEfficiency: '重击效率',
  channelingDamage: '蓄力伤害', factionDamage: '派系伤害', elementalDamage: '元素伤害',
  spreadTotal: '散射', projectileCount: '弹丸数', burstCount: '爆发数',
};
const ELEM_ZH = {
  heat: '火焰', cold: '冰冻', electric: '电击', toxin: '毒素', blast: '爆炸', gas: '毒气',
  magnetic: '磁力', radiation: '辐射', corrosive: '腐蚀', viral: '病毒',
  impact: '冲击', puncture: '穿刺', slash: '切割',
};

/** 一个属性键 → 中文 */
function statZh(stat) {
  const s = String(stat);
  if (s.startsWith('elemental:')) return ELEM_ZH[s.slice(10)] || s.slice(10);
  if (s.startsWith('physical:')) return ELEM_ZH[s.slice(9)] || s.slice(9);
  if (s.startsWith('faction:')) return '派系伤害（' + s.slice(8) + '）';
  return STAT_ZH[s] || s;
}

/**
 * 一张卡上**所有会影响结算**的词条，带上满级数值。
 * 判据与主界面一致：有 `contribStat` 或 `bucket` 才算（状态持续 bucket 为空但有键）。
 */
/** 一张卡的各条词条（每行一条：{ label: 乘区名, value: 带符号的值 }) */
function modStatLines(mod) {
  const out = [];
  for (const s of mod.stats || []) {
    if (!s.bucket && !s.contribStat) continue;
    const max = s.levelValues[s.levelValues.length - 1];
    const frac = FLAT_IS_FRACTION.has(s.contribStat || s.stat);
    const unit = s.form === 'flat' && !frac ? '' : '%';
    const shown = s.form === 'flat' && frac ? Math.round(max * 100 * 1000) / 1000 : max;
    out.push({
      label: statZh(s.contribStat || s.stat),
      value: (shown > 0 ? '+' : '') + shown + unit,
    });
  }
  return out;
}

function modValueText(mod) {
  const parts = [];
  for (const s of mod.stats || []) {
    if (!s.bucket && !s.contribStat) continue;
    const max = s.levelValues[s.levelValues.length - 1];
    const unit = s.form === 'flat' || s.unit === 'flat' ? '' : '%';
    parts.push(statZh(s.stat) + ' ' + (max > 0 ? '+' : '') + max + unit);
  }
  return parts.join(' · ');
}

function renderMods() {
  const kinds = slotKinds();
  const used = new Set([...state.slots.filter(Boolean), state.exilusId].filter(Boolean));
  const q = state.search.trim().toLowerCase();
  const list = all.modFile.mods
    .filter((m) => kinds.indexOf(m.slotKind) >= 0)
    .filter((m) => isModCompatibleWithWeapon(m, weaponWithSpecifics()))
    .filter((m) => !used.has(m.id))
    .filter((m) => matchesFilter(m, state.filter))
    .filter((m) => !q || String(m.name.zh || m.name.en).toLowerCase().includes(q));

  const box = $('#mods');
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<div class="empty">没有匹配的 Mod</div>'; return; }
  for (const m of list.slice(0, 400)) {
    const card = document.createElement('div');
    card.className = 'card';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = String(m.name.zh || m.name.en);
    card.append(name);

    // 每个词条单独一行
    for (const line of modStatLines(m)) {
      const row = document.createElement('div');
      row.className = 'val aria-line';
      const stat = document.createElement('span');
      stat.textContent = line.label;
      const amt = document.createElement('span');
      amt.className = 'amount';
      amt.textContent = line.value;
      row.append(stat, amt);
      card.append(row);
    }
    if (!modStatLines(m).length) {
      const none = document.createElement('div');
      none.className = 'val muted';
      none.textContent = '无伤害加成';
      card.append(none);
    }

    if (isExilusMod(m)) {
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.textContent = '劣化';
      card.append(tag);
    }
    card.draggable = true;
    card.addEventListener('dragstart', () => {
      state.drag = { kind: 'mod', id: m.id, exilus: isExilusMod(m) };
    });
    box.append(card);
  }
}

// 赋能列表（单独一栏，按大类筛）
function renderArcanes() {
  const box = $('#arcanes');
  if (!box) return;
  box.innerHTML = '';
  const arcanes = usableArcanes().filter((a) => a.key !== state.arcaneKey);
  if (!arcanes.length) {
    box.innerHTML = '<div class="empty">这把武器没有可用赋能</div>';
    return;
  }
  for (const a of arcanes) {
    const card = document.createElement('div');
    card.className = 'card arcane';

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = String(a.name.zh || a.name.en);
    card.append(name);

    // 每个词条单独一行：乘区名 + 满层值（叠层类再写 单层 × 层数）
    for (const e of arcaneEntries(a)) {
      const row = document.createElement('div');
      row.className = 'val aria-line';
      const stat = document.createElement('span');
      stat.textContent = statZh(e.stat);
      const amt = document.createElement('span');
      amt.className = 'amount';
      amt.textContent = '+' + fmtNum(e.amount) + '%';
      row.append(stat, amt);
      card.append(row);
      // 叠层类的推导过程单独一行小字，避免把主行挤得换行
      if (e.perStack !== null) {
        const sub = document.createElement('div');
        sub.className = 'sub';
        sub.textContent = '+' + fmtNum(e.perStack) + '% × ' + e.stacks;
        card.append(sub);
      }
    }

    card.draggable = true;
    card.addEventListener('dragstart', () => { state.drag = { kind: 'arcane', key: a.key }; });
    box.append(card);
  }
}

/**
 * 赋能的词条列表（带乘区与叠层信息）。
 *
 * 直接用数据层的 `arcaneDisplayStats`：它已经算好"每层值 × 层数 = 满层值"，
 * 并且把每条映射到内核乘区键（如装填速度 / 暴击伤害 / 基伤）。
 * 不要再从描述里正则抠数字——那样分不清是哪个乘区。
 */
function arcaneEntries(arc) {
  const stats = arcaneDisplayStats(arc);
  const stacks = arcaneStackCount(arc);
  return stats.map((s) => {
    const per = stacks > 1 ? Math.round((s.amount / stacks) * 1000) / 1000 : null;
    return { stat: s.stat, amount: s.amount, perStack: per, stacks };
  });
}

// ── 渲染：素材池 ──
/**
 * 哪些属性的 `flat` 是**小数口径**。
 *
 * 原因：内核的括号是 `值 = 面板 × (1 + pct) + flat`，暴击率 / 触发率 / 暴击伤害的
 * **面板本身就是小数**（布莱顿暴击率 0.22），所以 +5 个百分点必须写成 0.05 才能加对。
 * 这不是数据错误，只是**内部表示**；给人看的时候要换回百分比。
 */
const FLAT_IS_FRACTION = new Set([
  'critChance', 'statusChance', 'critMultiplier', 'weakpointCritChance', 'statusDamage',
]);

/** 一条素材的显示值（把小数口径的 flat 换成 %） */
function displayValue(e, statKey) {
  if (e.form === 'flat' && FLAT_IS_FRACTION.has(statKey)) return Math.round(e.value * 100 * 1000) / 1000;
  return e.value;
}

/** 一条素材的单位后缀 */
function unitOf(e, statKey) {
  if (e.form === 'pct') return '%';
  if (e.form === 'mul') return '×';
  if (e.form === 'flat') return FLAT_IS_FRACTION.has(statKey) ? '%' : ' 固定';
  return '';
}

function fmtNum(v) {
  if (!Number.isFinite(v)) return String(v);
  return String(Math.round(v * 1000) / 1000);
}

/** 当前配装里镀层卡的叠层上限（没有镀层卡时返回 null） */
function coMaxStacks() {
  let best = null;
  for (const id of [...state.slots.filter(Boolean), state.exilusId].filter(Boolean)) {
    const m = modById(id);
    if (!m) continue;
    const cond = (m.conditions || []).find((c) => c.group === 'condition_overload');
    const ms = cond && cond.maxStacks;
    if (typeof ms === 'number' && ms > 0) best = best === null ? ms : Math.max(best, ms);
  }
  return best;
}

/** 该卡自己的叠层上限（没有则 1） */
function modCoStacks(mod) {
  const cond = (mod.conditions || []).find((c) => c.group === 'condition_overload');
  const ms = cond && cond.maxStacks;
  return typeof ms === 'number' && ms > 0 ? ms : 1;
}

function renderBuckets() {
  const w = all.weaponById.get(state.weaponId);
  const mode = (w.modes || [])[state.modeIndex];
  if (!w || !mode) { $('#buckets').innerHTML = '<div class="empty">没有可算的模式</div>'; return; }

  const contribs = currentContributions();
  const opts = {};
  // 玄骸武器：默认元素是**火**（与主界面 store.ui.kuvaType 的初值一致）。
  // ⚠ 数据里 `w.kuva` 是**对象**（{ bonusRange, elements }），不是布尔值；
  //   只认 `=== true` 会让除卡拉克以外的玄骸武器全落空（那个是因为 id 撞上了正则才碰巧生效）。
  if (w.kuva) {
    opts.kuva = { type: state.kuvaType, ratio: state.kuvaRatio };
  }
  if (state.statusTypes !== null) opts.statusTypes = state.statusTypes;
  if (state.coStacks !== null) opts.coStacks = state.coStacks;
  const res = compute(w, mode, contribs, opts);

  // 默认值回填（用户没手动改时显示内核算出来的）
  // 默认值**直接写进输入框**（不留空），用户改了就按他的算
  const stInput = $('#statusTypes');
  const effA = state.statusTypes ?? res.statusTypes;
  if (document.activeElement !== stInput) stInput.value = String(effA);
  const isMelee = /melee/i.test(String(w.category || ''));
  const comboInput = $('#combo');
  comboInput.disabled = !isMelee;
  if (!isMelee) {
    comboInput.value = '';
    comboInput.title = '只有近战有连击';
  } else {
    const effCombo = state.combo ?? 12;
    if (document.activeElement !== comboInput) comboInput.value = String(effCombo);
    comboInput.title = '默认 12';
  }
  // 镀层叠层输入框：上限 = 当前配装里镀层卡的叠层上限（没有镀层卡就禁用）
  const maxY = coMaxStacks();
  const coInput = $('#coStacks');
  if (maxY === null) {
    coInput.disabled = true;
    coInput.max = '';
    coInput.title = '当前配装没有镀层卡';
    if (state.coStacks !== null) { state.coStacks = null; coInput.value = ''; }
  } else {
    coInput.disabled = false;
    coInput.max = String(maxY);
    coInput.title = '上限 ' + maxY + ' 层（当前镀层卡的上限）';
    // 输入超过上限 → 夹回去
    if (state.coStacks !== null && state.coStacks > maxY) {
      state.coStacks = maxY;
    }
    // 默认 = 满层，**直接写进输入框**
    const effY = state.coStacks ?? maxY;
    if (document.activeElement !== coInput) coInput.value = String(effY);
  }

  const box = $('#summary');
  box.innerHTML = '';
  const banner = document.createElement('div');
  const ok = res.materials.check.ok;
  banner.className = 'check ' + (ok ? 'ok' : 'bad');
  const ck = res.materials.check;
  banner.textContent = ok
    ? '自检通过：' + ck.inputCount + ' 条素材全部落桶，每个乘区单独核对一致'
    : '⚠ 自检失败：' + ck.inputCount + ' 条输入 → ' + ck.bucketedCount + ' 条落桶'
      + (ck.badBuckets.length ? '；对不上的乘区（' + ck.badBuckets.join(', ') + '）' : '');
  box.append(banner);

  // 输入层：发生在所有乘区**之前**的改动（玄骸元素加成）
  const kuvaIn = res.materials.input && res.materials.input.kuva;
  if (kuvaIn) {
    const card = document.createElement('div');
    card.className = 'bucket input-layer';
    const head = document.createElement('div');
    head.className = 'bucket-head';
    const key = document.createElement('span');
    key.className = 'bucket-key';
    key.textContent = '玄骸加成';
    const sum = document.createElement('span');
    sum.className = 'sum';
    sum.innerHTML = '<span class="muted">' + statZh('elemental:' + kuvaIn.type) + ' </span>'
      + '<b>+' + fmtNum(kuvaIn.amount) + '</b>'
      + '<span class="muted">（' + Math.round(kuvaIn.ratio * 100) + '%）</span>';
    head.append(key, sum);
    card.append(head);
    box.append(card);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = res.materials.totalEntries + ' 条素材 · ' + res.materials.buckets.length + ' 个乘区';
  box.append(meta);

  const bb = $('#buckets');
  bb.innerHTML = '';
  if (!res.materials.buckets.length) { bb.innerHTML = '<div class="empty">还没有装卡</div>'; return; }

  for (const b of res.materials.buckets) {
    const card = document.createElement('div');
    card.className = 'bucket';

    const head = document.createElement('div');
    head.className = 'bucket-head';
    const key = document.createElement('span');
    key.className = 'bucket-key';
    key.textContent = b.key;

    const sum = document.createElement('span');
    sum.className = 'sum';
    if (b.key === 'co' || b.key === 'coFreeze') {
      // 镀层类：显示每层值 + 实际加量（× 异况数 × 叠层）
      const per = b.total.pct;
      const a = state.statusTypes ?? res.statusTypes;
      const y = state.coStacks ?? coMaxStacks() ?? 1;
      const real = per * a * y;
      sum.innerHTML = '<span class="muted">每层 </span><span class="co"><b>' + fmtNum(per) + '</b>%</span>'
        + '<span class="muted"> × a</span><b>' + a + '</b>'
        + '<span class="muted"> × y</span><b>' + y + '</b>'
        + '<span class="muted"> = </span><b>' + fmtNum(real) + '</b><span class="muted">%</span>';
    } else {
      const parts = [];
      // 百分比与固定值**分开显示**：200% 与 +5% 固定是两个口径。
      // 它们之间是**相加**（`面板×(1+pct) + flat`），所以用 `+` 连接，不要用 `·`（那是乘）
      if (b.total.pct !== 0) {
        const terms = b.entries.filter((e) => e.active !== false && e.form === 'pct').map((e) => fmtNum(e.value));
        parts.push('<b>' + fmtNum(b.total.pct) + '</b>%'
          + (terms.length > 1 ? '<span class="muted"> = ' + terms.join(' + ') + '</span>' : ''));
      }
      if (b.total.flat !== 0) {
        const frac = FLAT_IS_FRACTION.has(b.key);
        const shown = frac ? Math.round(b.total.flat * 100 * 1000) / 1000 : b.total.flat;
        const flatTerms = b.entries.filter((e) => e.active !== false && e.form === 'flat')
          .map((e) => fmtNum(displayValue(e, b.key)));
        parts.push('<b>' + fmtNum(shown) + '</b><span class="muted">' + (frac ? '% 固定' : ' 固定') + '</span>'
          + (flatTerms.length > 1 ? '<span class="muted"> (= ' + flatTerms.join(' + ') + ')</span>' : ''));
      }
      if (b.total.mul !== 1) parts.push('×<b>' + fmtNum(b.total.mul) + '</b>');
      // 锁射速 / 锁多重：原值照显示，后面跟 ×0
      if (b.total.locked === true) {
        parts.push('<span class="locked">×0</span>');
      }
      // 乘区内部是相加关系（pct + flat），乘算另有 '×' 前缀，所以这里用 '+'
      sum.innerHTML = parts.length ? parts.join(' + ') : '<span class="muted">未生效</span>';
    }
    head.append(key, sum);
    card.append(head);

    const body = document.createElement('div');
    body.className = 'bucket-body';
    for (const e of b.entries) {
      const row = document.createElement('div');
      row.className = 'entry' + (e.active === false ? ' off' : '');
      const src = document.createElement('span');
      src.className = 'src';
      src.textContent = e.source + (e.slot !== undefined ? ' @槽' + e.slot : '') + (e.heavyX2 ? ' [重击×2]' : '');
      const val = document.createElement('span');
      val.textContent = fmtNum(displayValue(e, b.key)) + unitOf(e, b.key) + (b.total.locked ? ' ×0' : '');
      row.append(src, val);
      body.append(row);
    }
    card.append(body);
    bb.append(card);
  }
}

// ── 总渲染 ──
function render() {
  saveState();
  renderModeSelect();
  renderSlots();
  renderFilters();
  renderMods();
  renderArcanes();
  renderBuckets();
}

// ── 启动 ──
async function boot() {
  document.head.append(Object.assign(document.createElement('style'), { textContent: STYLE }));
  $('#hint').textContent = '加载数据…';

  all = await loadData();

  // 先尝试恢复上次的配装（换武器 / 刷新都不丢卡）
  const restored = restoreState();
  validateState();
  if (!state.weaponId) {
    const first = all.groups.get('primary');
    state.weaponId = (first && first.types.get('rifle') && first.types.get('rifle').weapons[0] || {}).id
      || [...all.weaponById.keys()][0];
  }
  state.weaponId = state.weaponId; // validateState 可能清空
  renderWeaponSelect();
  renderFilters();
  if (restored) $('#hint').textContent = '已恢复上次配装';

  $('#weapon').addEventListener('change', (e) => {
    state.weaponId = e.target.value;
    state.modeIndex = 0;
    state.slots = new Array(SLOT_COUNT).fill(null);
    state.exilusId = null;
    state.arcaneKey = null;
    state.statusTypes = null;
    state.coStacks = null;
    state.combo = null;
    $('#statusTypes').value = '';
    $('#coStacks').value = '';
    $('#combo').value = '';
    render();
  });
  $('#mode').addEventListener('change', (e) => { state.modeIndex = Number(e.target.value); renderBuckets(); });
  $('#statusTypes').addEventListener('input', (e) => {
    const v = e.target.value.trim();
    state.statusTypes = v === '' ? null : Math.max(0, Number(v));
    renderBuckets();
  });
  $('#coStacks').addEventListener('input', (e) => {
    const v = e.target.value.trim();
    state.coStacks = v === '' ? null : Math.max(0, Number(v));
    renderBuckets();
  });
  $('#combo').addEventListener('input', (e) => {
    const v = e.target.value.trim();
    state.combo = v === '' ? null : Math.max(1, Number(v));
    renderBuckets();
  });
  $('#unequipAll').addEventListener('click', () => {
    state.slots = new Array(SLOT_COUNT).fill(null);
    state.exilusId = null;
    state.arcaneKey = null;
    state.drag = null;
    render();
  });
  $('#modSearch').addEventListener('input', (e) => { state.search = e.target.value; renderMods(); renderArcanes(); });

  if (restored) setTimeout(() => { $('#hint').textContent = ''; }, 1500);
  else $('#hint').textContent = '';
  render();
}

boot().catch((err) => {
  $('#hint').textContent = '加载失败：' + err.message;
  console.error(err);
});
