/**
 * 人工数据层：与赋能相关的"事实表"。
 *
 * 原来是写死在 adapter 里的代码，现在按需求方 2026-11-17 的分类搬成数据。
 * 转换逻辑在 packages/core/src/input/arcane.ts。
 *
 * 依据：核心事实 §11（数据层给内核的结构化事实）。
 */
import type { ContribStat } from '../../../core/src/contributions.ts';

export const ARCANE_STAT_OVERRIDES: Readonly<Record<string, Readonly<Record<string, ContribStat | null>>>> = {
  // ── bucket 标错、词条其实是基伤 ──
  SecondaryDamageOnHeatProc: { BONUS: 'baseDamage' },
  // ── D-116：上限 / 条件 / 概率被当成加成 ──
  // 主要·堡垒：每点护甲 +1%，上限 +500% —— 满护甲时就是 500%（需求方 2026-11-06）
  DamageForBonusArmour: { GIVE_STAT: 'baseDamage', GIVE_STAT_MAX: null },
  // 主要·过载：能量 ≥90% 时「最大能量的 35%」作为多重，上限 350% —— 按满层取 350%
  MultishotForMaxEnergy: { HAVE_STAT_MIN: null, GIVE_STAT: 'multishot', GIVE_STAT_CAP: null },
  // 主要·衰弱：100% 是「追加基本异常」的概率，不是触发几率
  SplitStatusProcsOnStackedStatusHit: { CHANCE: null },
  // 主要·滞阻：15 是干扰半径（米），不是触发几率
  PrimaryJamEnemyWeaponsOnMagneticProc: { JAM_RANGE: null },
  // 主要·压缩（D-123 需求方：「记下他改变爆炸范围增加伤害和弹药效率这件事，
  //   但是由于这个赋能过于复杂，涉及爆炸范围，目前不实现」）：
  //   描述 = 瞄准时爆炸半径 ×0.2，**每损失 1 米** +100% 伤害、+5.5% 弹药效率。
  //   要算它必须知道该武器的爆炸半径与"损失了多少米"，而半径目前不在内核里 → 整条不生效。
  ConvergeRadialAttackOnAim: { RADIUS: null, STAT1: null, STAT2: null },
  // 主要·镀金弹头：数值槽里没有任何加成值，只有持续时间
  PrimaryPlatedRound: { DURATION: null },
  // 主要·死首：裸 .val 放行后按顺序对齐 —— [1] **弱点伤害** +30%（D-118：不随层数叠加），[2] 后坐力 -50%
  // D-138：次要·死首同样登记（以前只登记了主要版，次要版这 30% 被当"裸 val"丢掉）。
  //   需求方 2026-11-06：「现版本游戏，弱点==爆头，请全部改为弱点描述」
  PrimaryDamageOnNoMelee: { VAL: 'weakpointDamage', VAL2: null },
  SecondaryDamageOnNoMelee: { VAL: 'weakpointDamage', VAL2: null },
  // 次要·低温：NUM_PROCS 是"施加 3 层冰冻异常"的层数，不是触发几率（D-138：不生效）
  SecondaryColdOnPuncture: { NUM_PROCS: null },
  // ── 不是伤害词条 / 没有对应通路 → 明确不生效（null 覆盖 bucket 推断，避免误算） ──
  SecondaryOnRollCritChanceOnHeadshot: { BONUS: null }, // +300% 暴率**仅对弱点命中**生效
  ExtraProcOnProc: { BONUS: null }, // +24% 是"二次触发的概率"，不是状态触发率词条
  PrimaryEnergyRegenOnImpactProc: { BONUS: null }, // 能量回复
  // 次要·冷颤：类镀层加成，**只对冰冻层数生效**（需求方 2026-11-06）
  SecondaryExtraDamagePerFreezeStack: { VAL: 'coFreeze' },
  // ── 近战·刃影（D-189，需求方 2026-11-13）：`[0].CHANCE` = 25/40/55/70/85/100
  //   是「基础暴击命中时追加一次攻击」的**概率**，不是状态触发几率。
  //   ⚠ 不要登记 `STACKS`——它没有层数槽，`arcaneStackCount` 会自然回落到 1，
  //     按等级直接取 CHANCE 就是满值（满级 100）。
  ReplayLightCritHits: { CHANCE: 'bladeShadow' },
  // ── 词条名可识别，但指向的乘区要人工确认 ──
  LongbowDamageOnHeadshot: { DAMAGE: 'baseDamage' }, // "下一发"+300%
  StatusTriggerRadialDamage: { CHANCE: null, STAT1: null, RANGE: null }, // 需求方：设置成无效果
  BurningCystOnKill: { CHANCE: null, DAMAGE: null }, // DAMAGE 是触发物伤害，不是武器加成
  IceMistOnKill: { CHANCE: null, DAMAGE: null },
  LightningStrikeOnKill: { CHANCE: null, DAMAGE: null },
  ToxicBloodOnKill: { CHANCE: null, DAMAGE: null },
  // 需求方 2026-11-13：瀑流·强化的 750 是「触发异常时额外造成 750 伤害」——**附加伤害**，
  // 不是加成词条。以前整张被 `ARCANE_IGNORED` 屏蔽（等于不存在），现在放行，
  // 但数值不当作武器加成（null），界面上会显示「不参与增伤计算」。
  SecondaryOnStatusProcBonusDamage: { AMOUNT: null },
};

