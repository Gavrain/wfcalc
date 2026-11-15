/**
 * 裂罅（Riven）数据：词条表、基准值、组合系数、取值范围。
 *
 * 数据来源（需求方 2026-11-12 提供的 empx.cc「Riven Ranges」离线页面，每类一份）：
 *   · 步枪（不含霰弹） / 霰弹 / 次要 / 近战 / 空战 —— 五个页面
 *   · 守护**没有单独的页面**：需求方确认「守护武器是对应分到他对应类型的裂罅」，
 *     即守护枪械按槽位宽类吃步枪 / 霰弹 / 近战的词条表（见 `app-riven.js` 的 `rivenScopeOf`）
 *
 * 计算口径（需求方 2026-11-12 确认）：
 *
 *   ```
 *   正面词条 = 基准值 × 组合系数 × 倾向(1.2)
 *   负面词条 = 基准值 × 负面系数 × 倾向(1.2)
 *   取值范围 = 平均值 × 0.9 ~ 平均值 × 1.1        （负数按幅度，同样 ±10%）
 *   ```
 *
 *   | 组合 | 正面系数 | 负面系数 |
 *   |---|---|---|
 *   | 2+    | 0.99     | —        |
 *   | 2+1−  | 1.2375   | −0.495   |
 *   | 3+    | 0.75     | —        |
 *   | 3+1−  | 0.9375   | −0.75    |
 *
 *   每类的**基准值不同**（例如手枪基础伤害 219.6、霰弹 164.7、近战 164.7、
 *   空战暴击几率 99.9 而不是步枪的 150），基准值逐个从页面反推并对四张表交叉验证。
 *
 *   ⚠ 派系行页面显示的是 `1.54`，按「1 + 基准% × 0.99 × 1.2 / 100」算应为 1.53；
 *     页面 2+1− / 3+ / 3+1− 三格都与公式吻合，只有 2+ 那格与自家人不成比例，
 *     判定为页面 bug，**以公式为准**。
 *
 *   ⚠ 页面把四个单元素与复合元素合并成一行「Elemental / Elemental Combo」，
 *     那是因为它们的基准值相同；需求方确认要拆成 4 单元素 + 6 复合元素，
 *     且**不需要** `Elemental` 这个词条。
 */

/** 裂罅大类（游戏里按武器类型分的六类） */
export type RivenScope = 'rifle' | 'shotgun' | 'secondary' | 'melee' | 'archgun' | 'sentinel';

export const RIVEN_SCOPE_LABEL: Readonly<Record<RivenScope, string>> = {
  rifle: '步枪',
  shotgun: '霰弹',
  secondary: '次要',
  melee: '近战',
  archgun: '空战',
  sentinel: '守护',
};

/**
 * 有独立词条表的类型。
 *
 * ⚠ 守护不在其中：守护武器按槽位宽类归到步枪 / 霰弹 / 近战（需求方 2026-11-12）。
 */
export const RIVEN_SCOPES_WITH_DATA: readonly RivenScope[] = ['rifle', 'shotgun', 'secondary', 'melee', 'archgun'];

export type RivenComboId = '2pos' | '2pos_1neg' | '3pos' | '3pos_1neg';

export interface RivenCombo {
  id: RivenComboId;
  /** 正面词条条数 */
  pos: number;
  /** 负面词条条数（0 或 1） */
  neg: number;
  /** 正面系数 */
  gain: number;
  /** 负面系数（负数；无负面时为 null） */
  loss: number | null;
  /** 界面上的短标签 */
  label: string;
}

/**
 * 四种组合（需求方 2026-11-12 确认的系数）。
 *
 * 顺序 = 界面按钮顺序：2+ / 2+1− / 3+ / 3+1−。
 */
export const RIVEN_COMBOS: readonly RivenCombo[] = [
  { id: '2pos', pos: 2, neg: 0, gain: 0.99, loss: null, label: '2+' },
  { id: '2pos_1neg', pos: 2, neg: 1, gain: 1.2375, loss: -0.495, label: '2+1−' },
  { id: '3pos', pos: 3, neg: 0, gain: 0.75, loss: null, label: '3+' },
  { id: '3pos_1neg', pos: 3, neg: 1, gain: 0.9375, loss: -0.75, label: '3+1−' },
];

