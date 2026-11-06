/**
 * 元素阶段：物理 % / 元素 % 加量 + 两两合成（`docs/伤害公式.md` §5.3）。
 *
 * 输入是②基伤之后的面板分布；输出是合成前后的槽位与最终命中分布。
 * 不依赖任何其它阶段，`weapon-state.ts` 也直接调这里（去掉原来的 main ↔ weapon-state 双向依赖）。
 */
import type { DamageSpread, DamageType } from './damage-types.ts';
import {
  BASE_ELEMENTAL_TYPES,
  COMPOUND_TYPES,
  PHYSICAL_TYPES,
  isCompound,
  scaleSpread,
  spreadTotal,
} from './damage-types.ts';
import type { Contribution } from './contributions.ts';
import { contributionsFor, sumPct } from './contributions.ts';

// ─────────────────────────────────────────────────────────────
// 复合元素配对表（表 4.3）
// ─────────────────────────────────────────────────────────────

/**
 * 复合元素配对表（表 4.3）。
 *
 * ⚠ 之前这里写的是字面键（`'heat+cold'`），而 `pairOf` 用 `[a, b].sort()` 拼 key ——
 *   `'cold'.localeCompare('heat') < 0`，所以 `heat + cold` 实际会拼成 `'cold+heat'`，
 *   **整个表一条都对不上**（六种复合元素全部失效，实测火 + 冰不会合成爆炸）。
 *   现在改为：**表里直接写"配对 → 结果"的有序对，匹配时双向都查**，不再依赖排序结果。
 */
const PAIR_LIST: readonly [DamageType, DamageType, DamageType][] = [
  ['heat', 'cold', 'blast'],
  ['heat', 'toxin', 'gas'],
  ['heat', 'electric', 'radiation'],
  ['cold', 'toxin', 'viral'],
  ['cold', 'electric', 'magnetic'],
  ['toxin', 'electric', 'corrosive'],
];

/** 兼容旧导出：`'a+b'` 正序键 → 复合元素（正反对都登记） */
export const PAIRS: Readonly<Record<string, DamageType>> = (() => {
  const out: Record<string, DamageType> = {};
  for (const [a, b, result] of PAIR_LIST) {
    out[`${a}+${b}`] = result;
    out[`${b}+${a}`] = result;
  }
  return out;
})();

/** 两个基础元素能合成出的复合元素；不能配对返回 null（与顺序无关） */
export function pairOf(a: DamageType, b: DamageType): DamageType | null {
  for (const [x, y, result] of PAIR_LIST) {
    if ((x === a && y === b) || (x === b && y === a)) return result;
  }
  return null;
}

export type Side = 'hit' | 'dotBase';

export interface ElementSlot {
  type: DamageType;
  amount: number;
  /** 队列顺序：面板元素先入队，Mod 元素按槽位号；同号按来源稳定 */
  order: number;
  source: 'panel' | 'mod';
  sourceId?: string;
  /** 该槽位是否由 Mod 产生（DoT 基础值剔除 Mod 加量用） */
  fromMod: boolean;
}

export interface ApplyElementsResult {
  v: DamageSpread;
  /** 合成前的槽位 */
  slots: ElementSlot[];
  /** 合成的配对结果 */
  compounds: ElementSlot[];
  /** 合成后剩下的单元素 */
  singles: ElementSlot[];
}

/**
 * §5.3：元素 / 物理加量 + 两两合成。
 *
 * @param base  ② 的结果（已含基伤、已含被放大的玄骸）；函数内部不再乘玄骸
 * @param side  'hit' = 命中；'dotBase' = DoT 基础值（③④ 全部置 0，只留 ①+② 的效果）
 *
 * ⚠ A-14 已确认为**口径 A**：元素加量 = 新面板总伤 × 该元素 Σ%（加到该类型上）。
 */
