/**
 * 灵化形态数值（人工层，D-110）。
 *
 * **来源**：需求方 2026-11-06 直接录入（远程武器 4 把 / 近战武器 4 把）。
 * 本机访问不到 wiki.warframe.com（Cloudflare 挑战）与 fandom（DNS 被污染），
 * 所以其余武器按需求方指示：**先复用基础面板，并打上 `needsManualReview` 标记**，后面对着手填。
 *
 * ── 远程武器（`incarnon.stats` 有值）────────────────────────────
 * 灵化形态有自己独立的面板：总伤害、伤害组成、多重、射速、扳机、触发、暴击。
 * 清洗阶段用它替换掉"面板数值待人工层补充"的空壳。
 *
 * ── 近战武器（`incarnon.meleeBuff`）─────────────────────────────
 * 需求方原话：「近战的灵化 buff 先记录下来不直接做进去，这个要后面和枪械的灵化选项加成一起做。」
 * 所以这里**只记录、不参与计算**。近战灵化不更换伤害判定面板，只做属性修正。
 *
 * ⚠ 所有条目都带 `_source`：任何一个数都要能回答"哪来的"（CLAUDE.md §3）。
 */

/** 伤害组成：类型 → 占比（0~1）。未列出的剩余部分按"其余为冲击、穿刺"理解。 */
export type IncarnonSpread = Readonly<Record<string, number>>;

/** 远程武器的一个灵化射击模式 */
export interface IncarnonRangedMode {
  /** 模式 id（`incarnon` / `incarnon2` …） */
  id: string;
  /** 面板展示名 */
  label: string;
  /** 触发方式 */
  trigger: 'auto' | 'semi' | 'charged' | 'held' | 'unknown';
  /** 该模式的单一弹片/单发总伤害 */
  damage: number;
  /** 伤害组成（占比） */
  spread: IncarnonSpread;
  /** 多重射击 */
  multishot: number;
  /** 每秒发射次数 */
  fireRate: number;
  critChance: number;
  critMultiplier: number;
  statusChance: number;
  /** 以该模式为**瞄准形态**时，普通射击是否被替换（霰弹枪类：灵化后不再散射） */
  replacesBase?: boolean;
  /** 该模式是否带一段独立的"范围/爆炸"伤害（奏凯的 300 范围伤害） */
  aoe?: { damage: number; spread: IncarnonSpread; radius: number; falloff: string };
  /** 备注（充能、穿透、射程…，仅供人工参考，不参与计算） */
  note?: string;
}

/** 近战武器的灵化形态修正（**只记录，不参与计算**） */
export interface IncarnonMeleeBuff {
  /** 激活条件 */
  activation: string;
  /** 持续时间 */
  durationSeconds: number;
  /** 属性修正 */
  buffs: Readonly<Record<string, string>>;
  /** 额外机制（投射物、虚空碎片…） */
  extra?: string;
}

export interface IncarnonStats {
  /** 远程灵化形态的一个或多个射击模式 */
  modes: readonly IncarnonRangedMode[];
  /** 近战形态的属性修正（不参与计算） */
  meleeBuff?: IncarnonMeleeBuff;
  /** 数据来源（必须写） */
  _source: string;
  /**
   * 面板是否为"复用基础面板"的占位值。
   * true = 数值未收录，界面会打标记，不要当真。
   */
  _manual?: 'panel-reused' | 'entered';
  /** 其他人工备注 */
  note?: string;
}

/**
 * 灵化形态数值表（key 为武器 uniqueName 末段的紧凑写法，如 `ZarimanHeavyPistol`）。
 *
 * `incarnonInfoOf()` 会用同一套归一化去匹配，所以这里的 key 跟
 * `INCARNON_WEAPONS` 一样支持 `PrimeBurston` ↔ `Burston Prime` 这类词序差异。
 */
