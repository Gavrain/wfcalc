/**
 * 页面共享状态（D-105 第一步：把隐式全局收敛成一个显式对象）。
 *
 * 为什么要有这一层：`app.js` 里 `state.` 出现 46 次、`modSlots` 31 次、
 * `exilusModId` 19 次、`dragPayload` 16 次。这些变量如果直接散在各个模块里，
 * 拆文件之后就变成互相看不见的隐式全局——改一处忘一处。
 *
 * 约定：
 *   · 字段**直接读写**（`store.modSlots[0] = 'serration'`），不做 setter；
 *   · 只有「整体替换」的字段（`store.data` / `store.dataAll`）才走函数，
 *     免得某个模块拿着旧的引用继续算；
 *   · 这里不放任何 DOM 操作、不放任何计算公式。
 *
 * 浏览器与 Node 校对脚本都用同一个文件（纯 JS，无 Node API）。
 */

/** Mod 槽位数量（两行四列）／劣化槽索引 */
export const SLOT_COUNT = 8;
export const EXILUS_INDEX = 8;
export const MAX_SLOTS = 9;

/**
 * 裂罅在 Mod 槽里的「占位 id」（D-162）。
 *
 * 裂罅**不是** `mods.json` 里的一张卡，它有自己的词条组合；但槽位数组只存 id 字符串，
 * 所以用一个不会和真实 mod id 冲突的常量当占位。真实数据在 `store.riven` 里。
 */
export const RIVEN_SLOT_ID = '__riven__';

/** 冰冻满层数（与 core 的 FROZEN_FULL_STACKS 保持一致） */
export const FROZEN_FULL_STACKS = 10;

/** 界面选项（不属于任何"状态"，放这里方便别的模块引用） */
export const FACTION_OPTIONS = [
  ['none', '无'],
  ['grineer', 'Grineer'],
  ['corpus', 'Corpus'],
  ['infested', 'Infested'],
  ['orokin', 'Orokin'],
  ['murmur', 'Murmur'],
];

/** 玄骸加成可选元素：冰、火、毒、电、磁力、辐射、冲击 */
export const KUVA_ELEMENTS = ['cold', 'heat', 'toxin', 'electric', 'magnetic', 'radiation', 'impact'];

/** 元素 / 物理类型的中文名（编辑器、伤害分布、玄骸下拉都用这一份） */
export const ELEMENT_LABEL = {
  impact: '冲击', puncture: '穿刺', slash: '切割',
  heat: '火焰', cold: '冰冻', electric: '电击', toxin: '毒素',
  blast: '爆炸', gas: '毒气', magnetic: '磁力', radiation: '辐射',
  corrosive: '腐蚀', viral: '病毒', void: '虚空', tau: 'Tau',
};

/** 元素 / 物理类型的图表颜色 */
export const ELEMENT_COLOR = {
  impact: '#8fa3b8', puncture: '#b8a78f', slash: '#b85f6a',
  heat: '#e8703a', cold: '#5fb8d8', electric: '#c9a83a', toxin: '#6ab04c',
  blast: '#d98f5a', gas: '#7fbf5a', magnetic: '#8f7fd8', radiation: '#c8d85a',
  corrosive: '#8fbf7a', viral: '#b06fc0',
};

/** 乘区名的中文表（基伤 / 多重 / …） */
export const BUCKET_LABEL = {
  baseDamage: '基伤', multishot: '多重', elemental: '元素', physical: '物理',
  critChance: '暴击几率', critMultiplier: '暴击伤害', statusChance: '触发几率',
  faction: '派系', fireRate: '射速', utility: '通用',
};

/** 数字格式：千分位 + 固定小数位；非数字显示「—」 */
export function fmt(v, d = 2) {
  return Number.isFinite(v) ? v.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
}

/** 百分比格式：带符号 */
export function fmtPct(v, d = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%';
}

/** 乘区 → 中文名（元素 / 物理 / 派系走各自的分支） */
export function bucketLabel(stat) {
  if (stat.startsWith('elemental:')) return ELEMENT_LABEL[stat.split(':')[1]] || '元素';
  if (stat.startsWith('physical:')) return ELEMENT_LABEL[stat.split(':')[1]] || '物理';
  if (stat.startsWith('faction:')) return '派系';
  if (stat === 'co') return '基伤';
  return BUCKET_LABEL[stat] || stat;
}

