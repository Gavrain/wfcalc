/**
 * 清洗：官方导出 → 统一的武器面板结构。
 *
 * 规则来自 research/01-数据源可行性验证.md 第 6 节，每条规则都独立成函数，
 * 便于单测，也便于出错时定位是哪条规则导致数量异常。
 */
import { DT_KEY_MAP } from '../../core/src/damage-types.ts';
import type { DamageSpread } from '../../core/src/damage-types.ts';
import type {
  AttackMode,
  DamageSegment,
  ModeRole,
  ModeVariant,
  SegmentKind,
  TriggerKind,
  Weapon,
} from '../../core/src/weapon.ts';
import { hasAoeSegment } from '../../core/src/weapon.ts';
import type { ExportAttack, ExportBehaviour, ExportProjectile, ExportWeapon, ExportWeapons } from './types.ts';
import { incarnonInfoOf } from '../../data/manual/incarnon.ts';
import { incarnonStatsOf } from '../../data/manual/incarnon-stats.ts';
import {
  MANUAL_VARIANTS,
  REMOVED_WEAPONS,
  WEAPON_PATCHES,
  WEAPON_SPLITS,
  type ManualMode,
  type ManualVariant,
} from '../../data/src/manual/weapon-patches.ts';

/**
 * 投射物来源：普通发射还是蓄力发射。
 *
 * 2026-11 变更：core 已按 D-011 改成与**产出 JSON 逐字段对齐**的 `Weapon` 模型，
 * 原本定义在 `weapon.ts` 的 `ProjectileSlot` 与 `WeaponPanel` 不再由 core 导出——
 * `WeaponPanel` 是 data-build 自己的**中间模型**，`ProjectileSlot` 只是本文件的
 * 内部参数，都留在本包。
 */
type ProjectileSlot = 'projectile' | 'chargedProjectile';

/** 清洗统计，用于 dry-run 报告 */
export interface CleanStats {
  totalWeapons: number;
  keptWeapons: number;
  droppedPlaceholderBehaviours: number;
  keptBehaviours: number;
  weaponsWithMultipleModes: number;
  weaponsWithAoe: number;
  weaponsWithUnknownDamageType: number;
  /** 被分类过滤规则排除的条目数 */
  excludedByCategory: number;
  /** 清洗后没有有效模式而被跳过的条目数 */
  droppedNoValidMode: number;
  /** 跳过时**记录了原因**的条目数（D-142：不再静默丢弃）；其余为无 behaviours 的组件 */
  droppedReported: number;
  /** 应用了人工订正（`manual/weapon-patches.ts`）的武器数 */
  patchedWeapons: number;
  /** 由人工层整条构造的武器版本数（如暗黑分合剑的巨刃 / 双剑） */
  manualWeapons: number;
  /** 按需求方要求整条移除的条目数（技能类，不能配卡） */
  removedWeapons: number;
}

/**
 * 分类过滤规则（需求方确认）：
 *   - OperatorAmps：指挥官武器，不计入（DrifterPistol）
 *   - DrifterMelee：漂泊者近战，均存在同名战甲版且面板缺失，排除以免重复
 *
 * 保留：LongGuns / Pistols / Melee / SpecialItems（战甲技能武器）/
 *       SentinelWeapons（同伴）/ SpaceGuns / SpaceMelee（空战）
 */
export const EXCLUDED_CATEGORIES: readonly string[] = ['OperatorAmps', 'DrifterMelee'];

export interface CleanResult {
  weapons: Weapon[];
  stats: CleanStats;
  warnings: string[];
}

/** 清洗阶段的武器：计算模型 `Weapon` + 只在本阶段使用的溯源字段 */
export type CleanedWeapon = Weapon & {
  /** 官方导出的语言包键，localize 阶段解析显示名后即可移除 */
  languageKey?: string;
};
/**
 * 规则 1：识别并丢弃占位 behaviour。
 *
 * 实测有两类占位：
 *   A. 无 stateName、无投射、只有一条裸 `DT_IMPACT`（如 40 点冲击）。
 *   B. 有 stateName、无投射、只有一条裸 `DT_IMPACT`（同样量级的数据模板）。
 *
 * 注意：
 *   - **只针对裸 `DT_IMPACT`**。单一非冲击伤害（如 Haalvu 的纯 tau、
 *     部分武器的纯切割）是真实面板，必须保留。
 *   - 带 projectile / chargedProjectile 的 behaviour 永不整体丢弃；
 *     其内部的等值物理模板段在段级别过滤（见 toSegments）。
 */
/**
 * 规则 1：识别并丢弃占位 behavior（D-142 重写）。
 *
 * ## 为什么旧规则会出错
 *
 * 旧规则只有一条：「没有 projectile，且 impact 只有单类型 `DT_IMPACT`」→ 占位。
 * 它把**真实的单类型冲击武器**一起删了（映声战锤 340、双节尺棍 180、古声 170），
 * 因为真武器的唯一伤害完全可以是一条单类型冲击。
 *
 * ## 导出里的「模板」长什么样
 *
 * 实测同一个 4 字段指纹在几十把武器里逐字重复：
 * ```jsonc
 * "impact": { "DT_IMPACT": 3.33333, "DT_PUNCTURE": 3.33333, "DT_SLASH": 3.33334, "procChance": 0.1 }
 * "impact": { "DT_IMPACT": 40, "procChance": 0.1 }
 * ```
 * 判断依据（需求方 2026-11-07 确认）：
 *   · **`damagePerShot` 只描述一个模式**（多数是主模式）——横痃重炮的副模式榴弹爆炸、
 *     风鸣的蓄力直击都不在数组里；
 *   · 模板的**伤害类型与面板类型对不上**：分离面板是「冲击 130」，而 impact 是「切 + 穿」，
 *     面板里穿刺/切割都是 0 → 这条 impact 是废数据；
 *   · 模板的 **`procChance` 恒为 0.1**，而真武器的 impact 用的通常是武器级触发
 *     （映声战锤 0.15、分离 0.25、风鸣蓄力 0.27、横痃重炮副模式 0.57）。
 *
 * ## 现行判据（三条，缺一不可）
 *
 * 1. **主模式**（该武器第一个有伤害的 behavior）才做「逐类型比对」：
 *    impact 的每一种伤害类型都必须等于 `damagePerShot` 对应位；对得上 → 真伤害。
 * 2. **`procChance` 自洽**：impact 的 procChance 必须等于武器级 `procChance`，
 *    否则是模板里写死的 0.1（分离 0.25 ≠ 0.1 → 判废）。
 * 3. **兜底**：命中指纹（等值物理三元素或单类型裸冲击 + 小额 + procChance 0.1）→ 占位。
 *
 * 非主模式**不做面板比对**（面板描述不了它），只走 2/3 两条。
 */
export interface PlaceholderContext {
  /** 该 behavior 是否是武器的**主模式**（第一个有伤害的 behavior） */
  primary?: boolean | undefined;
  /** 武器级 `damagePerShot`（20 格数组） */
  damagePerShot?: readonly number[] | undefined;
  /** 武器级 `procChance`（触发几率） */
  weaponProcChance?: number | undefined;
}

/** impact 里所有 `DT_*` 数值之和 */
export function impactSum(impact: ExportAttack | undefined): number {
  if (!impact) return 0;
  return Object.entries(impact)
    .filter(([k, v]) => k.startsWith('DT_') && typeof v === 'number')
    .reduce((s, [, v]) => s + (v as number), 0);
}

