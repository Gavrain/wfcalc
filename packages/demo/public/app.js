/**
 * 赤毒·卡拉克（Kuva Karak）配装计算。
 *
 * 每个数值都能对应到 `docs/伤害公式.md` 的某个函数；面板区随 Mod 实时更新；
 * 备选 Mod 区给出装上之后的伤害增幅（增幅基准可选）。
 *
 * ⚠ 写法约束：`packages/demo/src/server.mjs` 用"剥类型"的方式在浏览器里直接跑 `.ts` 源码，
 * 所以这里只用**命名导入**，不要写 `const { a } = ns` 这种解构。
 */
import {
  compute,
  critAverage,
  critTiers,
  DOT_TYPES,
  isKuvaFamily,
  METRIC_OPTIONS,
  totalProcChance,
} from '../../core/src/index.ts';
import {
  arcaneToContributions,
  isConditionOverloadMod,
  isModCompatibleWithWeapon,
  modKindsFor,
  modToContributions,
} from '../../data/src/adapter.ts';

// ─────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────

const WEAPON_ID = 'KuvaKarak';
const MODE_ID = 'primary';
const SLOT_COUNT = 8; // 两行四列
const EXILUS_INDEX = 8; // 劣化槽
const MAX_SLOTS = 9;

/** 派系：只显示英文名，默认「无」 */
const FACTION_OPTIONS = [
  ['none', '无'],
  ['grineer', 'Grineer'],
  ['corpus', 'Corpus'],
  ['infested', 'Infested'],
  ['orokin', 'Orokin'],
  ['murmur', 'Murmur'],
];

/** 玄骸加成可选元素：冰、火、毒、电、磁力、辐射、冲击 */
const KUVA_ELEMENTS = ['cold', 'heat', 'toxin', 'electric', 'magnetic', 'radiation', 'impact'];

const ELEMENT_LABEL = {
  impact: '冲击', puncture: '穿刺', slash: '切割',
  heat: '火焰', cold: '冰冻', electric: '电击', toxin: '毒素',
  blast: '爆炸', gas: '毒气', magnetic: '磁力', radiation: '辐射',
  corrosive: '腐蚀', viral: '病毒', void: '虚空', tau: 'Tau',
};

const ELEMENT_COLOR = {
  impact: '#8fa3b8', puncture: '#b8a78f', slash: '#b85f6a',
  heat: '#e8703a', cold: '#5fb8d8', electric: '#c9a83a', toxin: '#6ab04c',
  blast: '#d98f5a', gas: '#7fbf5a', magnetic: '#8f7fd8', radiation: '#c8d85a',
  corrosive: '#8fbf7a', viral: '#b06fc0',
};

const BUCKET_LABEL = {
  baseDamage: '基伤', multishot: '多重', elemental: '元素', physical: '物理',
  critChance: '暴击几率', critMultiplier: '暴击伤害', statusChance: '触发几率',
  faction: '派系', fireRate: '射速', utility: '通用',
};

/**
 * 词条 / 属性名的中文表（界面用语统一走这里，不再直接显示英文 key）。
 * 与 `bucketLabel()` 分工：
 *   · 这里管**词条名**（穿透、装填速度……，用于 Mod 卡的数值行）；
 *   · `bucketLabel()` 管**乘区名**（基伤、多重……）。
 */
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
// 状态
// ─────────────────────────────────────────────────────────────

const modSlots = new Array(SLOT_COUNT).fill(null); // 索引 0..7 是 Mod 槽
let exilusModId = null; // 劣化槽
let arcaneKey = null; // 赋能

const state = {
  metric: 'perShot',
  faction: 'none',
  headshot: false,
  headshotMult: 3,
  kuvaType: 'heat',
  kuvaRatio: 0.6,
  coStatusTypes: 0,
  coStacks: 0,
  filter: 'all',
  search: '',
  modeIndex: 0, // 当前选中的攻击模式（D-042：多面板武器可切换）
};

let DATA = null;
let dragPayload = null;

/** 当前选中的攻击模式（D-042：多面板武器由右上角的模式按钮切换） */
function currentMode() {
  if (!DATA || !DATA.weapon) return null;
  const modes = DATA.weapon.modes;
  return modes[Math.min(state.modeIndex, modes.length - 1)] ?? modes[0];
}

// ─────────────────────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────────────────────

const $ = function (s) { return document.querySelector(s); };

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function fmt(v, d) {
  d = d === undefined ? 2 : d;
  return Number.isFinite(v) ? v.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
}

function fmtPct(v, d) {
  d = d === undefined ? 2 : d;
  if (v === null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%';
}

function bucketLabel(stat) {
  if (stat.startsWith('elemental:')) return ELEMENT_LABEL[stat.split(':')[1]] || '元素';
  if (stat.startsWith('physical:')) return ELEMENT_LABEL[stat.split(':')[1]] || '物理';
  if (stat.startsWith('faction:')) return '派系';
  if (stat === 'co') return '基伤';
  return BUCKET_LABEL[stat] || stat;
}

function spreadTotalOf(s) {
  let t = 0;
  const keys = Object.keys(s);
  for (let i = 0; i < keys.length; i++) t += s[keys[i]] || 0;
  return t;
}

function modName(mod) {
  return mod.name.zh || mod.name.en;
}

// ─────────────────────────────────────────────────────────────
// 计算
// ─────────────────────────────────────────────────────────────

function currentContributions() {
  const out = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const id = modSlots[i];
    if (!id) continue;
    const mod = DATA.modById.get(id);
    if (!mod) continue;
    const list = modToContributions(mod, mod.maxRank, i);
    for (let j = 0; j < list.length; j++) out.push(list[j]);
  }
  if (exilusModId) {
    const mod = DATA.modById.get(exilusModId);
    if (mod) {
      const list = modToContributions(mod, mod.maxRank, EXILUS_INDEX);
      for (let j = 0; j < list.length; j++) out.push(list[j]);
    }
  }
  if (arcaneKey) {
    const arc = DATA.arcaneByKey.get(arcaneKey);
    if (arc) {
      const list = arcaneToContributions(arc);
      for (let j = 0; j < list.length; j++) out.push(list[j]);
    }
  }
  return out;
}

/**
 * 镀层类的可用性：装上带 `co` 词条的 Mod 时显示 a / y 两个下拉框。
 * 叠层上限 y 取该 Mod 数据里的 maxStacks；异况超量常驻生效、恒 1 层。
 */
