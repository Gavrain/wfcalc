/**
 * WFCD 武器清洗路径（数据层切换实验，**尚未替换 clean.ts**）。
 *
 * 口径（需求方 2026-11-11 确认）：
 *   1. 一个射击模式 = 一个面板：主模式、灵化各一个；一个模式里的多段**相加**后结算。
 *   2. 射线**不再用 `beam` 标记**，由扳机决定：
 *        · 模式扳机 = `Held`            → 该模式是射线（持续射击）
 *        · 攻击名含 `Held`（灵化射线）  → 该攻击所在模式是射线
 *   3. 范围伤害由 `shot_type === 'AoE'` 判定，不再用 stateName 推断；AoE 段不吃镀层。
 *   4. 次要模式与主模式共用弹匣/装填；灵化模式没有弹匣/装填（充能弹药不建模）。
 *   5. `attacks[].status_chance` 是**单弹片**触发率（野猪 Prime 11.25% 与面板一致），
 *      段上原样保存，不做整发合并。
 *
 * 模式划分（按 WFCD 攻击名，而不是按武器名）：
 *   · 主攻击锚点：Normal Attack / Auto / Buckshot / Fully Spooled / Single Pellet /
 *     Semi-Auto Mode / Full Auto Mode / Primary / Primary-Fire / Beam / Held / First Attack…
 *     —— 名字是字面意思：Radial / Explosion / AoE / Detonation / Cloud 是**同一模式内的段**，
 *        Alt-Fire / Burst / Secondary Fire / Charged Shot / Quick Shot / Uncharged Shot 是**独立模式**。
 *   · 0 个独立模式锚点时，退化为「一个射击模式」：无爆发的攻击归主模式，带爆发的另起；
 *     Barrage / Quill / 导弹类攻击按「按名字切换」处理，各自成一个模式（不合并相加）。
 */
import type { AttackMode, DamageSegment, ModeRole, PanelOverride, TriggerKind, Weapon } from '../../core/src/weapon.ts';
import type { DamageSpread, DamageType } from '../../core/src/damage-types.ts';

// ─────────────────────────────────────────────────────────────
// WFCD 原始类型（只声明用到的字段）
// ─────────────────────────────────────────────────────────────

export interface WfcdAttack {
  name: string;
  speed?: number;
  crit_chance?: number;
  crit_mult?: number;
  status_chance?: number;
  shot_type?: 'Hit-Scan' | 'Projectile' | 'AoE' | string | undefined;
  shot_speed?: number;
  flight?: number;
  charge_time?: number;
  falloff?: { start: number; end: number; reduction: number };
  damage?: Record<string, number>;
}

export interface WfcdWeapon {
  name: string;
  uniqueName: string;
  productCategory?: string;
  slot?: string;
  trigger?: string;
  critChance?: number;
  criticalChance?: number;
  criticalMultiplier?: number;
  procChance?: number;
  fireRate?: number;
  magazineSize?: number;
  reloadTime?: number;
  multishot?: number;
  accuracy?: number;
  tags?: string[];
  isPrime?: boolean;
  attacks?: WfcdAttack[];
}

// ─────────────────────────────────────────────────────────────
// 伤害类型键
// ─────────────────────────────────────────────────────────────

/** WFCD 伤害键（小写英文）→ 内核 DamageType */
const DAMAGE_KEY: Readonly<Record<string, DamageType>> = {
  impact: 'impact',
  puncture: 'puncture',
  slash: 'slash',
  heat: 'heat',
  cold: 'cold',
  electricity: 'electric',
  toxin: 'toxin',
  blast: 'blast',
  radiation: 'radiation',
  gas: 'gas',
  magnetic: 'magnetic',
  viral: 'viral',
  corrosive: 'corrosive',
  void: 'void',
  tau: 'tau',
};

// ─────────────────────────────────────────────────────────────
// 扳机
// ─────────────────────────────────────────────────────────────

