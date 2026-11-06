/**
 * 产出格式：把 `Weapon` 转成"便于人工阅读与修改"的 JSON 布局。
 *
 * 设计目标（需求方要求"方便我修改"）：
 *   1. 每把武器一个对象，字段与游戏面板同名同序
 *   2. 百分比字段保持 0~1 小数，但在文件名与文档里注明换算
 *   3. 多模式武器逐模式展开，不被压扁
 *   4. 人工覆盖过的字段附带 `_manual` 标记，一眼看出哪些不是导出值
 *
 * 字段名与 `packages/core/src/weapon.ts` 的 `Weapon` **逐字段对齐**（D-011）：
 * 产出 JSON 直接就是内核的输入模型，中间不再做 `baseMultishot → multishot`、
 * `isAoe → aoe`、`name:{en,zh} → name + nameZh` 这类翻译。
 */
import type { AttackMode, DamageSegment, PanelOverride, SegmentKind, Weapon } from '../../core/src/weapon.ts';
import type { DamageSpread } from '../../core/src/damage-types.ts';
import { isKuvaFamily, KUVA_BONUS_MIN, KUVA_BONUS_MAX, KUVA_ELEMENT_TYPES } from '../../core/src/kuva.ts';
import type { AppliedOverride } from './overrides.ts';

export interface EmitSegment {
  /** D-078：`embedDeathAttack` 已剔除，只剩三种真实伤害段 */
  kind: SegmentKind;
  aoe: boolean;
  damage: DamageSpread;
  procChance: number;
}

/** 模式内的面板变体（D-080）：直接命中 / 爆炸，各自独立面板 */
export interface EmitVariant {
  id: string;
  label: string;
  segments: EmitSegment[];
  override?: PanelOverride;
}

export interface EmitMode {
  id: string;
  role: string;
  trigger: string;
  bullets: number;
  multishot: number;
  burst?: { count: number; delay: number };
  /** 模式内的面板变体（恒非空，至少 1 个）；段只存在于变体内 */
  variants: EmitVariant[];
  override?: PanelOverride;
  /**
   * D-110：该模式的数值是否已核实。
   * `panel-reused` = 面板是**复用基础面板**的占位值，界面会打标记。
   */
  _manual?: 'panel-reused' | 'entered';
  /** D-110：人工备注（来源、待办），供溯源与界面提示 */
  _note?: string;
}

export interface EmitWeapon {
  /** 内部名作为主键，跨版本稳定、便于检索与引用 */
  id: string;
  /** 显示名（已由语言包解析） */
  name: string;
  /** 中文显示名（语言包缺失时为 undefined） */
  nameZh?: string;
  category: string;
  /** Prime / Kuva / Syndicate 等变体标记 */
  variant?: string;
  /**
   * 玄骸类武器标记：需要用户在计算器里选元素与加成数值（25%~60%）。
   * 具体数值不在此处给出。
   */
  kuva?: { bonusRange: [number, number]; elements: string[] };
  critChance: number;
  critMultiplier: number;
  statusChance: number;
  fireRate: number;
  magazineSize?: number;
  reloadTime?: number;
  modes: EmitMode[];
  /** 人工覆盖过的字段：字段名 → 说明 */
  _manual?: Record<string, string>;
}

const emitSegment = (s: DamageSegment): EmitSegment => ({
  kind: s.kind,
  aoe: s.aoe,
  damage: Object.fromEntries(
    Object.entries(s.damage)
      .filter((e): e is [string, number] => typeof e[1] === 'number')
      .sort(([a], [b]) => a.localeCompare(b)),
  ),
  procChance: s.procChance,
});

function toEmitMode(m: AttackMode): EmitMode {
  // D-080：变体（直接命中 / 爆炸）各自独立成面板；模式上不再有 `segments`
  const variants: EmitVariant[] = m.variants.map((v) => ({
    id: v.id,
    label: v.label,
    segments: v.segments.map(emitSegment),
    ...(v.override ? { override: { ...v.override } } : {}),
  }));
  return {
    id: m.id,
    role: m.role,
    trigger: m.trigger,
    bullets: m.bullets,
    multishot: m.multishot,
    ...(m.burst ? { burst: m.burst } : {}),
    variants,
    ...(m.override ? { override: { ...m.override } } : {}),
    // D-110：把"数值是否核实"的标记与备注一并产出，界面据此打标
    ...(m._manual ? { _manual: m._manual } : {}),
    ...(m._note ? { _note: m._note } : {}),
  };
}

export function toEmitWeapon(
  w: Weapon,
  applied: AppliedOverride[],
  meta: { variantType?: string | undefined } = {},
): EmitWeapon {
  const mine = applied.filter((a) => a.weaponId === w.id);
  const manual = mine.length > 0
    ? Object.fromEntries(mine.map((a) => [a.field, `${a.from ?? '(无)'} → ${a.to}：${a.reason}`]))
    : undefined;

  // Prime / variant 标记：去掉 VT_ 前缀，只保留有意义的变体
  const rawVariant = meta.variantType ?? '';
  const variant = rawVariant.startsWith('VT_') ? rawVariant.slice(3).toLowerCase() : undefined;
  const isKuva = isKuvaFamily(w.id, meta.variantType);

  return {
    id: w.id,
    name: w.name,
    ...(w.nameZh ? { nameZh: w.nameZh } : {}),
    category: w.category,
    ...(variant && variant !== 'normal' ? { variant } : {}),
    ...(isKuva ? { kuva: { bonusRange: [KUVA_BONUS_MIN, KUVA_BONUS_MAX], elements: [...KUVA_ELEMENT_TYPES] } } : {}),
    critChance: w.critChance,
    critMultiplier: w.critMultiplier,
    statusChance: w.statusChance,
    fireRate: w.fireRate,
    ...(w.magazineSize != null ? { magazineSize: w.magazineSize } : {}),
    ...(w.reloadTime != null ? { reloadTime: w.reloadTime } : {}),
    modes: w.modes.map(toEmitMode),
    ...(manual ? { _manual: manual } : {}),
  };
}
