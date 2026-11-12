/**
 * 武器**结构**订正表：把一条导出条目拆成多个武器版本（D-141 / D-147 收窄）。
 *
 * 需求方 2026-11-12：
 * > 「2 你昨天检查过 wfcd 有这些武器的，再去看看，有就删掉」
 * > 「就留拆版本这个事情」
 *
 * 原先这里还有两类内容，已按要求删除：
 *   · `WEAPON_PATCHES`（7 把的面板数值：分离 / 分离 Prime / 蕈菇 / 月神狩弓两把 / 重力奇点拟成枪两把）
 *     —— WFCD 全部收录且数值一致，不再手写；
 *   · `REMOVED_WEAPONS`（琉璃碎击 / 土石坍方 ×2 的技能条目）—— WFCD 本来就没有这四把，
 *     数据源换到 WFCD 后它们天然不入库，剔除清单失去意义。
 *
 * 只留下「暗黑分合剑拆巨刃 / 双剑」：WFCD 只有一条 `Dark Split-Sword`，
 * 而游戏里两种架势是两套配卡（需求方 2026-11-07：「面板先空着，但是给他建两个武器版本」）。
 * 现在面板不再手写，两版都从 WFCD 那条攻击复制而来，只区分架势标签。
 */

/**
 * 拆成**多个武器版本**的条目（D-141）。
 *
 * 暗黑分合剑：依据导出 `compatibilityTags = ['DUAL_SWORDS_STANCE', 'HEAVY_BLADE_STANCE']`
 * ——两种架势本来就是两套配卡。
 */
export interface WeaponSplit {
  /** 原始 `id`（= 数据源的唯一名末段） */
  exportId: string;
  versions: Array<{
    /** 产出 id（`<exportId>@<后缀>`） */
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
 * 面板（伤害段 / 暴击 / 射速 / 弹匣）全部继承原条目——需求方说「其他的照旧」。
 */
export interface ManualVariant {
  /** 产出 id（`<exportId>@<后缀>`） */
  id: string;
  /** 原条目 id */
  exportId: string;
  /** 架势标签（判定近战细类） */
  stanceTags: string[];
  nameEn: string;
  nameZh: string;
}

export const MANUAL_VARIANTS: readonly ManualVariant[] = WEAPON_SPLITS.flatMap((s) =>
  s.versions.map((v) => ({
    id: v.id,
    exportId: s.exportId,
    stanceTags: v.stanceTags,
    nameEn: v.nameEn,
    nameZh: v.nameZh,
  })),
);
