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
    filter: 'all',
    search: '',
    modeIndex: 0, // 当前选中的攻击模式（D-042：多面板武器可切换）
    variantIndex: 0, // 当前模式内的面板变体（D-080：直接命中 / 爆炸）
  },

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
