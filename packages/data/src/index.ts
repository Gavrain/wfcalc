/**
 * 数据层入口。
 *
 * 目录约定：
 *   src/manual/     人工维护层（勿由流水线覆盖）：
 *     incarnon.ts        灵化武器清单（D-100）
 *     incarnon-stats.ts  灵化形态面板数值（D-110，需求方录入）
 *     weapon-issues.ts   武器「已知问题」清单（D-101，由 find-issues.mjs 生成）
 *     weapon-patches.ts  武器级人工订正表（D-141）
 *     overrides.ts       人工覆盖层（编辑器保存目标）
 *     exalted-slots.ts   显赫武器 → Mod 槽位补充
 *     weapon-effects.ts  武器被动效果表
 *     find-issues.mjs    生成 weapon-issues.ts 的脚本
 *   src/generated/  data-build 流水线生成，勿手改
 *   src/mods/       Mod 数值基线（D-140，入库 JSON）
 */

export type ManualLayerStatus = 'todo' | 'partial' | 'complete';

/** 人工维护层在某把武器上的覆盖状态，用于 UI 标注"数据未补齐" */
export interface CoverageNote {
  itemId: string;
  layer: string;
  status: ManualLayerStatus;
  /** 缺失的具体字段，对应 data-todo 里的条目 */
  missingFields: string[];
}

export const DATA_VERSION = '0.0.0';