function coMaxStacksOf(mod) {
  const cond = (mod.conditions || []).find(function (c) { return c.group === 'condition_overload'; });
  if (cond && cond.maxStacks) return cond.maxStacks;
  return 1;
}

function coInfo() {
  let maxStacks = 0;
  let perStack = 0;
  const sources = [];
  for (let i = 0; i < MAX_SLOTS; i++) {
    const id = i === EXILUS_INDEX ? exilusModId : modSlots[i];
    if (!id) continue;
    const mod = DATA.modById.get(id);
    if (!mod) continue;
    const co = mod.stats.filter(function (s) { return s.key === 'co'; });
    if (!co.length) continue;
    for (let j = 0; j < co.length; j++) {
      perStack += co[j].levelValues[co[j].levelValues.length - 1];
    }
    maxStacks = Math.max(maxStacks, coMaxStacksOf(mod));
    sources.push(modName(mod));
  }
  return { active: sources.length > 0, maxStacks: Math.max(1, maxStacks), perStack: perStack, sources: sources };
}

function computeOptions() {
  const co = coInfo();
  const opts = {
    kuva: { type: state.kuvaType, ratio: state.kuvaRatio },
    faction: state.faction,
    headshot: { enabled: state.headshot, multiplier: state.headshotMult },
  };
  if (co.active) {
    opts.coStacks = state.coStacks > 0 ? state.coStacks : co.maxStacks;
    opts.coStatusTypes = state.coStatusTypes;
  }
  return opts;
}

function runCompute(contribs) {
  return compute(DATA.weapon, currentMode(), contribs, computeOptions(), false);
}

function metricValueOf(res) {
  const lines = res.output.lines;
  for (let i = 0; i < lines.length; i++) if (lines[i].id === state.metric) return lines[i].value;
  return 0;
}

/**
 * 劣化槽只接受"不影响伤害"的功能类 Mod。
 *
 * ⚠ 数据里 `reloadSpeed`（装填速度）与 `magazine`（弹匣容量）被标成 `functional/utility`，
 *   但两者都**直接影响「持续伤害」口径**：
 *   ```
 *   持续伤害 = 单次射击 × 弹匣 ÷ (弹匣 ÷ 射速 + 装填时间)
 *   装填时间 = 面板装填 ÷ (1 + Σ装填速度%)
 *   ```
 *   所以它们属于**影响伤害**的词条，不能当纯功能卡塞进劣化槽（D-037）。
 *   同理 `fireRate` / `multishot` / `statusChance` 等一律按"影响伤害"处理。
 */
const DAMAGE_AFFECTING_STATS = new Set([
  'baseDamage', 'multishot', 'fireRate', 'statusChance', 'statusDamage', 'statusDuration',
  'critChance', 'critMultiplier', 'weakpointCritChance', 'weakpointDamage',
  'reloadSpeed', 'magazine', 'slashOnCrit', 'impactToSlash',
]);

