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

  // ── 需求方 2026-11-13：三把枪的弹匣 / 装填数据源缺失或填错 ──
  //
  // 背景：官方导出与 WFCD 同源，**两边一起缺或一起错**，所以「两份源一致」并不构成证据。
  //       太始弓就是活例：两份源都写装填 0.05 秒，而全库其它 16 把弓都是 0.55~0.7 秒。

  TnGrimoire: {
    // 需求方：「魔典就是弹匣0，换句话说他是弹匣内无限子弹」——
    // 弹匣 0 = 不需要装填，续航秒伤直接取连发秒伤（见 core/output.ts 的 sustainedDps）。
    fields: { magazineSize: 0 },
    reason: '魔典弹匣内无限子弹；两份数据源都没有 magazineSize 字段，按需求方 2026-11-13 确认填 0（0 = 无需装填）',
  },
  // ⚠ TnDoppelgangerGrimoire 不在这里：需求方 2026-11-13 确认它是查不到来源的重复条目，
  //   已由 `wfcd-clean.ts` 的 DUPLICATE_WFCD_IDS 剔除（且不会被官方导出补回来）。
  OmicrusPlayerWep: {
    // 需求方：「太始弓也是的，但是由于太始弓是弓箭，他是弹匣1备弹无限」
    // 装填：两份源都写 0.05 秒，明显错误（其余 16 把弓 0.55~0.7）；
    //       需求方确认应为 **0.6 秒**。
    fields: { magazineSize: 1, reloadTime: 0.6 },
    reason: '太始弓：两份数据源缺 magazineSize（按需求方确认为弹匣 1）；reloadTime 两份源都写 0.05 秒，与全库其它弓（0.55~0.7）量级不符，按需求方 2026-11-13 确认改为 0.6 秒',
  },
  CrpSplitLaser: {
    // 需求方：「导热聚焦枪弹匣70」——两份源都没有这个字段（WFCD 197 把主要武器里
    // 只有它和太始弓是空），按游戏内面板补。
    fields: { magazineSize: 70 },
    reason: '导热聚焦枪：两份数据源都没有 magazineSize，按需求方 2026-11-13 与游戏内面板确认补 70',
  },
};

/**
 * 制胜者的**两个形态拆成两把武器**（D-155，需求方 2026-11-13）。
 *
 * 需求方：
 * > 「跟拆成两把武器，分别带主要、近战后缀。
 * >   然后把近战武器的普攻、震地、重型震地拆成三个模式，这不是一个攻击内的不同段。」
 * > 「枪击也独立出来好了，因为枪刃另外包括闪劫都有近战射击模式，
 * >   虽然叫射击但也使用的是近战 mod 赋能，只是面板不一样。」
 *
 * 为什么必须手写：近战形态（`TnBayonetMeleeWeapon`）**WFCD 六个武器文件全都没收录**，
 * 官方导出里它只有两条一模一样的 behaviour，没有任何攻击名——所以震地、重型震地、
 * 枪击这三样拿不到自动数据，只能按中文维基手工落。
 *
 * 数值来源（[制胜者](https://warframe.huijiwiki.com/p/63863)，需求方 2026-11-13 确认
 * 「这个是对的，跟游戏内一样」）：
 *
 * | 攻击 | 伤害 | 范围 | 触发 | 暴击 |
 * |---|---|---|---|---|
 * | 普攻 | 穿刺 182 + 斩击 78 | — | 20% | 面板 40% / 3.2x |
 * | 枪击 | 穿刺 182 + 斩击 78（与普攻同伤害） | 4 米爆心，延迟 0.8 s | 20% | 面板 40% / 3.2x |
 * | 震地攻击 | 冲击 440 | 7 米，边缘 50% | 10% | 面板 40% / 3.2x |
 * | 重型震地攻击 | 爆炸 660 | 8 米，边缘 70% | — | 34% / 2.6x（攻击自带面板） |
 *
 * ⚠ 滑行攻击（520）需求方明确「现在没人用了，可以忽略」，不收。
 * ⚠ 步枪形态**没有爆炸段**（需求方 2026-11-13：「他步枪形态没有爆炸」）——
 *   官方导出里那条 3.3/3.3/3.3 的第二 behaviour 是隐藏字段，不落库。
 */
