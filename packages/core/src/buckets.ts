/**
 * 乘区（bucket）定义。
 *
 * 设计原则：**每个属性明确属于唯一一个乘区**，乘区内相加、乘区之间相乘。
 * 这是模拟器能给出"每个乘区贡献多少"的基础，也是防止 Mod 数值错配的关键。
 *
 * 口径来源：`docs/乘区归属表.md`（第 0~8 节已逐条确认）与 `docs/伤害公式.md`（第 2 节通用骨架）。
 *
 * 说明：本文件的注释此前为历史遗留的乱码，现已重写；逻辑以 `docs/乘区归属表.md` 为准。
 */
import type { DamageType } from './damage-types.ts';

/** 面板上一个可被 Mod 影响的属性 */
export type WeaponStat =
  | 'baseDamage'
  | 'multishot'
  | 'critChance'
  | 'critMultiplier'
  | 'statusChance'
  | 'fireRate'
  | 'reloadSpeed'
  | 'magazine'
  | 'range'
  | 'comboDuration'
  | 'projectileSpeed'
  | 'punchThrough'
  | 'ammoMax'
  | 'zoom'
  | 'factionDamage'
  | `elemental:${DamageType}`
  | `physical:${DamageType}`;

/** 乘区 id：与资料里的分类口径一致，便于对照 */
export type BucketId =
  | 'baseDamage'   // 基伤（含与多重并列的"加法"类）
  | 'multishot'
  | 'elemental'
  | 'physical'
  | 'critChance'
  | 'critMultiplier'
  | 'statusChance'
  | 'faction'
  | 'fireRate'
  | 'utility';     // 换弹、弹匣、穿透、射程等不影响单发伤害的部分

/** 一个 Mod / 赋能 / 紫卡词条 / 自定义加成提供的加成 */
export interface StatContribution {
  stat: WeaponStat;
  /** 单位：百分比（+50% 记为 50） */
  percent: number;
  /** 来源标识，用于拆解展示 */
  source: string;
}

/** 一个乘区在某次计算中的累加结果，供 UI 拆解展示 */
export interface BucketAccumulation {
  bucket: BucketId;
  /** 加法累加和（百分比） */
  additivePercent: number;
  /** 最终倍率 = 1 + additivePercent / 100 */
  multiplier: number;
  contributions: StatContribution[];
}