export function rivenComboOf(id: RivenComboId): RivenCombo {
  return RIVEN_COMBOS.find((c) => c.id === id) ?? RIVEN_COMBOS[0]!;
}

/** 倾向：游戏已取消倾向变动，全库统一 1.2（与紫卡模拟器 `params.dispSnapshotNote` 一致） */
export const RIVEN_DISPOSITION = 1.2;

/** 词条类别：普通 / 单元素 / 复合元素 / 派系 */
export type RivenStatKind = 'stat' | 'singleElement' | 'compoundElement' | 'faction';

/**
 * 一条裂罅词条。
 *
 * - `key`：稳定的词条键（存进配卡存档、也给内核 Contribution 当标签用）
 * - `stat`：内核 `ContribStat`（元素 / 物理 / 派系走模板字面量）
 * - `base`：基准值，**百分比口径**（165 = +165%）；派系也是百分比（45 = +45%，展示时换算成 1.45）
 */
export interface RivenStatDef {
  key: string;
  /** 中文名 */
  label: string;
  /** 英文名（取自 empx 页面，便于对账） */
  labelEn: string;
  /** 内核属性键（`elemental:heat` / `faction:grineer` …） */
  stat: string;
  kind: RivenStatKind;
  /** 基准值（百分比口径，见上方注释） */
  base: number;
  /** 能不能作为负面词条出现（**按类型各表**，见各表前的 `*_NEG`） */
  canNegative: boolean;
  /** 该属性在游戏里的单位；`'flat'` 的词条页面显示成米 / 发 / 秒，不显示 `%`。缺省为百分比 */
  statUnit?: 'percent' | 'flat';
}

// ─────────────────────────────────────────────────────────────
// 公共词条定义（各类武器共用，基准值按类各给一份）
// ─────────────────────────────────────────────────────────────

/**
 * 六派系。
 *
 * 需求方 2026-11-12：「派系是要 −1 的，因为原来是 +30% 派系伤害这样，改成了 1.x 显示……
 * 注意 6 个派系都有」；随后「去掉 Murmur」，第 6 个选 Scaldra。
 * 内核 `Faction` 已补上 `techrot` / `scaldra`（D-163）。
 */
export const RIVEN_FACTIONS: readonly { key: string; stat: string; label: string }[] = [
  { key: 'faction_grineer', stat: 'faction:grineer', label: 'Grineer' },
  { key: 'faction_corpus', stat: 'faction:corpus', label: 'Corpus' },
  { key: 'faction_infested', stat: 'faction:infested', label: 'Infested' },
  { key: 'faction_orokin', stat: 'faction:orokin', label: 'Orokin' },
  { key: 'faction_techrot', stat: 'faction:techrot', label: 'Techrot' },
  { key: 'faction_scaldra', stat: 'faction:scaldra', label: 'Scaldra' },
];

/** 派系基准值：+45%（展示成 1.45） */
const BASE_FACTION = 45;

/** 4 个单元素（冰 / 毒 / 电 / 火） */
const SINGLE_ELEMENTS: readonly { key: string; stat: string; label: string }[] = [
  { key: 'element_cold', stat: 'elemental:cold', label: '冰冻' },
  { key: 'element_toxin', stat: 'elemental:toxin', label: '毒素' },
  { key: 'element_electric', stat: 'elemental:electric', label: '电击' },
  { key: 'element_heat', stat: 'elemental:heat', label: '火焰' },
];

/** 6 个复合元素（腐蚀 / 毒气 / 磁力 / 辐射 / 病毒 / 爆炸） */
const COMPOUND_ELEMENTS: readonly { key: string; stat: string; label: string }[] = [
  { key: 'element_corrosive', stat: 'elemental:corrosive', label: '腐蚀' },
  { key: 'element_gas', stat: 'elemental:gas', label: '毒气' },
  { key: 'element_magnetic', stat: 'elemental:magnetic', label: '磁力' },
  { key: 'element_radiation', stat: 'elemental:radiation', label: '辐射' },
  { key: 'element_viral', stat: 'elemental:viral', label: '病毒' },
  { key: 'element_blast', stat: 'elemental:blast', label: '爆炸' },
];

