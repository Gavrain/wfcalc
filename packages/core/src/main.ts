/**
 * 结算链主函数 —— 严格按 `docs/伤害公式.md` 的 §4 ~ §9 实现。
 *
 * 执行顺序（**玄骸在基伤之前**，D-017）：
 * ```
 * L0 面板切段           buildVectors
 * ① 玄骸加成            applyKuvaBonus        ← 在基伤之前
 * ② 基伤 / 多重         applyBaseDamage / multishot
 * ③④ 物理% / 元素%      applyElements
 * ⑤ 两两合成            mergePairwise
 * L3 暴击 + 爆头        critChanceTotal / critDamageTotal / damageLine
 * L4 触发与 DoT         totalProcChance / stacksPerShot / dotTick
 * L5 目标结算           **本版暂缓**（D-014），只到"命中伤害层"
 * L6 输出口径           fireRateFinal / 各 DPS
 * ```
 *
 * 全部纯函数、无随机数、无隐式取整（表 2.4）；浮点只在展示层四舍五入。
 * 每个入口都返回 `detail`，记录"哪条贡献、落在哪个乘区、贡献了多少"。
 */
import type { DamageSpread, DamageType } from './damage-types.ts';
import {
  BASE_ELEMENTAL_TYPES,
  COMPOUND_TYPES,
  PHYSICAL_TYPES,
  isCompound,
  isPhysical,
  scaleSpread,
  spreadTotal,
} from './damage-types.ts';
import type { AttackMode, DamageSegment, Weapon } from './weapon.ts';
import { allSegments, firstSegment, panelStats } from './weapon.ts';
import type { Contribution, Faction } from './contributions.ts';
import { contributionsFor, productMul, sumFlat, sumPct } from './contributions.ts';
import { bucket, bucketDetail } from './buckets.ts';
import type { WeaponState } from './weapon-state.ts';
import { buildWeaponState, overForStacks } from './weapon-state.ts';

// ─────────────────────────────────────────────────────────────
// 上下文
// ─────────────────────────────────────────────────────────────

/** 派系定义在 `contributions.ts`（`ContribStat` 的 `faction:*` 分支要用），此处原样转出 */
export type { Faction };

export interface HeadshotOptions {
  /** 爆头开关（D-008 / D-020）：不勾选时整项不存在 */
  enabled: boolean;
  /** 敌人配置的爆头倍率，默认 3.0 */
  multiplier: number;
}

export interface CtxOptions {
  /** 玄骸元素与加成比例（25%~60%）。D-017：在基伤之前并入面板 */
  kuva?: { type: DamageType; ratio: number };
  /** 派系加成只对目标派系生效（D-013）；'none' 表示不计派系 */
  faction?: Faction;
  headshot?: HeadshotOptions;
  /**
   * 镀层类：实际生效的叠层数 `y`（A-03 / D-024：击杀后获得的 buff 层数，
   * UI 下拉框默认取 Mod 描述的 maxStacks）。
   */
  coStacks?: number;
  /** 镀层类：目标身上的异常状态**种类数** `a`（A-03 / D-024，默认 0 = 镀层不生效） */
  coStatusTypes?: number;
}

export interface Ctx {
  weapon: Weapon;
  mode: AttackMode;
  /** 全部贡献（Mod / 赋能 / 自定义），已摊成同一张表 */
  contribs: readonly Contribution[];
  options: CtxOptions;
  /** 射线标记（D-010：人工表，未确认前一律按非射线算） */
  beam: boolean;
  headshot: HeadshotOptions;
  faction: Faction;
  /** 镀层类叠层数 y */
  coStacks: number;
  /** 镀层类：目标异常状态种类数 a */
  coStatusTypes: number;
}

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

// ─────────────────────────────────────────────────────────────
// L0：面板切段
// ─────────────────────────────────────────────────────────────

/**
 * §4：一个模式里的每个 segment 都是一个独立向量；单弹头不乘多重，
 * 多重统一在 L6 乘（射线例外，见 §2.2）。
 */
export function buildVectors(mode: AttackMode): DamageSpread[] {
  return allSegments(mode).map((seg) => ({ ...seg.damage }));
}

// ─────────────────────────────────────────────────────────────
// ① 玄骸加成（L2 前置，D-017）
// ─────────────────────────────────────────────────────────────

/**
 * §5.1：玄骸那一份与面板基伤同等待遇 —— **吃基伤加成**（由后续 `applyBaseDamage` 放大），
 * 不吃灵化基伤那一路。冲击型与面板冲击合并（表 4.4）。
 *
 * `玄骸加量 = 面板总伤 × 比例`；随后基伤 `(1+G)` 一起作用。
 */
export function applyKuvaBonus(panel: DamageSpread, kuva: Ctx['options']['kuva']): DamageSpread {
  if (!kuva) return { ...panel };
  const augment = spreadTotal(panel) * kuva.ratio;
  const out: DamageSpread = { ...panel };
  out[kuva.type] = (out[kuva.type] ?? 0) + augment;
  return out;
}

// ─────────────────────────────────────────────────────────────
// ② 基伤
// ─────────────────────────────────────────────────────────────

/**
 * 镀层类伤害乘区（A-03 已定案，见 `docs/decisions.md` D-024）。
 *
 * 实现已移到 `weapon-state.ts`（`基伤面板` 这个 computed 要用它，
 * 放这里会形成 main ↔ weapon-state 的循环依赖），此处原样转出以保持导出面不变。
 */
export { overForStacks } from './weapon-state.ts';

/**
 * §5.2：基伤双基本值。
 *
 * ```
 * 基伤项 = 面板基伤 × (1 + Σ基伤Mod% + 镀层%) + 灵化基伤 × (1 + Σ基伤Mod%)
 * ```
 * · 镀层类（`co`）不吃灵化基伤、不吃 AoE；
 * · 玄骸那一份已经在 `applyKuvaBonus` 并入面板，所以**天然被放大**（D-017）。
 */
export function applyBaseDamage(
  panelWithKuva: DamageSpread,
  seg: Pick<DamageSegment, 'kind'>,
  contribs: readonly Contribution[],
  coStacks = 0,
  statusTypes = 0,
): DamageSpread {
  const g: number = 1 + sumPct(contribs, 'baseDamage');
  const isAoe: boolean = seg.kind === 'explosiveAttack';
  const k: number = isAoe ? g : g + overForStacks(contribs, coStacks, statusTypes);
  return scaleSpread(panelWithKuva, k);
}

/**
 * §2.2：多重独立乘区，与基伤相乘、绝不相加。
 *
 * ```
 * 当前多重 = 面板多重 × (1 + Σ多重%Mod) + Σ多重绝对值
 * ```
 *
 * ⚠ **面板多重不能写死成 1**：57 把武器自带多重（Twin Rogga 15、Brakk / Tenet Detron /
 * Drakgoon 10、Boar 8…），霰弹枪尤其明显。之前这里从常量 `1` 起算，
 * 等于把这些武器的面板多重整个丢掉（Twin Rogga 单次射击少了 15 倍）。
 * 面板值经 `panelStats(weapon, mode)` 取（D-050：模式 override 优先）。
 *
 * @param weapon 武器（取面板多重）；不传时退化为"无面板多重"（仅用于旧调用点）
 * @param mode   攻击模式（面板多重在模式上）
 */
export function multishot(
  contribs: readonly Contribution[],
  weapon?: Weapon,
  mode?: AttackMode,
): number {
  const panel = weapon && mode ? panelStats(weapon, mode).multishot : (weapon?.modes[0]?.multishot ?? 1);
  return bucket(panel, 'multishot', contribs);
}

