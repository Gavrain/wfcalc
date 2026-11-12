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

/**
 * 武器**中文名**人工表（D-152）。
 *
 * 为什么需要：官方语言包比游戏慢，新武器（WFCD 已收录、官方导出还没有）查不到中文名，
 * 界面上只能显示英文。需求方 2026-11-13 指出这四把的名字不对，要求补上中文名。
 *
 * 依据：warpedia 中文维基（灰机 wiki）的条目名 ——
 *   · Nunchasa  → [霜冥差](https://warframe.huijiwiki.com/wiki/Nunchasa)
 *     「Narin 的标志性弓箭」；
 *   · Aksondol  → [寒怨刺](https://warframe.huijiwiki.com/wiki/Aksondol)
 *     「Narin 的标志性双持手枪」；
 *   · Steflos Prime → [石晶之花Prime](https://warframe.huijiwiki.com/wiki/Steflos_Prime)
 *     「石晶之花的 Prime 版本」；
 *   · Corufell Prime → [闪劫Prime](https://warframe.huijiwiki.com/wiki/Corufell_Prime)
 *     「闪劫的 Prime 版本」。
 *
 * ⚠ 这正是 CLAUDE.md 规则 3 说的「人工推断」：**必须带 `_manual` 说明原因，能回答"哪来的"**。
 * 命名风格按现有数据（`丧钟 Prime` 这类中间带空格），维基原文「石晶之花Prime」不带空格。
 * 由 `packages/data-build/src/wfcd-clean.ts` 的 `MANUAL_ZH_NAME` 消费。
 */
export const MANUAL_WEAPON_ZH: Readonly<Record<string, { zh: string; reason: string }>> = {
  DuelistBow: { zh: '霜冥差', reason: '官方语言包未收录（新武器），取自中文维基条目「霜冥差」' },
  DuelistPistols: { zh: '寒怨刺', reason: '官方语言包未收录（新武器），取自中文维基条目「寒怨刺」' },
  PrimeSteflosShotgun: { zh: '石晶之花 Prime', reason: '官方语言包未收录，取自中文维基「石晶之花Prime」，按现有风格补空格' },
  PrimeCorufellScytheWeapon: { zh: '闪劫 Prime', reason: '官方语言包未收录，取自中文维基「闪劫Prime」，按现有风格补空格' },
};

/**
 * 武器**面板订正表**（D-154）。
 *
 * 需求方 2026-11-13：
 * > 「致胜者不是显赫，他也是双形态武器。有近战和步枪形态，面板不一样。」
 *
 * 制胜者（Vinquibus）是 Uriel 的标志性武器，**同时占用主武器位与近战位**，
 * 两个形态是两把独立的武器条目：
 *
 * | 条目 | 形态 | 数据来源 |
 * |---|---|---|
 * | `TnBayonetRifleWeapon` | 步枪 | WFCD `Primary.json`（完整） |
 * | `TnBayonetMeleeWeapon` | 近战 | **WFCD 未收录**，只能走官方导出，而导出**缺暴击/触发/攻速** |
 *
 * 缺的字段落成 0 / 1 的后果：近战形态**永远不暴击、从不触发异常、攻速 0**，
 * 算出来的伤害是错的。这里按中文维基的面板补上——
 * [制胜者](https://warframe.huijiwiki.com/p/63863)「制胜者（近战）」表：
 * 暴击几率 40.0%、暴击伤害 3.2x、触发几率 20.0%、攻速 1 倍。
 *
 * ⚠ CLAUDE.md 规则 3：人工推断值必须能回答「哪来的」，所以每条都带 `reason`，
 *   由 `packages/data-build/src/index.ts` 写进产出的 `_manual` / `_note` 字段。
 */
export const MANUAL_WEAPON_PANEL: Readonly<
  Record<string, { fields: Record<string, number>; reason: string }>
> = {
  TnBayonetMeleeWeapon: {
    fields: { critChance: 0.4, critMultiplier: 3.2, statusChance: 0.2, fireRate: 1 },
    reason:
      'WFCD 未收录近战形态，官方导出缺暴击/触发/攻速（导出为 0）；按中文维基「制胜者（近战）」面板补：暴击 40%、暴伤 3.2x、触发 20%、攻速 1',
  },
};
