/**
 * 乘区（bucket）骨架：表 2.0 的 `BUCKET`。
 *
 * ```
 * BUCKET(panel, id) = ( panel × (1 + Σ_pct(id)) + Σ_flat(id) ) × Π_mul(id)
 * ```
 *
 * 口径来源：`docs/乘区归属表.md` 第 2.0 节、`docs/伤害公式.md` §2.1。
 * 设计原则：**每个属性明确属于唯一一个乘区**，乘区内相加、乘区之间相乘。
 * 这是模拟器能给出"每个乘区贡献多少"的基础，也是防止 Mod 数值错配的关键。
 *
 * 注意：本文件原先的注释是历史遗留的乱码（双重转码，无法还原），已按文档重写，逻辑不变。
 */
import type { Contribution, ContribStat } from './contributions.ts';
import { sumFlat, sumPct, productMul } from './contributions.ts';

/** 乘区 id：与资料里的分类口径一致，便于对照 */
export type BucketId =
  | 'baseDamage' // 基伤（含与多重并列的"加法"类）
  | 'multishot'
  | 'elemental'
  | 'physical'
  | 'critChance'
  | 'critMultiplier'
  | 'statusChance'
  | 'faction'
  | 'fireRate'
  | 'utility'; // 换弹、弹匣、穿透、射程等不影响单发伤害的部分

/** 参与 BUCKET 计算的属性（即"面板值 → 最终值"的那几种） */
export type BucketableStat = Extract<
  ContribStat,
  'baseDamage' | 'multishot' | 'critChance' | 'critMultiplier' | 'statusChance' | 'fireRate' | 'faction' | 'statusDamage'
  | 'magazine' | 'reloadSpeed'
>;

export interface BucketDetail {
  stat: BucketableStat;
  /** 面板值（未加任何 Mod） */
  panel: number;
  /** Σ pct，小数口径 */
  pct: number;
  /** Σ flat，属性自身单位 */
  flat: number;
  /** Π mul */
  mul: number;
  /** 最终值 = (panel × (1+pct) + flat) × mul */
  value: number;
  /** 参与该乘区的贡献（供 UI 拆解；已按 active 过滤） */
  contributors: Contribution[];
}

/**
 * 通用乘区函数（表 2.0）。
 *
 * @param panel 面板值（暴率 0~1 小数、暴伤倍数、多重、射速…）
 * @param stat  该乘区对应的属性名
 * @param contribs 全部贡献
 */
export function bucket(panel: number, stat: BucketableStat, contribs: readonly Contribution[]): number {
  return bucketDetail(panel, stat, contribs).value;
}

/** 与 `bucket` 同值，但附带拆解明细（CLAUDE.md「每个乘区都能复算」的落点） */
export function bucketDetail(panel: number, stat: BucketableStat, contribs: readonly Contribution[]): BucketDetail {
  const pct: number = sumPct(contribs, stat);
  const flat: number = sumFlat(contribs, stat);
  const mul: number = productMul(contribs, stat);
  const value: number = (panel * (1 + pct) + flat) * mul;
  return {
    stat: stat,
    panel: panel,
    pct: pct,
    flat: flat,
    mul: mul,
    value: value,
    contributors: contribs.filter((c) => c.stat === stat && c.active !== false),
  };
}

/** 暴率 / 暴伤 / 射速这类"两段式"属性的面板 + 加成展示（供 UI 的「基础面板/加成后面板」对照） */
export interface PanelPair {
  stat: BucketableStat;
  base: number;
  after: number;
}

export function panelPairs(panelStats: Partial<Record<BucketableStat, number>>, contribs: readonly Contribution[]): PanelPair[] {
  const out: PanelPair[] = [];
  const entries = Object.entries(panelStats);
  for (const [stat, base] of entries) {
    const key: BucketableStat = stat;
    out.push({ stat: key, base: base, after: bucket(base, key, contribs) });
  }
  return out;
}