/**
 * 整个赋能**不参与伤害计算**的清单（数值根本不是武器伤害词条）。
 * 用整表排除，避免"第一个词条走 bucket 兜底"又把它们算进去。
 */
/**
 * **官方 \`STACKS\` 槽不可信**时的层数覆写（赋能 id → 真实层数）。
 *
 * 瀑流·耀炎（瀑流·耀炎）的导出是 \`[0].STACKS = 480\`，和描述 \`Stacks up to 480%\` 同源——
 * 那是**累加上限**（每层 12% → 40 层），不是层数。需求方 2026-11-06 确认：「耀炎是 480」
 * 指的就是那个 480%（40 层 × 12%）。
 */

export const ARCANE_BONUS_STATS: Readonly<Record<string, readonly (ContribStat | null)[]>> = {
  PrimaryCritDmgAndMultishotOnColdProc: ['critMultiplier', 'multishot'],
  PrimaryHeadshotCritMultOnHeadshot: ['critMultiplier', 'multishot'],
  SecondaryReloadSpeedAndMultishotOnElectricProc: ['reloadSpeed', 'multishot'],
  ShotgunMultishotAndReloadSpeedOnCloseKill: ['multishot', 'reloadSpeed'],
  HeavyAttackDamageAndShieldOnShieldBreak: ['baseDamage', null],
};

/**
 * **数值槽本身没有词条名**、但描述里其实有**多条加成**的赋能（D-138）。
 *
 * | 赋能 | 导出槽 | 描述 | 处理 |
 * |---|---|---|---|
 * | 次要·爆发 `MultishotForCombo` | `STAT_VALUE:20`（单槽） | 每层消耗的连击倍率 **+20% 暴击几率 和 暴击伤害** | 拆成暴率 +20 / 暴伤 +20 两条 |
 *
 * 之前只有 `bucket = critMultiplier` 兜底，暴率那一条整条丢了。
 * 两条都从同一个导出值取（描述里两个百分比相同）。
 */

export const ARCANE_MULTI_STATS: Readonly<Record<string, readonly ContribStat[]>> = {
  MultishotForCombo: ['critChance', 'critMultiplier'],
};

