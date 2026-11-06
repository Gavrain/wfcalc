/**
 * 武器模型 —— **与数据层输出逐字段对齐**（D-011 已确认）。
 *
 * 字段名以 `packages/data-build/src/emit.ts` 的实际输出为准：
 *   `multishot`（不是 baseMultishot）、`aoe`（不是 isAoe）、`name` + `nameZh`（不是 name:{en,zh}）。
 *
 * 数据来源：官方导出 `ExportWeapons.json` 的 `behaviours[]`，清洗见 `packages/data-build/src/clean.ts`。
 * 每个 behaviour 是一个"攻击模式"，其中包含最多 3 类伤害段：
 *
 *   impact            命中（子弹直接命中目标的伤害）
 *   attack            飞行体命中（投射物飞到目标后结算的伤害）
 *   explosiveAttack   爆炸（AoE，需要半径 + 距离衰减，见 data-todo）
 *
 * 这 3 类段对「多重」「元素」「暴击」的响应**并不相同**，必须分开建模，不能压平成单一伤害数组。
 *
 * ⚠ 导出里还有 `projectile.embedDeathAttack`，**它不是伤害段**：
 *   需求方确认它是「官方用于计算碎尸比例的字段」，总额恒为 100，
 *   切割占比越高碎尸概率越高，纯视觉表现（D-078）。清洗阶段已剔除。
 */
import type { DamageSpread, DamageType } from './damage-types.ts';

/** 官方导出的触发方式（stateName）去掉语言路径后的短名 */
export type TriggerKind = 'auto' | 'semi' | 'burst' | 'charge' | 'held' | 'active' | 'unknown';

/** 伤害段类型（D-078：不含 embedDeathAttack，它不产生伤害） */
export type SegmentKind = 'impact' | 'attack' | 'explosiveAttack';

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

/** 面板覆盖（变体级 / 模式级共用同一套字段） */
export interface PanelOverride {
  critChance?: number;
  critMultiplier?: number;
  statusChance?: number;
  fireRate?: number;
  magazineSize?: number;
  reloadTime?: number;
}

/**
 * 模式内的**面板变体**（D-080）。
 *
 * 同一发武器往往有两个阶段：「弹头直接命中」与「弹头爆炸」。
 * 它们的**触发率与暴击并不一致**，所以不能共享一套面板，也**不应挤在同一个面板里展示**。
 *
 * 这里把它们做成模式内的子项：
 * ```
 * 主模式（id=primary, role=normal）
 *   ├── 变体 direct  直接命中   ← 自己的面板 + 自己的配装
 *   └── 变体 blast   爆炸       ← 自己的面板 + 自己的配装
 * ```
 *
 * 界面只在模式内部切换变体，**不同时铺开**（避免拥挤）。
 * 单段模式的变体数为 1，界面不显示切换（行为与改动前相同）。
 */
export interface ModeVariant {
  /** 稳定 id：`direct`（直接命中）/ `blast`（爆炸） */
  id: string;
  /** 展示名：`直接命中` / `爆炸` */
  label: string;
  /** 该变体的伤害段（通常只有 1 段） */
  segments: DamageSegment[];
  /**
   * 该变体自己的面板覆盖。
   * 取值顺序：**变体 override → 模式 override → 武器级**（D-050 的延伸）。
   */
  override?: PanelOverride;
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
  /**
   * 模式内的面板变体（D-080）。
   *
   * 恒非空、至少 1 个。单段模式就是 1 个变体 `direct`。
   * **计算与展示都以变体为单位**：每个变体有自己的面板与配装。
   */
  variants: ModeVariant[];
  /**
   * 模式级面板覆盖值（D-050）。
   *
   * 不同模式的面板可能不同：灵化模式的暴击/触发与普通射击不一样，
   * 三模式武器（如 Kuva Hind）每个模式的暴击也各不相同。
   * 这里写的是**该模式自己的数值**；没写的项一律**回退到武器级**，
   * 所以只填部分字段是允许的，老数据（完全不填）行为不变。
   */
  override?: PanelOverride;
  /**
   * 该模式的数值**未核实**（D-110）。
   *
   * 用于灵化形态这类"官方导出没有、人工层还没填"的数据：
   * 面板先**复用基础面板**占位，同时在界面上明确打标记，
   * 不让用户误以为这个数可信。
   *
   * `'panel-reused'` = 面板是占位值；`'entered'` = 人工录入的真实值。
   */
  _manual?: 'panel-reused' | 'entered';
  /** 人工备注（来源、待办、补充说明），仅供展示与溯源 */
  _note?: string;
}