/**
 * impact 的伤害类型是否与 `damagePerShot` **逐类型一致**（D-142）。
 *
 * 只对主模式有意义：`damagePerShot` 描述的就是那一个模式。
 *   · 映声战锤 `[340,0,…]` vs `DT_IMPACT:340` → 一致；
 *   · 分离         `[130,0,…]` vs `DT_IMPACT:3.33 / DT_PUNCTURE:3.33 / DT_SLASH:3.33` → 不一致（切/穿面板是 0）；
 *   · 横痃重炮       `[2,13,19,0,…,7,…]` vs 主模式 impact `16/14/10` → 不一致（副模式的 143 病毒不在数组里）。
 */
export function impactTypesMatchPanel(
  impact: ExportAttack | undefined,
  damagePerShot: readonly number[] | undefined,
): boolean {
  if (!impact || !damagePerShot) return false;
  let compared = 0;
  for (const [key, value] of Object.entries(impact)) {
    if (!key.startsWith('DT_') || typeof value !== 'number') continue;
    const idx = DAMAGE_PER_SHOT_INDEX[key];
    if (idx === undefined) return false;
    const panel = damagePerShot[idx] ?? 0;
    if (Math.abs(panel - value) > Math.max(0.01, Math.abs(value) * 0.002)) return false;
    compared++;
  }
  return compared > 0;
}

/** 等值物理三元素 + procChance 0.1 + 数额极小：模板指纹 */
function isUniformPhysicalTiny(impact: ExportAttack): boolean {
  const imp = impact['DT_IMPACT'];
  const pun = impact['DT_PUNCTURE'];
  const sla = impact['DT_SLASH'];
  if (imp == null || pun == null || sla == null) return false;
  const otherKeys = Object.keys(impact).filter(
    (k) => k !== 'DT_IMPACT' && k !== 'DT_PUNCTURE' && k !== 'DT_SLASH' && k !== 'procChance',
  );
  if (otherKeys.length > 0) return false;
  const proc = impact['procChance'];
  return Math.abs(imp - pun) < 1e-3 && Math.abs(pun - sla) < 1e-3 && imp <= 40 && (proc == null || Math.abs(proc - 0.1) < 1e-6);
}

/** impact 是否命中「单一类型裸冲击 + 小额 + procChance 0.1」指纹 */
function isBareImpactTiny(impact: ExportAttack): boolean {
  const types = Object.keys(impact).filter((k) => k.startsWith('DT_') && typeof impact[k] === 'number');
  if (types.length !== 1 || types[0] !== 'DT_IMPACT') return false;
  const proc = impact['procChance'];
  return (impact['DT_IMPACT'] ?? 0) <= 40 && (proc == null || Math.abs(proc - 0.1) < 1e-6);
}

/** 规则 1 的单一入口：这条 behavior 是否整体丢弃 */
export function isPlaceholder(b: ExportBehaviour, ctx: PlaceholderContext = {}): boolean {
  if (b.projectile || b.chargedProjectile) return false;
  if (b.burst && !b.stateName) return false;
  if (!b.impact) return true;

  const impact = b.impact;
  const small = impactSum(impact) <= 40;
  const proc = impact['procChance'];
  const weaponProc = ctx.weaponProcChance;
  const { damagePerShot } = ctx;
  const hasProjectile = Boolean(b.projectile || b.chargedProjectile);
  const fingerprint = isUniformPhysicalTiny(impact) || isBareImpactTiny(impact);

  // (1) 主模式：与 `damagePerShot` **逐类型一致** → impact 是真伤害
  //     （映声战锤 340 / 双节尺棍 180 / 古声 170 / 预言者 33.67×3）。
  if (ctx.primary && impactTypesMatchPanel(impact, damagePerShot)) return false;

  // (2) 小额模板指纹（等值物理三元素 / 单类型裸冲击）
  if (small && fingerprint) return true;

  // (3) procChance 自洽性：模板恒为 0.1，真武器用武器级触发。
  //     · 分离：面板 0.25 vs impact 0.1 → 模板（需求方 2026-11-07 确认导出是废数据，面板另补）；
  //     · 雷霆第二模式 `穿 8 + 电 25 @0.1`：面板 0.16/0.22 → 模板。
  //     ⚠ 但要注意：雷霆第一模式（主模式，projectile 提供真伤害）有两个 impact 候选，
  //       删掉的要是「主模式的 impact」会让面板倒挂，所以只对**命中模板指纹**的 impact 生效。
  if (
    fingerprint &&
    !hasProjectile &&
    proc != null &&
    Math.abs(proc - 0.1) < 1e-6 &&
    weaponProc != null &&
    Math.abs(weaponProc - 0.1) > 1e-6
  ) {
    return true;
  }

  // (4) 雷霆的第二模式（`穿 8 + 电 25`）：**无投射组、又不在面板里**，但它是这个 behavior 的全部伤害。
  //     判据：非主模式 + 无投射组 + 命中模板指纹 + procChance 0.1 → 模板；其余保留。
  if (!hasProjectile && !ctx.primary && fingerprint) return true;

  return false;
}

/**
 * 主模式下标（D-142）：只对**主模式**做 `damagePerShot` 比对，因为那个数组只描述一个模式。
 *
 * 判定顺序：
 *   1. 第一个带**真实投射伤害**（`projectile.attack` / `explosiveAttack` 有值）的 behavior；
 *   2. 否则第一个有 `impact` 的 behavior；
 *   3. 都没有就取 0。
 */
export function primaryBehaviourIndex(behaviours: readonly ExportBehaviour[]): number {
  const hasReal = (a: unknown): boolean => Boolean(a) && Object.keys(a as object).some((k) => k.startsWith('DT_'));
  let firstImpactOnly = -1;
  for (let i = 0; i < behaviours.length; i++) {
    const b = behaviours[i]!;
    for (const proj of [b.projectile, b.chargedProjectile]) {
      if (!proj) continue;
      if (hasReal(proj.attack) || hasReal(proj.explosiveAttack)) return i;
    }
    if (firstImpactOnly < 0 && b.impact) firstImpactOnly = i;
  }
  return firstImpactOnly >= 0 ? firstImpactOnly : 0;
}

/**
 * 判断 impact 段是否为模板占位。
 *
 * 特征（三者同时满足才判定为占位）：
 *   1. 只含物理三元素 + procChance
 *   2. 三元素近似等值
 *   3. **数值极小**（≤ 40）——真实武器的物理伤害可以很高（如帕里斯 9/153/18 虽不等值，
 *      但也存在真实三等分的低伤段），而占位段实测恒为 1.99/2.67/3.33/4/6.67/10/40。
 *   4. procChance 为 0.1（缺省时也算）
 *
 * 仅靠"等值"会误杀真实武器，必须叠加"数值极小"限制。
 */
export function isUniformPhysicalPlaceholder(impact: ExportAttack | undefined): boolean {
  if (!impact) return false;
  return isUniformPhysicalTiny(impact);
}