// ─────────────────────────────────────────────────────────────
// ③④⑤⑥ 元素 / 物理加量 + 两两合成
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// L3：暴击与爆头
// ─────────────────────────────────────────────────────────────

/**
 * §3.1 / 表 2.0：暴率 = (面板 × (1+Σ暴率%) + 固定加算) × Πmul
 *
 * 面板取**该模式**的值（D-050）：模式有 override 时用它，否则回退武器级。
 */
export function critChanceTotal(weapon: Weapon, contribs: readonly Contribution[], mode?: AttackMode): number {
  const panel = mode ? panelStats(weapon, mode).critChance : weapon.critChance;
  return bucket(panel, 'critChance', contribs);
}

/**
 * §3.1：总爆伤 = (面板暴伤 × (1+Σ暴伤%) + 固定加算) × Πmul
 *
 * 同上，面板取该模式的值（D-050）。
 */
export function critDamageTotal(weapon: Weapon, contribs: readonly Contribution[], mode?: AttackMode): number {
  const panel = mode ? panelStats(weapon, mode).critMultiplier : weapon.critMultiplier;
  return bucket(panel, 'critMultiplier', contribs);
}

/** §3.1：平均伤害倍率 = cc(cd−1)+1 */
export function critAverage(v: number, cc: number, cd: number): number {
  return (cc * (cd - 1) + 1) * v;
}

export interface CritTier {
  k: number;
  prob: number;
  mul: number;
}

/** §3.1：上下限分档（暴率 150% → k=1，50% 概率 2 档、50% 概率 3 档） */
export function critTiers(cc: number, cd: number): CritTier[] {
  const k = Math.floor(cc);
  const f = cc - k;
  return [
    { k, prob: 1 - f, mul: 1 + k * (cd - 1) },
    { k: k + 1, prob: f, mul: 1 + (k + 1) * (cd - 1) },
  ];
}

/**
 * §3.2 / D-012 / D-020：爆头倍率 = 敌人配置的爆头倍率 × (1 + Σ爆头Mod%)。
 * **爆头是开关**：不勾选时整项不存在。
 */
export function headshotMultiplier(contribs: readonly Contribution[], base: number): number {
  return base * (1 + sumPct(contribs, 'headshotDamage'));
}

export interface DamageLine {
  /** 不暴击行 */
  nonCrit: number;
  /** 暴击行 */
  crit: number;
  /** 期望平均 */
  average: number;
  /** 本行实际使用的爆头倍率（未勾选爆头时为 1） */
  headshotMul: number;
}

/**
 * §3.2：命中伤害的分行。
 *
 * D-020：**只有「爆头 ∧ 暴击」才 ×2**；未暴击不乘、未开爆头整项不存在；与暴击分档线无关。
 * ```
 * 平均 = (1−cc)·base + cc·base·cd·(hitHead ? 2 : 1)
 * ```
 */
export function damageLine(v: number, cc: number, cd: number, hitHead: boolean, headshotMul: number): DamageLine {
  const base = hitHead ? v * headshotMul : v;
  const crit = base * cd * (hitHead ? 2 : 1);
  return {
    nonCrit: base,
    crit,
    average: (1 - cc) * base + cc * crit,
    headshotMul: hitHead ? headshotMul : 1,
  };
}

// ─────────────────────────────────────────────────────────────
// L4：触发与 DoT
// ─────────────────────────────────────────────────────────────

/** 表 6.2 的 DoT 系数 */
export const DOT_COEF: Readonly<Record<string, number>> = {
  heat: 0.5,
  toxin: 0.5,
  electric: 0.5,
  gas: 0.5,
  slash: 0.35,
};

export const DOT_TYPES = ['heat', 'toxin', 'electric', 'gas', 'slash'];
export type DoTType = (typeof DOT_TYPES)[number];

export const DOT_DURATION: Readonly<Record<DoTType, number>> = {
  heat: 6,
  toxin: 6,
  electric: 6,
  gas: 6,
  slash: 6,
};

// ─────────────────────────────────────────────────────────────
// 爆炸（Blast）异常：独立机制（D-031）
// ─────────────────────────────────────────────────────────────

/** 爆炸异常的常驻参数（D-031 需求方给出） */
export const BLAST = {
  /** 延迟结算：1.5 秒 */
  delaySeconds: 1.5,
  /** 最大层数（一般 10 层；有些敌人有特殊上限，如 4 层） */
  maxStacks: 10,
  /** 每层系数：0.3 × 基础伤害 */
  perStackCoef: 0.3,
  /** 满层/击杀后对周围敌人的每层系数：3.0 × 基础伤害 */
  detonateCoef: 3.0,
  /** 范围半径（米），不受武器爆炸范围 Mod 影响 */
  radiusMeters: 5,
} as const;

export interface BlastDetail {
  /** 每层伤害（0.3 × 基础 × 派系 × 暴击伤害 × 异常伤害 × 伤害弱点） */
  perStack: number;
  /** 每秒期望能结算的层数 */
  stacksPerSecond: number;
  /** 每秒叠层是否能在 1.5 秒内达到满层 */
  reachesMaxInWindow: boolean;
  /** 达到满层的耗时（秒），达不到则 null */
  timeToMaxSeconds: number | null;
  /** 对**主目标**的每秒秒伤（未满层时按实际层数均摊到 1 秒） */
  perSecond: number;
  /** 满层触发后每层伤害（**系数 0.3 → 3**，D-031 修订） */
  perStackDetonated: number;
  /** 对**周围敌人**的范围伤害每秒（系数 3，非主目标） */
  splashPerSecond: number;
  /** 是否已触发范围伤害（满层或击杀） */
  splashActive: boolean;
  /** 对主目标 6 秒合计 */
  total6s: number;
  /** 范围伤害 6 秒合计 */
  splash6s: number;
}

/**
 * 爆炸异常（D-031）。
 *
 * 规则：
 * ```
 * 每层伤害 = 基础伤害 × 系数 × (1+派系Mod) × 暴击伤害 × 异常状态伤害 × 伤害弱点（乘法叠加）
 *   系数：对主目标 0.3；**满层/击杀后对周围敌人 → 3**（D-031 修订：不是"再乘 3 倍"，是系数本身换成 3）
 * 结算时机 = min(1.5 秒延迟, 叠满 maxStacks, 目标死亡)
 * 范围 5 米，不受武器爆炸范围 Mod 影响；不需要周围目标数量
 * ```
 *
 * 与通用 DoT 的区别：
 *   · 有**层数上限**（其他 DoT 没有上限）；
 *   · 有**延迟结算**与**满层触发的系数跃升**；
 *   · 满层后对周围敌人按系数 3 结算，范围伤害**单列**展示。
 */