export function applyElements(
  base: DamageSpread,
  contribs: readonly Contribution[],
  side: Side = 'hit',
): ApplyElementsResult {
  const out: DamageSpread = {};

  // ── ③ 物理 %Mod：基数 = 该物理类型在**玄骸加成后的新面板**里的值（D-022 第二次修订）──
  //
  // 「统一建模逻辑」：物理与元素都基于玄骸加成后的新面板计算。
  // 于是玄骸若是**冲击**，它并入新面板的冲击里，自然享受 +冲击% Mod
  // （与 `乘区归属表.md` §4.4「冲击类型享受物理% Mod 增幅」一致）。
  //
  // ⚠ 物理加量**不进元素基数**：元素基数只取新面板总伤（见下），
  //   所以表 4.1 校验例 1（100 冲 + 100 切、+100% 冲、+100% 毒 → 毒 200）仍然成立。
  for (const t of PHYSICAL_TYPES) {
    const baseAmount: number = base[t] ?? 0;
    const m: number = side === 'hit' ? sumPct(contribs, `physical:${t}`) : 0;
    if (baseAmount !== 0 || m !== 0) out[t] = baseAmount * (1 + m);
  }

  // 元素 % 的基数 = 玄骸加成后的新面板总伤（**不含**物理 %Mod 的加量）。
  // A-14 口径 A + D-022：元素加量 = 新面板总伤 × 元素%。
  const tNew: number = spreadTotal(base);

  // ── ④ 元素 %Mod：基数 = 新面板总伤；同类型先加总成一个槽位（D-006）──
  const slots: ElementSlot[] = [];
  const byType: Map<DamageType, Contribution[]> = new Map();
  for (const t of BASE_ELEMENTAL_TYPES) {
    const group: Contribution[] = contributionsFor(contribs, `elemental:${t}`).filter((c) => c.form === 'pct');
    if (group.length) byType.set(t, group);
  }
  // 复合元素能不能由 Mod 直接给（如 磁力 Mod）：不参与配对，按独立槽位处理
  for (const t of COMPOUND_TYPES) {
    const group: Contribution[] = contributionsFor(contribs, `elemental:${t}`).filter((c) => c.form === 'pct');
    if (group.length) byType.set(t, group);
  }

  for (const entry of byType) {
    const t: DamageType = entry[0];
    const group: Contribution[] = entry[1];
    if (side !== 'hit') continue; // DoT 基础值剔除元素加量（6.2）
    let pctSum: number = 0;
    for (const c of group) pctSum += c.amount / 100;
    const amount: number = tNew * pctSum;
    let order: number = Number.MAX_SAFE_INTEGER;
    for (const c of group) order = Math.min(order, c.slot ?? Number.MAX_SAFE_INTEGER);
    const slot: ElementSlot = { type: t, amount, order, source: 'mod', fromMod: true };
    if (group[0]?.source !== undefined) slot.sourceId = group[0].source;
    slots.push(slot);
  }

  // ── ④b 面板自带的元素（含已被基伤放大的玄骸）→ 各占一个槽位，**排在 8 个 Mod 槽位之后** ──
  //
  // D-025（2026-11-05 需求方确认，依据 `乘区归属表.md` §4.3 / §4.4 原文）：
  //   「这些额外元素**视为位于 Mod 槽位 9、10、11、12 号**，按同一套逻辑参与合成」
  //   自带元素的内部优先级：**火焰 > 冰冻 > 电击 > 毒素**。
  //
  // ⚠ 之前这里把 order 取成 -1000（负值），导致自带元素抢在所有 Mod 槽位之前配对：
  //   玄骸火 + 冰Mod 时，玄骸火先跟冰配成爆炸，把玩家想配毒气的火 Mod 晾在一边。
  const PANEL_ELEMENT_PRIORITY: readonly DamageType[] = ['heat', 'cold', 'electric', 'toxin'];
  let panelOrder: number = 9; // 8 个 Mod 槽位是 0..7，自带元素从 9 开始
  for (const t of PANEL_ELEMENT_PRIORITY) {
    const amount: number = base[t] ?? 0;
    if (amount > 0) {
      slots.push({ type: t, amount, order: panelOrder, source: 'panel', fromMod: false });
      panelOrder++;
    }
  }
  // 面板上可能还存在复合元素（例如武器自带磁力），不参与配对，排最后
  for (const t of COMPOUND_TYPES) {
    const amount: number = base[t] ?? 0;
    if (amount > 0) {
      slots.push({ type: t, amount, order: panelOrder, source: 'panel', fromMod: false });
      panelOrder++;
    }
  }

  // ── ⑤ 两两合成 ──
  // 按 D-006 实现：已有的同类型元素**先合并成一个槽位**，再按槽位号从小到大两两配对。
  const { singles, compounds } = mergePairwise(slots);

  // ── ⑥ 汇总：单元素 + 复合元素（同类型相加）──
  for (const s of singles) out[s.type] = (out[s.type] ?? 0) + s.amount;
  for (const c of compounds) out[c.type] = (out[c.type] ?? 0) + c.amount;

  return { v: out, slots, compounds, singles };
}