export interface WeaponOverlay {
  /** 产出 id */
  id: string;
  /** 原条目 id（产物里这个条目要被替换掉） */
  exportId: string;
  nameEn: string;
  nameZh: string;
  /** 槽位类型：`primary` 主武器 / `melee` 近战 */
  category: 'primary' | 'melee';
  /** 面板字段（暴击 / 触发 / 攻速 …） */
  fields: Record<string, number>;
  /** 模式（结构与 `weapons/*.json` 的 `modes` 一致，略去 `bullets` / `multishot`） */
  modes: Array<{
    id: string;
    label?: string;
    trigger: string;
    heavy?: boolean;
    /** 模式级面板（例如重型震地自带的 34% / 2.6x） */
    override?: Record<string, number>;
    variants: Array<{ id: string; label: string; segments: Array<Record<string, unknown>> }>;
  }>;
  /** 为什么手写（写进产出的 `_note`） */
  reason: string;
}

const BAYONET_REASON =
  '制胜者近战形态 WFCD 未收录、官方导出无攻击数据；伤害与震地/重型震地按中文维基「制胜者（近战）」手工落库，需求方 2026-11-13 确认与游戏内一致';

export const WEAPON_OVERLAYS: readonly WeaponOverlay[] = [
  {
    id: 'TnBayonetRifleWeapon',
    exportId: 'TnBayonetRifleWeapon',
    nameEn: 'Vinquibus (Primary)',
    nameZh: '制胜者（主要）',
    category: 'primary',
    fields: { critChance: 0.4, critMultiplier: 3.2, statusChance: 0.2, fireRate: 1.5, magazineSize: 8, reloadTime: 3 },
    modes: [
      {
        id: 'primary',
        label: '射击',
        trigger: 'semi',
        variants: [
          {
            id: 'direct',
            label: '直接命中',
            segments: [{ kind: 'attack', aoe: false, damage: { puncture: 280, slash: 120 }, procChance: 0.2 }],
          },
        ],
      },
    ],
    reason: '步枪形态按官方导出（穿刺 280 + 斩击 120）；需求方 2026-11-13「他步枪形态没有爆炸」，不收爆炸段',
  },
  {
    id: 'TnBayonetMeleeWeapon',
    exportId: 'TnBayonetMeleeWeapon',
    nameEn: 'Vinquibus (Melee)',
    nameZh: '制胜者（近战）',
    category: 'melee',
    fields: { critChance: 0.4, critMultiplier: 3.2, statusChance: 0.2, fireRate: 1 },
    modes: [
      {
        id: 'primary',
        label: '普攻',
        trigger: 'unknown',
        variants: [
          {
            id: 'direct',
            label: '直接命中',
            segments: [{ kind: 'attack', aoe: false, damage: { puncture: 182, slash: 78 }, procChance: 0.2 }],
          },
        ],
      },
      {
        id: 'ranged',
        label: '枪击',
        trigger: 'unknown',
        variants: [
          {
            id: 'direct',
            label: '直接命中',
            segments: [{ kind: 'attack', aoe: false, damage: { puncture: 182, slash: 78 }, procChance: 0.2 }],
          },
          {
            // 需求方原话里 400 爆炸是「近战形态的枪击爆炸」，不是步枪形态的
            id: 'blast',
            label: '爆炸',
            segments: [
              { kind: 'explosiveAttack', aoe: true, damage: { blast: 400 }, procChance: 0.2, radius: 4, delay: 0.8, falloff: 0.7 },
            ],
          },
        ],
      },
      {
        id: 'slam',
        label: '震地攻击',
        trigger: 'unknown',
        variants: [
          {
            id: 'blast',
            label: '范围伤害',
            segments: [
              { kind: 'explosiveAttack', aoe: true, damage: { impact: 440 }, procChance: 0.1, radius: 7, falloff: 0.5 },
            ],
          },
        ],
      },
      {
        id: 'heavy',
        label: '重型震地攻击',
        trigger: 'unknown',
        heavy: true,
        variants: [
          {
            id: 'blast',
            label: '范围伤害',
            segments: [
              { kind: 'explosiveAttack', aoe: true, damage: { blast: 660 }, procChance: 0.2, radius: 8, falloff: 0.7 },
            ],
          },
        ],
        // 重型震地自带面板（维基：暴击 34% / 2.6x），与武器级 40% / 3.2x 不同
        override: { critChance: 0.34, critMultiplier: 2.6 },
      },
    ],
    reason: BAYONET_REASON,
  },
];