/** 一份伤害分布（类型 → 数值）的合计 */
export function spreadTotalOf(spread) {
  let total = 0;
  for (const k of Object.keys(spread)) total += spread[k] || 0;
  return total;
}

export const store = {
  /** 界面选项状态（派系 / 爆头 / 玄骸 / 镀层层数 / 筛选 / 搜索 / 当前模式与变体） */
  ui: {
    metric: 'perShot',
    faction: 'none',
    headshot: false,
    headshotMult: 3,
    kuvaType: 'heat',
    kuvaRatio: 0.6,
    /** 镀层：敌人身上的**异况种类数**（需求方 2026-11-06：默认 0，加成随之不生效） */
    coStatusTypes: 0,
    /** 镀层：叠加层数。**默认取叠层上限**（D-112 / D-117：以前用 0 表示"取上限"，
     *  结果 0 层永远选不中；现在 0 就是真正的 0 层，默认值由 `coDefaults()` 填上限） */
    coStacks: 0,
    /** 未装备镀层类 Mod 时是否做「假设装备」推演（默认开，见 D-113） */
    coPreview: true,
    /** 敌人当前冰冻层数（D-086：次要·冷颤按冰冻层数生效） */
    coFreezeStacks: 0,
    /**
     * 近战**连击倍率**（需求方 2026-11-13）。
     *
     * 急进猛突 / 创口溃烂是「每层连击倍率 +X%」，实际加量 = X% × 连击倍率。
     * 近战武器**始终显示**这个配置框，默认 12x（带凯旋之爪满层为 13x）。
     */
    comboMultiplier: 12,
    /**
     * 次要·爆发的**爆发层数**（需求方 2026-11-13）。
     *
     * 描述是「消耗所有连击倍率，每层消耗的连击倍率 +20% 暴率 / +20% 暴伤」，
     * 层数 = 被消耗的连击倍率。**只有装上次要·爆发时才显示**这个配置框，
     * 默认 12 层，最高 13 层。
     */
    burstStacks: 12,
    filter: 'all',
    search: '',
    modeIndex: 0, // 当前选中的攻击模式（D-042：多面板武器可切换）
    /**
     * 当前模式内**勾选了哪些攻击方式**（需求方 2026-11-12）。
     *
     * 一个模式可以有多种攻击方式（弹头命中 / 爆炸 / 射线 / 蓄力），
     * 界面用复选框选哪些参与计算，选中的高亮——像切换统计口径那样。
     * `null` = 全选（切换武器/模式时重置为全选）。
     */
    selectedVariants: null,
    /** 旧字段，保留只为兼容读取；新代码用 `selectedVariants` */
    variantIndex: 0,

    /**
     * 「N 秒异常总伤 / N 秒总伤」的窗口长度（秒，D-171，需求方 2026-11-13）。
     *
     * 在左栏那两个口径的名字后面用下拉框选，默认 6 秒（与以前的「六秒」一致）。
     * 超过 6 秒的不做（需求方：「6 后面就不要了，通常不会连续射击那么久」）。
     */
    dotWindowSeconds: 6,

    /**
     * 裂罅 Mod 区展开状态（D-162，需求方 2026-11-12）。
     *
     * 裂罅区默认收起（它是「做一张特定的紫卡」时才用的折叠面板），
     * 展开/收起不写进配卡存档，刷新后回到收起。
     */
    rivenOpen: false,
    /** 待选词条区按什么取值算：'min' | 'avg' | 'max'（默认平均，需求方 2026-11-12） */
    rivenValueMode: 'avg',
    /**
     * 待选词条区的排序方式（D-168，需求方 2026-11-12）。
     *
     * | 值 | 名称 | 说明 |
     * |---|---|---|
     * | `default`  | 默认      | 按词条表本身的顺序（普通词条 → 物理 → 元素 → 派系） |
     * | `gain`     | 增幅      | 这条词条装进当前裂罅后的增幅，从高到低 |
     * | `gainAsc`  | 增幅↑    | 增幅从低到高（看"哪些词条会拖后腿"） |
     * | `value`    | 数值      | 当前属性基准下的数值，从高到低（同类词条横向比大小） |
     * | `max`      | 最高值    | 该词条在当前组合下能洗到的最大值，从高到低 |
     * | `name`     | 名称      | 按中文名排序，方便按名字找 |
     */
    rivenSort: 'default',
    /** 待选词条区的搜索词 */
    rivenSearch: '',
  },

  /**
   * 当前这张裂罅（D-162）：**一个武器只有一张**，且是**同一个实体**——
   * 裂罅区和 Mod 槽里看到的是同一份数据，改词条 / 改数值两边同时变。
   *
   * ```
   * {
   *   combo: '2pos' | '2pos_1neg' | '3pos' | '3pos_1neg',
   *   entries: [ { key, value } ... ]   // 正面词条在 pos 条数内，负面词条在最后
   * }
   * ```
   *
   * `null` = 这张武器还没有裂罅（界面上是空的组合区）。
   * 槽位里 `modSlots[i] === RIVEN_SLOT_ID` 表示裂罅**已装进第 i 个槽**。
   */
  riven: null,

  /** 8 个 Mod 槽（索引 0..7） */
  modSlots: new Array(SLOT_COUNT).fill(null),
  /** 劣化槽（一张功能 Mod 的 id） */
  exilusModId: null,
  /** 赋能槽（一个赋能 key） */
  arcaneKey: null,

  /** 当前武器的数据（`app-data.js` 的 `loadWeapon` 建立，`loadPage` 时整体替换） */
  data: null,
  /** 全部武器索引（`boot` 时建立，`loadAllWeapons` 时整体替换） */
  dataAll: null,

  /** 拖动中的载荷（拖拽过程中临时存在） */
  dragPayload: null,
  /** `renderAll` 算好的一份基准，供每张卡查"相对提升" */
  gainCtx: null,
};

