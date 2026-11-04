/**
 * 数据层入口。
 *
 * 目录约定：
 *   data/manual/aoe.ts     —— AoE 半径与伤害衰减（人工维护，todo 见 data-todo/）
 *   data/manual/incarnon.ts—— 灵化加成（人工维护）
 *   data/manual/arcanes.ts  —— 武器赋能数值（人工维护）
 *   data/manual/mods.ts     —— Mod 数值与乘区归属（人工维护）
 *   data/generated/        —— data-build 流水线生成，勿手改
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
