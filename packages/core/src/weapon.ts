/**
 * 攻击模式与伤害段模型。
 *
 * 来源：官方导出 `ExportWeapons.json` 的 `behaviours[]`。
 * 每个 behaviour 是一个"攻击模式"，其中包含最多 4 类伤害段：
 *
 *   impact            命中（子弹直接命中目标的伤害）
 *   attack            飞行体命中（投射物飞到目标后结算的伤害）
 *   explosiveAttack   爆炸（AoE，需要半径 + 距离衰减，见 docs 与 data-todo）
 *   embedDeathAttack  嵌入/滞留后死亡（如 Gorgon 的蓄力爆炸）
 *
 * 此外，一个 behaviour 里可能有 **两组** 投射数据：
 *   projectile          普通发射
 *   chargedProjectile   蓄力发射（弓、弩、发射器类）
 * 两者数值相同时代表"只能蓄满发射"，应合并为一个模式；
 * 不同时代表可区分蓄力程度，需拆成多个模式。判断逻辑见 data-build/clean.ts。
 *
 * 这 4 类段对「多重」「元素」「暴击」的响应**并不相同**，必须分开建模，
 * 不能压平成单一伤害数组——见 research/01-数据源可行性验证.md 第 3 节。
 */
import type { DamageSpread } from './damage-types.ts';

/** 官方导出的触发方式（stateName）去掉语言路径后的短名 */
export type TriggerKind = 'auto' | 'semi' | 'burst' | 'charge' | 'held' | 'active' | 'unknown';

/** 伤害段类型 */
export type SegmentKind = 'impact' | 'attack' | 'explosiveAttack' | 'embedDeathAttack';

/** 投射物的来源：普通发射还是蓄力发射 */
export type ProjectileSlot = 'projectile' | 'chargedProjectile';

/** 用于把 AoE 段归类到"需要半径与衰减参数"的清单 */
export const AOE_SEGMENT_KINDS: readonly SegmentKind[] = ['explosiveAttack'];

/**
 * 模式的语义角色。
 *
 * - normal    普通射击
 * - charged   蓄力射击（由 chargedProjectile 拆出，与 normal 数值不同时）
 * - incarnon  灵化模式（导出中表现为同一武器下的额外 TriggerCharge behaviour，
 *             但暴击/触发与普通射击不同——据需求方说明）
 */
export type ModeRole = 'normal' | 'charged' | 'incarnon';

export interface DamageSegment {
  kind: SegmentKind;
  /** 该段的伤害分布（官方导出里已带 procChance） */
  damage: DamageSpread;
  /** 该段自身的触发几率（官方导出里每个段单独给） */
  procChance: number;
  /**
   * 该段是否产生范围伤害。
   * true 时半径与衰减参数来自人工维护层（data/manual/aoe.ts），缺失时输出告警。
   */
  isAoe: boolean;
}

export interface AttackMode {
  /** 稳定 id，用于配置方案引用，如 `primary` / `charged` / `incarnon` */
  id: string;
  /** 语义角色，决定 UI 分组与系数覆盖方式 */
  role: ModeRole;
  /** 官方导出给出的 stateName 短名 */
  trigger: TriggerKind;
  /** 该段的弹头数（fireIterations） */
  bullets: number;
  /** 多重基数（顶层 multishot；与 bullets 可能不同，见 PoC 第 3 节） */
  baseMultishot: number;
  /** 点射 */
  burst?: { count: number; delay: number };
  segments: DamageSegment[];
  /**
   * 该模式专属的暴击/触发覆盖值。
   * 灵化等模式的暴击、触发与武器面板不同，需在这里单独给出；
   * 缺省时沿用 WeaponPanel 上的面板值。
   */
  override?: {
    critChance?: number;
    critMultiplier?: number;
    statusChance?: number;
  };
  /** 官方导出的原始键路径（stateName），便于追踪与 debug */
  sourceKey?: string;
}

export interface WeaponPanel {
  /** 内部稳定 id（官方导出键路径的最后一段） */
  id: string;
  name: { en: string; zh?: string };
  category: 'primary' | 'secondary' | 'melee' | 'archgun' | 'archmelee' | 'companion' | 'unknown';
  critChance: number;
  critMultiplier: number;
  statusChance: number;
  fireRate: number;
  magazineSize?: number;
  reloadTime?: number;
  /** 复合/基础元素以外的所有面板数据都收敛在这里，便于"自定义武器面板"复用同一结构 */
  modes: AttackMode[];
  /** 近战专有 */
  melee?: {
    range: number;
    followThrough: number;
    comboDuration: number;
    slamAttack: number;
    slamRadialDamage: number;
    slamRadius: number;
    slideAttack: number;
    heavyAttackDamage: number;
    heavySlamAttack: number;
    heavySlamRadialDamage: number;
    heavySlamRadius: number;
  };
}
