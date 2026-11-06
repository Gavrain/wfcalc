/**
 * 武器被动效果表。
 *
 * 背景：官方导出的武器数据里**没有任何被动效果字段**（只有面板数值、
 * variantType、compatibilityTags 等）。武器的被动/特殊机制必须人工维护。
 *
 * 处理原则（与需求方讨论确定）：
 *   1. 能落到乘区的被动 → 用结构化条目表达（本文件），计算器按表应用
 *   2. 无法用乘区表达的被动 → 标记 unsupported，UI 提示，不参与计算
 *   3. 绝不在计算逻辑里硬编码某把武器的特例
 *
 * 每个条目都可以在 UI 里单独开关，便于对比"有/无该被动"。
 */
import type { BucketableStat } from '../../../core/src/buckets.ts';

/** 被动触发时机 */
export type EffectTrigger =
  | 'always' // 永久生效
  | 'onHit' // 命中时
  | 'onWeakPointHit' // 弱点命中时
  | 'onKill' // 击杀时
  | 'onReload' // 换弹后
  | 'onStatus' // 造成异常状态时
  | 'stacking'; // 叠加类（需说明层数与持续时间）

export interface WeaponEffect {
  /** 稳定 id，用于配置方案与 UI 开关 */
  id: string;
  trigger: EffectTrigger;
  /** 影响的属性；unsupported 时为 null */
  stat: BucketableStat | null;
  /** 数值（百分比口径，如 0.3 表示 +30%） */
  value: number;
  /** 叠加层数上限（stacking 类） */
  maxStacks?: number;
  /** 持续时间（秒），永久为 null */
  duration?: number | null;
  /** 说明文字，UI 直接展示 */
  note: string;
  /** 无法量化为乘区的被动，标记后不参与计算 */
  unsupported?: boolean;
}

/** 武器内部 id → 被动列表 */
export const WEAPON_EFFECTS: Record<string, WeaponEffect[]> = {
  // 示例条目（待人工逐把补充，格式确定后批量录入）
  // KuvaOgris: [
  //   {
  //     id: 'kuva_ogris_radius',
  //     trigger: 'onKill',
  //     stat: null,
  //     value: 0.3,
  //     maxStacks: 1,
  //     duration: null,
  //     note: '击杀敌人后爆炸半径 +30%',
  //     unsupported: true,
  //   },
  // ],
};