/** 物理三系（页面只有一行「IPS」，三项同基准） */
const PHYSICALS: readonly { key: string; stat: string; label: string }[] = [
  { key: 'physical_impact', stat: 'physical:impact', label: '冲击' },
  { key: 'physical_puncture', stat: 'physical:puncture', label: '穿刺' },
  { key: 'physical_slash', stat: 'physical:slash', label: '切割' },
];

/** 一条「普通词条」的模板：key / 中文名 / 英文名 / 内核属性 / 能否为负 */
interface StatTemplate {
  key: string;
  label: string;
  labelEn: string;
  stat: string;
  canNegative: boolean;
  /**
   * 内核属性本身的单位（**不是裂罅数值的单位**，裂罅数值一律是百分比口径）。
   *
   * `'flat'` = 这个属性在游戏里是固定量（米 / 发 / 秒 / 次），不是百分比：
   *   · 穿透（m）、攻击范围（m）、连击持续时间（s）、弹药上限（发）、弹匣容量（发）。
   * 页面按这个决定显示成 `2.7m` 还是 `106.9%`。
   */
  statUnit?: 'percent' | 'flat';
}

/** 页面里可能出现的全部普通词条（各类按自己的基准值挑用） */
const TEMPLATES: Readonly<Record<string, StatTemplate>> = {
  baseDamage: { key: 'baseDamage', label: '基础伤害', labelEn: 'Damage', stat: 'baseDamage', canNegative: true },
  critChance: { key: 'critChance', label: '暴击几率', labelEn: 'CritChance', stat: 'critChance', canNegative: true },
  critMultiplier: { key: 'critMultiplier', label: '暴击伤害', labelEn: 'CritDmg', stat: 'critMultiplier', canNegative: true },
  statusChance: { key: 'statusChance', label: '触发几率', labelEn: 'Status Chance', stat: 'statusChance', canNegative: true },
  statusDuration: { key: 'statusDuration', label: '异常状态持续时间', labelEn: 'Status Duration', stat: 'statusDuration', canNegative: true },
  statusDamage: { key: 'statusDamage', label: '异常状态伤害', labelEn: 'Status Damage', stat: 'statusDamage', canNegative: false },
  multishot: { key: 'multishot', label: '多重射击', labelEn: 'Multishot', stat: 'multishot', canNegative: true },
  fireRate: { key: 'fireRate', label: '射速', labelEn: 'Fire Rate', stat: 'fireRate', canNegative: true },
  magazine: { key: 'magazine', label: '弹匣容量', labelEn: 'Magazine', stat: 'magazine', canNegative: true },
  reloadSpeed: { key: 'reloadSpeed', label: '装填速度', labelEn: 'Reload', stat: 'reloadSpeed', canNegative: true },
  reloadHolstered: { key: 'reloadHolstered', label: '收纳时装填速度', labelEn: 'Reload (Holstered)', stat: 'reloadSpeed', canNegative: false },
  ammoMax: { key: 'ammoMax', label: '弹药上限', labelEn: 'Ammo Max', stat: 'ammoMax', canNegative: true },
  ammoEfficiency: { key: 'ammoEfficiency', label: '弹药效率', labelEn: 'Ammo Efficiency', stat: 'ammoEfficiency', canNegative: false },
  punchThrough: { key: 'punchThrough', label: '穿透', labelEn: 'Punch Through', stat: 'punchThrough', canNegative: false, statUnit: 'flat' },
  recoil: { key: 'recoil', label: '后坐力', labelEn: 'Recoil', stat: 'recoil', canNegative: true },
  zoom: { key: 'zoom', label: '变焦', labelEn: 'Zoom', stat: 'zoom', canNegative: true },
  projectileSpeed: { key: 'projectileSpeed', label: '弹速', labelEn: 'Flight Speed', stat: 'projectileSpeed', canNegative: true },
  weakpointCritChance: { key: 'weakpointCritChance', label: '弱点暴击几率', labelEn: 'Weakpoint Critical Chance', stat: 'weakpointCritChance', canNegative: false },
  weakpointDamage: { key: 'weakpointDamage', label: '弱点伤害', labelEn: 'Weakpoint Damage', stat: 'weakpointDamage', canNegative: false },
  // 近战专属
  attackSpeed: { key: 'attackSpeed', label: '攻击速度', labelEn: 'Attack Speed', stat: 'fireRate', canNegative: true },
  comboDuration: { key: 'comboDuration', label: '连击持续时间', labelEn: 'Combo Duration', stat: 'utility', canNegative: true, statUnit: 'flat' },
  comboChance: { key: 'comboChance', label: '连击计数获得几率', labelEn: 'Combo Chance', stat: 'utility', canNegative: true },
  initialCombo: { key: 'initialCombo', label: '初始连击', labelEn: 'Initial Combo', stat: 'utility', canNegative: false },
  heavyEfficiency: { key: 'heavyEfficiency', label: '重击效率', labelEn: 'Heavy Efficiency', stat: 'utility', canNegative: true },
  slideCrit: { key: 'slideCrit', label: '滑砍暴击几率', labelEn: 'Slide Crit', stat: 'utility', canNegative: true },
  finisherDamage: { key: 'finisherDamage', label: '终结者伤害', labelEn: 'Finisher Damage', stat: 'utility', canNegative: true },
  heavyDamage: { key: 'heavyDamage', label: '重击伤害', labelEn: 'Heavy Damage', stat: 'utility', canNegative: false },
  heavyWindUp: { key: 'heavyWindUp', label: '重击蓄力速度', labelEn: 'Heavy Wind Up', stat: 'utility', canNegative: false },
  meleeRange: { key: 'meleeRange', label: '攻击范围', labelEn: 'Range', stat: 'utility', canNegative: true, statUnit: 'flat' },
  parryAngle: { key: 'parryAngle', label: '格挡角度', labelEn: 'Parry Angle', stat: 'utility', canNegative: false },
  slamDamage: { key: 'slamDamage', label: '震地伤害', labelEn: 'Slam Damage', stat: 'utility', canNegative: false },
};