function isExilusMod(mod) {
  const stats = mod.stats;
  if (!stats.length) return false;
  for (let i = 0; i < stats.length; i++) {
    const s = stats[i];
    // ① 有进伤害乘区的词条
    if (s.bucket && s.bucket !== 'utility') return false;
    // ② 虽然是 utility，但影响伤害（装填 / 弹匣等，D-037）
    if (DAMAGE_AFFECTING_STATS.has(s.stat)) return false;
    if (s.stat.indexOf('elemental:') === 0 || s.stat.indexOf('physical:') === 0) return false;
    if (s.key === 'co') return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────
// 顶部
// ─────────────────────────────────────────────────────────────

function renderHeader() {
  const w = DATA.weapon;
  $('#weapon-title').textContent = (w.nameZh || w.name) + '（' + w.name + '）';
  $('#weapon-meta').textContent =
    currentMode().id + ' · ' + currentMode().role + ' · ' + currentMode().trigger +
    ' · 面板多重 ' + currentMode().multishot;

  renderModeSwitch();
  renderKuvaVisibility();
}

/**
 * 多面板武器的模式切换（D-042）：在「武器面板」标题右侧一排按钮。
 * 单模式武器不显示切换栏。
 */
function renderModeSwitch() {
  const box = $('#mode-switch');
  if (!box) return;
  box.innerHTML = '';
  const modes = DATA.weapon.modes;
  if (modes.length <= 1) return; // 单模式武器不显示

  for (let i = 0; i < modes.length; i++) {
    const m = modes[i];
    const btn = el('button', 'mode-btn' + (i === state.modeIndex ? ' active' : ''), MODE_LABEL[m.id] || m.id);
    btn.type = 'button';
    btn.title = m.id + ' · ' + m.trigger;
    (function (idx) {
      btn.addEventListener('click', function () {
        state.modeIndex = idx;
        renderAll();
      });
    })(i);
    box.append(btn);
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
 * 玄骸加成区块的可见性（D-042）：
 * **非玄骸武器完全隐藏**（连标题一起）。
 */
function renderKuvaVisibility() {
  const isKuva = Boolean(DATA.isKuva);
  const controls = $('#kuva-controls');
  if (controls) {
    controls.style.display = isKuva ? '' : 'none';
    // 标题紧跟在它前面
    const title = controls.previousElementSibling;
    if (title && title.classList && title.classList.contains('section-title')) {
      title.style.display = isKuva ? '' : 'none';
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 左侧面板
// ─────────────────────────────────────────────────────────────

function renderPanel(res) {
  const p = res.panelPairs;
  const w = DATA.weapon;

  const rows = [
    ['暴击几率', (p.critChance.base * 100).toFixed(2) + '%', (p.critChance.after * 100).toFixed(2) + '%'],
    ['暴击伤害', '×' + p.critMultiplier.base.toFixed(2), '×' + p.critMultiplier.after.toFixed(2)],
    ['触发几率', (p.statusChance.base * 100).toFixed(2) + '%', (p.statusChance.after * 100).toFixed(2) + '%'],
    ['多重射击', p.multishot.base.toFixed(2), p.multishot.after.toFixed(3)],
    ['射速', p.fireRate.base.toFixed(3), p.fireRate.after.toFixed(3)],
    // D-066：弹匣与装填各占一行，改用**核心算出的面板对照**（之前直接读武器原始值，
    // 导致弹匣/装填 Mod 在面板上看不出任何效果）
    ['弹匣容量', String(p.magazineSize.base), p.magazineSize.after.toFixed(1)],
    ['装填时间', p.reloadTime.base + ' 秒', p.reloadTime.after.toFixed(3) + ' 秒'],
  ];

  fillRows('#panel-table', ['属性', '基础面板', '当前面板'], rows);

  const orig = currentMode().segments[0].damage;
  const spread = res.totalSpread;
  const typeSet = [];
  const push = function (t) { if (typeSet.indexOf(t) < 0) typeSet.push(t); };
  Object.keys(orig).forEach(push);
  Object.keys(spread).forEach(push);

  // 当前触发几率（含触发几率 Mod，射线另算）——不是面板静态值
  const procNow = totalProcChance(currentMode().segments[0].procChance, currentContributions(), false);
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

/** 该行的「当前」值是否与「基础」值不同（且不是合计行） */
function isChanged(row) {
  if (row[0] === '合计') return false;
  const a = typeof row[1] === 'object' && row[1] ? row[1].text : row[1];
  const b = typeof row[2] === 'object' && row[2] ? row[2].text : row[2];
  return a !== undefined && b !== undefined && String(a) !== String(b);
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
    const ok = Boolean(dragPayload) && accepts(dragPayload);
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
    if (!dragPayload || !accepts(dragPayload)) return;
    e.preventDefault();
    card.classList.remove('drop-target');
    dropHappened = true; // 成功放进配置区，dragend 时不再卸下
    onDrop(dragPayload);
    dragPayload = null;
  });
}

function makeDraggable(card, payload) {
  card.draggable = true;
  card.addEventListener('dragstart', function (e) {
    dragPayload = payload;
    dropHappened = false;
    card.classList.add('dragging');
    if (e.dataTransfer) e.dataTransfer.setData('text/plain', payload.id || payload.key || '');
  });
  card.addEventListener('dragend', function () {
    card.classList.remove('dragging');
    const p = dragPayload;
    dragPayload = null;
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
    if (p.from === 'exilus') { exilusModId = null; renderAll(); return; }
    if (typeof p.index === 'number' && modSlots[p.index]) { modSlots[p.index] = null; renderAll(); }
    return;
  }
  if (p.kind === 'arcane') { arcaneKey = null; renderAll(); }
}

function statChips(mod) {
  const wrap = el('div', 'slot-stats');
  for (let i = 0; i < mod.stats.length; i++) {
    const s = mod.stats[i];
    if (!s.bucket || s.bucket === 'utility') continue;
    const max = s.levelValues[s.levelValues.length - 1];
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
  exilusModId = null;
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

/** 普通 Mod 槽：放 Mod，或作为已有 Mod 的换位/插入目标 */
function modSlotCard(index) {
  const card = el('div', 'slot');
  card.append(el('div', 'slot-title', '槽位 ' + (index + 1)));
  const body = el('div', 'slot-body');
  const id = modSlots[index];

  if (id) {
    const mod = DATA.modById.get(id);
    body.append(el('div', 'slot-name', modName(mod)));
    body.append(statChips(mod));
    // D-040：去掉「卸下」按钮，改为把卡片拖出 Mod 配置区即卸下
    makeDraggable(card, { kind: 'mod', id: id, from: 'slot', index: index });
  } else {
    body.append(el('div', 'slot-empty', '空'));
  }
  card.append(body);

  makeDropTarget(card, function (p) { return slotAcceptsMod(p, index); }, function (p) { dropOnSlot(p, index); });
  return card;
}

/** 劣化槽：只接受功能类 Mod */
function exilusSlotCard() {
  const card = el('div', 'slot exilus');
  card.append(el('div', 'slot-title', '劣化槽'));
  const body = el('div', 'slot-body');

  if (exilusModId) {
    const mod = DATA.modById.get(exilusModId);
    body.append(el('div', 'slot-name', modName(mod)));
    // D-040：去掉「卸下」按钮，改为拖出配置区即卸下
    makeDraggable(card, { kind: 'mod', id: exilusModId, exilus: true, from: 'exilus' });
  } else {
    body.append(el('div', 'slot-empty', '拖入功能 Mod'));
  }
  card.append(body);

  makeDropTarget(
    card,
    function (p) { return p.kind === 'mod' && p.exilus; },
    function (p) { placeMod(p.id, EXILUS_INDEX); },
  );
  return card;
}

/** 赋能槽 */
function arcaneSlotCard() {
  const card = el('div', 'slot arcane');
  card.append(el('div', 'slot-title', '赋能'));
  const body = el('div', 'slot-body');

  if (arcaneKey) {
    const arc = DATA.arcaneByKey.get(arcaneKey);
    body.append(el('div', 'slot-name', arc.name.zh || arc.name.en));
    // D-040：赋能同样拖出配置区即卸下
    makeDraggable(card, { kind: 'arcane', key: arcaneKey, from: 'arcane' });
  } else {
    body.append(el('div', 'slot-empty', '拖入赋能'));
  }
  card.append(body);

  makeDropTarget(
    card,
    function (p) { return p.kind === 'arcane'; },
    function (p) { arcaneKey = p.key; renderAll(); },
  );
  return card;
}

/** 8 个 Mod 槽里还有空位吗（D-034：全满时拒绝从备选区拖入） */
function hasEmptyModSlot() {
  for (let i = 0; i < SLOT_COUNT; i++) if (!modSlots[i]) return true;
  return false;
}

/** 槽位是否接受这次拖拽（决定"允许放置"还是"禁止符号"） */
function slotAcceptsMod(payload, targetIndex) {
  // 赋能不能进 Mod 槽
  if (payload.kind !== 'mod') return false;
  // 功能类只能进劣化槽
  if (payload.exilus) return false;
  // 目标槽若已有 Mod → 拒绝，避免"不小心把已装 Mod 顶掉"（D-038）
  if (targetIndex !== undefined && modSlots[targetIndex]) return false;
  // 从槽位间移动不受空位限制
  if (payload.from === 'slot') return true;
  // 从备选区拖入：必须还有空位
  return hasEmptyModSlot();
}

/**
 * 把 Mod 放到目标槽（D-034 的"紧凑前移"语义）。
 *
 * ```
 * 拖到位置 k：把"从新 Mod 到 k"这一段里已有的 Mod 按紧凑规则重排，
 *            空洞被填上，新 Mod 占在 k。
 *   例：槽位 3 空、拖到槽位 6
 *       → 槽位 4/5/6 依次前移，填上 3；
 *       → 新 Mod 落在槽位 6。
 * ```
 * 前后移动同理，所以永远不会把已有 Mod 剔除。
 */
function dropOnSlot(payload, targetIndex) {
  const mod = DATA.modById.get(payload.id);
  if (!mod) return;
  if (isExilusMod(mod)) {
    flash('该 Mod 只能放入劣化槽');
    return;
  }

  if (payload.from === 'slot' && typeof payload.index === 'number') {
    // D-038：目标槽已占用则拒绝（拖到已占用的槽显示禁止符号，不会顶掉别人的 Mod）
    if (modSlots[targetIndex]) return;
    modSlots[targetIndex] = modSlots[payload.index];
    modSlots[payload.index] = null;
  } else {
    // 目标槽已占用则拒绝
    if (modSlots[targetIndex]) return;
    insertCompact(payload.id, targetIndex);
  }
  renderAll();
}

/**
 * 槽位内移动（D-035）：**直接交换两个位置**，不做整体平移、不做自动紧凑。
 * 放在哪个位置就是哪个位置，空槽就保持空着。
 */
function moveWithinSlots(from, to) {
  if (from === to) return;
  const a = modSlots[from];
  const b = modSlots[to];
  modSlots[to] = a;
  modSlots[from] = b;
}

/**
 * 从备选区拖入（D-035）：**放在哪个位置就是哪个位置**，不做自动紧凑。
 *
 * ```
 * · 目标槽为空     → 直接放进去，其他槽一律不动；
 * · 目标槽已有 Mod → 原来那张退回备选区，新 Mod 占位，其他槽不动。
 * ```
 * 空出来的槽保持空着，后面的 Mod **不会**自动前移填洞（这是 D-035 对 D-034 的修订）。
 */
function insertCompact(modId, index) {
  const out = modSlots.slice();
  const existing = out.indexOf(modId);
  if (existing >= 0) out[existing] = null;
  // 目标位原内容退回备选区（不挪到其它槽）
  out[index] = modId;
  for (let i = 0; i < SLOT_COUNT; i++) modSlots[i] = out[i];
}

function placeMod(modId, index) {
  const mod = DATA.modById.get(modId);
  if (!mod) return;
  if (index === EXILUS_INDEX) {
    if (!isExilusMod(mod)) {
      flash('劣化槽只能放入功能类 Mod');
      return;
    }
    exilusModId = modId;
  } else {
    if (isExilusMod(mod)) {
      flash('功能类 Mod 只能放入劣化槽');
      return;
    }
    const existing = modSlots.indexOf(modId);
    if (existing >= 0) modSlots[existing] = null;
    modSlots[index] = modId;
  }
  dragPayload = null;
  renderAll();
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
    if (exilusModId) return null; // 劣化槽已占用
    const saved = exilusModId;
    exilusModId = mod.id;
    const c = currentContributions();
    exilusModId = saved;
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
  const mods = DATA.availableMods;
  // 已装备的 Mod 不在备选区重复显示（D-034）
  const installed = new Set();
  for (let i = 0; i < SLOT_COUNT; i++) if (modSlots[i]) installed.add(modSlots[i]);
  if (exilusModId) installed.add(exilusModId);

  for (let i = 0; i < mods.length; i++) {
    const mod = mods[i];
    if (installed.has(mod.id)) continue;
    if (!matchesFilter(mod, state.filter)) continue;
    const name = modName(mod);
    if (state.search && name.toLowerCase().indexOf(state.search.toLowerCase()) < 0) continue;

    const exilus = isExilusMod(mod);
    // 模拟"装备这张 Mod"：找第一个空位放进去，
    // **不能**直接替换已装备的 Mod —— 那样会把原有收益一起算掉，出现大把负数。
    const nextContribs = simulateEquip(mod, exilus);
    let gain = null;
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
  $('#candidate-count').textContent = rows.length + ' / ' + DATA.availableMods.length;
}

function candidateCard(row) {
  const mod = row.mod;
  const card = el('div', 'cand');
  makeDraggable(card, { kind: 'mod', id: mod.id, exilus: row.exilus, from: 'list' });

  const top = el('div', 'cand-top');
  top.append(el('span', 'cand-name', modName(mod)));
  if (row.exilus) top.append(el('span', 'tag', '功能'));
  card.append(top);

  const statText = [];
  for (let i = 0; i < mod.stats.length; i++) {
    const s = mod.stats[i];
    if (!s.bucket) continue;
    const max = s.levelValues[s.levelValues.length - 1];
    statText.push(statLabel(s.stat) + ' ' + (max > 0 ? '+' : '') + max);
  }
  card.append(el('div', 'cand-stats', statText.join(' · ') || '无伤害加成'));

  const gainEl = el('div', 'cand-gain');
  const cls = row.gain === null ? '' : row.gain >= 0.00005 ? 'pos' : row.gain <= -0.00005 ? 'neg' : '';
  gainEl.append(el('span', 'gain-label', '增幅'));
  gainEl.append(el('span', 'gain-val ' + cls, fmtPct(row.gain)));
  card.append(gainEl);

  card.addEventListener('click', function () { showDetail(row); });
  return card;
}

// ─────────────────────────────────────────────────────────────
// 拆解
// ─────────────────────────────────────────────────────────────

function showDetail(row) {
  const box = $('#detail');
  box.innerHTML = '';
  const mod = row.mod;
  box.append(el('h3', '', modName(mod)));

  const ul = el('ul', 'detail-list');
  for (let i = 0; i < mod.stats.length; i++) {
    const s = mod.stats[i];
    const max = s.levelValues[s.levelValues.length - 1];
    ul.append(el('li', '', statLabel(s.stat) + '：' + (max > 0 ? '+' : '') + max));
  }
  box.append(ul);

  const cur = runCompute(currentContributions());

  // 用与备选区一致的模拟方式（装到空位，不顶掉已有 Mod）
  const nextContribs = simulateEquip(mod, row.exilus);
  if (!nextContribs) {
    box.append(el('div', 'muted', '当前配置已满，无法装备这张 Mod'));
    return;
  }
  const next = runCompute(nextContribs);

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

  // 暴击变动（D-038）：暴击几率 / 暴击伤害 / 平均倍率 前后对照
  const curSeg = cur.segments[0];
  const seg = next.segments[0];
  const critBox = el('div', 'merge-box');
  critBox.append(el('div', 'section-title', '暴击变动'));
  const ctab = el('table', 'detail-table');
  const ch = el('tr');
  ['', '当前', '装备后', '变化'].forEach(function (h) { ch.append(el('th', '', h)); });
  ctab.append(ch);

  const critRows = [
    ['暴击几率', curSeg.critChance, seg.critChance, 'pct'],
    ['暴击伤害', curSeg.critDamage, seg.critDamage, 'x'],
    ['平均暴击倍率', critAverage(1, curSeg.critChance, curSeg.critDamage), critAverage(1, seg.critChance, seg.critDamage), 'x'],
  ];
  let critChanged = false;
  for (let i = 0; i < critRows.length; i++) {
    const name = critRows[i][0];
    const a = critRows[i][1];
    const b = critRows[i][2];
    const kind = critRows[i][3];
    const diff = b - a;
    if (Math.abs(diff) > 1e-9) critChanged = true;
    const tr = el('tr');
    tr.append(el('td', '', name));
    tr.append(el('td', '', kind === 'pct' ? (a * 100).toFixed(2) + '%' : '×' + a.toFixed(3)));
    tr.append(el('td', '', kind === 'pct' ? (b * 100).toFixed(2) + '%' : '×' + b.toFixed(3)));
    if (Math.abs(diff) < 1e-9) {
      tr.append(el('td', '', '—'));
    } else {
      // 变化量统一用 % 表示（不用 pp）
      const txt = kind === 'pct'
        ? ((a !== 0 ? diff / a : 0) >= 0 ? '+' : '') + (a !== 0 ? (diff / a) * 100 : 0).toFixed(2) + '%'
        : (diff >= 0 ? '+' : '') + diff.toFixed(3);
      tr.append(el('td', diff > 0 ? 'pos' : 'neg', txt));
    }
    ctab.append(tr);
  }
  critBox.append(ctab);
  if (critChanged) critBox.classList.add('changed');
  box.append(critBox);

  const ct = critTiers(seg.critChance, seg.critDamage);
  const tierBox = el('div', 'merge-box');
  tierBox.append(el('div', 'section-title', '暴击分档'));
  tierBox.append(el('div', 'merge-src', ct.map(function (t) {
    return '等级 ' + t.k + '：' + (t.prob * 100).toFixed(1) + '% × ' + t.mul.toFixed(2);
  }).join('　')));
  tierBox.append(el('div', 'merge-src', '平均 ' + critAverage(1, seg.critChance, seg.critDamage).toFixed(3) + ' 倍'));
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
  if (!co.active) return;

  box.append(el('div', 'section-title', '镀层加成'));

  const row = el('div', 'controls-row');

  const aLabel = el('label', '', '目标异常状态种类');
  const aSel = el('select');
  for (let i = 0; i <= 10; i++) {
    const o = el('option', '', String(i));
    o.value = String(i);
    aSel.append(o);
  }
  aSel.value = String(state.coStatusTypes);
  aSel.addEventListener('change', function (e) { state.coStatusTypes = Number(e.target.value); renderAll(); });
  aLabel.append(aSel);
  row.append(aLabel);

  const yLabel = el('label', '', '叠加层数');
  const ySel = el('select');
  for (let i = 0; i <= co.maxStacks; i++) {
    const o = el('option', '', String(i));
    o.value = String(i);
    ySel.append(o);
  }
  ySel.value = String(state.coStacks > 0 ? state.coStacks : co.maxStacks);
  ySel.addEventListener('change', function (e) { state.coStacks = Number(e.target.value); renderAll(); });
  yLabel.append(ySel);
  row.append(yLabel);

  box.append(row);

  const x = co.perStack;
  const y = state.coStacks > 0 ? state.coStacks : co.maxStacks;
  const a = state.coStatusTypes;
  box.append(el('div', 'muted', co.sources.join('、') + '：每层 ' + x + '% × ' + a + ' × ' + y + ' = ' + (x * a * y) + '%'));
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

  // 拖回备选区 = 卸下
  const list = $('#candidate-list');
  list.addEventListener('dragover', function (e) {
    if (!dragPayload) return;
    if (dragPayload.from === 'list') return; // 从备选区内部拖，不处理
    e.preventDefault();
    list.classList.add('drop-target');
  });
  list.addEventListener('dragleave', function () { list.classList.remove('drop-target'); });
  list.addEventListener('drop', function (e) {
    e.preventDefault();
    list.classList.remove('drop-target');
    if (!dragPayload) return;
    dropHappened = true; // 已在 drop 里处理，dragend 不要重复卸下
    removeByPayload(dragPayload);
    dragPayload = null;
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
  const contribs = currentContributions();
  const res = runCompute(contribs);
  renderHeader();
  renderPanel(res);
  renderSlots();
  renderControls();
  renderCandidates(res);
  renderArcaneList();
  // 不再显示"可装 N 张"（信息噪音），保留元素留空
  $('#slot-info').textContent = '';
  if (!$('#detail').firstChild) {
    $('#detail').append(el('div', 'muted', '点击备选 Mod 查看拆解'));
  }
}

/** 赋能列表（D-032 / D-034）：只放步枪赋能，多列网格，只显示名字 */
function renderArcaneList() {
  const box = $('#arcane-list');
  box.innerHTML = '';
  const list = DATA.primaryArcanes;
  let shown = 0;
  for (let i = 0; i < list.length; i++) {
    // 已装备的赋能不在列表里重复显示（D-034）
    if (arcaneKey === list[i].key) continue;
    box.append(arcaneCard(list[i]));
    shown++;
  }
  $('#arcane-count').textContent = shown + ' 个';
}

function arcaneCard(arc) {
  const card = el('div', 'cand arcane-cand');
  makeDraggable(card, { kind: 'arcane', key: arc.key, from: 'list' });

  const top = el('div', 'cand-top');
  top.append(el('span', 'cand-name', arc.name.zh || arc.name.en));
  card.append(top);
  // 只显示名字；效果描述等数据修正后再优化（D-034）
  return card;
}

// ─────────────────────────────────────────────────────────────
// 武器编辑器（D-044，仅开发态）
//
// 可编辑：面板数值 / 伤害分布 / trigger / 每段 procChance。
// 不可编辑：面板总伤（恒等于 Σ damage，只读显示）。
// 保存：POST /__save-weapon → packages/data/src/manual/weapon-overrides.json
// ─────────────────────────────────────────────────────────────

const EDITABLE_WEAPON_FIELDS = [
  ['critChance', '暴击几率', 'ratio'],
  ['critMultiplier', '暴击伤害', 'x'],
  // 触发几率只在这里编辑；模式里不再重复出现（D-048）
  ['statusChance', '触发几率', 'ratio'],
  ['fireRate', '射速', 'num'],
  ['magazineSize', '弹匣容量', 'num'],
  ['reloadTime', '装填时间', 'num'],
];

const TRIGGER_OPTIONS = [
  'auto', 'burst', 'semi', 'charged', 'active', 'held', 'duplex', 'none', 'unknown',
];

/**
 * 发射器类型的展示名与特点说明（D-048）。
 * 下拉显示「中文名（特点）」，同时保留英文原值，方便人工核对数据。
 */
const TRIGGER_LABELS = {
  auto: ['全自动', '按住持续射击'],
  semi: ['半自动', '每点一次打一发'],
  burst: ['点射', '一次扣扳机打出多连发'],
  charged: ['蓄力', '按住蓄力后释放，伤害通常更高'],
  active: ['主动', '需手动触发，如次要开火'],
  held: ['持续引导', '按住持续输出，如光束类'],
  duplex: ['双发', '扣扳机与松开各打一发'],
  none: ['无', '武器本身不直接射击'],
  unknown: ['未标注', '数据未给出，待人工确认'],
};

function triggerLabel(t) {
  const e = TRIGGER_LABELS[t];
  return e ? e[0] + '（' + e[1] + '）' : t;
}

/** 编辑器工作副本（打开时从 DATA.weapon 深拷贝） */
let editorDraft = null;

async function detectDevMode() {
  try {
    const r = await fetch('/__dev');
    if (!r.ok) return false;
    const j = await r.json();
    return Boolean(j && j.canEdit);
  } catch {
    return false; // 静态部署：没有后端 → 不显示编辑入口
  }
}

function openEditor() {
  editorDraft = JSON.parse(JSON.stringify({
    weaponId: DATA.weapon.id,
    name: DATA.weapon.name,
    nameZh: DATA.weapon.nameZh,
    critChance: DATA.weapon.critChance,
    critMultiplier: DATA.weapon.critMultiplier,
    statusChance: DATA.weapon.statusChance,
    fireRate: DATA.weapon.fireRate,
    magazineSize: DATA.weapon.magazineSize,
    reloadTime: DATA.weapon.reloadTime,
    modes: DATA.weapon.modes.map(function (m) {
      return {
        id: m.id,
        role: m.role,
        trigger: m.trigger,
        procChance: m.segments[0] ? m.segments[0].procChance : 0,
        // D-050：模式级面板覆盖（没写就是空，编辑时会按需填）
        override: m.override ? { ...m.override } : undefined,
        segments: m.segments.map(function (s) {
          return { kind: s.kind, aoe: s.aoe, damage: { ...s.damage }, procChance: s.procChance };
        }),
      };
    }),
  }));
  $('#editor-overlay').style.display = 'flex';
  renderEditor();
}

function closeEditor() {
  $('#editor-overlay').style.display = 'none';
}

function renderEditor() {
  const body = $('#editor-body');
  body.innerHTML = '';
  if (!editorDraft) return;

  $('#editor-title').textContent = '编辑：' + (editorDraft.nameZh || editorDraft.name) + '（' + editorDraft.name + '）';

  // ── 每个模式一组：面板数值 + 发射器类型 + 伤害分布（D-050）──
  // 不同模式的面板可能不同（灵化模式、三模式武器），所以面板数值挂在模式上，模式在最上面。
  for (let mi = 0; mi < editorDraft.modes.length; mi++) {
    const mode = editorDraft.modes[mi];
    body.append(el('h3', 'editor-section', '模式：' + mode.id));

    // 面板数值（该模式自己的；未填则回退武器级）
    const grid = el('div', 'editor-grid');
    for (let i = 0; i < EDITABLE_WEAPON_FIELDS.length; i++) {
      const key = EDITABLE_WEAPON_FIELDS[i][0];
      const label = EDITABLE_WEAPON_FIELDS[i][1];
      const kind = EDITABLE_WEAPON_FIELDS[i][2];
      const row = el('label', 'editor-field');
      row.append(el('span', 'editor-label', label));
      const input = el('input', 'editor-input');
      input.type = 'number';
      input.step = '0.01';
      // 当前生效值 = 模式 override ?? 武器级
      const effective = mode.override && mode.override[key] !== undefined
        ? mode.override[key] : editorDraft[key];
      if (kind === 'ratio') {
        input.value = String(+(effective * 100).toFixed(4));
        input.dataset.percent = '1';
      } else {
        input.value = String(effective);
      }
      input.addEventListener('input', function (e) {
        const raw = Number(e.target.value);
        const v = input.dataset.percent ? raw / 100 : raw;
        if (!Number.isFinite(v)) return;
        // 写进该模式的 override
        mode.override = mode.override || {};
        mode.override[key] = v;
        // 触发几率同时同步到分段（内核读的是段上的 procChance）
        if (key === 'statusChance') {
          mode.procChance = v;
          for (const s of mode.segments || []) s.procChance = v;
        }
      });
      row.append(input);
      grid.append(row);
    }
    body.append(grid);

    // 发射器类型：中文名 + 括号特点说明（D-048）。
    // 触发几率**不**在这里重复出现——它属于武器级字段，只在「面板数值」里编辑。
    const metaRow = el('div', 'editor-meta-row');

    const tField = el('label', 'editor-field');
    tField.append(el('span', 'editor-label', '发射器类型'));
    const tSel = el('select');
    for (let i = 0; i < TRIGGER_OPTIONS.length; i++) {
      const key = TRIGGER_OPTIONS[i];
      const o = el('option', '', triggerLabel(key));
      o.value = key;
      tSel.append(o);
    }
    tSel.value = TRIGGER_OPTIONS.indexOf(mode.trigger) >= 0 ? mode.trigger : 'unknown';
    tSel.addEventListener('change', function (e) { mode.trigger = e.target.value; });
    tField.append(tSel);
    metaRow.append(tField);

    body.append(metaRow);

    // 伤害分布（可增删类型）
    body.append(el('div', 'editor-sub', '伤害分布'));
    const dmgWrap = el('div', 'editor-dmg-list');
    renderEditorDamage(mode, dmgWrap, mi);
    body.append(dmgWrap);

    // 「添加伤害类型」放在面板总伤**上面**：
    // 下拉选类型（D-049，不再自动取第一个可用项）+ 添加按钮
    const addRow = el('div', 'editor-add-row');

    const used = new Set(Object.keys(mode.segments[0] ? mode.segments[0].damage : {}));
    const avail = Object.keys(ELEMENT_LABEL).filter(function (t) { return !used.has(t); });

    const addSel = el('select', 'editor-add-select');
    for (let i = 0; i < avail.length; i++) {
      const o = el('option', '', ELEMENT_LABEL[avail[i]]);
      o.value = avail[i];
      addSel.append(o);
    }
    addRow.append(addSel);

    const addBtn = el('button', 'btn-ghost', '+ 添加伤害类型');
    addBtn.type = 'button';
    if (!avail.length) {
      addBtn.disabled = true;
      addSel.disabled = true;
      addSel.append(el('option', '', '（已无可用类型）'));
    }
    (function (m, sel) {
      addBtn.addEventListener('click', function () {
        const t = sel.value;
        if (!t) return;
        const seg = m.segments[0];
        if (!seg) return;
        seg.damage[t] = 0;
        renderEditor();
      });
    })(mode, addSel);
    addRow.append(addBtn);

    body.append(addRow);

    // 面板总伤（只读，由分布求和）
    const total = el('div', 'editor-total');
    fillEditorTotal(total, mode);
    total.dataset.totalFor = String(mi);
    body.append(total);
  }
}

function renderEditorDamage(mode, wrap, mi) {
  wrap.innerHTML = '';
  const seg = mode.segments[0];
  if (!seg) return;
  const types = Object.keys(seg.damage);
  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    const row = el('div', 'editor-dmg-row');
    row.append(el('span', 'editor-dmg-name', ELEMENT_LABEL[t] || t));
    const input = el('input', 'editor-input');
    input.type = 'number';
    input.step = '0.01';
    input.min = '0';
    input.value = String(seg.damage[t]);
    input.addEventListener('input', function (e) {
      const v = Number(e.target.value);
      seg.damage[t] = Number.isFinite(v) && v >= 0 ? v : 0;
      input.value = String(seg.damage[t]);
      // 总伤只读，实时跟着分布变
      const totalBox = $('.editor-total[data-total-for="' + mi + '"]');
      if (totalBox) fillEditorTotal(totalBox, mode);
    });
    row.append(input);
    const del = el('button', 'btn-ghost btn-tiny', '删除');
    del.type = 'button';
    del.addEventListener('click', function () {
      delete seg.damage[t];
      renderEditor();
    });
    row.append(del);
    wrap.append(row);
  }
  if (!types.length) wrap.append(el('div', 'muted', '无伤害类型，请添加'));
}

/** 面板总伤只读显示：恒等于 Σ damage */
function fillEditorTotal(box, mode) {
  const seg = mode.segments[0];
  let sum = 0;
  if (seg) {
    for (const v of Object.values(seg.damage)) sum += Number(v) || 0;
  }
  box.innerHTML = '';
  box.append(el('span', 'editor-label', '面板总伤'));
  box.append(el('span', 'editor-total-val', sum.toFixed(2)));
}

async function saveEditor() {
  const msg = $('#editor-msg');
  msg.textContent = '保存中…';
  msg.className = 'editor-msg';
  // D-050：触发几率现在挂在每个模式的 override 上；保存前仍要同步到分段的 procChance，
  // 否则内核读段上的旧值。
  if (editorDraft) {
    for (const m of editorDraft.modes || []) {
      const sc = m.override && m.override.statusChance;
      if (Number.isFinite(sc)) {
        m.procChance = sc;
        for (const s of m.segments || []) s.procChance = sc;
      }
    }
  }
  try {
    const r = await fetch('/__save-weapon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editorDraft),
    });
    const j = await r.json();
    if (!j.ok) {
      msg.textContent = '保存失败：' + (j.errors || []).join('；');
      msg.className = 'editor-msg neg';
      return;
    }
    msg.textContent = '已保存到 ' + j.path;
    msg.className = 'editor-msg pos';
    // D-046：保存后立即重新合并并重渲染，不需要刷新页面
    await reloadWeaponOverrides(true);
    flash('已保存并生效');
  } catch (err) {
    msg.textContent = '保存失败：' + String(err);
    msg.className = 'editor-msg neg';
  }
}

/** 读取 overrides，刷新「已修改」标记 */
// ─────────────────────────────────────────────────────────────
// overrides 合并（D-046）
//
// 优先级：generated < manual/weapon-overrides.json
// 规则：
//   · 武器级 6 个数值字段 → 标量覆盖
//   · 模式按 **id** 匹配（不按下标），匹配不到则忽略并警告
//   · 分段按下标覆盖 damage / procChance
//   · damage **整体替换**（因为编辑器允许删除某个伤害类型）
//   · 未出现在 override 里的字段保留 generated 原值
// ─────────────────────────────────────────────────────────────

const OVERRIDE_WEAPON_FIELDS = [
  'critChance', 'critMultiplier', 'statusChance', 'fireRate', 'magazineSize', 'reloadTime',
];

/**
 * 把一条 override 合并进武器对象（原地修改并返回）。
 * ⚠ 调用方必须传入**深拷贝**，否则会把 override 写回 generated 的原对象，
 *   下次再合并就会叠加（比如射速被乘两次）。
 * @param weapon 武器对象的深拷贝
 * @param ov 该武器对应的 override（可为空）
 */
function mergeWeaponOverride(weapon, ov) {
  if (!ov) return weapon;

  // ① 武器级数值：标量覆盖
  for (let i = 0; i < OVERRIDE_WEAPON_FIELDS.length; i++) {
    const k = OVERRIDE_WEAPON_FIELDS[i];
    if (ov[k] !== undefined && Number.isFinite(ov[k])) weapon[k] = ov[k];
  }

  // ② 模式：按 id 匹配
  if (Array.isArray(ov.modes)) {
    for (let i = 0; i < ov.modes.length; i++) {
      const om = ov.modes[i];
      if (!om || typeof om.id !== 'string') continue;
      const target = weapon.modes.find(function (m) { return m.id === om.id; });
      if (!target) {
        console.warn('override 里的模式「' + om.id + '」在武器数据中不存在，已忽略');
        continue;
      }
      // trigger / role
      if (typeof om.trigger === 'string') target.trigger = om.trigger;
      if (typeof om.role === 'string') target.role = om.role;

      // D-050：模式级面板覆盖（只接受有限数值，非法值忽略）
      if (om.override && typeof om.override === 'object') {
        const ov = {};
        for (const [k, v] of Object.entries(om.override)) {
          if (!OVERRIDE_WEAPON_FIELDS.includes(k)) continue;
          if (typeof v === 'number' && Number.isFinite(v)) ov[k] = v;
        }
        target.override = Object.keys(ov).length ? ov : undefined;
      }

      // ③ 分段：按下标覆盖
      if (Array.isArray(om.segments) && target.segments) {
        if (om.segments.length !== target.segments.length) {
          console.warn('模式「' + om.id + '」的分段数量不一致（override ' + om.segments.length +
            ' / 原 ' + target.segments.length + '），按 override 为准');
        }
        for (let s = 0; s < om.segments.length && s < target.segments.length; s++) {
          const os = om.segments[s];
          const ts = target.segments[s];
          if (!os || !ts) continue;
          if (Number.isFinite(os.procChance)) ts.procChance = os.procChance;
          // damage 整体替换（支持"删除某伤害类型"）
          if (os.damage && typeof os.damage === 'object') {
            const clean = {};
            for (const [t, v] of Object.entries(os.damage)) {
              clean[t] = Number.isFinite(v) && v >= 0 ? v : 0;
            }
            ts.damage = clean;
          }
        }
      }
      // 若 override 只给了模式的 procChance（编辑器这么存），把它同步到所有分段
      if (Number.isFinite(om.procChance)) {
        for (let s = 0; s < target.segments.length; s++) {
          target.segments[s].procChance = om.procChance;
        }
      }
    }
  }
  return weapon;
}

/** 读取 overrides 并应用到当前武器，然后重渲染 */
async function reloadWeaponOverrides(applyToWeapon) {
  try {
    const r = await fetch('/__weapon-overrides');
    if (!r.ok) return;
    const all = await r.json();
    DATA.overrides = all || {};
    if (applyToWeapon) {
      // 每次都从「generated 的深拷贝」出发再合并，保证不会叠加
      const fresh = JSON.parse(JSON.stringify(DATA.baseWeapon));
      DATA.weapon = mergeWeaponOverride(fresh, DATA.overrides[DATA.baseWeapon.id]);
      // 玄骸系判定也可能随 name/variant 变化，重新算一次
      DATA.isKuva = isKuvaFamily(DATA.weapon.id, DATA.weapon.variantType, DATA.weapon.name);
      renderAll();
    }
    renderModifiedBadge();
  } catch {
    /* 静态部署下没有这个接口，忽略 */
  }
}

function renderModifiedBadge() {
  const badge = $('#modified-badge');
  if (!badge) return;
  const has = Boolean(DATA.overrides && DATA.overrides[DATA.weapon.id]);
  badge.style.display = has ? '' : 'none';
}

function wireEditor() {
  const openBtn = $('#open-editor');
  if (openBtn) openBtn.addEventListener('click', openEditor);
  const closeBtn = $('#editor-close');
  if (closeBtn) closeBtn.addEventListener('click', closeEditor);
  const saveBtn = $('#editor-save');
  if (saveBtn) saveBtn.addEventListener('click', saveEditor);
  const resetBtn = $('#editor-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      editorDraft = null;
      closeEditor();
      flash('已放弃本次编辑');
    });
  }
  // 点遮罩关闭
  const overlay = $('#editor-overlay');
  if (overlay) {
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeEditor();
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 启动
// ─────────────────────────────────────────────────────────────

async function boot() {
  const results = await Promise.all([
    fetch('/packages/data/src/generated/weapons/primary.json').then(function (r) { return r.json(); }),
    fetch('/packages/data/src/generated/mods/weapon-slots.json').then(function (r) { return r.json(); }),
    fetch('/packages/data/src/generated/mods/mods.json').then(function (r) { return r.json(); }),
    fetch('/packages/data/src/generated/mods/arcanes.json').then(function (r) { return r.json(); }),
  ]);

  const weapons = results[0];
  const slotFile = results[1];
  const modFile = results[2];
  const arcaneFile = results[3];

  const weapon = weapons.weapons.find(function (w) { return w.id === WEAPON_ID; });
  if (!weapon) throw new Error('找不到武器 ' + WEAPON_ID);
  // 默认选中 primary 模式（若没有则取第一个）
  const primaryIdx = weapon.modes.findIndex(function (m) { return m.id === MODE_ID; });
  state.modeIndex = primaryIdx >= 0 ? primaryIdx : 0;

  const entry = slotFile.weapons[WEAPON_ID];
  const kinds = modKindsFor(entry, entry.slots);
  // 先按可装种类筛，再按武器专属兼容性筛（D-029）
  const availableMods = modFile.mods
    .filter(function (m) { return kinds.indexOf(m.slotKind) >= 0; })
    .filter(function (m) { return isModCompatibleWithWeapon(m, weapon); })
    .sort(function (a, b) { return String(modName(a)).localeCompare(String(modName(b)), 'zh-CN'); });

  const byId = new Map();
  availableMods.forEach(function (m) { byId.set(m.id, m); });
  const arcaneByKey = new Map();

  // 玄骸 / 信条 / 终幕 系武器才有元素加成（D-042）。必须带 name——
  // 很多玄骸武器的内部 id 是 GrnBowWeapon / CrpBEArcaPlasmor 之类，光看 id 会漏判。
  const isKuva = isKuvaFamily(weapon.id, weapon.variantType, weapon.name);

  DATA = {
    // baseWeapon 保持 generated 的原样，合并 override 时每次从它出发，避免叠加
    baseWeapon: weapon,
    weapon: weapon,
    isKuva: isKuva,
    availableMods: availableMods,
    modById: byId,
    arcaneByKey: arcaneByKey,
    primaryArcanes: [],
    slotKinds: kinds,
    overrides: {},
  };

  arcaneFile.arcanes.forEach(function (a) {
    arcaneByKey.set(a.key, a);
    if (a.category === 'primary') DATA.primaryArcanes.push(a);
  });

  // D-052：默认**不预装任何 Mod**，进页面是空配置，由用户自己拖。
  // （此前会预填 8 张步枪 Mod，导致"当前面板"一进页面就已经被加成过，不好核对）

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
  wireEditor();
  renderAll();

  // 开发态才显示「编辑」按钮（D-044）；静态部署没有后端，不渲染
  const dev = await detectDevMode();
  const openBtn = $('#open-editor');
  if (openBtn) openBtn.style.display = dev ? '' : 'none';
  // D-046：开发态首屏就把 overrides 合进武器数据
  if (dev) await reloadWeaponOverrides(true);
}

boot().catch(function (err) {
  console.error(err);
  document.body.innerHTML = '<pre style="color:#e06060;padding:24px">' + (err.stack || err) + '</pre>';
});