/**
 * `impact` 是否为**单类型小额占位**（D-079）。
 *
 * 实测：10 把武器（碎裂者 / 碎裂者 Prime / 塞多 / 塞多 Prime / 祸根 / 祸根 Prime /
 * 圣英 / 圣英 Prime / 祸根 / 科林斯…）的 `impact` 完全相同：
 *
 * ```
 * { DT_CORROSIVE: 3, procChance: 0.3 }
 * ```
 *
 * 判据：
 *   1. 只有**一个** `DT_*` 键；
 *   2. 数值 ≤ 3（实测这类占位恒为 3，与等值物理占位的 1.99/2.67/3.33 同量级）；
 *   3. `procChance` 为 0.3。
 *
 * 佐证：
 *   · 祸根同一把武器有两个 behaviour，另一个的 impact 正是**已识别的等值物理占位**
 *     `3.33/3.33/3.33 + procChance 0.1`，说明两者是同类占位、只是写法不同；
 *   · 这 10 把里有 8 把在 WFCD 里**完全没有腐蚀伤害**；
 *     另 2 把（祸根 / 祸根 Prime）确实有腐蚀，但那来自**投掷武器掷出的矛**
 *     （WFCD 单列为 `Spear Throw`），不是这个 impact 字段。
 */
export function isTinySingleTypePlaceholder(impact: ExportAttack | undefined): boolean {
  if (!impact) return false;
  const types = Object.keys(impact).filter((k) => k.startsWith('DT_'));
  if (types.length !== 1) return false;
  const value = impact[types[0]!];
  if (typeof value !== 'number' || value > 3) return false;
  const proc = impact['procChance'];
  return proc == null || Math.abs(proc - 0.3) < 1e-6;
}

/** `impact` 是否是任何一种已知占位（段级过滤的统一入口） */
export function isImpactPlaceholder(impact: ExportAttack | undefined): boolean {
  return isUniformPhysicalPlaceholder(impact) || isTinySingleTypePlaceholder(impact);
}

/**
 * `impact` 段是否**完全不计入官方面板**（D-095）。
 *
 * 判据（三条同时满足）：
 *   1. `damagePerShot` 里，`impact` 段的物理三元素**全部为 0**；
 *   2. impact 段含**至少两种**物理三元素（排除炸药类那种单类型 `DT_IMPACT:10` 命中冲击）；
 *   3. 该 behaviour **没有 explosiveAttack**（排除"面板把命中算进爆炸"的武器）。
 *
 * 依据（实测 654 把武器）：`damagePerShot` 的总和**恒等于** `totalDamage`（0 例偏差），
 * 所以它是官方面板的权威数组。
 *
 * 典型：血肢 Hema
 * ```
 * damagePerShot = [0,0,0, 0,...,47,...]   totalDamage = 47
 * impact 段     = { DT_IMPACT:7.5, DT_PUNCTURE:7.5, DT_SLASH:15, procChance:0.1 }  ← 30 点，不在面板里
 * projectile.attack = { DT_VIRAL:47 }
 * ```
 * WFCD 同样把血肢的 impact/puncture/slash 全记为 0。三方一致 → 这 30 点是残留数据。
 *
 * ⚠ 只对**当前 behaviour** 的 impact 生效，且只在 `damagePerShot` 存在时判断。
 *
 * @param impact 当前 behaviour 的 impact 段
 * @param damagePerShot 官方导出的面板伤害数组
 * @param typeIndex 伤害类型 → 数组索引的映射
 */
export function isImpactExcludedFromPanel(
  impact: ExportAttack | undefined,
  damagePerShot: readonly number[] | undefined,
  typeIndex: Readonly<Record<string, number>>,
  hasExplosive = false,
): boolean {
  if (!impact || !damagePerShot) return false;
  if (hasExplosive) return false; // 条件 3：有爆炸段的武器，面板可能把命中并入爆炸
  // 条件 2：必须是物理三元素的多类型段（炸药类那种单类型 DT_IMPACT:10 是真实命中，保留）
  const physical = ['DT_IMPACT', 'DT_PUNCTURE', 'DT_SLASH'].filter(
    (k) => typeof impact[k] === 'number' && impact[k] !== 0,
  );
  if (physical.length < 2) return false;
  // 条件 1：这些类型在面板里全为 0
  let anyMapped = false;
  for (const k of physical) {
    const idx = typeIndex[k];
    if (idx === undefined) continue;
    anyMapped = true;
    if ((damagePerShot[idx] ?? 0) !== 0) return false;
  }
  return anyMapped;
}

/**
 * 规则 3：浮点规范化，消除 18.999991 / 13.000001 之类的导出误差。
 * 保留 4 位小数，足以表达所有面板数值（如 0.0001 的触发率精度）。
 */