/** 一类武器的词条基准值表：词条 key → 基准值（百分比口径） */
type BaseMap = Readonly<Record<string, number>>;

function defOf(key: string, base: number): RivenStatDef {
  const t = TEMPLATES[key];
  if (!t) throw new Error('裂罅词条模板不存在：' + key);
  return { ...t, base, kind: 'stat' };
}

/**
 * 一条元素行的基准值（保留「单元素」与「复合元素」可能不同的能力）。
 *
 * 绝大多数类型两者相同，所以页面把它们合并成一行；**空战是例外**：
 * 页面里 `Elemental` 是 142.2、`Elemental Combo` 是 106.9，
 * 反推出来是 **单元素 119.7 / 复合元素 90**。
 */
interface ElementBases {
  single: number;
  compound: number;
}

function buildTable(
  posKeys: readonly string[],
  negKeys: readonly string[],
  bases: BaseMap,
  element: ElementBases,
  physicalBase: number,
): { positive: RivenStatDef[]; negative: RivenStatDef[] } {
  const positive: RivenStatDef[] = [];
  for (const k of posKeys) {
    const base = bases[k];
    if (base === undefined) throw new Error('裂罅基准值缺失：' + k);
    positive.push(defOf(k, base));
  }
  positive.push(
    ...PHYSICALS.map((p) => ({ ...p, labelEn: p.label, kind: 'stat' as const, base: physicalBase, canNegative: true })),
    ...SINGLE_ELEMENTS.map((e) => ({ ...e, labelEn: e.label, kind: 'singleElement' as const, base: element.single, canNegative: false })),
    ...COMPOUND_ELEMENTS.map((e) => ({ ...e, labelEn: e.label, kind: 'compoundElement' as const, base: element.compound, canNegative: false })),
    ...RIVEN_FACTIONS.map((f) => ({ ...f, labelEn: f.label, kind: 'faction' as const, base: BASE_FACTION, canNegative: true })),
  );
  const negSet = new Set(negKeys);
  const negKeysAll = [
    ...posKeys.filter((k) => negSet.has(k)),
    ...PHYSICALS.map((p) => p.key).filter((k) => negSet.has(k)),
    ...RIVEN_FACTIONS.map((f) => f.key).filter((k) => negSet.has(k)),
  ];
  const negative = negKeysAll.map((k) => positive.find((d) => d.key === k)!).filter(Boolean);
  return { positive, negative };
}

