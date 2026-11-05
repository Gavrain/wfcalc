/**
 * 武器模型 —— **与数据层输出逐字段对齐**（D-011 已确认）。
 *
 * 字段名以 `packages/data-build/src/emit.ts` 的实际输出为准：
 *   `multishot`（不是 baseMultishot）、`aoe`（不是 isAoe）、`name` + `nameZh`（不是 name:{en,zh}）。
 *
 * 数据来源：官方导出 `ExportWeapons.json` 的 `behaviours[]`，清洗见 `packages/data-build/src/clean.ts`。
 * 每个 behaviour 是一个"攻击模式"，其中包含最多 4 类伤害段：
 *
 *   impact            命中（子弹直接命中目标的伤害）
 *   attack            飞行体命中（投射物飞到目标后结算的伤害）
 *   explosiveAttack   爆炸（AoE，需要半径 + 距离衰减，见 data-todo）
 *   embedDeathAttack  嵌入/滞留后死亡
 *
 * 这 4 类段对「多重」「元素」「暴击」的响应**并不相同**，必须分开建模，不能压平成单一伤害数组。
 */
import type { DamageSpread, DamageType } from './damage-types.ts';

/** 官方导出的触发方式（stateName）去掉语言路径后的短名 */
export type TriggerKind = 'auto' | 'semi' | 'burst' | 'charge' | 'held' | 'active' | 'unknown';

/** 伤害段类型 */
export type SegmentKind = 'impact' | 'attack' | 'explosiveAttack' | 'embedDeathAttack';

/** 用于把 AoE 段归类到"需要半径与衰减参数"的清单 */
export const AOE_SEGMENT_KINDS: readonly SegmentKind[] = ['explosiveAttack'];

/**
 * 模式的语义角色。
 *
 * - normal    普通射击
 * - charged   蓄力射击
 * - incarnon  灵化模式（暴击/触发与普通射击不同，需人工层补 override）
 */
export type ModeRole = 'normal' | 'charged' | 'incarnon';

export interface DamageSegment {
  kind: SegmentKind;
  /** 该段的伤害分布 */
  damage: DamageSpread;
  /** 该段自身的触发几率（0~1） */
  procChance: number;
  /** 该段是否产生范围伤害（= 数据层的 `aoe` 字段） */
  aoe: boolean;
}

export interface AttackMode {
  /** 稳定 id：`primary` / `mode2` / `charged` / `incarnon` */
  id: string;
  role: ModeRole;
  trigger: TriggerKind;
  /** 该段的弹头数（导出 fireIterations）。**不参与伤害计算**，只做溯源（D-009） */
  bullets: number;
  /** 面板多重（= 导出顶层 multishot）。**伤害计算只用这个**（D-009） */
  multishot: number;
  burst?: { count: number; delay: number };
  segments: DamageSegment[];
  /**
   * 模式级面板覆盖值（D-050）。
   *
   * 不同模式的面板可能不同：灵化模式的暴击/触发与普通射击不一样，
   * 三模式武器（如 Kuva Hind）每个模式的暴击也各不相同。
   * 这里写的是**该模式自己的数值**；没写的项一律**回退到武器级**，
   * 所以只填部分字段是允许的，老数据（完全不填）行为不变。
   */
  override?: {
    critChance?: number;
    critMultiplier?: number;
    statusChance?: number;
    fireRate?: number;
    magazineSize?: number;
    reloadTime?: number;
  };
}

/** 玄骸武器（Kuva / Tenet / Coda 系）的元素加成信息 */
export interface KuvaInfo {
  bonusRange: [number, number];
  elements: DamageType[];
}

export interface Weapon {
  id: string;
  name: string;
  nameZh?: string;
  category: 'primary' | 'secondary' | 'melee' | 'archgun' | 'archmelee' | 'companion' | 'unknown';
  critChance: number;
  critMultiplier: number;
  statusChance: number;
  fireRate: number;
  magazineSize?: number;
  reloadTime?: number;
  modes: AttackMode[];
  /** 'kuva' / 'variant' … */
  variant?: string;
  kuva?: KuvaInfo;
}

/** 取武器的一个攻击模式；找不到时抛错（不静默回退到第一个模式，避免选错模式也算出结果） */
export function getMode(weapon: Weapon, modeId: string): AttackMode {
  const mode = weapon.modes.find((m) => m.id === modeId);
  if (!mode) throw new Error(`武器 ${weapon.id} 没有模式 ${modeId}（可选：${weapon.modes.map((m) => m.id).join(', ')}）`);
  return mode;
}

/**
 * 模式最终生效的面板数值（**唯一取值入口**，D-050）。
 *
 * 取值顺序：**模式自己的 override → 武器级默认值**。
 * 没写 override 的武器（当前 192 把全部如此）行为与改动前完全一致。
 */
export function panelStats(weapon: Weapon, mode: AttackMode) {
  const o = mode.override;
  return {
    critChance: o?.critChance ?? weapon.critChance,
    critMultiplier: o?.critMultiplier ?? weapon.critMultiplier,
    statusChance: o?.statusChance ?? weapon.statusChance,
    fireRate: o?.fireRate ?? weapon.fireRate,
    multishot: mode.multishot,
    magazineSize: o?.magazineSize ?? weapon.magazineSize ?? 0,
    reloadTime: o?.reloadTime ?? weapon.reloadTime ?? 0,
  };
}