export function tidy(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** DT_* 键 → DamageSpread；未知类型记入 warnings */
/**
 * 官方导出 `damagePerShot` 数组的索引 → `DT_*` 键（D-095）。
 *
 * 由 842 把武器的「impact 单类型 + damagePerShot 单非零」样本反推，
 * 与 WFCD `damage` 对象的字段顺序完全一致（13/13 类型吻合）。
 */
export const DAMAGE_PER_SHOT_INDEX: Readonly<Record<string, number>> = {
  DT_IMPACT: 0, DT_PUNCTURE: 1, DT_SLASH: 2,
  DT_FIRE: 3, DT_FREEZE: 4, DT_ELECTRICITY: 5, DT_POISON: 6,
  DT_BLAST: 7, DT_RADIATION: 8, DT_GAS: 9, DT_MAGNETIC: 10,
  DT_VIRAL: 11, DT_CORROSIVE: 12, DT_VOID: 13, DT_SENTIENT: 14,
};

export function toSpread(attack: ExportAttack, warnings: string[], context: string): DamageSpread {
  const spread: DamageSpread = {};
  for (const key of Object.keys(attack)) {
    if (!key.startsWith('DT_')) continue;
    const value = attack[key];
    if (typeof value !== 'number' || value === 0) continue;

    const type = DT_KEY_MAP[key];
    if (!type) {
      warnings.push(`${context}: 未知伤害类型 ${key}（已忽略）`);
      continue;
    }
    spread[type] = tidy((spread[type] ?? 0) + value);
  }
  return spread;
}

const hasDamage = (s: DamageSpread): boolean => Object.values(s).some((v) => (v ?? 0) > 0);

/** stateName 的语言键 → TriggerKind */
export function toTriggerKind(stateName: string | undefined): TriggerKind {
  if (!stateName) return 'unknown';
  const tail = stateName.split('/').pop() ?? '';
  if (/TriggerAuto/i.test(tail)) return 'auto';
  if (/TriggerSemiAuto/i.test(tail)) return 'semi';
  if (/TriggerBurst/i.test(tail)) return 'burst';
  if (/Charged|Charge/i.test(tail)) return 'charge';
  // ⚠ 官方导出的拼写是 `Continous`（少一个 u），正则必须同时接受两种写法，
  //   否则托里德的毒云会被判成 unknown 而不是 held（D-092 修正）
  if (/Held|Continuous|Continous|Beam/i.test(tail)) return 'held';
  if (/TriggerActivated|Activated/i.test(tail)) return 'active';
  return 'unknown';
}

/**
 * 判断一个「只有 impact 段」的 behaviour 是否是**同一次开火的附带伤害**（D-092 修正）。
 *
 * 只有 impact 是**纯物理三元素**（impact / puncture / slash 之外没有别的伤害类型）时才算。
 * 反例：
 *   · Burston Prime 的 `Loadout_TriggerAuto` 只有 `DT_FIRE: 13` —— 这是独立的第二种射击模式；
 *   · 托里德的毒云只有 `DT_TOXIN: 51` —— 这个确实是附带伤害，
 *     但它有 stateName `Loadout_TriggerContinous`（持续/射线类触发），单独处理。
 */
/**
 * 判断一个「没有 projectile」的 behaviour 是否是**同一次开火的附带伤害**（D-092 修正）。
 *
 * 判据：`stateName` 属于**持续/射线类**触发（`Loadout_TriggerContinous` 等）。
 *
 * 实测对照：
 * ```
 * 托里德    Loadout_TriggerContinous  { DT_POISON: 51 }   ← 毒云，附带伤害 → 合并
 * Burston  Loadout_TriggerAuto       { DT_FIRE: 13 }     ← 全自动模式，独立射击 → 保留
 * BurstRifle Loadout_TriggerAuto     { DT_FIRE: 3 }      ← 独立模式 → 保留
 * ```
 * ⚠ 用「伤害类型是否物理」来判断会漏掉 Burston 这类纯元素射击；
 *   用「有没有 stateName」也不够（两者都有）。只有 trigger === "held"
 *   （Held / Continuous / Beam）才是附带伤害。
 */
export function isIncidentalImpact(stateName: string | undefined): boolean {
  return toTriggerKind(stateName) === 'held';
}

/** 从 behaviour 提取全部伤害段；slot 指定读取哪一组投射数据 */
export function toSegments(
  b: ExportBehaviour,
  warnings: string[],
  context: string,
  slot: ProjectileSlot = 'projectile',
  /** 官方 `damagePerShot`：用于剔除"不计入面板"的 impact 段（D-095，血肢） */
  damagePerShot?: readonly number[],
  /** 是否启用 damagePerShot 过滤（近战/空战近战关掉：它们本来就只有 impact 段，实测会整把清空） */
  usePanelFilter = true,
  /**
   * D-142：impact 是否就是这个 behavior 的**真实伤害**（主模式且逐类型与面板一致）。
   *
   * 为 true 时整段保留，不再过占位 / 面板过滤；为 false 时照旧按模板过滤。
   * 由调用方用 `impactTypesMatchPanel` 算出。
   */
  impactIsReal = false,
): DamageSegment[] {
  const segments: DamageSegment[] = [];

  const push = (kind: SegmentKind, attack: ExportAttack | undefined, aoe: boolean, isOnlySource = false): void => {
    if (!attack) return;
    // 段级别也要过滤占位（占位段可能和真实投射共存在同一 behaviour 内）：
    //   · 等值物理三元素（1.99/2.67/3.33…）
    //   · 单类型小额（腐蚀 3，D-079）
    // D-142：`isOnlySource`（= 主模式且与面板逐类型一致）时不过滤——那是真实伤害。
    if (kind === 'impact' && !isOnlySource && isImpactPlaceholder(attack)) return;
    // D-095：impact 段涉及的伤害类型在官方面板 damagePerShot 里全为 0 → 不进面板
    if (kind === 'impact' && usePanelFilter && !isOnlySource && isImpactExcludedFromPanel(attack, damagePerShot, DAMAGE_PER_SHOT_INDEX, Boolean(b.projectile?.explosiveAttack))) return;
    const damage = toSpread(attack, warnings, `${context}/${kind}`);
    if (!hasDamage(damage)) return;
    segments.push({
      kind,
      damage,
      procChance: tidy(attack.procChance ?? 0),
      aoe,
    });
  };

  // 命中段（impact）与投射组无关，只在读取第一组时加入，避免重复。
  //
  // D-142：`impactIsReal` 由调用方判定（**主模式** + 与 `damagePerShot` 逐类型一致），
  // 为 true 时整段保留；否则照旧走模板 / 面板过滤（横痃重炮主模式的 16/14/10 残留、
  // 弓的 `3.33×3 @0.1` 命中模板都会在这里被滤掉）。
  const proj = slot === 'projectile' ? b.projectile : b.chargedProjectile;
  if (slot === 'projectile') push('impact', b.impact, false, impactIsReal);

  if (proj) {
    push('attack', proj.attack, false);
    push('explosiveAttack', proj.explosiveAttack, true);
    // ⚠ `embedDeathAttack` **不收录**（D-078）：需求方确认它是「官方用于计算碎尸比例的字段」，
    //   总额恒为 100（切割占比越高碎尸概率越高），纯视觉表现，**与伤害计算无关**。
    //   之前把它当成独立的一段 push 进来，导致相关的 61 个 behaviour 伤害被系统性高估
    //   （Astilla Prime 高 80%：343 vs 实际 243）。
    //   证据：61 条样本中「不含 embedDeath」更接近 WFCD 总面板的有 57 条。
    //   实测 61 个带该字段的 behaviour **都另有 attack 或 explosiveAttack**，
    //   所以剔除后不会有武器因此失去整段。
  }
  return segments;
}

/**
 * 把一组伤害段按「直接命中 / 爆炸」分组成**面板变体**（D-080）。
 *
 * 需求方口径：命中与爆炸**不应该挤在同一个面板里**，也不能共享一套面板——
 * 它们的触发率与暴击往往不同，而且实战中通常只聚焦其中一个。
 * 所以拆成模式内的子项，各自独立面板、独立配装：
 *
 * ```
 * segs = [attack, explosiveAttack]  →  [ {direct:[attack]}, {blast:[explosiveAttack]} ]
 * segs = [attack]                   →  [ {direct:[attack]} ]      ← 单段，界面不显示切换
 * ```
 *
 * 分类规则：`explosiveAttack` → **爆炸**；其余（`attack` / `impact`）→ **直接命中**。
 */
export function toVariants(segments: DamageSegment[] | undefined): ModeVariant[] {
  const direct: DamageSegment[] = [];
  const blast: DamageSegment[] = [];
  for (const s of segments ?? []) {
    if (s.kind === 'explosiveAttack') blast.push(s);
    else direct.push(s);
  }
  const variants: ModeVariant[] = [];
  if (direct.length > 0) variants.push({ id: 'direct', label: '直接命中', segments: direct });
  if (blast.length > 0) variants.push({ id: 'blast', label: '爆炸', segments: blast });
  return variants;
}

/**
 * 归一化比较两组投射数据是否完全相同
 */
export function sameProjectile(a: ExportProjectile | undefined, b: ExportProjectile | undefined): boolean {
  const sig = (p: ExportProjectile | undefined): string => {
    if (!p) return 'none';
    const norm = (atk: ExportAttack | undefined): string => {
      if (!atk) return 'none';
      const entries = Object.entries(atk)
        .filter(([k]) => k.startsWith('DT_') || k === 'procChance')
        .map(([k, v]) => `${k}=${tidy(Number(v ?? 0))}`)
        .sort();
      return entries.join('&');
    };
    // D-078：`embedDeathAttack` 不再参与段签名（它不产生伤害，不该影响"是否同一攻击"的判定）
    return [norm(p.attack), norm(p.explosiveAttack)].join('|');
  };
  return sig(a) === sig(b);
}

/**
 * **官方导出里不存在、但被导出的冗余字段**：整段丢弃（D-121）。
 *
 * 目前只有一条：
 * ```
 * 巴兹火枪 GrnGorgSniperRifle   projectile.explosiveAttack = { DT_EXPLOSION: 40 }
 * ```
 * 需求方 2026-11-06：
 * > 「巴兹火枪的基础面板有问题，他没有爆炸也没有范围伤害……当然巴兹这个爆炸还是要删掉的。」
 *
 * 巴兹火枪是**标记类**武器（副模式给敌人打标记），游戏里没有爆炸、也没有 AoE。
 * 它这条 `explosiveAttack` 与实际行为不符（同一 behaviour 的 `impact` 段
 * 60/11.25/3.75 也没被 `damagePerShot` 计入面板，见 D-095 —— 官方导出本身就不干净）。
 * 这里按武器 id 精确剔除**那一段 `explosiveAttack`**，其它段原样保留并记录理由。
 */
export const DROP_EXPLOSIVE_ATTACK_WEAPONS: Readonly<Record<string, string>> = {
  GrnGorgSniperRifle: '巴兹火枪没有爆炸/范围伤害；官方导出里的 explosiveAttack 40 是冗余字段（需求方 2026-11-06 确认删除）',
};

/** 该段是否应被剔除（按武器 + 段类型） */
export function shouldDropSegment(weaponId: string, seg: DamageSegment): string | null {
  const reason = DROP_EXPLOSIVE_ATTACK_WEAPONS[weaponId];
  if (reason && seg.kind === 'explosiveAttack') return reason;
  return null;
}

/**
 * 占比 → 具体数值（D-110）。
 *
 * 需求方给的灵化面板是"总伤害 + 伤害组成占比"（如 140 伤害、57% 切割），
 * 这里换算成各类别的绝对值；**未列出的剩余部分按"其余为冲击、穿刺"平分**，
 * 所以调用方给占比时不必把冲击/穿刺也写出来。
 *
 * 换算后总量**严格等于** `total`（不会因为四舍五入漂移）。
 */
export function spreadFromRatio(
  total: number,
  ratio: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  let used = 0;
  let usedRatio = 0;
  for (const [type, r] of Object.entries(ratio)) {
    if (!(r > 0)) continue;
    const v = total * r;
    out[type] = v;
    used += v;
    usedRatio += r;
  }
  const rest = total - used;
  if (rest > 1e-9 && usedRatio < 1) {
    // 剩余部分：物理三元素里没被点名的，按"其余为冲击、穿刺"平分
    const remaining = ['impact', 'puncture', 'slash'].filter((x) => out[x] === undefined);
    const pool = remaining.length > 0 ? remaining : ['slash'];
    const each = rest / pool.length;
    for (const x of pool) out[x] = (out[x] ?? 0) + each;
  }
  return out;
}

/**
 * 灵化模式判定。
 *
 * 依据需求方说明 + 实测结构：帕里斯 Prime / 帕里斯 / 恐惧 这类武器，
 * 导出里有两个 TriggerCharge behaviour：
 *   behaviour[0]：projectile + chargedProjectile + impact   ← 普通射击
 *   behaviour[1]：仅 chargedProjectile + impact(占位)        ← 灵化模式射击
 *
 * 关键特征：
 *   - 没有 projectile（灵化只是充能形态，没有"未充能发射"）
 *   - 只有 chargedProjectile
 *   - 其 impact 要么不存在，要么是指示性占位段（会被段级过滤掉）
 *   - **该武器必须已经有别的 behaviour 提供普通射击**
 *     （否则"只能蓄满发射"的武器会被误判为灵化，如 AsymetricalBow / DerelictCernos）
 *
 * 不能用"多个 charge behaviour"判断——蓄力发射器也会有多个。
 *
 * @param hasSiblingNormal 该武器其它 behaviour 中是否已有可用的普通投射
 */
export function isIncarnonBehaviour(b: ExportBehaviour, hasSiblingNormal: boolean): boolean {
  if (!hasSiblingNormal) return false;
  if (!b.chargedProjectile) return false;
  if (b.projectile) return false;
  // impact 若无真实内容（不存在或仅为占位）则视为灵化
  if (!b.impact) return true;
  return isImpactPlaceholder(b.impact);
}

/** 分类到 Weapon.category */
/**
 * 分类映射。
 *
 * 导出的 productCategory 取值实测有：
 *   LongGuns / Pistols / Melee / SpecialItems（战甲技能武器）/
 *   SentinelWeapons（同伴）/ SpaceGuns / SpaceMelee（空战）
 *
 * 空战与同伴武器分别归到 archgun / archmelee / companion，
 * 而不是一律丢进 unknown——它们同样需要计算，只是 mod 规则不同。
 */
export function toCategory(w: ExportWeapon): Weapon['category'] {
  const cat = w.productCategory ?? '';
  const holster = w.holsterCategory ?? '';

  if (cat === 'LongGuns') return 'primary';
  if (cat === 'Pistols') return 'secondary';
  if (cat === 'Melee' || cat === 'SpecialItems') return 'melee';

  // 空战
  if (cat === 'SpaceGuns') return 'archgun';
  if (cat === 'SpaceMelee') return 'archmelee';
  if (/Archgun|ArchGun/i.test(holster)) return 'archgun';
  if (/Archmelee|ArchMelee/i.test(holster)) return 'archmelee';

  // 同伴武器（守护/宠物）
  if (cat === 'SentinelWeapons') {
    return /melee/i.test(holster) ? 'archmelee' : 'companion';
  }

  return 'unknown';
}

/** 武器内部 id：取导出键路径最后一段 */
export function toWeaponId(key: string): string {
  const parts = key.split('/');
  return parts[parts.length - 1] ?? key;
}

/** 主清洗入口 */
export function cleanWeapons(exportWeapons: ExportWeapons): CleanResult {
  const warnings: string[] = [];
  const weapons: CleanedWeapon[] = [];
  const stats: CleanStats = {
    totalWeapons: 0,
    keptWeapons: 0,
    droppedPlaceholderBehaviours: 0,
    keptBehaviours: 0,
    weaponsWithMultipleModes: 0,
    weaponsWithAoe: 0,
    weaponsWithUnknownDamageType: 0,
    excludedByCategory: 0,
    droppedNoValidMode: 0,
    droppedReported: 0,
    patchedWeapons: 0,
    manualWeapons: 0,
    removedWeapons: 0,
  };

  for (const [key, w] of Object.entries(exportWeapons)) {
    stats.totalWeapons++;

    // 分类过滤（需求方确认的排除列表）
    if (EXCLUDED_CATEGORIES.includes(w.productCategory ?? '')) {
      stats.excludedByCategory++;
      continue;
    }

    // 按武器整条移除（需求方判定：技能类，不能配卡，D-141）
    const removedWhy = REMOVED_WEAPONS[toWeaponId(key)];
    if (removedWhy) {
      stats.removedWeapons++;
      warnings.push(`${key}: 已移除 —— ${removedWhy}`);
      continue;
    }

    const category = toCategory(w);

    const behaviours = w.behaviours ?? [];
    // D-142：**主模式** = 第一个以 impact 为唯一伤害来源的 behavior（没有则第一个 behavior）。
    // 只有主模式才与 `damagePerShot` 比对——那个数组只描述一个模式。
    const primaryIndex = primaryBehaviourIndex(behaviours);
    const impactIsReal = (b: ExportBehaviour, index: number): boolean =>
      index === primaryIndex && impactTypesMatchPanel(b.impact, w.damagePerShot);

    const usable: Array<{ behaviour: ExportBehaviour; index: number }> = [];
    behaviours.forEach((b, index) => {
      if (
        isPlaceholder(b, {
          primary: index === primaryIndex,
          damagePerShot: w.damagePerShot,
          weaponProcChance: w.procChance,
        })
      ) {
        stats.droppedPlaceholderBehaviours++;
        return;
      }
      usable.push({ behaviour: b, index });
    });
    stats.keptBehaviours += usable.length;

    // 该武器是否已有能提供普通射击的 behaviour（用于灵化判定）
    const hasSiblingNormal = usable.some(({ behaviour }) => behaviour.projectile && Object.keys(behaviour.projectile).length > 0);

    const warningsBefore = warnings.length;
    const modes: AttackMode[] = [];

    /**
     * **只有命中段、没有投射组**的 behaviour 不算独立射击模式（D-092）。
     *
     * 例：Torid 的第 2 个 behaviour 是 `Loadout_TriggerContinous`，只有 `impact`
     * （毒云/持续伤害），没有 `projectile`。它不是"第二种射击方式"，而是同一次开火的
     * 附带伤害。需求方 2026-11-06：「托里德自身只有一个射击模式」。
     *
     * 判定：`!b.projectile && !b.chargedProjectile` → 不是射击模式。
     * 这类段并入**最后一个普通模式**的爆炸变体（若存在），否则丢弃并告警。
     */
    const impactOnly: DamageSegment[][] = [];
    const modeBehaviours: ExportBehaviour[] = [];
    // 「无投射组的 behaviour 算不算独立模式」（D-092）只对**枪械**成立。
    // 近战 / 空战近战这类本来就没有 projectile，它们的每个 behaviour 都是真模式，
    // 合并会把整把武器弄没（实测 Tenet Grigori 因此消失）。
    // D-142：守护 / 同伴武器（`SENTINEL_WEAPON`，多半也是近战飞掷物）同样没有投射组，
    // 一并按近战处理，否则它们的 behaviour 会被 D-092 吞掉。
    const isMelee = category === 'melee' || category === 'archmelee' || category === 'companion';
    const mergeImpactOnly = !isMelee;
    // D-142：整个事件/定时器触发的 `impact` 组（如重力奇点的 `TriggerActivated`）是**唯一的伤害来源**
    // ——没有投射组可以承接它。如果再按 D-092 并进「爆炸变体」，整把武器会再次变成空壳。
    const timeTriggeredOnly =
      usable.length === 1 &&
      !usable[0]!.behaviour.projectile &&
      !usable[0]!.behaviour.chargedProjectile &&
      isIncidentalImpact(usable[0]!.behaviour.stateName);
    for (const { behaviour: b, index: behaviourIndex } of usable) {
      // D-142：空战近战 / 守护 / 同伴类本来就没有投射，它们的 behaviour 永远是真模式，
      // 不能被 D-092 的「只有 impact → 并进爆炸变体」吞掉（否则分离 / 分离 Prime 整把消失）。
      if (isMelee) {
        modeBehaviours.push(b);
        continue;
      }
      // ⚠ 只有**没有 projectile 且 impact 是纯物理三元素**的 behaviour 才算"附带伤害"（D-092 修正）。
      //   反例：Burston Prime 的两个 behaviour 都没有 projectile，一个是物理 burst、
      //   一个是纯火 auto —— 后者是**独立的第二种射击模式**，不能被合并掉，
      //   否则全自动模式整段消失、trigger 变成 unknown（实测 78 把武器受影响）。
      if (!b.projectile && !b.chargedProjectile && mergeImpactOnly && !timeTriggeredOnly && isIncidentalImpact(b.stateName)) {
        const segs = toSegments(b, warnings, `${key}#impactOnly`, 'projectile', w.damagePerShot, !isMelee, impactIsReal(b, behaviourIndex));
        if (segs.length > 0) impactOnly.push(segs);
        else stats.droppedPlaceholderBehaviours++;
        continue;
      }
      modeBehaviours.push(b);
    }
    if (impactOnly.length > 0 && modeBehaviours.length === 0) {
      // 整个武器只有这种段（极端情况），按原样当作唯一模式，不丢数据
      for (const segs of impactOnly) {
        modes.push({
          // D-142：纯 impact 武器（空战近战 / 守护飞镖）没有 stateName，触发方式标 unknown
          id: `mode${modes.length + 1}`, role: 'normal',
          trigger: 'unknown', bullets: 1, multishot: tidy(w.multishot ?? 1),
          variants: toVariants(segs),
        });
      }
      impactOnly.length = 0;
    }

    // ── 灵化模式（D-100 / D-110）──
    // 灵化武器清单来自人工层 manual/incarnon.ts（官方导出没有灵化标记）。
    // 判定：武器命中清单 且 behaviour 数 = 普通模式数 + 1 → 最后一个 behaviour 是灵化形态。
    //
    // D-110：扎里曼号系列（Laetum / Phenmor / Felarx / Praedos / Innodem）在导出里
    // 两个 behaviour 都是普通投射，结构判据认不出来。这些人只要人工层
    // `INCARNON_STATS` 给了远程模式，就把最后一个 behaviour 当作灵化形态的**挂点**，
    // 真实面板一律取人工层数值（这只是一个待替换的槽位）。
    const englishName = key.split('/').pop() ?? '';
    const inc = incarnonInfoOf(englishName);
    const manualStats = incarnonStatsOf(englishName);
    let incarnonIndex = -1;
    if (inc && modeBehaviours.length >= 2) {
      incarnonIndex = modeBehaviours.length - 1;
      warnings.push(`${key}: 识别为灵化武器（${inc.source}），最后一个 behaviour 标为灵化模式`);
    } else if (manualStats && manualStats.modes.length > 0 && modeBehaviours.length >= 1) {
      incarnonIndex = modeBehaviours.length - 1;
      warnings.push(`${key}: 人工层有灵化形态数值，最后一个 behaviour 作为灵化挂点`);
    }
    modeBehaviours.forEach((b, index) => {
      // 原始 behaviour 下标（modeBehaviours 可能少几条，被吞并的仅-impact behaviour 不计入）
      const behaviourIndex = behaviours.indexOf(b);
      const context = `${key}#${index}`;
      const trigger = toTriggerKind(b.stateName);
      const burst = b.burst ? { count: b.burst.count, delay: tidy(b.burst.delay) } : undefined;

      // 灵化形态（D-100）：复用已有的 role='incarnon' 通道，
      // 这样它会像弓类灵化一样被单独识别、不参与半自动炮轰的装备判定。
      const isIncarnonSlot = index === incarnonIndex;
      const base = {
        trigger,
        bullets: b.fireIterations ?? 1,
        multishot: tidy(w.multishot ?? 1),
        ...(b.stateName ? { sourceKey: b.stateName } : {}),
        ...(burst ? { burst } : {}),
      } as const satisfies Partial<AttackMode>;

      // 灵化 behaviour：只有 chargedProjectile、无 projectile，且武器已有普通射击。
      // 其暴击/触发数值与武器面板不同，需要人工层补 override（此处留空并告警）。
      // 灵化形态（D-100）：数据可能在 chargedProjectile（弓类），也可能只在 impact（伯斯顿类）。
      // 两种都取，取到哪个算哪个。数值暂不收录。
      // D-108（需求方 2026-11-06 选 B1）：不再只靠人工清单，**按结构规则自动对应**。
      // 规则：只有 chargedProjectile、没有 projectile，且同武器已有别的 behaviour 提供普通射击。
      // 这样 WFCD 那 158 把带"灵化/蓄力"命名攻击的武器都能对上，不必逐把人工确认。
      if (isIncarnonSlot || isIncarnonBehaviour(b, hasSiblingNormal)) {
        // D-110：优先用人工层录入的灵化形态数值（INCARNON_STATS）。
        const stats = incarnonStatsOf(key.split('/').pop());
        if (stats && stats.modes.length > 0) {
          let incNo = 0;
          for (const im of stats.modes) {
            // id 去重：第一个叫 incarnon，之后 incarnon2 / incarnon3 …
            incNo += 1;
            const incId = incNo === 1 ? 'incarnon' : `incarnon${incNo}`;
            const seg: DamageSegment = {
              kind: 'incarnon' as SegmentKind,
              aoe: Boolean(im.aoe),
              damage: spreadFromRatio(im.damage, im.spread),
              procChance: im.statusChance,
            };
            modes.push({
              id: incId,
              role: 'incarnon',
              trigger: im.trigger as TriggerKind,
              bullets: 1,
              multishot: im.multishot,
              override: {
                critChance: im.critChance,
                critMultiplier: im.critMultiplier,
                statusChance: im.statusChance,
                fireRate: im.fireRate,
              },
              variants: toVariants([seg]),
              _manual: 'entered',
              ...(im.note ? { _note: im.note } : {}),
            });
          }
          warnings.push(`${key}#${index}: 灵化形态数值来自人工层（${stats._source}）`);
          return;
        }

        // 人工层还没填 → **复用基础面板**占位，并打上未核实标记（需求方 2026-11-06）。
        const segs =
          toSegments(b, warnings, context, 'chargedProjectile', w.damagePerShot, !isMelee, impactIsReal(b, behaviourIndex)).length > 0
            ? toSegments(b, warnings, context, 'chargedProjectile', w.damagePerShot, !isMelee, impactIsReal(b, behaviourIndex))
            : toSegments(b, warnings, context, 'projectile', w.damagePerShot, !isMelee, impactIsReal(b, behaviourIndex));
        if (segs.length > 0) {
          const meleeNote = stats?.meleeBuff
            ? `近战灵化（不参与计算）：${stats.meleeBuff.activation}，持续 ${stats.meleeBuff.durationSeconds} 秒，` +
              Object.entries(stats.meleeBuff.buffs).map(([k, v]) => `${k} ${v}`).join('，') +
              (stats.meleeBuff.extra ? `；${stats.meleeBuff.extra}` : '')
            : '';
          modes.push({
            id: 'incarnon',
            role: 'incarnon',
            ...base,
            variants: toVariants(segs),
            // 面板是复用的基础面板，不是灵化形态的真实值 → 界面必须打标记
            _manual: 'panel-reused',
            _note: meleeNote || '灵化形态面板未收录，暂复用基础面板',
          });
          warnings.push(`${key}#${index}: 灵化形态面板未收录，已复用基础面板并标记`);
        }
        return;
      }

      // 普通投射（含命中段）
      const normalSegs = toSegments(b, warnings, context, 'projectile', w.damagePerShot, !isMelee, impactIsReal(b, behaviourIndex));
      const chargedSegs = b.chargedProjectile
        ? toSegments(b, warnings, context, 'chargedProjectile', w.damagePerShot, !isMelee, impactIsReal(b, behaviourIndex))
        : [];
      const hasNormal = normalSegs.length > 0;
      const hasCharged = chargedSegs.length > 0;

      if (hasNormal) {
        modes.push({
          id: `mode${modes.length + 1}`, role: 'normal', ...base,
          variants: toVariants(normalSegs),
        });
      }

      // 蓄力投射与普通不同 → 单独成为一个模式
      if (b.chargedProjectile && !sameProjectile(b.projectile, b.chargedProjectile) && hasCharged) {
        modes.push({
          id: `mode${modes.length + 1}`, role: 'charged', ...base,
          variants: toVariants(chargedSegs),
        });
      } else if (!b.projectile && hasCharged) {
        // 只有 chargedProjectile、没有 projectile：这是"只能蓄满发射"（如食人女魔类），
        // 蓄力数据即该武器的唯一射击数据。
        modes.push({
          id: `mode${modes.length + 1}`, role: 'normal', ...base,
          variants: toVariants(chargedSegs),
        });
      }
    });

    // 模式 id 规范化：第一个普通模式叫 primary，其余按顺序编号
    //
    // D-110：灵化模式**可能不止一个**（奏凯的直击/范围、赘骨的连射/蓄力），
    // 所以这里不能一律改成 `incarnon`——那样两个模式会撞 id。
    // 规则：第一个叫 `incarnon`，之后 `incarnon2` / `incarnon3` …
    {
      let incNo = 0;
      modes.forEach((m, i) => {
        if (m.role === 'incarnon') {
          incNo += 1;
          m.id = incNo === 1 ? 'incarnon' : `incarnon${incNo}`;
        } else if (i === 0) m.id = 'primary';
        else if (m.role === 'charged') m.id = 'charged';
        else m.id = `mode${i + 1}`;
      });
    }

    // 只有命中段的 behaviour（毒云之类）并入第一个普通模式的**爆炸变体**（D-092）：
    // 它属于同一次开火，不是第二个射击模式。
    if (impactOnly.length > 0) {
      const host = modes.find((m) => m.role === 'normal') ?? modes[0];
      if (host) {
        const extra = impactOnly.flat();
        const blast = extra.filter((s) => s.kind !== 'explosiveAttack');
        // 这些段本质是范围/持续伤害，统一按爆炸变体呈现
        const asBlast: DamageSegment[] = blast.map((s) => ({ ...s, kind: 'explosiveAttack', aoe: true } as DamageSegment));
        const existing = host.variants.find((v) => v.id === 'blast');
        if (existing) existing.segments.push(...asBlast);
        else host.variants.push({ id: 'blast', label: '爆炸', segments: asBlast });
      }
    }

    // D-121：按武器剔除官方导出里的冗余段（目前只有巴兹火枪的 explosiveAttack 40）。
    // 必须在上面两步之后做——`impactOnly` 合并与变体分组都可能再生成 `explosiveAttack` 段。
    {
      const wid = toWeaponId(key);
      for (const m of modes) {
        for (const v of m.variants) {
          const kept: DamageSegment[] = [];
          for (const seg of v.segments) {
            const why = shouldDropSegment(wid, seg);
            if (why) { warnings.push(`${key}: 已剔除${seg.kind}段 —— ${why}`); continue; }
            kept.push(seg);
          }
          v.segments = kept;
        }
        // 变体里的段被清空后整个变体也一并去掉（标签页不留空壳）
        m.variants = m.variants.filter((v) => v.segments.length > 0);
      }
    }

    // 只统计真正的"未知伤害类型"告警，其它告警（如灵化需人工补数值）不计入
    const newWarnings = warnings.slice(warningsBefore);
    if (newWarnings.some((w) => w.includes('未知伤害类型'))) stats.weaponsWithUnknownDamageType++;

    // 没有可解析模式的武器直接跳过。
    // D-142：不再静默——只要导出里**有面板数值**（说明是一把真武器），就必须把原因写进 warning；
    // 只有「无 behaviours 且面板为 0」的组件/部件（宠物头腿、增幅器组件、滑板部件）才安静跳过。
    if (modes.length === 0) {
      // 人工订正表里有它的，后面会整组换上人工模式（或由人工层构造同名版本）——先留空壳，不算丢弃
      const replacedByPatch = Boolean(WEAPON_PATCHES[toWeaponId(key)]?.modes);
      const replacedByManual = MANUAL_VARIANTS.some((m) => m.exportId === toWeaponId(key));
      if (!replacedByPatch && !replacedByManual) stats.droppedNoValidMode++;
      if (replacedByPatch) {
        weapons.push({
          id: toWeaponId(key),
          name: w.name ?? toWeaponId(key),
          category,
          critChance: tidy(w.criticalChance ?? 0),
          critMultiplier: tidy(w.criticalMultiplier ?? 1),
          statusChance: tidy(w.procChance ?? 0),
          fireRate: tidy(w.fireRate ?? 0),
          ...(w.magazineSize != null ? { magazineSize: tidy(w.magazineSize) } : {}),
          ...(w.reloadTime != null ? { reloadTime: tidy(w.reloadTime) } : {}),
          modes: [],
          ...(w.name ? { languageKey: w.name } : {}),
        });
        stats.keptWeapons++;
        continue;
      }
      if (replacedByManual) {
        // 由人工层构造了替代版本（如暗黑分合剑的巨刃 / 双剑），原条目不再入库
        warnings.push(`${key}: 原条目丢掉，改由人工层构造版本（见 manual/weapon-patches.ts）`);
        continue;
      }
      const hasPanel = (w.totalDamage ?? 0) > 0;
      if (hasPanel || behaviours.length > 0) {
        stats.droppedReported++;
        const desc = behaviours.length === 0 ? '导出 behaviours 为空' : '导出的 behaviour 均无可用伤害段';
        warnings.push(`${key}: 清洗后没有任何有效攻击模式，已跳过（${desc}，面板伤害 ${w.totalDamage ?? 0}）`);
      }
      continue;
    }

    if (modes.length > 1) stats.weaponsWithMultipleModes++;
    if (modes.some((m) => hasAoeSegment(m))) stats.weaponsWithAoe++;

    weapons.push({
      id: toWeaponId(key),
      // 此处先放内部名占位，稍后由 localize 阶段用语言包解析为显示名
      name: w.name ?? toWeaponId(key),
      category,
      critChance: tidy(w.criticalChance ?? 0),
      critMultiplier: tidy(w.criticalMultiplier ?? 1),
      statusChance: tidy(w.procChance ?? 0),
      fireRate: tidy(w.fireRate ?? 0),
      ...(w.magazineSize != null ? { magazineSize: tidy(w.magazineSize) } : {}),
      ...(w.reloadTime != null ? { reloadTime: tidy(w.reloadTime) } : {}),
      modes,
      // 语言包键保留到 localize 阶段（`Weapon` 本身没有这个字段，见 CleanedWeapon）
      ...(w.name ? { languageKey: w.name } : {}),
    });
    stats.keptWeapons++;
  }

  // ── 人工订正层（D-141）：导出本身有错 / 只有空壳的武器，按游戏内白板面板改写 ──
  // 拆版本条目（`@` 形式）不在这里处理——它们在下面由原条目 copy 出来，名称与标记在那时一并写入。
  applyWeaponPatches(weapons, warnings, stats);

  // ── 拆版本（D-141）：由原条目 copy 出人工版本，例如暗黑分合剑 → 巨刃 / 双剑 ──
  for (const v of MANUAL_VARIANTS) {
    const originKey = Object.keys(exportWeapons).find((k) => toWeaponId(k) === v.exportId);
    const origin = originKey ? exportWeapons[originKey] : undefined;
    const patch = WEAPON_PATCHES[v.id];
    if (!origin || !patch) {
      warnings.push(`${v.id}: 缺少原条目或订正定义，已跳过拆版本`);
      continue;
    }
    if (weapons.some((w) => w.id === v.id)) {
      warnings.push(`${v.id}: 与已有武器重名，已跳过`);
      continue;
    }
    // 面板项（暴击 / 射速 / 弹匣 / 换弹）继承原条目——需求方说「其他的照旧」；
    // 伤害段由订正表的 `modes` 决定（空数组 = 面板待补）。
    weapons.push({
      id: v.id,
      name: patch.nameEn ?? v.id,
      ...(patch.nameZh ? { nameZh: patch.nameZh } : {}),
      category: toCategory(origin),
      critChance: tidy(origin.criticalChance ?? 0),
      critMultiplier: tidy(origin.criticalMultiplier ?? 1),
      statusChance: tidy(origin.procChance ?? 0),
      fireRate: tidy(origin.fireRate ?? 0),
      ...(origin.magazineSize != null ? { magazineSize: tidy(origin.magazineSize) } : {}),
      ...(origin.reloadTime != null ? { reloadTime: tidy(origin.reloadTime) } : {}),
      modes: patch.modes ? patch.modes.map(toManualMode) : [],
      variant: 'variant',
      // 溯源：产出里会带上 `_manual` / `_note`，界面据此打错误标记（D-101 / D-141）
      _manual: patch._source,
      _note: patch.note,
    });
    stats.manualWeapons++;
    warnings.push(`${v.id}: ${patch.note}`);
  }

  weapons.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { weapons, stats, warnings };
}

/** 人工模式 → 产出用的 `AttackMode`（id / label 由 `label` 字段带出，见 emit） */
function toManualMode(m: ManualMode): AttackMode {
  const segments: DamageSegment[] = m.segments.map((s) => ({
    kind: s.kind,
    damage: s.damage,
    procChance: s.procChance,
    aoe: s.aoe,
  }));
  return {
    id: m.id,
    role: 'normal',
    trigger: (m.trigger as TriggerKind | undefined) ?? 'unknown',
    bullets: 1,
    multishot: m.multishot ?? 1,
    variants: toVariants(segments),
    ...(m.label ? { _label: m.label } : {}),
  };
}

/** 拆版本补丁的 key 集合（`exportId_后缀`），用于区分两次订正调用 */
const VARIANT_PATCH_IDS = new Set(
  WEAPON_SPLITS.flatMap((s) => s.versions.map((v) => v.id)),
);

/**
 * 应用 `manual/weapon-patches.ts` 的武器级订正（D-141）。
 *
 * 只改**面板数值与整组模式**；显示名由 localize 阶段处理，这里只登记待覆盖的名称。
 */
function applyWeaponPatches(
  weapons: CleanedWeapon[],
  warnings: string[],
  stats: CleanStats,
): void {
  const byId = new Map(weapons.map((w) => [w.id, w]));
  for (const [id, patch] of Object.entries(WEAPON_PATCHES)) {
    // 拆版本条目的名称与标记在「拆版本」循环里写入，这里跳过
    if (VARIANT_PATCH_IDS.has(id)) continue;
    const w = byId.get(id);
    if (!w) {
      warnings.push(`人工订正 ${id}: 库里没有这把武器，已跳过（检查 id 是否与导出末段一致）`);
      continue;
    }
    if (patch.critChance != null) w.critChance = tidy(patch.critChance);
    if (patch.critMultiplier != null) w.critMultiplier = tidy(patch.critMultiplier);
    if (patch.statusChance != null) w.statusChance = tidy(patch.statusChance);
    if (patch.fireRate != null) w.fireRate = tidy(patch.fireRate);
    if (patch.magazineSize != null) w.magazineSize = tidy(patch.magazineSize);
    if (patch.reloadTime != null) w.reloadTime = tidy(patch.reloadTime);
    if (patch.modes) w.modes = patch.modes.map(toManualMode);
    if (patch.nameZh) w.nameZh = patch.nameZh;
    if (patch.nameEn) w.name = patch.nameEn;
    // 名称覆盖后不再需要语言包（localize 会跳过 languageKey 缺失的条目）
    if (patch.nameZh || patch.nameEn) delete w.languageKey;

    w._manual = patch._source;
    w._note = patch.note;
    stats.patchedWeapons++;
    warnings.push(`${id}: 已应用人工订正（${patch._source}）—— ${patch.note}`);
  }
}
