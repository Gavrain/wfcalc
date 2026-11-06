/**
 * 武器级人工订正表（D-141，需求方 2026-11-07 确认）。
 *
 * 用途：官方导出 `ExportWeapons.json` **本身有错**、或导出里只有空壳的武器，
 * 在这里按游戏内**零 Mod 白板面板**直接写数值。清洗阶段在导出结果之后应用。
 *
 * 原则（`CLAUDE.md` 第 3 条「数据能追溯」）：
 *   · 每个字段都必须带 `_note` 说明来源与原因，产出里会原样带出去；
 *   · 只写确定的部分，不确定的不猜。
 *
 * 类型故意不引入 data-build 的类型——人工层只放数据，由消费方校验。
 */

/** 伤害分布：伤害类型 → 数值（沿用产出 JSON 的英文键） */
export type ManualDamage = Record<string, number>;

export interface ManualMode {
  /** 模式 id（产出的 `modes[].id`，如 `primary` / `mode2`） */
  id: string;
  /** 展示名（产出的 `_label`，如「球体融合」），界面优先用它 */
  label?: string;
  /** 触发方式（产出 `trigger`），缺省 `unknown` */
  trigger?: 'auto' | 'semi' | 'burst' | 'charge' | 'held' | 'active' | 'unknown';
  multishot?: number;
  segments: Array<{
    kind: 'impact' | 'attack' | 'explosiveAttack';
    aoe: boolean;
    damage: ManualDamage;
    procChance: number;
  }>;
}

export interface WeaponPatch {
  /** 面板覆盖（0~1 小数） */
  critChance?: number;
  critMultiplier?: number;
  statusChance?: number;
  fireRate?: number;
  magazineSize?: number;
  reloadTime?: number;
  /**
   * 整组替换攻击模式。给 `[]` = **面板未收录**（产出 `modes: []`，界面标「面板待补」）。
   * 不给 = 保留导出的模式。
   */
  modes?: ManualMode[];
  /** 中英文显示名覆盖（不传则沿用语言包） */
  nameZh?: string;
  nameEn?: string;
  /** 备注：为什么改、来源是什么 */
  note: string;
  /** 来源标记：`bible` = 需求方给的游戏内白板值；`export-missing` = 导出里没有可用数据 */
  _source: 'bible' | 'export-missing';
}

/**
 * 全部人工订正，key = 官方导出键的末段（= 产出里的 `id`）。
 *
 * 依据：需求方 2026-11-07 逐条对照游戏内白板面板后给出。
 */
export const WEAPON_PATCHES: Readonly<Record<string, WeaponPatch>> = {
  // ── 分离 / 分离 Prime：导出 behaviours 只有一条 `3.33×3 @0.1` 的模板（判废） ──
  // 游戏面板：130 / 160 冲击（需求方 2026-11-07 确认）。导出只给了 totalDamage，伤害类型按面板补冲击。
  SentGlaiveWeapon: {
    modes: [
      {
        id: 'primary',
        segments: [{ kind: 'impact', aoe: false, damage: { impact: 130 }, procChance: 0.25 }],
      },
    ],
    note: '导出 behaviours 是判废模板（3.33×3 @0.1，与面板「冲击 130」类型不符）；按游戏面板补为冲击 130',
    _source: 'bible',
  },
  PrimeHeliosGlaiveWeapon: {
    modes: [
      {
        id: 'primary',
        segments: [{ kind: 'impact', aoe: false, damage: { impact: 160 }, procChance: 0.25 }],
      },
    ],
    note: '导出 behaviours 是判废模板（3.33×3 @0.1，与面板「冲击 160」类型不符）；按游戏面板补为冲击 160',
    _source: 'bible',
  },

  // ── 暗黑分合剑：导出 behaviours 为空，先给两个版本占位（巨刃 / 双剑），面板待补 ──
  // ⚠ key 用产出 id 的原样形式（含 `@`），与 `MANUAL_VARIANTS` 一一对应
  'DarkSwordDaggerHybridWeapon@heavy_blade': {
    nameEn: 'Dark Split-Sword (Heavy Blade)',
    nameZh: '暗黑分合剑（巨刃）',
    modes: [],
    note: '导出 behaviours 为空、游戏面板未收录；先建「巨刃」版本占位，数值待补（需求方 2026-11-07）',
    _source: 'export-missing',
  },
  'DarkSwordDaggerHybridWeapon@dual_swords': {
    nameEn: 'Dark Split-Sword (Dual Swords)',
    nameZh: '暗黑分合剑（双剑）',
    modes: [],
    note: '导出 behaviours 为空、游戏面板未收录；先建「双剑」版本占位，数值待补（需求方 2026-11-07）',
    _source: 'export-missing',
  },

  // ── 重力奇点拟成枪（本体）：导出给的是「病毒 200」，且 behaviours 是空壳 ──
  CephPrimary: {
    modes: [
      {
        id: 'primary',
        label: '球体融合',
        segments: [{ kind: 'impact', aoe: false, damage: { magnetic: 100 }, procChance: 0.3 }],
      },
      {
        id: 'mode2',
        label: '球体爆炸',
        segments: [{ kind: 'explosiveAttack', aoe: true, damage: { magnetic: 200 }, procChance: 0.3 }],
      },
    ],
    note: '导出为「病毒 200」且 behaviours 为空；按游戏面板改为磁力：球体融合 100、球体爆炸 200（原面板值，类型改磁力）',
    _source: 'bible',
  },

  // ── 枢议·重力奇点拟成枪（变体）：导出给的是「病毒 240」，behaviours 是空壳 ──
  CSSimulor: {
    modes: [
      {
        id: 'primary',
        label: '球体融合',
        segments: [{ kind: 'impact', aoe: false, damage: { magnetic: 125 }, procChance: 0.35 }],
      },
      {
        id: 'mode2',
        label: '球体爆炸',
        segments: [{ kind: 'explosiveAttack', aoe: true, damage: { magnetic: 240 }, procChance: 0.35 }],
      },
    ],
    note: '导出为「病毒 240」且 behaviours 为空；按游戏面板改为磁力：球体融合 125、球体爆炸 240（原面板值，类型改磁力）',
    _source: 'bible',
  },

  // ── 蕈菇：游戏面板是「直接命中 16 + 范围 114」，导出塌成一条爆炸 130 ──
  NokkoArchGun: {
    modes: [
      {
        id: 'primary',
        multishot: 6,
        segments: [
          { kind: 'impact', aoe: false, damage: { blast: 16 }, procChance: 0.349 },
          { kind: 'explosiveAttack', aoe: true, damage: { blast: 114 }, procChance: 0.349 },
        ],
      },
    ],
    note: '导出只有一条 DT_EXPLOSION 130；按游戏面板拆成直接命中 16 + 范围 114（火/爆炸组合元素）',
    _source: 'bible',
  },

  // ── 月神狩弓：导出只有需求的 1/3.2（比例一致），按游戏面板改 ──
  ExaltedBow: {
    modes: [
      {
        id: 'primary',
        multishot: 1,
        segments: [
          { kind: 'attack', aoe: false, damage: { impact: 33.6, puncture: 192, slash: 14.4 }, procChance: 0.2 },
        ],
      },
    ],
    note: '导出为 冲 10.5 / 穿 60 / 切 4.5（合计 75）；游戏面板 冲 33.6 / 穿 192 / 切 14.4（合计 240），比例一致',
    _source: 'bible',
  },
  PrimeExaltedBow: {
    modes: [
      {
        id: 'primary',
        multishot: 1,
        segments: [
          { kind: 'attack', aoe: false, damage: { impact: 33.6, puncture: 192, slash: 14.4 }, procChance: 0.2 },
        ],
      },
    ],
    note: '同月神狩弓：导出 75 → 游戏面板 240（冲 33.6 / 穿 192 / 切 14.4）',
    _source: 'bible',
  },
};

