/**
 * 裂罅（紫卡）词条 → 内核贡献。
 *
 * 依据：核心事实 §11（内核只吃结构化事实）。
 *
 * 界面只负责「选了哪些词条、洗到什么值」，**换算在这里**：
 *   · 后坐力：正面词条是**降低**后坐力（显示 −X%）、负面是增加；
 *     但它不影响伤害，内核直接丢掉；
 *   · 派系：词条存的是**百分比幅度**（+45 表示 +45%），内核口径同样是百分比加算，
 *     所以原样传；界面上显示的 `×1.45` 是**展示换算**，与计算无关；
 *   · 内核不认的词条（缩放 / 穿透 / 弹速 / 状态持续 / 弹药上限）只影响界面显示，直接跳过。
 */
import type { Contribution, ContribStat } from '../contributions.ts';

/** 一条已洗出的裂罅词条（界面传进来） */
export interface RivenEntry {
  /** 词条键（来自 `data/src/manual/riven.ts` 的词条定义） */
  key: string;
  /** 词条映射到的内核属性键 */
  stat: string;
  /**
   * **幅度**：正负词条都存正数（词条的正负由 `kind` 决定）。
   * 派系词条是百分比口径（45 表示 +45%）。
   */
  value: number;
  /** 词条在界面上的位置：`pos` 正面 / `neg` 负面 */
  kind: 'pos' | 'neg';
}

/** 内核认的键（其余只影响界面显示，不进结算） */
const KEPT: ReadonlySet<string> = new Set<ContribStat>([
  'baseDamage',
  'critChance',
  'critMultiplier',
  'statusChance',
  'statusDamage',
  'multishot',
  'fireRate',
  'magazine',
  'reloadSpeed',
  'ammoEfficiency',
  // 需求方：「现版本游戏，弱点 == 爆头」——两者都并进爆头乘区
  'weakpointCritChance',
  'weakpointDamage',
  'headshotDamage',
] as ContribStat[]);

function isKept(stat: string): stat is ContribStat {
  if (KEPT.has(stat as ContribStat)) return true;
  return (
    stat.startsWith('faction:') ||
    stat.startsWith('elemental:') ||
    stat.startsWith('physical:')
  );
}

/**
 * 裂罅词条 → 内核贡献。
 *
 * @param entries 已洗出的词条（空槽位传 `null`，会被跳过）
 * @param source  来源标识，默认 `riven`（拆解面板用它分组）
 * @param slot    裂罅所在的槽位下标（可选，拆解面板用它定位）
 */
export function rivenToContributions(
  entries: readonly (RivenEntry | null)[],
  source = 'riven',
  slot?: number,
): Contribution[] {
  const out: Contribution[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || !e.key || !isKept(e.stat)) continue;
    const sign = e.kind === 'neg' ? -1 : 1;
    const amount = sign * Math.abs(e.value);
    if (amount === 0) continue;
    out.push({
      stat: e.stat,
      form: 'pct',
      amount,
      source,
      ...(slot !== undefined ? { slot } : {}),
      label: `裂罅 ${e.key} ${amount >= 0 ? '+' : '−'}${Math.abs(amount)}%`,
    });
  }
  return out;
}

/**
 * 后坐力词条的**显示方向**（不进计算，只给界面用）。
 *
 * ```
 * 正面词条 → 后坐力降低 → 显示 −X%
 * 负面词条 → 后坐力增加 → 显示 +Y%
 * ```
 */
export function recoilDisplaySign(kind: 'pos' | 'neg'): 1 | -1 {
  return kind === 'neg' ? 1 : -1;
}

/**
 * 派系词条的显示倍率（百分比幅度 → `×1.45` / `×0.73`）。
 *
 * **只用于显示**：内核与数据一律用百分比幅度，转换只发生在渲染这一层。
 */
export function factionDisplayMultiplier(kind: 'pos' | 'neg', magnitude: number): number {
  return kind === 'pos' ? 1 + magnitude / 100 : 1 - magnitude / 100;
}