/**
 * §5.3 `mergePairwise`：两两配对；**复合元素不参与配对**。
 *
 * 关键规则（D-006 已确认「同类型先加总再合成」）：
 *   1. 同类型的槽位（面板自带火 + 火Mod）**先合并成一个槽位**，再参与配对；
 *   2. 两个基础元素按配对表合成复合元素，合成物**不再参与配对**（表 4.3）；
 *   3. 配不上的留作单元素。
 *
 * ⚠ 与文档 §5.3 伪代码的差异（`docs/decisions.md` D-023）：原伪代码"取出 a → 找能配对的 b"
 *   会因 `pairOf(火,火) = null` 而让面板火与火Mod 各自落单，得不到 §5.4 与 D-006 确认的「毒气 370」。
 *   这里按确认结论实现：同类型先合并，再两两配对。
 */
export function mergePairwise(slots: readonly ElementSlot[]): {
  singles: ElementSlot[];
  compounds: ElementSlot[];
} {
  // 1. 同类型先合并（稳定：顺序按 order 升序）
  const sorted: ElementSlot[] = slots.slice().sort((a, b) => a.order - b.order);
  const grouped: ElementSlot[] = [];
  for (const s of sorted) {
    let hit: ElementSlot | undefined;
    for (const g of grouped) {
      if (g.type === s.type) {
        hit = g;
        break;
      }
    }
    if (!hit) {
      grouped.push({ ...s });
      continue;
    }
    hit.amount += s.amount;
    hit.order = Math.min(hit.order, s.order);
    if (s.fromMod) {
      hit.fromMod = true;
      hit.source = 'mod';
      if (hit.sourceId === undefined && s.sourceId !== undefined) hit.sourceId = s.sourceId;
    }
  }

  // 2. 按 order 两两配对
  const queue: ElementSlot[] = grouped.sort((a, b) => a.order - b.order);
  const singles: ElementSlot[] = [];
  const compounds: ElementSlot[] = [];
  while (queue.length) {
    const a: ElementSlot = queue.shift()!;
    if (isCompound(a.type)) {
      compounds.push(a);
      continue;
    }
    let idx: number = -1;
    for (let i = 0; i < queue.length; i++) {
      const s = queue[i]!;
      if (isCompound(s.type)) continue;
      if (s.type === a.type) continue; // 同类型已在第 1 步合并，不会走到这里
      if (pairOf(a.type, s.type) !== null) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      singles.push(a);
      continue;
    }
    const b: ElementSlot = queue.splice(idx, 1)[0]!;
    const merged: ElementSlot = {
      type: pairOf(a.type, b.type)!,
      amount: a.amount + b.amount,
      order: Math.min(a.order, b.order),
      source: a.fromMod || b.fromMod ? 'mod' : 'panel',
      fromMod: a.fromMod || b.fromMod,
    };
    const sourceId = a.sourceId ?? b.sourceId;
    if (sourceId !== undefined) merged.sourceId = sourceId;
    compounds.push(merged);
  }
  return { singles: singles, compounds: compounds };
}

/** 便捷：只取合成后的命中分布（`applyElements(..., 'hit').v`） */
export function hitSpread(base: DamageSpread, contribs: readonly Contribution[]): DamageSpread {
  return applyElements(base, contribs, 'hit').v;
}

/** 便捷：只取 DoT 基础值的分布（`applyElements(..., 'dotBase').v`） */
export function dotBaseSpread(base: DamageSpread, contribs: readonly Contribution[]): DamageSpread {
  return applyElements(base, contribs, 'dotBase').v;
}

/**
 * 把两个伤害分布逐类型相加（**不取整**）。
 * 汇总"全部段 / 按变体"时用，`compute()` 与 `spreadByVariant` 共用这一份实现。
 */
export function addSpread(into: DamageSpread, from: DamageSpread): DamageSpread {
  for (const [k, v] of Object.entries(from) as [DamageType, number][]) {
    into[k] = (into[k] ?? 0) + (v ?? 0);
  }
  return into;
}

/** 分布 × 标量（元素加量剔除外用；原 `scaleSpread` 的语义别名，保持单一来源） */
export function scale(spread: DamageSpread, k: number): DamageSpread {
  return scaleSpread(spread, k);
}