/**
 * 拆成**多个武器版本**的导出条目（D-141）。
 *
 * 暗黑分合剑：需求方 2026-11-07「面板先空着，但是给他建两个武器版本，一个巨刃一个双剑，
 * 并用错误标记功能标记上」。依据是导出 `compatibilityTags = ['DUAL_SWORDS_STANCE', 'HEAVY_BLADE_STANCE']`
 * ——两种架势本来就是两套配卡。
 */
export interface WeaponSplit {
  /** 导出键末段（= 原始 `id`） */
  exportId: string;
  versions: Array<{
    /**
     * 补丁 id = **产出 id**（`<exportId>@<后缀>`），与 `WEAPON_PATCHES` 的 key 同一串；
     * 拆版本时直接拿它当产出 id，避免两套写法对不上
     */
    id: string;
    nameEn: string;
    nameZh: string;
    /** 判定 Mod 槽位的架势标签 */
    stanceTags: string[];
  }>;
}

export const WEAPON_SPLITS: readonly WeaponSplit[] = [
  {
    exportId: 'DarkSwordDaggerHybridWeapon',
    versions: [
      {
        id: 'DarkSwordDaggerHybridWeapon@heavy_blade',
        nameEn: 'Dark Split-Sword (Heavy Blade)',
        nameZh: '暗黑分合剑（巨刃）',
        stanceTags: ['HEAVY_BLADE_STANCE'],
      },
      {
        id: 'DarkSwordDaggerHybridWeapon@dual_swords',
        nameEn: 'Dark Split-Sword (Dual Swords)',
        nameZh: '暗黑分合剑（双剑）',
        stanceTags: ['DUAL_SWORDS_STANCE'],
      },
    ],
  },
];

/**
 * 由原条目 copy 出的人工版本（D-141）。
 *
 * 版本条目本身在 `WEAPON_PATCHES` 里只带「名称 + 空面板」，其它面板项（暴击 / 射速 / 弹匣）
 * 从原导出条目继承——需求方说「其他的照旧」。
 */
export interface ManualVariant {
  /** 产出 id（`<exportId>@<后缀>`） */
  id: string;
  /** 导出键末段 */
  exportId: string;
  /** 架势标签（判定近战细类） */
  stanceTags: string[];
}

export const MANUAL_VARIANTS: readonly ManualVariant[] = WEAPON_SPLITS.flatMap((s) =>
  s.versions.map((v) => ({
    id: v.id,
    exportId: s.exportId,
    stanceTags: v.stanceTags,
  })),
);

/** 要**整条丢弃**的导出条目（需求方判定，D-141） */
export const REMOVED_WEAPONS: Readonly<Record<string, string>> = {
  // 需求方 2026-11-07：「他们是技能，不能配卡」——不建武器条目
  GaraShankWeapon: '琉璃碎击：战甲技能，不能配卡，不建武器条目（D-141）',
  GaraShankWeaponPrime: '琉璃碎击 Prime：战甲技能，不能配卡，不建武器条目（D-141）',
  AtlasPunchWeapon: '土石坍方：战甲技能，不能配卡，不建武器条目（D-141）',
  AtlasPunchWeaponPrime: '土石坍方 Prime：战甲技能，不能配卡，不建武器条目（D-141）',
};
