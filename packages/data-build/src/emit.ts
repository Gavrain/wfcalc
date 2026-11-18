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
import type {
  AttackMode,
  DamageSegment,
  ModeManualFlag,
  PanelOverride,
  SegmentKind,
  Weapon,
  WeaponManualFlag,
} from '../../core/src/weapon.ts';
import type { DamageSpread } from '../../core/src/damage-types.ts';
import { isKuvaFamily, KUVA_BONUS_MIN, KUVA_BONUS_MAX, KUVA_ELEMENT_TYPES } from '../../core/src/kuva.ts';
import type { AppliedOverride } from './overrides.ts';

/**
 * 玄骸是否成立：看数据里的显示名（需求方 2026-11-18：赤毒·布拉玛等 21 把 Tenet / Coda / Kuva
 * 武器的内部 id 不带前缀，只按 id 判会漏标，界面就只剩「无」）。
 * 判据集中在 `isKuvaFamily`，这里只负责把**名字**传进去。
 * 依据：核心事实 §6（玄骸加成类型与并入面板）。
 */
const kuvaWeapon = (w: Weapon, variantType?: string): boolean => isKuvaFamily(w.id, variantType, w.name);

export interface EmitSegment {
  /** D-078：`embedDeathAttack` 已剔除，只剩三种真实伤害段 */
  kind: SegmentKind;
  aoe: boolean;
  damage: DamageSpread;
  procChance: number;
  /**
   * 该段是射线（D-160）。**只写正面标记**，缺省 = 跟随所在攻击方式 / 模式的扳机。
   *
   * 目前只有灵化射线（托里德 / 野猪 / 赘骨的 Held 条 / 盗贼）会写，
   * 判定见 `data/src/manual/incarnon-beam.ts`。
   */
  beam?: boolean;
}

/**
 * 模式内的一种**攻击方式**（D-080 的变体 / D-148 明确其含义）。
 *
 * 一个模式可以有多种攻击方式（弹头命中 / 爆炸 / 射线 / 蓄力），界面分开显示并各带复选框，
 * 用户选哪些参与计算（需求方 2026-11-12）。
 */
export interface EmitVariant {
  id: string;
  label: string;
  /**
   * 该攻击方式自己的扳机（D-148）。缺省 = 跟随模式的扳机。
   * 只有「同一模式内两种扳机并存」才有值——典型是赘骨的灵化（一条射线、一条蓄力）。
   */
  trigger?: string;
  segments: EmitSegment[];
  override?: PanelOverride;
  /** 默认是否勾选参与计算（缺省 = 勾选） */
  defaultSelected?: boolean;
}

export interface EmitMode {
  id: string;
  role: string;
  /**
   * 该模式的扳机（D-148）。**普通模式下射线的唯一判据**：`'held'` 即射线。
   * 同一把武器的不同模式可以有各自的扳机（幻离子：主模式 held，子母弹副模式非 held）。
   *
   * ⚠ D-160：灵化模式例外——WFCD 的灵化攻击一律不带 `Held`，托里德 / 野猪 / 盗贼的射线
   * 由人工表 `INCARNON_BEAM_ATTACKS` 点名，写在**段**的 `beam: true` 上。
   */
  trigger: string;
  bullets: number;
  multishot: number;
  burst?: { count: number; delay: number };
  /** 模式内的面板变体（恒非空，至少 1 个）；段只存在于变体内 */
  variants: EmitVariant[];
  override?: PanelOverride;
  /**
   * D-110 / D-141：该模式的数值来源。
   * `panel-reused` = 面板是**复用基础面板**的占位值，界面会打标记；
   * `bible` = 按需求方给的游戏内白板面板改写；`export-missing` = 导出不可用、人工层录入。
   */
  _manual?: ModeManualFlag;
  /** D-110：人工备注（来源、待办），供溯源与界面提示 */
  _note?: string;
  /** D-141：模式展示名（如「球体融合」），界面优先于通用模式名 */
  _label?: string;
  /**
   * D-155：该模式是不是**重击系**（重型震地 / 重击 / 重击回旋刃）。
   * 内核据此把「重击时 ×2」的固定暴击率词条（斩铁等）按双倍计入暴率。
   */
  _heavy?: boolean;
  /**
   * 需求方 2026-11-13：该模式是不是**震地系**（震地 / 重型震地）。
   * 内核据此决定「震地伤害 +X%」（震波等）是否生效——它进独立的震地伤害乘区，
   * 只对这两个模式起作用，普攻 / 重击 / 枪击都不吃。
   */
  _slam?: boolean;
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
  _manualFields?: Record<string, string>;
  /**
   * D-141：整把武器的人工标记。`panel-empty` = 面板尚未收录（`modes: []`，界面标「面板待补」）。
   *
   * ⚠ 历史字段名 `_manual` 在**武器级**原本是「字段 → 说明」的对象，
   * 为避免与模式级字符串标记混淆，字段级说明改用 `_manualFields`（只在这把武器被覆盖时出现）。
   */
  _manual?: WeaponManualFlag;
  /** 人工备注（来源 / 待办） */
  _note?: string;
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
  // D-160：只写正面标记（射线），不写 `false`——缺省就是"跟随扳机"
  ...(s.beam === true ? { beam: true } : {}),
});

function toEmitMode(m: AttackMode): EmitMode {
  // D-080 / D-148：模式内的每种「攻击方式」各自成面板；模式上不再有 `segments`
  const variants: EmitVariant[] = m.variants.map((v) => ({
    id: v.id,
    label: v.label,
    // 攻击方式自己的扳机（赘骨灵化：射线 + 蓄力）；没写就跟随模式
    ...(v.trigger ? { trigger: v.trigger } : {}),
    segments: v.segments.map(emitSegment),
    ...(v.override ? { override: { ...v.override } } : {}),
    ...(v.defaultSelected === false ? { defaultSelected: false } : {}),
  }));
  return {
    id: m.id,
    role: m.role,
    // D-148：模式扳机就是射线的判据（held = 射线），不另设 beam 字段
    trigger: m.trigger,
    bullets: m.bullets,
    multishot: m.multishot,
    ...(m.burst ? { burst: m.burst } : {}),
    variants,
    ...(m.override ? { override: { ...m.override } } : {}),
    // D-110：把"数值是否核实"的标记与备注一并产出，界面据此打标
    ...(m._manual ? { _manual: m._manual } : {}),
    ...(m._note ? { _note: m._note } : {}),
    ...(m._label ? { _label: m._label } : {}),
    ...(m._heavy ? { _heavy: true } : {}),
    ...(m._slam ? { _slam: true } : {}),
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
  const isKuva = kuvaWeapon(w, meta.variantType);

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
    ...(manual ? { _manualFields: manual } : {}),
    ...(w._manual ? { _manual: w._manual } : {}),
    ...(w._note ? { _note: w._note } : {}),
  };
}