export function blastDetail(
  baseValue: number,
  stacksPerSecond: number,
  opts: { factionPct: number; statusDamagePct: number; critDamageMul: number; headshotMul: number },
): BlastDetail {
  const multiplier =
    (1 + opts.factionPct) * opts.critDamageMul * (1 + opts.statusDamagePct) * opts.headshotMul;

  // 系数：0.3（普通）/ 3（满层或击杀后，对周围敌人）
  const perStack = baseValue * BLAST.perStackCoef * multiplier;
  const perStackDetonated = baseValue * BLAST.detonateCoef * multiplier;

  const secondsToMax = stacksPerSecond > 0 ? BLAST.maxStacks / stacksPerSecond : Infinity;
  const reachesMax = secondsToMax <= BLAST.delaySeconds;
  const timeToMaxSeconds = reachesMax ? secondsToMax : null;

  // 对主目标：1.5 秒窗口结束时的层数均摊到 1 秒
  const effectiveStacks = reachesMax ? BLAST.maxStacks : stacksPerSecond * BLAST.delaySeconds;
  const perSecond = perStack * effectiveStacks;

  // 对周围敌人（非主目标）：只有满层/击杀才触发，每秒按系数 3 × 层数
  const splashActive = reachesMax && stacksPerSecond > 0;
  const splashPerSecond = splashActive ? perStackDetonated * BLAST.maxStacks : 0;

  return {
    perStack,
    stacksPerSecond,
    reachesMaxInWindow: reachesMax,
    timeToMaxSeconds,
    perSecond,
    perStackDetonated,
    splashPerSecond,
    splashActive,
    total6s: perSecond * 6,
    splash6s: splashPerSecond * 6,
  };
}

/**
 * §0.3 ①：单弹头总触发率。
 * 射线额外 ×(1+Σ多重%)（表 2.3）—— `beam` 来自人工表，未确认前按非射线算（D-010）。
 */
export function totalProcChance(procChance: number, contribs: readonly Contribution[], beam: boolean): number {
  const m = 1 + sumPct(contribs, 'statusChance');
  return beam ? procChance * m * (1 + sumPct(contribs, 'multishot')) : procChance * m;
}

/** §0.3 ②：某元素在触发池里的份额 */
export function share(t: DamageType, v: DamageSpread): number {
  const total = spreadTotal(v);
  return total > 0 ? (v[t] ?? 0) / total : 0;
}

/**
 * §0.3 ③④：单次射击某元素的期望层数 = 总触发率 × 元素占比 × 多重。
 * 射线**不重复乘多重**（多重已并进触发率）。
 *
 * @param multishotValue 当前多重（含面板多重）。不传则按「有面板多重的武器」处理时
 *   必须显式传入——见 {@link multishot}
 */
export function stacksPerShot(
  t: DamageType,
  v: DamageSpread,
  procChance: number,
  contribs: readonly Contribution[],
  beam: boolean,
  multishotValue?: number,
): number {
  const ms = multishotValue ?? multishot(contribs);
  return totalProcChance(procChance, contribs, beam) * share(t, v) * (beam ? 1 : ms);
}

export interface DotTickDetail {
  type: DoTType;
  /** ① 基础值（= dotBase 全类型之和，见 §6.2） */
  baseValue: number;
  /** 该元素自己在 dotBase 里的那一份（仅用于展示，不参与计算） */
  ownTypeValue: number;
  /** ② = ① × 系数 */
  baseTick: number;
  /** ③ 该类型元素 %（6.3：毒气只吃毒气） */
  elementPct: number;
  /** 6.3 异常状态伤害 % */
  statusDamagePct: number;
  /** ③ 派系第二次 */
  factionPct: number;
  /** D-008 每跳的爆头开关倍率 */
  headshotMul: number;
  /** 每跳最终值 */
  tick: number;
}

/**
 * §7 `dotTick`：DoT 每跳伤害（6.2 完整链）。
 *
 * ```
 * ① 基础值 dotBase[t]（含玄骸 + 基伤 + 多重 + 暴击，**不含**元素/物理 Mod 加量）
 * ② × 系数
 * ③ × (1 + 该类型元素%) × (1 + 异常状态伤害%) × (1 + 派系%)   ← 派系第二次（D-013）
 * ④ × 爆头开关（D-008：不进①，避免被派系二次放大）
 * ```
 */
/**
 * §6.2 `dotTick`：DoT 每跳伤害（完整链）。
 *
 * ```
 * ① 触发时的"基础命中伤" = 命中伤害中【剔除元素/物理 Mod 加量】后的值
 *      · 保留：基伤%、多重%、暴击；计入：**全部伤害类型（物理 + 元素）**
 * ② 基础触发值 = ① × 该元素系数
 * ③ 每跳伤害 = ② × (1 + Σ该类型元素Mod%) × (1 + Σ异常状态伤害%) × (1 + Σ派系%) × 爆头开关
 * ```
 *
 * ⚠ **① 取的是所有类型之和，不是该类型自己的那一份**（文档 §6.2 原文：
 *   「计入：全部伤害类型（物理 + 元素）」）。
 *   之前错误地取了 `dotBase[t]`，导致：
 *     · 毒气完全由 Mod 合成、`dotBase` 里没有毒气这一项 → 每跳恒为 0；
 *     · 火焰/毒素等也只按自己那部分计，数值偏低。
 */
export function dotTick(
  dotBase: DamageSpread,
  t: DoTType,
  contribs: readonly Contribution[],
  opts: { factionPct: number; headshot?: HeadshotOptions; headshotMul: number },
): DotTickDetail {
  // ① 基础命中伤（已含暴击 / 爆头 / 爆头暴击，见 resolveSegment 的 dotBase）
  const baseValue = spreadTotal(dotBase);
  // ② 该元素自己的那一份，仅用于展示/排查；不参与数值
  const ownTypeValue = dotBase[t] ?? 0;
  const baseTick = baseValue * (DOT_COEF[t] ?? 0);
  const elementPct = sumPct(contribs, `elemental:${t}`);
  const statusDamagePct = sumPct(contribs, 'statusDamage');
  // ── D-062：DoT 每跳**只**额外吃「元素类型 %」与「异常状态伤害 %」，再加派系 ──
  // 基础值里已经包含暴击、爆头、爆头暴击、基伤、多重 → 这里**不再**乘爆头。
  // （射速与多重影响的是"叠几层"，不是"每跳多少伤害"。）
  const tick = baseTick * (1 + elementPct) * (1 + statusDamagePct) * (1 + opts.factionPct);
  return {
    type: t,
    baseValue,
    ownTypeValue,
    baseTick,
    elementPct,
    statusDamagePct,
    factionPct: opts.factionPct,
    headshotMul: 1, // 已并进基础值，此处恒为 1（保留字段供界面显示）
    tick,
  };
}

// ─────────────────────────────────────────────────────────────
// 派系乘区（D-013：命中结算前乘一次、DoT 每跳再乘一次）
// ─────────────────────────────────────────────────────────────

const FACTION_STATS: Readonly<Record<Exclude<Faction, 'none'>, `faction:${Faction}`>> = {
  grineer: 'faction:grineer',
  corpus: 'faction:corpus',
  infested: 'faction:infested',
  orokin: 'faction:orokin',
  murmur: 'faction:murmur',
};

export function factionFor(faction: Faction, contribs: readonly Contribution[]): number {
  if (faction === 'none') return 0;
  return sumPct(contribs, FACTION_STATS[faction]);
}

// ─────────────────────────────────────────────────────────────
// 输入构造
// ─────────────────────────────────────────────────────────────