/** 整体替换当前武器数据（不要直接给 `store.data` 赋值，免得别的模块拿着旧引用） */
export function setData(data) {
  store.data = data;
  return data;
}

/** 整体替换全部武器索引 */
export function setDataAll(all) {
  store.dataAll = all;
  return all;
}

// ─────────────────────────────────────────────────────────────
// 配卡存档（D-157，需求方 2026-11-12）
//
// > 「现在换武器会清空配卡，我想刷新页面的时候能保存当前配卡状态，
// >   不然一不小心按到 f5 就要重新来了。」
//
// 存进浏览器 `localStorage`，**按武器分开存**：
//   · 换到一把存过的枪 → 恢复它自己的配卡；
//   · 换到没存过的枪 → 照旧清空（空配卡）；
//   · 刷新页面 → 回到上次那把枪、那套配卡、那组配置。
//
// 设计约束：
//   · 这里**只做读写与形状校验**，不认识 Mod / 武器数据（不碰 `store.data`）；
//   · 任何异常（隐私模式、存储满了、JSON 坏了）都当成"没有存档"，不让页面崩；
//   · 存的只是数据，恢复时由 `app.js` 逐项核对数据是否还在，缺了就跳过。
// ─────────────────────────────────────────────────────────────

/** 配卡存档的存储键；改结构时把 v1 递增，旧结构会被当成"没有存档" */
export const LOADOUT_STORE_KEY = 'wfcalc.loadout.v1';

/** 存档里 `loadouts` 保留的武器数上限（防本地存储无限膨胀，超出按最久没用的淘汰） */
export const LOADOUT_MAX_WEAPONS = 60;

/** 安全拿 `localStorage`；浏览器禁用了就返回 null */
function safeStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (e) {
    return null;
  }
}

/** 读整份存档；没有 / 坏了都返回 null */
export function readLoadoutStore() {
  const ls = safeStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(LOADOUT_STORE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    if (!obj.loadouts || typeof obj.loadouts !== 'object') return null;
    if (!Array.isArray(obj.order)) obj.order = [];
    return obj;
  } catch (e) {
    return null;
  }
}

/** 写整份存档；存不下就安静放弃（不影响页面使用） */
function writeLoadoutStore(obj) {
  const ls = safeStorage();
  if (!ls) return false;
  try {
    ls.setItem(LOADOUT_STORE_KEY, JSON.stringify(obj));
    return true;
  } catch (e) {
    return false;
  }
}

/** 只留字符串 id，其余（undefined / 空串）落成 null */
function modIdOf(v) {
  return typeof v === 'string' && v ? v : null;
}

/**
 * 把界面上的一份配卡整理成能存的形状。
 *
 * @param slots     8 个 Mod 槽
 * @param exilusId  劣化槽
 * @param arcaneKey 赋能槽
 */
export function makeLoadoutEntry(slots, exilusId, arcaneKey) {
  const out = [];
  for (let i = 0; i < SLOT_COUNT; i++) out.push(modIdOf(Array.isArray(slots) ? slots[i] : null));
  return { slots: out, exilus: modIdOf(exilusId), arcane: modIdOf(arcaneKey) };
}