// ─────────────────────────────────────────────────────────────
// 各类型的基准值
//
// 来源：empx 页面 2+ 组合的**平均值** ÷ (0.99 × 1.2) 反推，
// 并核对 2+1− / 3+ / 3+1− 三张表（同一基准 × 各自系数）。
// ─────────────────────────────────────────────────────────────

/** 步枪（主要武器，不含霰弹） */
const RIFLE_BASES: BaseMap = {
  baseDamage: 165, critChance: 149.99, critMultiplier: 120, statusChance: 90, statusDuration: 99.99,
  statusDamage: 90, multishot: 90, fireRate: 60.03, magazine: 50, reloadSpeed: 50,
  reloadHolstered: 90, ammoMax: 49.95, ammoEfficiency: 45, punchThrough: 2.7, recoil: 90,
  zoom: 59.99, projectileSpeed: 90, weakpointCritChance: 247.5, weakpointDamage: 225,
};
/**
 * 负面词条池 = **每类裂罅自己的负面栏**（需求方 2026-11-14：「注意每种裂罅的负面池子也不一定一样」）。
 *
 * 对照 empx `?positives=3&negative=true` 的 Negative Stats 表（2026-11-14 逐类拉取）：
 *
 * | 类型 | 负面栏里有 | 负面栏里**没有** |
 * |---|---|---|
 * | 步枪 | 弹药上限、暴击几率、暴击伤害、基础伤害、射速、弹速、IPS、弹匣、多重、后坐力、装填、触发几率、异常持续、变焦、6 派系 | 弹药效率、穿透、**元素**、**异常伤害**、弱点两条 |
 * | 霰弹 | 同步枪（样枪 Arca Plasmor） | 同步枪 |
 * | 手枪 | 同步枪（样枪 Acrid） | 同步枪 |
 * | 空战 | 同步枪（样枪 Arbucep） | 弹药效率、穿透、弹速、**元素**、**异常伤害**、弱点两条 |
 * | 近战 | 攻速、连击几率、连击持续、暴击几率、暴击伤害、基础伤害、处决伤害、重击效率、IPS、攻击范围、滑砍暴击、触发几率、异常持续、6 派系 | 初始连击、重击伤害、重击蓄力、格挡角度、震地伤害、**元素**、**异常伤害** |
 *
 * ⚠ 页面负面栏里有 `Faction = 1.00 / 1.00 / 1.00` 这一行，表示「派系可以作负面」；
 *   数值与公式一致（空战派系 45 × 0.75 × 1.2 = 40.5）。6 个派系都保留在负面池里。
 *
 * ⚠ **同一张表里正、负的数值一样**：负面的「幅度」与正面同一口径
 *   （都是 `基准 × 系数 × 1.2`），empx 的 3+1− 负面栏实测就是正面的 0.8 倍。
 */

/** 步枪 / 霰弹 / 手枪 共用的负面池 */
const GUN_NEG = [
  'baseDamage', 'critChance', 'critMultiplier', 'statusChance', 'statusDuration', 'multishot',
  'fireRate', 'magazine', 'reloadSpeed', 'ammoMax', 'recoil', 'zoom', 'projectileSpeed',
  'physical_impact', 'physical_puncture', 'physical_slash',
  'faction_grineer', 'faction_corpus', 'faction_infested', 'faction_orokin', 'faction_techrot', 'faction_scaldra',
];
const RIFLE_NEG = GUN_NEG;
const SHOTGUN_NEG = GUN_NEG;
const PISTOL_NEG = GUN_NEG;