export function buildContext(
  weapon: Weapon,
  mode: AttackMode,
  contribs: readonly Contribution[],
  options: CtxOptions = {},
  beam = false,
): Ctx {
  const headshot: HeadshotOptions = options.headshot ?? { enabled: false, multiplier: 3.0 };
  return {
    weapon,
    mode,
    contribs,
    options,
    beam,
    headshot,
    faction: options.faction ?? 'none',
    coStacks: options.coStacks ?? 0,
    coStatusTypes: options.coStatusTypes ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────
// 完整单段结算
// ─────────────────────────────────────────────────────────────

export interface SegmentResult {
  kind: DamageSegment['kind'] | string;
  /** L0 面板向量 */
  panel: DamageSpread;
  /** ① 玄骸并入后的面板 */
  panelWithKuva: DamageSpread;
  /** ② 基伤放大后 */
  baseAfterBaseDamage: DamageSpread;
  /** ③④⑤⑥ 合成后的最终分布（hit 侧） */
  finalHit: DamageSpread;
  /** 物理/元素 = 合成前的槽位 */
  elementDetail: ApplyElementsResult;
  /** DoT 基础值的分布（= side 'dotBase'，只剔加量） */
  dotBase: DamageSpread;
  /** 暴率 / 暴伤（已含 Mod） */
  critChance: number;
  critDamage: number;
  /** 单个弹头（未乘多重 / 未乘暴击） */
  singlePelletSpread: DamageSpread;
  /** 命中伤害三行（单弹头，已乘暴击与爆头） */
  line: DamageLine;
  /** DoT 每跳明细 */
  dotTicks: DotTickDetail[];
}

/**
 * 结算一个伤害段。**不作任何取整**，浮点原样返回，展示层再格式化。
 *
 * 注意：这里的"命中伤害"是**单弹头**口径；单次射击要再乘 `multishot()`（L6 / 表 0.1）。
 *
 * @param upstream 上游已算好的 `新面板` / `基伤面板`（D-075 的 computed）。
 *   传了就直接用，**不再重复走玄骸与基伤**；不传则自己算（独立调用 `resolveSegment` 时用）。
 *   这样 `compute()` 里 state 与逐段结算共用同一份中间结果，不会出现两份数字对不上的情况。
 */
export function resolveSegment(
  ctx: Ctx,
  seg: DamageSegment,
  upstream?: { 新面板: DamageSpread; 基伤面板: DamageSpread },
): SegmentResult {
  const { weapon, contribs } = ctx;
  const panel: DamageSpread = { ...seg.damage };

  // ① 玄骸（在基伤之前，D-017）
  // ② 基伤
  //   上游给过就直接取 computed，避免重复计算（数值同一份）
  const panelWithKuva: DamageSpread = upstream ? upstream.新面板 : applyKuvaBonus(panel, ctx.options.kuva);
  const baseAfterBaseDamage: DamageSpread = upstream
    ? upstream.基伤面板
    : applyBaseDamage(panelWithKuva, seg, contribs, ctx.coStacks, ctx.coStatusTypes);

  // ③④⑤⑥ 元素 / 物理加量
  const elementDetail: ApplyElementsResult = applyElements(baseAfterBaseDamage, contribs, 'hit');
  const finalHit: DamageSpread = elementDetail.v;

  // DoT 基础值（§6.2 ①）：剔除元素/物理加量，面板自带元素保留。
  // ⚠ **必须含暴击**——文档原文「保留基伤%、多重%、暴击」「该值【享受暴击】」。
  //   之前这里只取了 `baseAfterBaseDamage`（暴击之前的值），导致暴击类 Mod
  //   对 DoT 完全没有增益（暴率/暴伤怎么调 DoT 都不变）。
  const dotBaseRaw: DamageSpread = applyElements(baseAfterBaseDamage, contribs, 'dotBase').v;

  // L3 暴击 + 爆头
  const cc = critChanceTotal(weapon, contribs, ctx.mode);
  const cd = critDamageTotal(weapon, contribs, ctx.mode);
  const hsMul = headshotMultiplier(contribs, ctx.headshot.multiplier);
  const vTotal = spreadTotal(finalHit);
  const line: DamageLine = damageLine(vTotal, cc, cd, ctx.headshot.enabled, hsMul);

  // ── D-062 / D-063：DoT 基础值 = 命中基础值 × **单弹头期望倍率** ──
  // 需求方口径：
  //   「爆头影响基础值计算。爆头暴击也是对基础值生效，dot 部分都应该以基础值为准。
  //     参考暴击，dot 部分会额外生效的只有派系伤害和元素异常状态伤害这两种词条，
  //     射速和多重影响的是叠层。」
  //   「爆头倍率为 3 的时候如果没暴击，就还是三倍的爆头倍率。爆头暴击这个两倍
  //     只在又暴击又开启了爆头时产生，如果有未暴击白字需要加权计算。」
  //
  // 所以直接用 `damageLine` 的**期望倍率**，而不是把 ×2 恒定乘上去：
  //   非爆头：`(1−cc)·1 + cc·cd`
  //   爆头：  `(1−cc)·hsM + cc·hsM·cd·2`     ← ×2 只作用于**暴击那一支**
  // 展开后即 `1 + cc(cd−1)`（非爆头）或 `hsM·(1 + cc(2cd−1))`（爆头）。
  const dotBase: DamageSpread = scaleSpread(dotBaseRaw, expectedHitMultiplier(cc, cd, ctx.headshot.enabled, hsMul));

  // 单弹头分布（供"加成后面板"与触发占比展示）：元素加量已含，暴击单列
  const singlePelletSpread: DamageSpread = finalHit;

  // 派系（D-013：命中结算前一次）
  const factionPct = factionFor(ctx.faction, contribs);

  const dotTicks: DotTickDetail[] = DOT_TYPES.map((t) =>
    dotTick(dotBase, t, contribs, { factionPct, headshot: ctx.headshot, headshotMul: hsMul }),
  );

  return {
    kind: seg.kind,
    panel,
    panelWithKuva,
    baseAfterBaseDamage,
    finalHit,
    elementDetail,
    dotBase,
    critChance: cc,
    critDamage: cd,
    singlePelletSpread,
    line,
    dotTicks,
  };
}

// ─────────────────────────────────────────────────────────────
// L6：输出口径（表 0.1 / 0.2 / 9 节）
// ─────────────────────────────────────────────────────────────

/** 输出口径 id（可比较 / 可作为备选区增幅基准的一类伤害量） */
export type OutputId = 'pelletPerHit' | 'perShot' | 'hitDps' | 'sustainedDps' | 'dotPerSecond' | 'dot6s';

export interface OutputLine {
  id: OutputId;
  label: string;
  description: string;
  /** 数值单位（如 `/弹头`、`/发`、`/秒`），空串表示无单位 */
  unit: string;
  /** 该口径下的伤害数值 */
  value: number;
}

/** 备选区可选的"增幅比较口径"（demo 的单选按钮） */
export const OUTPUT_IDS: readonly OutputId[] = [
  'pelletPerHit', // 单弹头
  'perShot', // 单次射击
  'hitDps', // 爆发伤害
  'sustainedDps', // 持续伤害
  'dotPerSecond', // DoT 每层秒伤
  'dot6s', // DoT 六秒总伤
];

/**
 * D-055：该 DoT 类型对应的元素**是否真的出现在命中分布里**。
 *
 * 触发池只由「命中伤害里实际存在的伤害类型」构成（§0.3），
 * 没有的元素永远叠不出层。而 `dotTick` 的 ① 基础值取的是**全类型之和**，
 * 所以必须单独判断，否则毒/火/电这些没配的元素也会算出「每层秒伤」。
 */
export function hasDotElement(spread: DamageSpread, t: DoTType): boolean {
  return (spread[t] ?? 0) > 0;
}

/**
 * 开火时间线（D-058 / **D-067 改为毫秒精度**）：某个时刻是否在开火。
 *
 * ```
 * 一个循环 = 打空弹匣（mag ÷ 射速 秒）+ 装填（reload 秒）
 * 若 mag ÷ 射速 ≥ 窗口长度 → 全程开火，永不装填
 * 装填期 = [fireDur, cycle)  —— 期间不叠层
 * ```
 *
 * ⚠ 原来的实现用**整秒**判定（看该秒中点落在哪一段），导致开火秒数是阶梯函数：
 *   射速 16.92 → 开火 4 秒，射速 25.08 → 开火 5 秒，射速 30.33 → 又掉回 4 秒，
 *   于是"加射速反而降低总伤"。改成按**真实时间**判定后就单调了。
 *
 * @param t 时刻（秒）
 */
export function isFiringAt(mag: number, fr: number, reload: number, t: number): boolean {
  if (!(mag > 0) || !(fr > 0)) return true; // 数据缺失时按全程开火
  const fireDur = mag / fr;
  const cycle = fireDur + Math.max(0, reload);
  if (cycle <= 0) return true;
  return t % cycle < fireDur;
}

/** 毫秒精度：1 秒切成 1000 份（D-067） */
const MS_PER_SECOND = 1000;

/**
 * 第 sec 秒（覆盖 `[sec-1, sec)`）的**开火时长占比** ∈ [0, 1]（D-067）。
 *
 * 用毫秒精度积分实际开火区间，而不是整秒开关 —— 这样射速提升会**单调**增加叠层。
 */
export function firingFraction(mag: number, fr: number, reload: number, sec: number): number {
  if (!(mag > 0) || !(fr > 0)) return 1;
  const fireDur = mag / fr;
  const cycle = fireDur + Math.max(0, reload);
  if (fireDur >= cycle || cycle <= 0) return 1; // 永不装填

  let fired = 0;
  const t0 = sec - 1;
  for (let ms = 0; ms < MS_PER_SECOND; ms++) {
    const t = t0 + ms / MS_PER_SECOND;
    if (t % cycle < fireDur) fired++;
  }
  return fired / MS_PER_SECOND;
}

/**
 * 兼容旧签名（D-058）：第 sec 秒是否**整秒都在开火**。
 * 新代码请用 {@link firingFraction}（毫秒精度的占比，D-067）。
 */
export function buildFiringTimeline(mag: number, fr: number, reload: number, window = 6): (sec: number) => boolean {
  if (!(mag > 0) || !(fr > 0)) return () => true;
  const fireDur = mag / fr;
  const cycle = fireDur + Math.max(0, reload);
  if (fireDur >= window || cycle <= 0) return () => true; // 6 秒内打不完，无需装填
  return (sec: number): boolean => {
    // 第 sec 秒覆盖 [sec-1, sec)
    const mid = sec - 0.5;
    return mid % cycle < fireDur;
  };
}

/**
 * **在 0 秒立即跳一拍**的 DoT 类型（D-059）。
 *
 * 电击与毒气在触发当下就结算一次，层数取"首发"（单发期望层数）。
 * 火焰每秒合并一跳、毒素/切割按各自节奏，都不在此列。
 */
export const IMMEDIATE_TICK: ReadonlySet<DoTType> = new Set<DoTType>(['electric', 'gas']);

/**
 * 取该类型的层数上限（`null` = 无上限）。
 * 单独抽出来，避免 `DOT_MAX_STACKS[t]` 在 t 越界时静默返回 undefined。
 */
function DOT_MAX_STOCKS_FIX(t: DoTType): number | null {
  const v = (DOT_MAX_STACKS as Record<string, number | null | undefined>)[t];
  return v === undefined ? null : v;
}

/**
 * 各 DoT 的**层数上限**（§6.3）。`null` = 无上限。
 * 毒气 10 层封顶；火/毒/电/切割均无上限。
 */
export const DOT_MAX_STACKS: Readonly<Record<DoTType, number | null>> = {
  heat: null,
  toxin: null,
  electric: null,
  gas: 10,
  slash: null,
};

/**
 * DoT 基础值的**期望倍率**（D-062 / D-063）。
 *
 * 与 §3.2 的 `damageLine` 同一支口径，只是直接给出倍率：
 *
 * ```
 * 非爆头： (1−cc)·1        + cc·cd
 * 爆头：   (1−cc)·hsM      + cc·hsM·cd·2      ← 那个 ×2 只作用于暴击支
 * ```
 *
 * 关键（需求方 D-063 原文）：
 *   「爆头倍率为 3 的时候如果没暴击，就还是三倍的爆头倍率。爆头暴击这个两倍
 *     只在又暴击又开启了爆头时产生，如果有未暴击白字需要加权计算。」
 * 所以 ×2 **不能**无条件乘上去，必须按暴击率加权。
 *
 * @param cc 暴击率
 * @param cd 爆击倍率
 * @param headshotEnabled 是否勾选爆头
 * @param hsMul 爆头倍率（默认 ×3，含 `+爆头伤害%` Mod）
 */
export function expectedHitMultiplier(
  cc: number,
  cd: number,
  headshotEnabled: boolean,
  hsMul: number,
): number {
  // ── D-064：按**暴击分档**加权，而不是简单的 (1−cc)/cc 两支 ──
  // 暴率可以 >100%（橙暴/红暴），此时 `1−cc` 会变成负数，白字支根本不存在。
  // 所以必须用 §3.1 的 `critTiers()`：k = floor(cc)、f = cc − k，
  // 分档倍率 = `1 + k(cd−1)`，k ≥ 1 都是"暴击"。
  if (cc <= 0) {
    // 完全不暴击：只有白字
    return headshotEnabled ? hsMul : 1;
  }

  const tiers = critTiers(cc, cd);
  let total = 0;
  for (const tier of tiers) {
    if (tier.prob <= 0) continue;
    // k ≥ 1 视为"暴击"（含 2 档、3 档…）
    const isCrit = tier.k >= 1;
    let mul = tier.mul;
    if (headshotEnabled) {
      mul = mul * hsMul;
      // D-020：爆头 ∧ 暴击 → 最终 ×2；只作用于真正暴击的档位
      if (isCrit) mul = mul * 2;
    }
    total += tier.prob * mul;
  }
  return total;
}

/**
 * 六秒异常状态总伤（§0.2 / §6.3）——**逐秒模拟曲线**。
 *
 * ```
 * 前提：持续射击中，从 t=0 开始按射速与触发期望逐秒叠层
 * 口径：第 t 秒的伤害 = 该秒在场层数 × 每层伤害
 * 六秒总伤 = Σ_{t=1..6} 该秒伤害
 * ```
 *
 * **火焰（§6.3「新出现的火焰异常状态会刷新已有的火焰异常状态持续时间
 * 并叠加灼烧的伤害量，即后续命中的基础值加入到火焰 DoT 的计算」）**：
 * - 火焰**每秒跳一次**，所以按**整数秒**把该秒内新叠的基础值加进去；
 * - 层数是**累加量**而不是"多重叠加"：第 t 秒的每跳 =
 *   `单层伤害 × 该秒结束时累计的层数`；
 * - 刷新持续时间 → 火焰在 6 秒窗口内不会自然结束（只要还在开火）。
 *
 * **装填空窗（D-058）**：如果 6 秒内打不满（弹匣 ÷ 射速 < 6），
 * 每个循环要空出对应的**装填时间**，期间**不叠层**、DoT 也不跳。
 *
 * @param stacksPerSecond 每秒叠层（已含触发率 × 元素占比 × 多重 × 射速）
 * @param perStackPerSecond 单层每秒伤害（= `tick.tick`）
 * @param window 窗口长度（秒，默认 6）
 * @param firing 每秒的开火占比（0~1，由弹匣/射速/装填推出），默认全程开火。
 *   兼容旧的布尔签名：`true` 视为 1、`false` 视为 0（见下方 `frac` 归一化）。
 * @param stacksPerShot 单发期望层数（D-059：电击/毒气第 0 拍用它）
 */
export function dotSixSecondCurve(
  t: DoTType,
  stacksPerSecond: number,
  perStackPerSecond: number,
  window = 6,
  firing?: (second: number) => boolean | number,
  stacksPerShot = 0,
): number {
  const cap = DOT_MAX_STOCKS_FIX(t);
  const isHeat = t === 'heat';
  // 火焰专用的"累计基础值层数"（单调累加，不清零）
  let heatAccum = 0;
  // 非火焰的当场层数（只增不减）
  let stacks = 0;
  let total = 0;

  // ── D-059：电击 / 毒气在 0 秒立即跳一拍，层数取"首发" ──
  // 这一拍额外计入六秒之外（故窗口内共 7 拍）。
  if (IMMEDIATE_TICK.has(t) && stacksPerShot > 0) {
    const firstTick = cap === null ? stacksPerShot : Math.min(stacksPerShot, cap);
    total += perStackPerSecond * firstTick;
    // 这一层已经跳过了，进入 t=1 时不要重复计入 → 记为已存在
    stacks = firstTick;
  }

  for (let sec = 1; sec <= window; sec++) {
    // D-067：开火占比（0~1，毫秒精度）。老调用方传布尔值也能用（true→1 / false→0）。
    const raw = firing ? (firing as (s: number) => boolean | number)(sec) : true;
    const frac = raw === true ? 1 : raw === false ? 0 : Math.max(0, Math.min(1, Number(raw) || 0));

    // 这一秒内新叠上的层，按开火占比折算
    const added = stacksPerSecond * frac;
    if (isHeat) {
      heatAccum += added;
    } else {
      stacks += added;
    }

    // ⚠ 装填期间**不叠层**，但**已有的 DoT 仍在跳伤害**（D-058）。
    // 只有"新增层"被暂停，已叠的层照常每秒结算。
    if (isHeat) {
      // 火焰按整数秒把这一秒叠加的基础值计入 → 每跳 = 单层 × 累计层数
      total += perStackPerSecond * heatAccum;
    } else if (stacks > 0) {
      const capped = cap === null ? stacks : Math.min(stacks, cap);
      total += perStackPerSecond * capped;
    }
  }
  return total;
}

/**
 * 兼容旧签名（D-057 引入）：供测试直接调用。
 * @deprecated 用 {@link dotSixSecondCurve}
 */
export function sixSecondTotal(
  t: DoTType,
  stacksPerSecond: number,
  perStackPerSecond: number,
  window = 6,
  firing?: (second: number) => boolean | number,
): number {
  return dotSixSecondCurve(t, stacksPerSecond, perStackPerSecond, window, firing);
}

/**
 * 射速最终值（表 0.1）：`(面板 × (1+Σ射速%) + Σflat) × Πmul`
 *
 * 面板取该模式的值（D-050）：蓄力/灵化模式的射速与普通射击不同。
 */
export function fireRateFinal(weapon: Weapon, contribs: readonly Contribution[], mode?: AttackMode): number {
  const panel = mode ? panelStats(weapon, mode).fireRate : weapon.fireRate;
  return bucket(panel, 'fireRate', contribs);
}

export interface OutputBreakdown {
  lines: OutputLine[];
  /** 单弹头命中（期望，含暴击） */
  pelletPerHit: number;
  multishot: number;
  /** 单次射击（期望） */
  perShot: number;
  fireRate: number;
  hitDps: number;
  sustainedDps: number;
  dotPerSecond: number;
  dot6s: number;
  /** 每个 DoT 类型的每秒输出（期望层数 × 每跳） */
  dotPerType: Partial<Record<DoTType, number>>;
  /** 每个 DoT 类型的每秒期望叠层 */
  stacksPerType: Partial<Record<DoTType, number>>;
  /** 爆炸异常明细（D-031），无爆炸元素时 stacksPerSecond = 0 */
  blast: BlastDetail;
}

/**
 * §9：把单段结算结果折算成五个输出口径。
 *
 * · 单弹头伤害 = 合成后总伤 × 暴击期望 × 爆头开关（实弹**不乘多重**）
 * · 单次射击   = 单弹头 × 多重
 * · 每秒命中   = 单次射击 × 射速（**不含装填**，即"持续开火时"的命中 DPS）
 * · 持续射击   = 单次 × 弹匣 / (弹匣/射速 + 装填)（口径 B，全文档唯一除法）
 * · DoT        = Σ 各类型（每秒叠层 × 每跳）
 */
export function buildOutput(weapon: Weapon, mode: AttackMode, contribs: readonly Contribution[], res: SegmentResult, ctx: Ctx): OutputBreakdown {
  // D-050：面板数值一律取**该模式**的（模式 override → 武器级回退）——多重同理，
  // 面板多重来自 `mode.multishot`，不能写死 1
  const ps = panelStats(weapon, mode);
  const ms = multishot(contribs, weapon, mode);
  const fr = fireRateFinal(weapon, contribs, mode);
  const pelletPerHit = res.line.average;
  const perShot = pelletPerHit * ms;
  const hitDps = perShot * fr;

  // 弹匣与装填：吃 Mod 加成（D-037）。
  //   · `magazine` 是**弹匣容量**的加法 %；
  //   · `reloadSpeed` 是**装填速度**的加法 %，装填**时间** = 面板时间 ÷ (1 + Σ装填速度%)。
  //   两者都直接影响"持续伤害"口径，所以它们不算纯功能类 Mod。
  //   面板值同样取该模式的（D-050）。
  const magBase: number = ps.magazineSize ?? 0;
  const mag: number = bucket(magBase, 'magazine', contribs);
  const reloadBase: number = ps.reloadTime ?? 0;
  const reloadSpeedMul: number = 1 + sumPct(contribs, 'reloadSpeed');
  const reload: number = reloadBase > 0 && reloadSpeedMul > 0 ? reloadBase / reloadSpeedMul : reloadBase;
  const sustained: number = mag > 0 && fr > 0 ? (perShot * mag) / (mag / fr + reload) : 0;

  const seg: DamageSegment = firstSegment(mode)!;
  const dotPerType: Partial<Record<DoTType, number>> = {};
  const stacksPerType: Partial<Record<DoTType, number>> = {};
  // 开火时间线（D-058 / D-067）：打满弹匣后要装填，期间不叠层。
  // D-067 改为**毫秒精度的开火占比**，否则射速提升会产生阶梯式负收益。
  const firingTimeline = (sec: number): number => firingFraction(mag, fr, reload, sec);
  // D-061：加权**只在有 DoT 的类型之间**分配。
  // 冲击/穿刺/辐射/腐蚀/病毒等没有 DoT 的伤害类型**不参与**加权 ——
  // 它们虽然也占触发池，但不会产生持续伤害，不该摊薄 DoT 的份。
  // 分母 = 命中分布中「有 DoT 的五种类型」之和。
  let dotSpreadTotal = 0;
  for (const t of DOT_TYPES) dotSpreadTotal += res.finalHit[t] ?? 0;

  let dotPerSecond = 0;
  let dot6s = 0;
  for (const tick of res.dotTicks) {
    // ── D-055：该元素**不在配装里**就完全不参与 ──
    // 「没有的元素不会被触发，虽然有基础值」：dotTick 的 ① 基础值取的是全类型之和，
    // 所以毒/火/电这些即便配装里没有，也能算出一个非零的「每跳伤害」。
    // 但触发池里没有它 → 永远叠不出层 → 层数 0、每层秒伤 0、六秒总伤 0。
    // 判据是该类型是否真的出现在命中伤害分布里。
    if (!hasDotElement(res.finalHit, tick.type)) {
      stacksPerType[tick.type] = 0;
      dotPerType[tick.type] = 0;
      continue;
    }

    // ── 口径一：**加权每层秒伤**（D-043 / D-060 / D-061）──
    // 单层 DoT 每秒造成的伤害 = ② × ③，即 `tick.tick`。
    // **不含**层数、**不含**射速、**不含**多重 —— 这是"每层"的定义。
    // 触发是**互斥**的，所以合计要按占比加权；分母只算有 DoT 的类型。
    const perStackPerSecond = tick.tick;
    const shareOfType = dotSpreadTotal > 0
      ? (res.finalHit[tick.type] ?? 0) / dotSpreadTotal
      : 0;
    dotPerType[tick.type] = perStackPerSecond;
    dotPerSecond += perStackPerSecond * shareOfType;

    // ── 口径二：**六秒异常状态总伤**（D-043 / D-057 修订）──
    // 这里才乘"每秒叠层"：单发层数 = 触发率 × 元素占比 × 多重；每秒叠层 = 单发层数 × 射速。
    // 多重传 `ms`（含面板多重），否则 Twin Rogga 这类武器叠层会被低估 15 倍。
    const stacksPerShotOfType = stacksPerShot(tick.type, res.finalHit, seg.procChance, contribs, ctx.beam, ms);
    const stacksPerSecond = stacksPerShotOfType * fr;
    stacksPerType[tick.type] = stacksPerSecond;

    // **逐秒曲线**（§0.2 / D-057 / D-058 / D-059）：
    //   · 每秒把"当场层数 × 每层伤害"累加，而不是稳态值 × 6；
    //   · 毒气 10 层封顶；火焰按整数秒把新基础值累加进去（§6.3）；
    //   · 装填期间不叠新层，但已有层照常跳；
    //   · **电击 / 毒气在第 0 秒立即额外跳一拍**，层数取首发。
    dot6s += dotSixSecondCurve(
      tick.type, stacksPerSecond, perStackPerSecond, 6, firingTimeline, stacksPerShotOfType,
    );
  }

  // 爆炸异常（D-031）：独立机制，有 1.5 秒延迟、10 层上限、满层 3 倍
  //
  // ⚠ 倍率来源（需求方 D-031 原文）：其它伤害加成包括「暴击伤害、异常状态伤害、伤害弱点」，
  //   它们之间**以乘法叠加**。这里取：
  //     暴击伤害   = 单弹头的平均暴击倍率（含爆头开关，见 res.line）
  //     异常状态伤害 = Σ statusDamage%
  //     伤害弱点   = 爆头开关倍率（weakpoint 目前只有爆头一个来源）
  //     派系       = 第二次乘算（与通用 DoT 的 D-013 一致）
  // D-055：配装里没有爆炸元素时，爆炸异常根本不会触发，直接归 0。
  //
  // ⚠ 基础值**不能**取 `res.dotBase.blast`（D-056 修复）：
  //   dotBase 是"剔除元素/物理 Mod 加量"后的分布，而爆炸几乎总是由 Mod
  //   合成（火+冰、火+电），dotBase 里根本没有 blast 这一项 → 恒为 0。
  //   按 §6.2 ①，DoT 基础值是「**全类型之和**」，爆炸同样适用。
  const blastBase = hasDotElement(res.finalHit, 'blast') ? spreadTotal(res.dotBase) : 0;
  const blastStacks = stacksPerShot('blast', res.finalHit, seg.procChance, contribs, ctx.beam, ms);
  const blast = blastDetail(blastBase, blastStacks * fr, {
    factionPct: factionFor(ctx.faction, contribs),
    statusDamagePct: sumPct(contribs, 'statusDamage'),
    // ⚠ 这里要的是**暴击倍率**，不是命中伤害的绝对值（D-056 修复）。
    //   原来传 `res.line.average`（那是"单弹头期望伤害"，数值上远大于倍率），
    //   与 baseValue 相乘后爆炸伤害被放大到离谱。
    //   倍率口径 = `1 + 暴率 × (暴伤 − 1)`，即 critAverage(1, cc, cd)。
    // ⚠ D-063：爆炸的 baseValue 取自 `res.dotBase`，而 dotBase **已经含**
    //   完整的期望倍率（暴击 + 爆头 + 爆头暴击的加权）。这里传 1，否则会重复乘。
    critDamageMul: 1,
    headshotMul: 1,
  });
  // D-057：爆炸是**非 DoT 机制**，所以
  //   · **不计入**「DoT 每层秒伤」（那个口径只统计火/毒/电/毒气/切割）；
  //   · **仍计入**「六秒异常状态总伤」。
  // 范围伤害（系数 3）依旧单独列出，不进合计（D-031 修订）。
  dot6s += blastStacks > 0 ? blast.total6s : 0;

  const lines: OutputLine[] = [
    { id: 'pelletPerHit', label: '单弹头', description: '合成后总伤 × 暴击期望 × 爆头开关', unit: '/弹头', value: pelletPerHit },
    { id: 'perShot', label: '单次射击', description: '单弹头 × 多重', unit: '/发', value: perShot },
    { id: 'hitDps', label: '爆发伤害', description: '单次射击 × 射速（不含装填）', unit: '/秒', value: hitDps },
    { id: 'sustainedDps', label: '持续伤害', description: '单次射击 × 弹匣 ÷ (弹匣÷射速 + 装填)', unit: '/秒', value: sustained },
    { id: 'dotPerSecond', label: 'DoT 加权每层秒伤', description: '单层 DoT 每秒伤害 × 该类型触发占比（爆炸不计入）', unit: '/层/秒', value: dotPerSecond },
    { id: 'dot6s', label: '六秒异常状态总伤', description: 'Σ 各类型逐秒累加（毒气封顶 10 层、火焰递增）；含爆炸', unit: '', value: dot6s },
  ];

  return {
    lines: lines,
    pelletPerHit: pelletPerHit,
    multishot: ms,
    perShot: perShot,
    fireRate: fr,
    hitDps: hitDps,
    sustainedDps: sustained,
    dotPerSecond: dotPerSecond,
    dot6s: dot6s,
    dotPerType: dotPerType,
    stacksPerType: stacksPerType,
    blast: blast,
  };
}

/** 一站式：从武器 + 模式 + 贡献算出全部输出口径 */
export interface ComputeResult {
  ctx: Ctx;
  segments: SegmentResult[];
  /**
   * 计算链状态树（D-075）：输入层 / computed 层。
   *
   * 下游（UI、报告脚本、增幅分析）应当读这里，而不是自己从 面板 + Mod 重算：
   *   · `state.computed.当前暴击率` / `当前暴击伤害` / `当前多重` …
   *   · `state.computed.新面板`（玄骸加成后的数组形态）
   *   · `state.computed.元素槽位`（合成前的独立槽位数组）
   *
   * 取的是**第一个（主）段**；每段各自的完整 computed 见 `perSegment`。
   */
  state: WeaponState;
  /**
   * 逐段的 `WeaponState`（与 `segments` 一一对应）。
   *
   * 多段武器（60 把，如 Astilla Prime 的 impact/attack/explosiveAttack/embedDeathAttack）
   * 每段的面板不同，`新面板` / `基伤面板` / `元素槽位` / `命中分布` 都各有一份。
   * 单段武器时 `perSegment[0] === state` 的等价内容。
   */
  perSegment: WeaponState[];
  /** 主段（第一个段）的输出口径 */
  output: OutputBreakdown;
  /** 面板 → 加成后面板 的对照 */
  panelPairs: {
    critChance: { base: number; after: number };
    critMultiplier: { base: number; after: number };
    statusChance: { base: number; after: number };
    fireRate: { base: number; after: number };
    multishot: { base: number; after: number };
    /** D-066：弹匣容量（吃 `magazine` Mod） */
    magazineSize: { base: number; after: number };
    /** D-066：装填**时间**（吃 `reloadSpeed` Mod，速度越快时间越短） */
    reloadTime: { base: number; after: number };
  };
  /** 加成后的伤害分布（**所有变体所有段**之和） */
  totalSpread: DamageSpread;
  /**
   * **按变体分组**的加成后伤害分布（D-096）。
   *
   * `totalSpread` 是把命中段和爆炸段一起加起来的，直接拿它和"当前变体的基础分布"
   * 并列显示会让两个面板混同（巴什穆 / 巴兹火枪）。UI 要按变体对照，读这里。
   *
   * 数组顺序与 `mode.variants` 一一对应。
   */
  spreadByVariant: DamageSpread[];
  /** 加成后面板总伤（单弹头，未乘暴击） */
  moddedPanelTotal: number;
}

export function compute(
  weapon: Weapon,
  mode: AttackMode,
  contribs: readonly Contribution[],
  options: CtxOptions = {},
  beam = false,
): ComputeResult {
  const ctx: Ctx = buildContext(weapon, mode, contribs, options, beam);

  // D-080：段只属于变体，模式上不再有 `segments`。这里把各变体的段摊平：
  // 每个段仍独立结算（各自可能属于不同面板变体），结果按变体顺序排列。
  const segs: DamageSegment[] = allSegments(mode);

  // ── 每段的上游 computed 只算一次；逐段结算与 state 共用这一份（D-075）──
  // 之前 `resolveSegment()` 与 `buildState()` 各算一遍玄骸→基伤，
  // 主段被计算两次，且 state 只覆盖第一段（60 把多段武器受影响）。
  const ups = segs.map((seg) => segmentUpstream(weapon, mode, contribs, ctx, seg));
  const segments: SegmentResult[] = segs.map((seg, i) =>
    resolveSegment(ctx, seg, { 新面板: ups[i]!.state.computed.新面板, 基伤面板: ups[i]!.state.computed.基伤面板 }),
  );

  const totalSpread: DamageSpread = {};
  for (const s of segments) {
    for (const [k, v] of Object.entries(s.finalHit) as [DamageType, number][]) {
      totalSpread[k] = (totalSpread[k] ?? 0) + (v ?? 0);
    }
  }
  const moddedPanelTotal = spreadTotal(totalSpread);

  // 按变体分组累计（D-096）：段顺序 = allSegments(mode) = 各变体段按序拼接
  const spreadByVariant: DamageSpread[] = [];
  {
    let cursor = 0;
    for (const variant of mode.variants) {
      const acc: DamageSpread = {};
      for (let i = 0; i < variant.segments.length; i++) {
        const segRes = segments[cursor + i];
        if (!segRes) continue;
        for (const [k, v] of Object.entries(segRes.finalHit) as [DamageType, number][]) {
          acc[k] = (acc[k] ?? 0) + (v ?? 0);
        }
      }
      cursor += variant.segments.length;
      spreadByVariant.push(acc);
    }
  }

  const output: OutputBreakdown = buildOutput(weapon, mode, contribs, segments[0]!, ctx);

  // ── 计算链状态树：主段（D-075），downstream 一律从这里取值 ──
  const state: WeaponState = buildState(weapon, mode, contribs, ctx, segs[0]!, ups[0]);

  // ── 每个段各自的 computed（多段武器逐段可见）──
  const perSegment: WeaponState[] = ups.map((u, i) => buildState(weapon, mode, contribs, ctx, segs[i]!, u));
  const c = state.computed;
  const p = state.inputs.panel;

  return {
    ctx,
    segments,
    output,
    state,
    perSegment,
    panelPairs: {
      critChance: { base: p.critChance, after: c.当前暴击率 },
      critMultiplier: { base: p.critMultiplier, after: c.当前暴击伤害 },
      statusChance: { base: p.statusChance, after: c.当前触发率 },
      fireRate: { base: p.fireRate, after: c.当前射速 },
      multishot: { base: p.multishot, after: c.当前多重 },
      magazineSize: { base: p.magazineSize, after: c.当前弹匣 },
      reloadTime: { base: p.reloadTime, after: c.当前装填时间 },
    },
    totalSpread,
    spreadByVariant,
    moddedPanelTotal,
  };
}

/**
 * 计算某一段的上游 computed（玄骸 → 基伤）。
 *
 * 多段武器每段的面板不同，所以**每段各有一份** `新面板` / `基伤面板`；
 * 面板数值（暴击、多重…）是全武器共享的，不随段变化。
 */
function segmentUpstream(
  weapon: Weapon,
  mode: AttackMode,
  contribs: readonly Contribution[],
  ctx: Ctx,
  seg: DamageSegment,
) {
  return buildWeaponState(weapon, mode, contribs, {
    beam: ctx.beam,
    faction: ctx.faction,
    coStacks: ctx.coStacks,
    coStatusTypes: ctx.coStatusTypes,
    kuva: ctx.options.kuva,
    segment: seg,
  });
}

/** 把 `buildWeaponState` 的产物补全元素合成部分，得到完整 `WeaponState` */
function buildState(
  weapon: Weapon,
  mode: AttackMode,
  contribs: readonly Contribution[],
  ctx: Ctx,
  seg: DamageSegment,
  partialResult?: ReturnType<typeof segmentUpstream>,
): WeaponState {
  const { state: partial } = partialResult ?? segmentUpstream(weapon, mode, contribs, ctx, seg);
  // 元素合成依赖本文件的 applyElements（与结算链共用同一个实现，保证一致）
  const el: ApplyElementsResult = applyElements(partial.computed.基伤面板, contribs, 'hit');
  return {
    ...partial,
    computed: {
      ...partial.computed,
      元素槽位: el.slots,
      命中分布: el.v,
      命中分布总伤: spreadTotal(el.v),
    },
  };
}

export { productMul, sumFlat };

/**
 * 拆解：每个乘区的累加明细（供 UI 展示"每个乘区都能复算"）。
 *
 * D-050：面板值取**该模式**的；不传 mode 时回退到第一个模式。
 */
export function bucketBreakdown(
  weapon: Weapon,
  contribs: readonly Contribution[],
  mode?: AttackMode,
): ReturnType<typeof bucketDetail>[] {
  const m = mode ?? weapon.modes[0];
  const ps = m ? panelStats(weapon, m) : { critChance: weapon.critChance, critMultiplier: weapon.critMultiplier, statusChance: weapon.statusChance, fireRate: weapon.fireRate };
  return [
    bucketDetail(ps.critChance, 'critChance', contribs),
    bucketDetail(ps.critMultiplier, 'critMultiplier', contribs),
    bucketDetail(ps.statusChance, 'statusChance', contribs),
    bucketDetail(ps.fireRate, 'fireRate', contribs),
  ];
}