/**
 * 把裂罅写进存档（D-162）。
 *
 * 裂罅不写进 `slots` 的普通 id 列表里（它不是 `mods.json` 的卡），
 * 而是单独存成 `entry.riven = { combo, entries }`，槽位里用占位 id 表示"已装备"。
 * 形状不对就整块丢掉，不让坏数据流回界面。
 */
function rivenEntryOf(riven) {
  if (!riven || typeof riven !== 'object') return null;
  const combo = typeof riven.combo === 'string' ? riven.combo : null;
  if (!combo) return null;
  const entries = [];
  if (Array.isArray(riven.entries)) {
    for (const e of riven.entries) {
      if (!e || typeof e.key !== 'string' || !e.key) { entries.push(null); continue; }
      const v = Number(e.value);
      entries.push({ key: e.key, value: Number.isFinite(v) ? v : 0 });
    }
  }
  return { combo, entries };
}

/** 取某把武器存过的配卡。返回 `null` = 这把枪**从没存过**（调用方应清空）。
 *
 * 形状不对的槽一律落成 null，不让坏数据流进界面。
 * @param {string} weaponId
 */
export function getSavedLoadout(weaponId) {
  const st = readLoadoutStore();
  if (!st || !weaponId) return null;
  const entry = st.loadouts[weaponId];
  if (!entry || typeof entry !== 'object') return null;
  const e = makeLoadoutEntry(entry.slots, entry.exilus, entry.arcane);
  // 裂罅（D-162）：与这份配卡一起存一起取
  e.riven = rivenEntryOf(entry.riven);
  // 每把武器各自记一份界面状态（模式 / 攻击方式勾选 / 配置区），跟它一起存一起取
  e.ui = entry.ui && typeof entry.ui === 'object' ? entry.ui : null;
  return e;
}

/**
 * 保存某把武器的配卡（整份替换这一项），同时记下当前是哪把枪。
 *
 * @param weaponId 武器 id
 * @param entry    {@link makeLoadoutEntry} 的形状；省略 = 存成空配卡
 * @param current  额外要记的界面状态（模式 / 攻击方式勾选 / 配置区），可省略
 */
export function saveLoadout(weaponId, entry = null, current = null) {
  if (!weaponId) return false;
  const st = readLoadoutStore() || { version: 1, current: null, order: [], loadouts: {}, ui: null };
  st.version = 1;
  st.loadouts[weaponId] = makeLoadoutEntry(entry && entry.slots, entry && entry.exilus, entry && entry.arcane);
  // 裂罅（D-162）跟着这份配卡一起存
  const rv = rivenEntryOf(entry && entry.riven);
  if (rv) st.loadouts[weaponId].riven = rv;
  // 每把武器各带一份界面状态（`entry.ui`），存的时候一起写
  if (entry && entry.ui && typeof entry.ui === 'object') {
    st.loadouts[weaponId].ui = entry.ui;
  }
  // 当前武器自成一个必存项
  st.current = weaponId;
  if (current) st.ui = current;
  // LRU：当前武器排最前，其余保持原序，超出上限的最久没用的丢掉
  const order = [weaponId].concat((Array.isArray(st.order) ? st.order : []).filter(function (id) {
    return id !== weaponId && st.loadouts[id];
  }));
  st.order = order.slice(0, LOADOUT_MAX_WEAPONS);
  const keep = new Set(st.order);
  for (const id of Object.keys(st.loadouts)) {
    if (!keep.has(id)) delete st.loadouts[id];
  }
  return writeLoadoutStore(st);
}

/** 上次退出时用的是哪把武器（`null` = 没有存档 / 从没进过页面） */
export function lastWeaponId() {
  const st = readLoadoutStore();
  return st && typeof st.current === 'string' && st.current ? st.current : null;
}

/** 上次保存的界面状态（模式索引 / 攻击方式勾选 / 配置区）；没有就返回 null */
export function lastUiState() {
  const st = readLoadoutStore();
  return st && st.ui && typeof st.ui === 'object' ? st.ui : null;
}

/** 清空整份存档（目前没有界面入口，留给测试与将来的"重置"用） */
export function clearLoadoutStore() {
  const ls = safeStorage();
  if (!ls) return;
  try {
    ls.removeItem(LOADOUT_STORE_KEY);
  } catch (e) {
    /* 存不了就算了 */
  }
}