/** 近战：比枪械多「连击几率 / 重击效率 / 滑砍暴击 / 处决伤害 / 攻击范围」，没有多重 / 弹匣 / 装填 */

/** 空战：比枪械少「弹速」（页面负面栏没有 Flight Speed） */

/** 霰弹 */
const SHOTGUN_BASES: BaseMap = {
  baseDamage: 164.7, critChance: 89.98, critMultiplier: 89.98, statusChance: 89.98, statusDuration: 100,
  statusDamage: 89.98, multishot: 119.7, fireRate: 89.98, magazine: 50, reloadSpeed: 50,
  reloadHolstered: 89.98, ammoMax: 89.98, ammoEfficiency: 45, punchThrough: 2.7, recoil: 89.98,
  zoom: 42, projectileSpeed: 89.98, weakpointCritChance: 247.5, weakpointDamage: 225,
};

/** 次要（副手） */
const PISTOL_BASES: BaseMap = {
  baseDamage: 219.61, critChance: 150, critMultiplier: 89.98, statusChance: 89.98, statusDuration: 100,
  statusDamage: 89.98, multishot: 119.7, fireRate: 74.66, magazine: 50, reloadSpeed: 50,
  reloadHolstered: 89.98, ammoMax: 89.98, ammoEfficiency: 45, punchThrough: 2.7, recoil: 89.98,
  zoom: 80.13, projectileSpeed: 89.98, weakpointCritChance: 247.5, weakpointDamage: 225,
};

/**
 * 近战。
 *
 * ⚠ 近战页面里有 8 把**空战近战**（Agkuza / Centaur / Kaszas / Knux / Onorix /
 *   Prisma Veritux / Rathbone / Veritux）标着倾向 0.5；这里的基准值按页面 1.2 那一套反推，
 *   没有用 0.5 单独算（见 `data.md` D-164 的待确认项）。
 */
const MELEE_BASES: BaseMap = {
  baseDamage: 164.73, critChance: 179.97, critMultiplier: 89.98, statusChance: 89.98, statusDuration: 100,
  statusDamage: 89.98, attackSpeed: 54.88, comboDuration: 8.08, comboChance: 58.75, initialCombo: 24.5,
  heavyEfficiency: 73.4, slideCrit: 120.03, finisherDamage: 119.7, heavyDamage: 119.7, heavyWindUp: 119.7,
  meleeRange: 1.94, parryAngle: 80.98, slamDamage: 119.7,
};
const MELEE_POS = [
  'baseDamage', 'critChance', 'critMultiplier', 'statusChance', 'statusDuration', 'statusDamage',
  'attackSpeed', 'comboDuration', 'comboChance', 'initialCombo', 'heavyEfficiency', 'slideCrit',
  'finisherDamage', 'heavyDamage', 'heavyWindUp', 'meleeRange', 'parryAngle', 'slamDamage',
];
const MELEE_NEG = [
  'baseDamage', 'critChance', 'critMultiplier', 'statusChance', 'statusDuration', 'attackSpeed',
  'comboDuration', 'comboChance', 'heavyEfficiency', 'slideCrit', 'finisherDamage',
  'meleeRange', 'physical_impact', 'physical_puncture', 'physical_slash',
  'faction_grineer', 'faction_corpus', 'faction_infested', 'faction_orokin', 'faction_techrot', 'faction_scaldra',
];

