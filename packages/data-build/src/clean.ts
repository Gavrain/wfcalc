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
export function isPlaceholder(b: ExportBehaviour): boolean {
  if (b.projectile || b.chargedProjectile) return false;
  if (b.burst && !b.stateName) return false;
  if (!b.impact) return true;

  const types = Object.keys(b.impact).filter((k) => k.startsWith('DT_') && b.impact![k] !== undefined);
  return types.length === 1 && types[0] === 'DT_IMPACT';
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
  const imp = impact['DT_IMPACT'];
  const pun = impact['DT_PUNCTURE'];
  const sla = impact['DT_SLASH'];
  if (imp == null || pun == null || sla == null) return false;

  // 只允许这三个键（外加 procChance）
  const otherKeys = Object.keys(impact).filter(
    (k) => k !== 'DT_IMPACT' && k !== 'DT_PUNCTURE' && k !== 'DT_SLASH' && k !== 'procChance',
  );
  if (otherKeys.length > 0) return false;

  const proc = impact['procChance'];
  const uniform = Math.abs(imp - pun) < 1e-3 && Math.abs(pun - sla) < 1e-3;
  const tiny = imp <= 40;
  return uniform && tiny && (proc == null || Math.abs(proc - 0.1) < 1e-6);
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
): DamageSegment[] {
  const segments: DamageSegment[] = [];

  const push = (kind: SegmentKind, attack: ExportAttack | undefined, aoe: boolean): void => {
    if (!attack) return;
    // 段级别也要过滤占位（占位段可能和真实投射共存在同一 behaviour 内）：
    //   · 等值物理三元素（1.99/2.67/3.33…）
    //   · 单类型小额（腐蚀 3，D-079）
    if (kind === 'impact' && isImpactPlaceholder(attack)) return;
    // D-095：impact 段涉及的伤害类型在官方面板 damagePerShot 里全为 0 → 不进面板
    if (kind === 'impact' && usePanelFilter && isImpactExcludedFromPanel(attack, damagePerShot, DAMAGE_PER_SHOT_INDEX, Boolean(b.projectile?.explosiveAttack))) return;
    const damage = toSpread(attack, warnings, `${context}/${kind}`);
    if (!hasDamage(damage)) return;
    segments.push({
      kind,
      damage,
      procChance: tidy(attack.procChance ?? 0),
      aoe,
    });
  };

  // 命中段（impact）与投射组无关，只在读取第一组时加入，避免重复
  if (slot === 'projectile') push('impact', b.impact, false);

  const proj = slot === 'projectile' ? b.projectile : b.chargedProjectile;
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

/** 归一化比较两组投射数据是否完全相同 */
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
  };

  for (const [key, w] of Object.entries(exportWeapons)) {
    stats.totalWeapons++;

    // 分类过滤（需求方确认的排除列表）
    if (EXCLUDED_CATEGORIES.includes(w.productCategory ?? '')) {
      stats.excludedByCategory++;
      continue;
    }

    const category = toCategory(w);

    const behaviours = w.behaviours ?? [];
    const usable: ExportBehaviour[] = [];
    for (const b of behaviours) {
      if (isPlaceholder(b)) {
        stats.droppedPlaceholderBehaviours++;
        continue;
      }
      usable.push(b);
    }
    stats.keptBehaviours += usable.length;

    // 该武器是否已有能提供普通射击的 behaviour（用于灵化判定）
    const hasSiblingNormal = usable.some(
      (b) => b.projectile && Object.keys(b.projectile).length > 0,
    );

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
    const isMelee = category === 'melee' || category === 'archmelee';
    const mergeImpactOnly = !isMelee;
    for (const b of usable) {
      // ⚠ 只有**没有 projectile 且 impact 是纯物理三元素**的 behaviour 才算"附带伤害"（D-092 修正）。
      //   反例：Burston Prime 的两个 behaviour 都没有 projectile，一个是物理 burst、
      //   一个是纯火 auto —— 后者是**独立的第二种射击模式**，不能被合并掉，
      //   否则全自动模式整段消失、trigger 变成 unknown（实测 78 把武器受影响）。
      if (!b.projectile && !b.chargedProjectile && mergeImpactOnly && isIncidentalImpact(b.stateName)) {
        const segs = toSegments(b, warnings, `${key}#impactOnly`, 'projectile', w.damagePerShot, !isMelee);
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
          id: `mode${modes.length + 1}`, role: 'normal',
          trigger: 'unknown', bullets: 1, multishot: tidy(w.multishot ?? 1),
          variants: toVariants(segs),
        });
      }
      impactOnly.length = 0;
    }

    // ── 灵化模式（D-100）──
    // 灵化武器清单来自人工层 manual/incarnon.ts（官方导出没有灵化标记）。
    // 判定：武器命中清单 且 behaviour 数 = 普通模式数 + 1 → 最后一个 behaviour 是灵化形态。
    // 数值暂不收录（需求方 2026-11-06：先不填数值，只做识别）。
    const englishName = key.split('/').pop() ?? '';
    const inc = incarnonInfoOf(englishName);
    let incarnonIndex = -1;
    if (inc && modeBehaviours.length >= 2) {
      incarnonIndex = modeBehaviours.length - 1;
      warnings.push(`${key}: 识别为灵化武器（${inc.source}），最后一个 behaviour 标为灵化模式`);
    }
    modeBehaviours.forEach((b, index) => {
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
      if (isIncarnonSlot || isIncarnonBehaviour(b, hasSiblingNormal)) {
        const segs =
          toSegments(b, warnings, context, 'chargedProjectile', w.damagePerShot, !isMelee).length > 0
            ? toSegments(b, warnings, context, 'chargedProjectile', w.damagePerShot, !isMelee)
            : toSegments(b, warnings, context, 'projectile', w.damagePerShot, !isMelee);
        if (segs.length > 0) {
          modes.push({ id: 'incarnon', role: 'incarnon', ...base, variants: toVariants(segs) });
          warnings.push(`${key}#${index}: 识别为灵化模式，面板数值待人工层补充`);
        }
        return;
      }

      // 普通投射（含命中段）
      const normalSegs = toSegments(b, warnings, context, 'projectile', w.damagePerShot, !isMelee);
      const chargedSegs = b.chargedProjectile
        ? toSegments(b, warnings, context, 'chargedProjectile', w.damagePerShot, !isMelee)
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
    modes.forEach((m, i) => {
      if (m.role === 'incarnon') m.id = 'incarnon';
      else if (i === 0) m.id = 'primary';
      else if (m.role === 'charged') m.id = 'charged';
      else m.id = `mode${i + 1}`;
    });

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

    // 只统计真正的"未知伤害类型"告警，其它告警（如灵化需人工补数值）不计入
    const newWarnings = warnings.slice(warningsBefore);
    if (newWarnings.some((w) => w.includes('未知伤害类型'))) stats.weaponsWithUnknownDamageType++;

    // 没有可解析模式的武器（例如纯数据残留条目）直接跳过，但记录
    if (modes.length === 0) {
      stats.droppedNoValidMode++;
      warnings.push(`${key}: 清洗后没有任何有效攻击模式，已跳过`);
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

  weapons.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { weapons, stats, warnings };
}