/** 当前生效的面板变体（模式内） */
export function activeVariant(mode: AttackMode, variantId?: string): ModeVariant {
  if (variantId) {
    const hit = mode.variants.find((v) => v.id === variantId);
    if (hit) return hit;
  }
  return mode.variants[0]!;
}

/**
 * 模式内**全部变体的全部段**（按变体顺序拼接）。
 *
 * D-080 之后 `AttackMode` 上不再有 `segments` 字段——段只属于变体。
 * 需要"把整段遍历一遍"的地方（统计、差异比对、审核表、整枪汇总）用这个函数。
 *
 * ⚠ 结算与展示**不要**用它：应当按变体分别处理（每个变体是一个独立面板）。
 */
export function allSegments(mode: AttackMode): DamageSegment[] {
  const out: DamageSegment[] = [];
  for (const v of mode.variants ?? []) out.push(...v.segments);
  return out;
}

/**
 * 模式内**指定变体**的段（D-120）。
 *
 * 单变体结算用：`compute()` 会把 `mode.variants` 缩到只剩选中那个变体再调 `allSegments`，
 * 于是 `segments` / `spreadByVariant` 都只含**当前变体**，界面不会再拿别的变体去累加。
 * 越界 / 没传 → 原样返回（调用方给的是已经缩好的模式）。
 */
export function variantSegments(mode: AttackMode, variantIndex?: number): DamageSegment[] {
  if (variantIndex === undefined) return allSegments(mode);
  const v = mode.variants?.[variantIndex];
  if (!v) return allSegments(mode);
  return [...v.segments];
}

/** 模式内全部段的数量（含所有变体） */
export function segmentCount(mode: AttackMode): number {
  return (mode.variants ?? []).reduce((n, v) => n + v.segments.length, 0);
}

/** 模式内**第一个**段（跨变体）；空则返回 undefined */
export function firstSegment(mode: AttackMode): DamageSegment | undefined {
  for (const v of mode.variants ?? []) {
    const s = v.segments[0];
    if (s) return s;
  }
  return undefined;
}

/** 模式是否含任何 AoE 段（任一变体内） */
export function hasAoeSegment(mode: AttackMode): boolean {
  return (mode.variants ?? []).some((v) => v.segments.some((s) => s.aoe));
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
 * 模式最终生效的面板数值（**唯一取值入口**，D-050 / D-080）。
 *
 * 取值顺序：**变体 override → 模式 override → 武器级默认值**。
 * 没写 override 的武器（当前全部如此）行为与改动前完全一致。
 *
 * @param variant 模式内的面板变体（D-080）。不传则只用模式级 override。
 */
export function panelStats(weapon: Weapon, mode: AttackMode, variant?: ModeVariant) {
  const o = mode.override;
  const v = variant?.override;
  return {
    critChance: v?.critChance ?? o?.critChance ?? weapon.critChance,
    critMultiplier: v?.critMultiplier ?? o?.critMultiplier ?? weapon.critMultiplier,
    statusChance: v?.statusChance ?? o?.statusChance ?? weapon.statusChance,
    fireRate: v?.fireRate ?? o?.fireRate ?? weapon.fireRate,
    multishot: mode.multishot,
    magazineSize: v?.magazineSize ?? o?.magazineSize ?? weapon.magazineSize ?? 0,
    reloadTime: v?.reloadTime ?? o?.reloadTime ?? weapon.reloadTime ?? 0,
  };
}