/**
 * **词条名 → 内核属性**的显式覆盖（按赋能 id + 词条名）。
 *
 * 用于两种情况，两种情况都必须按 Mod 描述人工判定：
 * 1. 词条名没有语义（`VAL` 被过滤掉了，只能用 bucket），而 **bucket 是错的**；
 * 2. 词条名有语义但代码认不出（`AMOUNT` / `STAT1` / `CHANCE` …）。
 *
 * | 赋能 | 实际问题 | 处理 |
 * |---|---|---|
 * | 瀑流·耀炎 | 词条是 `BONUS`（基伤），流水线 `bucket` 写成 `statusChance` | 基伤 |
 * | 瀑流·精准 | `BONUS` = +300% **Crit Chance on Weakpoint Hits**，不是全局暴率 | 现无 weakpoint 暴率通路，**不生效** |
 * | 次要·妨害 | `BONUS` 是"二次触发的概率"，不是状态触发率词条 | **不生效** |
 * | 主要·激昂 | `BONUS` 是能量回复，不是状态触发率 | **不生效** |
 * | 次要·冷颤 | 裸 `.val` = "敌人多受 45% 伤害"，是独立终伤倍率 | **不生效**（等待其乘区确认） |
 * | 瀑流·强化 | `[BONUS,AMOUNT]` = +750 固定附加伤害（不是百分比） | **不生效** |
 * | 弓箭·利矢 | `BONUS.DAMAGE`，只作用于"下一发" | 基伤（上限口径已简化） |
 *
 * **D-116（需求方 2026-11-06）**：官方导出的数值槽里混着「条件 / 上限 / 层数 / 概率」，
 * 被 `statForArcaneKey` 按词条名一律当成了**每层加成**，于是算出了下面这些明显错的数：
 *
 * | 赋能 | 导出值 | 旧结果 | 现状 |
 * |---|---|---|---|
 * | 主要·堡垒 `DamageForBonusArmour` | `GIVE_STAT:1` `GIVE_STAT_MAX:500` | 基伤 +1 | **基伤 +500**（需求方：「应该是 500」） |
 * | 主要·过载 `MultishotForMaxEnergy` | `HAVE_STAT_MIN:90` `GIVE_STAT:35` `GIVE_STAT_CAP:350` | 多重 +90 | 多重 +350（35% × 10 层，需求方：按描述满层取） |
 * | 主要·衰弱 `SplitStatusProcsOnStackedStatusHit` | `CHANCE:100` | 触发 +1000 | **不生效**（追加异常的概率，不是触发率词条） |
 * | 主要·滞阻 `PrimaryJamEnemyWeaponsOnMagneticProc` | `JAM_RANGE:15` | 触发 +15 | **不生效**（干扰范围，不是触发率） |
 * | 主要·压缩 `ConvergeRadialAttackOnAim` | `RADIUS:0.2` `STAT1:100` `STAT2:5.5` | 无 | **不生效**（D-123：它会改爆炸范围、并按损失的半径加伤害/弹药效率，涉及半径数据，需求方明确「目前不实现」） |
 * | 主要·镀金弹头 `PrimaryDamagePerAmmoOnReload` | 只有 `DURATION` | 无 | **不生效**（每发弹药的加成按弹匣长度换算，待确认） |
 * | 主要·死首 `PrimaryDamageOnNoMelee` | `[1].val:30` `[2].val:-50` | 无 | 弱点伤害 +30（不随层数叠加，D-118；-50 后坐力仍忽略） |
 */

export const ARCANE_TOTAL_OVERRIDES: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  DamageForBonusArmour: { baseDamage: 500 },
  MultishotForMaxEnergy: { multishot: 350 },
  PrimaryDamageOnNoMelee: { weakpointDamage: 30 },
  SecondaryDamageOnNoMelee: { weakpointDamage: 30 }, // D-138：与主要·死首同口径
};

/**
 * 赋能**在界面上显示的词条**（D-116 / D-123：待选区与装备区都要有词条）。
 *
 * ⚠ D-123 修正：以前这里用一张显示缩放表显示**上限**（堡垒 500、过载 350），
 *   而真正喂给内核的仍是导出里的第一个数（1、35）——「描述改对了，收益还是不对」。
 *   现在数值合并在 `arcaneToContributions` 里完成，这里只是同一份结果的透传，
 *   所以**卡上显示的就是算进内核的**；「明确不生效」的赋能返回空数组，卡上不写任何提示。
 *
 * @returns `[{ stat, amount, label }]`，`amount` 为百分比口径
 */

export const ARCANE_STACK_OVERRIDES: Readonly<Record<string, number>> = {
  SecondaryDamageOnHeatProc: 40, // 每层 12% × 40 = 480%
};
/**
 * **没有层数槽**的赋能 → 层数恒为 1（需求方 2026-11-13 核对）。
 *
 * 霰弹·仇杀 / 近战·同化的官方原文**没有 STACKS**（数值槽只有 BONUS1 / BONUS2 / DURATION），
 * 但旧实现按"每层值 × 40"在乘，等于多算了 40 倍：
 * ```
 * 霰弹·仇杀   多重 +180% / 装填 +75%（原文就是这么多，不是每层值）
 * 近战·同化   重击伤害 +150% / 护盾 +30%
 * ```
 */

export const ARCANE_NO_STACKS: ReadonlySet<string> = new Set([
  'ShotgunMultishotAndReloadSpeedOnCloseKill',
  'HeavyAttackDamageAndShieldOnShieldBreak',
]);


export const ARCANE_IGNORED = new Set<string>([]);

/** 解析单个赋能的某个词条 → 内核属性（null = 不参与伤害计算） */

export const ARCANE_NON_STAT_NAMES = new Set(['STACKS', 'MAX_STACKS', 'DURATION', 'MAX', 'TIME', 'RANGE', 'RADIUS', 'COOLDOWN']);

/** 赋能的数值槽名 → 内核属性（认不出返回 null） */