/** WFCD 扳机值 → 内核 TriggerKind；`Held` 是射线 */
export function toTrigger(raw: string | undefined | null): TriggerKind {
  const t = String(raw ?? '').trim().toLowerCase();
  if (!t) return 'unknown';
  if (t === 'held') return 'held';
  if (t === 'auto') return 'auto';
  if (t === 'semi') return 'semi';
  if (t === 'burst' || t === 'auto burst') return 'burst';
  if (t === 'charge' || t === 'duplex') return 'charge';
  if (t === 'active') return 'active';
  return 'unknown';
}

/** 该攻击是不是射线形态：攻击名带 `Held`（如 `Incarnon Form Held Damage`） */
export function isHeldAttack(name: string): boolean {
  return /\bHeld\b/i.test(name);
}

/* 该模式是否射线。
 *
 * 判据（需求方 2026-11-11，逐条确认过）：
 *   · 扳机 = `Held` → 射线（持续射击）；
 *   · 攻击名含 `Held` 且 `shot_type` 不是 `AoE` → 射线
 *     （`Incarnon Form Held Damage` = 灵化射线；`Incarnon Form Charge Radial Attack` 是范围伤害，不算）。
 *
 * 不按 `Incarnon` / `Radial` / `Alt-Fire` 的名字做任何附加推断——
 * 原子矿融炮 / 咖玛腕甲枪的灵化是 `Incarnon Form`(投射物) + `Incarnon Form Radial Attack`(AoE)，不是射线。
 * 绘墨：主模式（扳机 Held）是射线，`Alt-Fire`(投射物) 与 `Alt-Fire Radial Attack`(AoE) 不是。
 * 巴什穆：扳机 Auto，只有名为 `Held` 的那一条攻击是射线（次要射击）。
 */
export function isBeamMode(mode: AttackMode): boolean {
  if (mode.trigger === 'held') return true;
  // 攻击名含 Held 的段必须是"射线形态"而不是范围伤害（`x Held Damage` 算，`x Held Radial Attack` 不算）
  return (mode as AttackMode & { _beamAttacks?: boolean })._beamAttacks === true;
}

// ─────────────────────────────────────────────────────────────
// 模式划分
// ─────────────────────────────────────────────────────────────

/** 主攻击锚点：它们是「射击模式本身」，不带"另一个模式"的语义 */
const PRIMARY_ANCHORS: readonly RegExp[] = [
  /^Normal Attack$/i,
  /^Auto$/i,
  /^Auto Burst$/i,
  /^Auto-Burst$/i,
  /^Buckshot$/i,
  /^Fully Spooled$/i,
  /^Single Pellet$/i,
  /^Semi-Auto Mode$/i,
  /^Full Auto Mode$/i,
  /^Primary$/i,
  /^Primary-Fire$/i,
  /^Beam$/i,
  /^Held$/i,
  /^First Attack$|^Second Attack$|^Third Attack$/i,
  /^Normal Radial Attack$/i,
];

/** 独立模式的锚点：名字本身表示"另一种射击方式" */
const SEPARATE_MODE: readonly RegExp[] = [
  /^Incarnon Form/i, // 灵化形态：独立面板
  /Alt-Fire/i,
  /Secondary Fire/i,
  /^Burst$/i,
  /^Burst Shot$/i,
  /^Burst Mode$/i,
  /^Burst-Fire/i,
  /^Full-Auto$/i,
  /^Charged Shot$/i,
  /^Quick Shot$/i,
  /^Uncharged Shot$/i,
  /^Uncharged Horizontal\/Vertical Shot$/i,
  /^Charged Horizontal\/Vertical Shot$/i,
  /^Perfect Shot$/i,
  /^Single Rocket Impact$/i, // 蓄力火箭：主模式（其爆炸是同模式内的段）
  /^Barrage Mode$/i,
  /^Quill$/i,
  /^Poison Quill$|^Fire Quill$|^Electric Quill$|^Ice Quill$/i,
  /^Charge$/i,
  /^Horizontal Spread$/i,
  /^Spear Throw$/i, // 已有 "Spear Throw Impact" 时会被下面的同义合并处理
];