export const INCARNON_STATS: Readonly<Record<string, IncarnonStats>> = {
  // ── 远程武器：奏凯（Laetum）──
  // 注意：灵化形态同时有「直击 100」和「范围 300」，是两个独立面板（D-080 变体思路），
  // 这里拆成两个模式 `incarnon` / `incarnon2`，与武器原本的"两段变体"结构一致。
  'ZarimanHeavyPistol': {
    _source: '需求方 2026-11-06 录入（远程武器表）',
    _manual: 'entered',
    modes: [
      {
        id: 'incarnon',
        label: '灵化形态',
        trigger: 'auto',
        damage: 100,
        spread: { impact: 1 },
        multishot: 1,
        fireRate: 6.67,
        critChance: 0.22,
        critMultiplier: 2.2,
        statusChance: 0.22,
        note: '灵化充能 216',
      },
      {
        id: 'incarnon2',
        label: '灵化形态（范围）',
        trigger: 'auto',
        damage: 300,
        spread: { radiation: 1 },
        multishot: 1,
        fireRate: 6.67,
        critChance: 0.22,
        critMultiplier: 2.2,
        statusChance: 0.22,
        aoe: { damage: 300, spread: { radiation: 1 }, radius: 2, falloff: '2 米外 80%' },
        note: '范围 2 米，2 米外 80%；投射物 40 米/秒，精准度 4',
      },
    ],
  },

  // ── 远程武器：凤殁（Phenmor）──
  'ZarimanSemiAutoRifle': {
    _source: '需求方 2026-11-06 录入（远程武器表）',
    _manual: 'entered',
    modes: [
      {
        id: 'incarnon',
        label: '灵化形态',
        trigger: 'auto',
        damage: 140,
        spread: { slash: 0.57 },
        multishot: 1,
        fireRate: 13.3,
        critChance: 0.2,
        critMultiplier: 2,
        statusChance: 0.2,
        note: '57% 切割（其余为冲击、穿刺）；穿透 3 米，精准度 14，投射物 80 米/秒，灵化充能 408',
      },
    ],
  },

  // ── 远程武器：逐枭（Felarx）──
  // 「多重 1」：灵化形态是单弹片（霰弹枪灵化后不再散射）→ 用 replacesBase 表达
  'ZarimanPumpShotgun': {
    _source: '需求方 2026-11-06 录入（远程武器表）',
    _manual: 'entered',
    modes: [
      {
        id: 'incarnon',
        label: '灵化形态',
        trigger: 'semi',
        damage: 600,
        spread: { radiation: 0.67 },
        multishot: 1,
        fireRate: 1.5,
        critChance: 0.2,
        critMultiplier: 3,
        statusChance: 0.2,
        replacesBase: true,
        note: '600 为单弹片伤害；67% 辐射；强制触发冲击；射程 56 米，精准度 9，投射物 100 米/秒，灵化充能 60',
      },
    ],
  },

  // ── 远程武器：赘骨（Onos）──
  // 连射(30 辐射) / 蓄力(2200 火焰 + 1100 范围) 是两个独立模式
  'EntratiWristGunWeapon': {
    _source: '需求方 2026-11-06 录入（远程武器表）',
    _manual: 'entered',
    modes: [
      {
        id: 'incarnon',
        label: '灵化形态（连射）',
        trigger: 'held',
        damage: 30,
        spread: { radiation: 1 },
        multishot: 1,
        fireRate: 2,
        critChance: 0.14,
        critMultiplier: 1.6,
        statusChance: 0.18,
        note: '连射穿透 5 米；灵化充能 350',
      },
      {
        id: 'incarnon2',
        label: '灵化形态（蓄力）',
        trigger: 'charged',
        damage: 2200,
        spread: { heat: 1 },
        multishot: 1,
        fireRate: 0.25,
        critChance: 0.38,
        critMultiplier: 3.2,
        statusChance: 0.26,
        aoe: { damage: 1100, spread: { heat: 1 }, radius: 3, falloff: '3 米外 70%' },
        note: '强制触发火焰；蓄力每次耗 50 弹药',
      },
    ],
  },

  // ── 近战武器：以下只记录 buff，**不参与计算**（需求方：后面和枪械灵化加成一起做）──
  'ZarimanTonfaWeapon': {
    _source: '需求方 2026-11-06 录入（近战武器表）',
    _manual: 'panel-reused',
    modes: [],
    meleeBuff: {
      activation: '5x 连击后重击激活',
      durationSeconds: 90,
      buffs: { 攻击范围: '+3 米', 攻速: '+40%' },
    },
    note: '近战灵化不更换伤害判定面板，只做属性修正；面板伤害 200（80% 切割）即普通攻击面板',
  },
  'ZarimanDaggerWeapon': {
    _source: '需求方 2026-11-06 录入（近战武器表）',
    _manual: 'panel-reused',
    modes: [],
    meleeBuff: {
      activation: '5x 连击激活',
      durationSeconds: 90,
      buffs: { 攻击范围: '+3 米', 攻速: '+40%' },
      extra: '滞空格挡发射投射物（100% 辐射、强制触发冲击、射程 21 米、伤害 360）',
    },
    note: '面板伤害 360（50% 切割；投射物 360）即普通攻击面板',
  },
  'Ruvox': {
    _source: '需求方 2026-11-06 录入（近战武器表）',
    _manual: 'panel-reused',
    modes: [],
    meleeBuff: {
      activation: '6x 连击激活',
      durationSeconds: 90,
      buffs: { 攻击范围: '+3 米', 攻速: '-35%', 伤害类型: '冲击伤害全部转为穿刺' },
    },
    note: '面板 170（100% 冲击，灵化后转为 100% 穿刺）',
  },
  'Thalys': {
    _source: '需求方 2026-11-06 录入（近战武器表）',
    _manual: 'panel-reused',
    modes: [],
    meleeBuff: {
      activation: '6x 连击激活',
      durationSeconds: 90,
      buffs: { 攻击范围: '+3 米', 攻速: '+40%' },
      extra: '普通攻击命中使敌人产生虚空碎片',
    },
    note: '面板伤害 300（70% 切割）即普通攻击面板',
  },
};

/** 归一化（与 `incarnon.ts` 同一套规则） */
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[\s'\-&]/g, '');
}

const NORMALIZED_STATS: ReadonlyMap<string, IncarnonStats> = new Map(
  Object.entries(INCARNON_STATS).map(([k, v]) => [normalizeName(k), v]),
);

/**
 * 按武器唯一名（uniqueName 末段，如 `ZarimanHeavyPistol`）查灵化形态数值。
 * 找不到时返回 undefined（调用方按"面板待补充"处理）。
 */
export function incarnonStatsOf(uniqueName: string | undefined): IncarnonStats | undefined {
  if (!uniqueName) return undefined;
  const direct = INCARNON_STATS[uniqueName];
  if (direct) return direct;
  return NORMALIZED_STATS.get(normalizeName(uniqueName));
}
