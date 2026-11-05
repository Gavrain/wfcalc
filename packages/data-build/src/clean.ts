/**
 * 清洗：官方导出 → 统一的武器面板结构。
 *
 * 规则来自 research/01-数据源可行性验证.md 第 6 节，每条规则都独立成函数，
 * 便于单测，也便于出错时定位是哪条规则导致数量异常。
 */
import { DT_KEY_MAP } from '../../core/src/damage-types.ts';
import type { DamageSpread } from '../../core/src/damage-types.ts';
import type { AttackMode, DamageSegment, ModeRole, ProjectileSlot, SegmentKind, TriggerKind, WeaponPanel } from '../../core/src/weapon.ts';
import type { ExportAttack, ExportBehaviour, ExportProjectile, ExportWeapon, ExportWeapons } from './types.ts';

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
  weapons: WeaponPanel[];
  stats: CleanStats;
  warnings: string[];
}

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
 * 规则 3：浮点规范化，消除 18.999991 / 13.000001 之类的导出误差。
 * 保留 4 位小数，足以表达所有面板数值（如 0.0001 的触发率精度）。
 */
export function tidy(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** DT_* 键 → DamageSpread；未知类型记入 warnings */
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
  if (/Held|Continuous|Beam/i.test(tail)) return 'held';
  if (/TriggerActivated|Activated/i.test(tail)) return 'active';
  return 'unknown';
}

/** 从 behaviour 提取全部伤害段；slot 指定读取哪一组投射数据 */
export function toSegments(
  b: ExportBehaviour,
  warnings: string[],
  context: string,
  slot: ProjectileSlot = 'projectile',
): DamageSegment[] {
  const segments: DamageSegment[] = [];

  const push = (kind: SegmentKind, attack: ExportAttack | undefined, isAoe: boolean): void => {
    if (!attack) return;
    // 段级别也要过滤等值物理占位（占位段可能和真实投射共存在同一 behaviour 内）
    if (kind === 'impact' && isUniformPhysicalPlaceholder(attack)) return;
    const damage = toSpread(attack, warnings, `${context}/${kind}`);
    if (!hasDamage(damage)) return;
    segments.push({
      kind,
      damage,
      procChance: tidy(attack.procChance ?? 0),
      isAoe,
    });
  };

  // 命中段（impact）与投射组无关，只在读取第一组时加入，避免重复
  if (slot === 'projectile') push('impact', b.impact, false);

  const proj = slot === 'projectile' ? b.projectile : b.chargedProjectile;
  if (proj) {
    push('attack', proj.attack, false);
    push('explosiveAttack', proj.explosiveAttack, true);
    push('embedDeathAttack', proj.embedDeathAttack, true);
  }
  return segments;
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
    return [norm(p.attack), norm(p.explosiveAttack), norm(p.embedDeathAttack)].join('|');
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
  return isUniformPhysicalPlaceholder(b.impact);
}

/** 分类到 WeaponPanel.category */
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
export function toCategory(w: ExportWeapon): WeaponPanel['category'] {
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
  const weapons: WeaponPanel[] = [];
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

    usable.forEach((b, index) => {
      const context = `${key}#${index}`;
      const trigger = toTriggerKind(b.stateName);
      const burst = b.burst ? { count: b.burst.count, delay: tidy(b.burst.delay) } : undefined;

      const base = {
        trigger,
        bullets: b.fireIterations ?? 1,
        baseMultishot: w.multishot ?? 1,
        ...(b.stateName ? { sourceKey: b.stateName } : {}),
        ...(burst ? { burst } : {}),
      };

      // 灵化 behaviour：只有 chargedProjectile、无 projectile，且武器已有普通射击。
      // 其暴击/触发数值与武器面板不同，需要人工层补 override（此处留空并告警）。
      if (isIncarnonBehaviour(b, hasSiblingNormal)) {
        const segs = toSegments(b, warnings, context, 'chargedProjectile');
        if (segs.length > 0) {
          modes.push({ id: 'incarnon', role: 'incarnon', ...base, segments: segs });
          warnings.push(`${key}#${index}: 识别为灵化模式，暴击/触发需人工层补充（见 data-todo）`);
        }
        return;
      }

      // 普通投射（含命中段）
      const normalSegs = toSegments(b, warnings, context, 'projectile');
      const chargedSegs = b.chargedProjectile
        ? toSegments(b, warnings, context, 'chargedProjectile')
        : [];
      const hasNormal = normalSegs.length > 0;
      const hasCharged = chargedSegs.length > 0;

      if (hasNormal) {
        modes.push({ id: `mode${modes.length + 1}`, role: 'normal', ...base, segments: normalSegs });
      }

      // 蓄力投射与普通不同 → 单独成为一个模式
      if (b.chargedProjectile && !sameProjectile(b.projectile, b.chargedProjectile) && hasCharged) {
        modes.push({ id: `mode${modes.length + 1}`, role: 'charged', ...base, segments: chargedSegs });
      } else if (!b.projectile && hasCharged) {
        // 只有 chargedProjectile、没有 projectile：这是"只能蓄满发射"（如食人女魔类），
        // 蓄力数据即该武器的唯一射击数据。
        modes.push({ id: `mode${modes.length + 1}`, role: 'normal', ...base, segments: chargedSegs });
      }
    });

    // 模式 id 规范化：第一个普通模式叫 primary，其余按顺序编号
    modes.forEach((m, i) => {
      if (m.role === 'incarnon') m.id = 'incarnon';
      else if (i === 0) m.id = 'primary';
      else if (m.role === 'charged') m.id = 'charged';
      else m.id = `mode${i + 1}`;
    });

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
    if (modes.some((m) => m.segments.some((s) => s.isAoe))) stats.weaponsWithAoe++;

    const melee =
      category === 'melee' && w.slamAttack != null
        ? {
            range: tidy(w.range ?? 0),
            followThrough: tidy(w.followThrough ?? 0),
            comboDuration: tidy(w.comboDuration ?? 0),
            slamAttack: tidy(w.slamAttack),
            slamRadialDamage: tidy(w.slamRadialDamage ?? 0),
            slamRadius: tidy(w.slamRadius ?? 0),
            slideAttack: tidy(w.slideAttack ?? 0),
            heavyAttackDamage: tidy(w.heavyAttackDamage ?? 0),
            heavySlamAttack: tidy(w.heavySlamAttack ?? 0),
            heavySlamRadialDamage: tidy(w.heavySlamRadialDamage ?? 0),
            heavySlamRadius: tidy(w.heavySlamRadius ?? 0),
          }
        : undefined;

    weapons.push({
      id: toWeaponId(key),
      name: { en: w.name ?? toWeaponId(key) },
      category,
      critChance: tidy(w.criticalChance ?? 0),
      critMultiplier: tidy(w.criticalMultiplier ?? 1),
      statusChance: tidy(w.procChance ?? 0),
      fireRate: tidy(w.fireRate ?? 0),
      ...(w.magazineSize != null ? { magazineSize: tidy(w.magazineSize) } : {}),
      ...(w.reloadTime != null ? { reloadTime: tidy(w.reloadTime) } : {}),
      modes,
      ...(melee ? { melee } : {}),
    });
    stats.keptWeapons++;
  }

  weapons.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { weapons, stats, warnings };
}