/** 同义/从属关系：带这些词的是「另一个模式的段」，不是新模式 */
const SUBPART: readonly RegExp[] = [
  /Radial Attack/i,
  /Explosion|Explode|Detonation/i,
  /AoE$/i,
  /Contact/i,
  /Impact$/i,
  /Cloud|Field/i, // 毒云 / 冰场
  /Damage over Time/i,
  /Merging/i, // 奇点枪融合伤害
  /Spear Throw/i,
  /^Orb /i,
];

const matchesAny = (name: string, list: readonly RegExp[]): boolean => list.some((re) => re.test(name));

/** 是否有明确的独立模式锚点（不算主攻击锚点） */
function hasSeparateModeAnchor(attacks: readonly WfcdAttack[]): boolean {
  return attacks.some((a) => matchesAny(a.name, SEPARATE_MODE) && !matchesAny(a.name, PRIMARY_ANCHORS));
}

/**
 * 攻击归组：返回 [[模式名, 攻击列表], …]
 *
 * 规则顺序：
 *   1. 有独立模式锚点 → 每个锚点各成一个模式，非锚点的子段并到"最近的前一个锚点"；
 *   2. 没有独立模式锚点 → 只有一个射击模式，所有攻击都是它的段（相加）；
 *   3. 退化情形（全无锚点，如火箭/奇点枪/多弹种）：见 `fallbackGroups`。
 */
function groupAttacks(attacks: readonly WfcdAttack[]): { name: string; attacks: WfcdAttack[] }[] {
  const groups: { name: string; attacks: WfcdAttack[] }[] = [];
  const anchors = attacks.filter((a) => matchesAny(a.name, SEPARATE_MODE) || matchesAny(a.name, PRIMARY_ANCHORS));

  if (anchors.length === 0) return fallbackGroups(attacks);

  let current: { name: string; attacks: WfcdAttack[] } | null = null;
  for (const a of attacks) {
    const isAnchor = matchesAny(a.name, SEPARATE_MODE) || matchesAny(a.name, PRIMARY_ANCHORS);
    if (isAnchor) {
      current = { name: a.name, attacks: [a] };
      groups.push(current);
    } else if (current) {
      current.attacks.push(a);
    } else {
      // 锚点之前的孤立子段（例如 "1st Attack" 之前没有）→ 挂到第一个组
      groups.push({ name: a.name, attacks: [a] });
      current = groups[groups.length - 1]!;
    }
  }
  return groups;
}

/**
 * 无明确锚点时的退化分组（火箭 / 奇点枪 / 多弹种 / 六连导弹）：
 *   · 全部攻击视为一个射击模式（相加），除非包含「按名字切换」的弹种（Quill / Barrage / 1st Attack…）；
 *   · 「按名字切换」的不合并，每个名字一个模式。
 */
function fallbackGroups(attacks: readonly WfcdAttack[]): { name: string; attacks: WfcdAttack[] }[] {
  const switchable = /^(\d+(st|nd|rd|th) Attack|Barrage Mode|.*Quill|Horizontal Spread|Charge)$/i;
  const singles = attacks.filter((a) => switchable.test(a.name));
  if (singles.length > 0) {
    // 按名字切换：每个名字一个模式，其余子段（爆炸等）跟随同名家族
    const out: { name: string; attacks: WfcdAttack[] }[] = [];
    let current: { name: string; attacks: WfcdAttack[] } | null = null;
    for (const a of attacks) {
      if (switchable.test(a.name) || current === null) {
        current = { name: a.name, attacks: [a] };
        out.push(current);
      } else {
        current.attacks.push(a);
      }
    }
    return out;
  }
  return [{ name: 'default', attacks: [...attacks] }];
}

// ─────────────────────────────────────────────────────────────
// 攻击 → 伤害段
// ─────────────────────────────────────────────────────────────