/** 空战 */
const ARCHGUN_BASES: BaseMap = {
  baseDamage: 99.92, critChance: 99.92, critMultiplier: 80.13, statusChance: 60.27, statusDuration: 100,
  statusDamage: 89.98, multishot: 60.27, fireRate: 60.02, magazine: 60.27, reloadSpeed: 99.92,
  ammoMax: 99.92, ammoEfficiency: 45, punchThrough: 2.7, recoil: 89.98,
  zoom: 60.02, weakpointCritChance: 247.5, weakpointDamage: 225,
};
/** 空战负面池：**没有弹速**（empx 负面栏没有 Flight Speed），其余与枪械一致 */
const ARCHGUN_NEG = [
  'baseDamage', 'critChance', 'critMultiplier', 'statusChance', 'statusDuration', 'multishot',
  'fireRate', 'magazine', 'reloadSpeed', 'ammoMax', 'recoil', 'zoom',
  'physical_impact', 'physical_puncture', 'physical_slash',
  'faction_grineer', 'faction_corpus', 'faction_infested', 'faction_orokin', 'faction_techrot', 'faction_scaldra',
];

const COMMON_POS = [
  'baseDamage', 'critChance', 'critMultiplier', 'statusChance', 'statusDuration', 'statusDamage', 'multishot',
];

/**
 * 元素基准值：除空战外，单元素与复合元素都是 **90**
 * （页面把两者合并成一行，正是因为基准值相同）。
 */
const ELEMENT_BASE: ElementBases = { single: 90, compound: 90 };

const RIFLE_TABLE = buildTable(
  [...COMMON_POS, 'fireRate', 'magazine', 'reloadSpeed', 'reloadHolstered', 'ammoMax', 'ammoEfficiency',
    'punchThrough', 'recoil', 'zoom', 'projectileSpeed', 'weakpointCritChance', 'weakpointDamage'],
  RIFLE_NEG, RIFLE_BASES, ELEMENT_BASE, 119.97,
);
const SHOTGUN_TABLE = buildTable(
  [...COMMON_POS, 'fireRate', 'magazine', 'reloadSpeed', 'reloadHolstered', 'ammoMax', 'ammoEfficiency',
    'punchThrough', 'recoil', 'zoom', 'projectileSpeed', 'weakpointCritChance', 'weakpointDamage'],
  SHOTGUN_NEG, SHOTGUN_BASES, ELEMENT_BASE, 120,
);
const PISTOL_TABLE = buildTable(
  [...COMMON_POS, 'fireRate', 'magazine', 'reloadSpeed', 'reloadHolstered', 'ammoMax', 'ammoEfficiency',
    'punchThrough', 'recoil', 'zoom', 'projectileSpeed', 'weakpointCritChance', 'weakpointDamage'],
  PISTOL_NEG, PISTOL_BASES, ELEMENT_BASE, 120,
);
const MELEE_TABLE = buildTable(
  MELEE_POS, MELEE_NEG, MELEE_BASES, ELEMENT_BASE, 119.7,
);
const ARCHGUN_TABLE = buildTable(
  [...COMMON_POS, 'fireRate', 'magazine', 'reloadSpeed', 'ammoMax', 'ammoEfficiency',
    'punchThrough', 'recoil', 'zoom', 'weakpointCritChance', 'weakpointDamage'],
  // ⚠ 空战是唯一「单元素 ≠ 复合元素」的类型：页面 Elemental 142.2 → 119.7、Elemental Combo 106.9 → 90
  ARCHGUN_NEG, ARCHGUN_BASES, { single: 119.7, compound: 90 }, 90,
);

export interface RivenStatTable {
  scope: RivenScope;
  positive: readonly RivenStatDef[];
  negative: readonly RivenStatDef[];
}

const TABLES: Readonly<Record<string, RivenStatTable>> = {
  rifle: { scope: 'rifle', ...RIFLE_TABLE },
  shotgun: { scope: 'shotgun', ...SHOTGUN_TABLE },
  secondary: { scope: 'secondary', ...PISTOL_TABLE },
  melee: { scope: 'melee', ...MELEE_TABLE },
  archgun: { scope: 'archgun', ...ARCHGUN_TABLE },
};

/**
 * 取某一类武器的词条表。
 *
 * ⚠ `sentinel` **没有自己的表**：需求方 2026-11-12「守护武器是对应分到他对应类型的裂罅」，
 *   调用方应先按槽位宽类把守护武器映射成 rifle / shotgun / melee 再来取；
 *   直接传 `sentinel` 返回 `null`。
 */
