/**
 * 产出格式：把 WeaponPanel 转成"便于人工阅读与修改"的 JSON 布局。
 *
 * 设计目标（需求方要求"方便我修改"）：
 *   1. 每把武器一个对象，字段与游戏面板同名同序
 *   2. 百分比字段保持 0~1 小数，但在文件名与文档里注明换算
 *   3. 多模式武器逐模式展开，不被压扁
 *   4. 人工覆盖过的字段附带 `_manual` 标记，一眼看出哪些不是导出值
 */
import type { AttackMode, WeaponPanel } from '../../core/src/weapon.ts';
import { isKuvaFamily, KUVA_BONUS_MIN, KUVA_BONUS_MAX, KUVA_ELEMENT_TYPES } from '../../core/src/kuva.ts';
import type { AppliedOverride } from './overrides.ts';

export interface EmitMode {
  id: string;
  role: string;
  trigger: string;
  bullets: number;
  multishot: number;
  burst?: { count: number; delay: number };
  segments: Array<{
    kind: string;
    aoe: boolean;
    damage: Record<string, number>;
    procChance: number;
  }>;
  override?: Record<string, number>;
}

export interface EmitWeapon {
  id: string;
  name: string;
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

function toEmitMode(m: AttackMode): EmitMode {
  return {
    id: m.id,
    role: m.role,
    trigger: m.trigger,
    bullets: m.bullets,
    multishot: m.baseMultishot,
    ...(m.burst ? { burst: m.burst } : {}),
    segments: m.segments.map((s) => ({
      kind: s.kind,
      aoe: s.isAoe,
      damage: Object.fromEntries(Object.entries(s.damage).sort(([a], [b]) => a.localeCompare(b))),
      procChance: s.procChance,
    })),
    ...(m.override ? { override: m.override } : {}),
  };
}

export function toEmitWeapon(
  w: WeaponPanel,
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
    // 导出只有语言键，这里保留原样，等名称映射补齐后替换
    name: w.name.en,
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