function toSpread(damage: Record<string, number> | undefined, warnings: string[], context: string): DamageSpread {
  const out: DamageSpread = {};
  for (const [k, v] of Object.entries(damage ?? {})) {
    const t = DAMAGE_KEY[k.toLowerCase()];
    if (!t) {
      warnings.push(`${context}: 未知伤害类型 ${k}（已忽略）`);
      continue;
    }
    if (typeof v === 'number' && v !== 0) out[t] = (out[t] ?? 0) + v;
  }
  return out;
}

/**
 * 一个 WFCD 攻击 → 一段。
 * `shot_type === 'AoE'` → 范围段（`aoe: true`，不吃镀层）。
 * 段上**保留该攻击自己的暴击/触发/射速**（WFCD 攻击级有独立数值）。
 */
export function toSegment(a: WfcdAttack, warnings: string[], context: string): DamageSegment | null {
  const damage = toSpread(a.damage, warnings, context);
  if (Object.keys(damage).length === 0) return null;
  const aoe = String(a.shot_type ?? '').toLowerCase() === 'aoe';
  return {
    kind: aoe ? 'explosiveAttack' : 'attack',
    aoe,
    damage,
    // WFCD 的 status_chance 是**百分比**（11.25 = 11.25%）；内核是 0~1
    procChance: typeof a.status_chance === 'number' ? a.status_chance / 100 : 0,
  };
}

/** 攻击级面板 → 模式级 override（暴击/触发/射速只有和武器级不同时才写） */
function attackOverride(a: WfcdAttack, weapon: WfcdWeapon): PanelOverride | undefined {
  const o: PanelOverride = {};
  if (typeof a.crit_chance === 'number' && a.crit_chance / 100 !== (weapon.criticalChance ?? 0)) o.critChance = a.crit_chance / 100;
  if (typeof a.crit_mult === 'number' && a.crit_mult !== weapon.criticalMultiplier) o.critMultiplier = a.crit_mult;
  if (typeof a.status_chance === 'number' && a.status_chance / 100 !== (weapon.procChance ?? 0)) o.statusChance = a.status_chance / 100;
  if (typeof a.speed === 'number' && a.speed !== weapon.fireRate) o.fireRate = a.speed;
  return Object.keys(o).length > 0 ? o : undefined;
}

// ─────────────────────────────────────────────────────────────
// 武器
// ─────────────────────────────────────────────────────────────

const CATEGORY: Readonly<Record<string, Weapon['category']>> = {
  LongGuns: 'primary',
  Pistols: 'secondary',
  Melee: 'melee',
  SpaceGuns: 'archgun',
  SpaceMelee: 'archmelee',
  SentinelWeapons: 'companion',
};

export function toCategory(w: WfcdWeapon): Weapon['category'] {
  return CATEGORY[w.productCategory ?? ''] ?? 'unknown';
}

/** 武器 id：取 uniqueName 最后一段（与官方导出键一致，便于跨源对照） */
export function toWeaponId(w: WfcdWeapon): string {
  const parts = (w.uniqueName ?? '').split('/');
  return parts[parts.length - 1] ?? w.name;
}

const round4 = (v: number): number => Math.round(v * 10000) / 10000;

export interface CleanedWfcdWeapon extends Weapon {
  /** 该模式是否射线（扳机 Held 或含 Held 攻击），供界面标注与计算使用 */
  beamModeIds: string[];
  /** 供对照：原始武器名 */
  wfcdName: string;
}

export interface WfcdCleanResult {
  weapons: CleanedWfcdWeapon[];
  stats: {
    total: number;
    kept: number;
    droppedNoAttack: number;
    multiMode: number;
    beamModes: number;
    unknownTrigger: number;
  };
  warnings: string[];
}

/**
 * WFCD 武器清洗主入口。
 *
 * ⚠ 不会写任何文件；产出由调用方（临时对照脚本）决定。
 */