export function rivenStatTableOf(scope: RivenScope): RivenStatTable | null {
  return TABLES[scope] ?? null;
}

export interface RivenValueRange {
  avg: number;
  min: number;
  max: number;
  /** 内核贡献里的数值：百分比口径（165 = +165%）；派系同样返回百分比（45 = +45%） */
  amount: number;
}

/**
 * 算一条词条在某个组合下的数值（百分比口径）。**全项目唯一的一条裂罅数值公式**。
 *
 * ```
 * 正面 = 基准 × combo.gain × 倾向(1.2)
 * 负面 = 基准 × |combo.loss| × 倾向(1.2)
 * 区间 = 平均值 × 0.9 ~ 平均值 × 1.1
 * ```
 *
 * ⚠ 倾向 1.2 **只乘这一次**（需求方 2026-11-14：「只要保证只乘一次就行了」）。
 *   页面侧的 `app-riven.js` 以前自己又抄了一遍这个公式（手写 `* 1.2`），
 *   现在一律调这里，不要在别处再乘倾向。
 *
 * @returns 数值区间；负面词条返回**正数**（幅度），由调用方加负号
 */
export function rivenStatRange(def: RivenStatDef, combo: RivenCombo, kind: 'pos' | 'neg'): RivenValueRange {
  const coef = kind === 'pos' ? combo.gain : Math.abs(combo.loss ?? 0);
  const avg = def.base * coef * RIVEN_DISPOSITION;
  return { avg, min: avg * 0.9, max: avg * 1.1, amount: avg };
}

/** 与页面一致的取整：向下取整到 1 位小数 */
export function roundRiven(v: number): number {
  return Math.floor(v * 10 + 1e-9) / 10;
}

/** 派系词条的显示形式：百分比 → 1.xx 倍率（需求方：原来是 +30% 派系伤害，现在显示成 1.x） */
export function rivenDisplayValue(def: RivenStatDef, kind: 'pos' | 'neg', raw: number): number {
  if (def.kind !== 'faction') return raw;
  return kind === 'pos' ? 1 + raw / 100 : 1 - raw / 100;
}

/**
 * 一条词条界面上显示的**单位**（2026-11-14）。
 *
 * | 类 | 显示 | 例 |
 * |---|---|---|
 * | 派系 | 倍率 `1.xx` / 负面 `0.xx` | 1.54 / 0.73 |
 * | 后坐力 | 裂罅数值是百分比 | 正面 −128.3%（降低）/ 负面 +21.4%（增加） |
 * | `statUnit: 'flat'` 的词条 | **不带 %** | 穿透 3.2m、攻击范围 2.3m、连击持续时间 9.6s |
 * | 其余 | 百分比 | 106.9% |
 *
 * ⚠ 裂罅数值本身一律是百分比口径；「固定数值」只影响**显示**，不改计算。
 */
export function rivenDisplayUnit(def: RivenStatDef): 'faction' | 'pct' | 'flat' | 'recoil' {
  if (def.kind === 'faction') return 'faction';
  if (def.key === 'recoil') return 'recoil';
  return def.statUnit === 'flat' ? 'flat' : 'pct';
}

/**
 * 一条词条在界面上的取值范围，按**显示口径**返回（派系已换算成 1.xx，且保证 `min <= max`）。
 *
 * 负面词条返回的是**正数幅度**（例如 89.1），调用方自己加负号显示。
 */
export function rivenDisplayRange(
  def: RivenStatDef,
  combo: RivenCombo,
  kind: 'pos' | 'neg',
): { avg: number; min: number; max: number } {
  const r = rivenStatRange(def, combo, kind);
  const disp = (v: number) => rivenDisplayValue(def, kind, v);
  const a = disp(r.avg);
  const lo = disp(r.min);
  const hi = disp(r.max);
  return { avg: a, min: Math.min(lo, hi), max: Math.max(lo, hi) };
}