export function cleanWfcdWeapons(raw: readonly WfcdWeapon[]): WfcdCleanResult {
  const warnings: string[] = [];
  const weapons: CleanedWfcdWeapon[] = [];
  const stats = { total: 0, kept: 0, droppedNoAttack: 0, multiMode: 0, beamModes: 0, unknownTrigger: 0 };

  for (const w of raw) {
    stats.total++;
    const attacks = w.attacks ?? [];
    if (attacks.length === 0) {
      stats.droppedNoAttack++;
      continue;
    }
    const trigger = toTrigger(w.trigger);
    if (trigger === 'unknown') stats.unknownTrigger++;

    const grouped = groupAttacks(attacks);
    const modes: AttackMode[] = [];
    const beamModeIds: string[] = [];

    for (const [gi, g] of grouped.entries()) {
      const segs: DamageSegment[] = [];
      for (const a of g.attacks) {
        const s = toSegment(a, warnings, `${w.name}#${g.name}`);
        if (s) segs.push(s);
      }
      if (segs.length === 0) continue;

      const isIncarnon = /Incarnon Form/i.test(g.name);
      const role: ModeRole = isIncarnon
        ? 'incarnon'
        : /^(Charged Shot|Quick Shot|Uncharged Shot|Charge|Uncharged Horizontal\/Vertical Shot|Perfect Shot)$/i.test(g.name)
          ? 'charged'
          : 'normal';
      // 模式 id：灵化固定 incarnon；其余 primary / mode2 / mode3…
      const id = isIncarnon ? 'incarnon' : gi === 0 ? 'primary' : role === 'charged' && modes.every((m) => m.role !== 'charged') ? 'charged' : `mode${modes.length + 1}`;

      // 灵化没有弹匣/装填概念（充能弹药不建模）；其余模式共用武器级弹匣/装填。
      const override = attackOverride(g.attacks[0]!, w);
      const roleOverride: PanelOverride | undefined =
        role === 'incarnon'
          ? { ...(override ?? {}), magazineSize: 0, reloadTime: 0 }
          : override;

      const mode: AttackMode = {
        id,
        role,
        trigger,
        bullets: 1,
        multishot: round4(w.multishot ?? 1),
        variants: [{ id: 'direct', label: '直接命中', segments: segs }],
        ...(roleOverride ? { override: roleOverride } : {}),
      };
      // 射线判定只认「扳机 Held」或「该模式内有非 AoE 的 Held 攻击」。
      // 攻击名单先暂存在模式对象上，判定后即删，不进入产出。
      const beamHits = g.attacks.filter((a) => isHeldAttack(a.name) && String(a.shot_type ?? '').toLowerCase() !== 'aoe');
      (mode as AttackMode & { _beamAttacks?: boolean })._beamAttacks = beamHits.length > 0;
      const beam = isBeamMode(mode);
      delete (mode as AttackMode & { _beamAttacks?: boolean })._beamAttacks;
      modes.push(mode);
      if (beam) beamModeIds.push(id);
    }

    if (modes.length === 0) {
      stats.droppedNoAttack++;
      warnings.push(`${w.name}: 所有攻击都没有伤害，已跳过`);
      continue;
    }

    // 主模式排最前（灵化/蓄力排在后面）
    const order: Record<ModeRole, number> = { normal: 0, charged: 1, incarnon: 2 };
    modes.sort((a, b) => order[a.role] - order[b.role]);

    if (modes.length > 1) stats.multiMode++;
    stats.beamModes += beamModeIds.length;
    stats.kept++;

    weapons.push({
      id: toWeaponId(w),
      name: w.name,
      category: toCategory(w),
      critChance: round4(w.criticalChance ?? 0),
      critMultiplier: round4(w.criticalMultiplier ?? 1),
      statusChance: round4(w.procChance ?? 0),
      fireRate: round4(w.fireRate ?? 0),
      ...(w.magazineSize != null ? { magazineSize: round4(w.magazineSize) } : {}),
      ...(w.reloadTime != null ? { reloadTime: round4(w.reloadTime) } : {}),
      modes,
      beamModeIds,
      wfcdName: w.name,
    });
  }

  weapons.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { weapons, stats, warnings };
}
