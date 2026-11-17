/**
 * 乘区（bucket）骨架：表 2.0 的 `BUCKET`。
 *
 * ```
 * BUCKET(panel, id) = ( panel × (1 + Σ_pct(id)) + Σ_flat(id) ) × Π_mul(id)
 * ```
 *
 * 口径来源：依据：核心事实 第 2.0 节、依据：核心事实。
 * 设计原则：**每个属性明确属于唯一一个乘区**，乘区内相加、乘区之间相乘。
 * 这是模拟器能给出"每个乘区贡献多少"的基础，也是防止 Mod 数值错配的关键。
 *
 * 注意：本文件原先的注释是历史遗留的乱码（双重转码，无法还原），已按文档重写，逻辑不变。
 */
import type { Contribution, ContribStat } from './contributions.ts';
import { contributionsFor, sumFlat, sumPct, productMul } from './contributions.ts';
import type { DamageSpread, DamageType } from './damage-types.ts';
import { spreadTotal } from './damage-types.ts';
import type { DamageSegment } from './weapon.ts';

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
  | 'magazine' | 'reloadSpeed' | 'ammoEfficiency'
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

/**
 * 该乘区是否被**锁定**（D-091 锁射速 / 需求方 2026-11-13 锁多重）。
 *
 * 半自动炮轰系列「Fire Rate cannot be modified」、敏锐主武 / 敏锐手枪
 * 「Multishot cannot be modified」：一旦配装里任意一条贡献带上标记，
 * **该属性的所有来源（正的和负的）都不生效**，即恒等于面板值。
 *
 * 判定放在乘区入口，全内核只有这一个地方决定「锁没锁」：
 * `fireRateFinal()`、面板对照、卡片增幅、`bucketBreakdown()` 全部经 `bucketDetail()`，
 * 所以它们必然看到同一个结果，不会出现「这边显示锁了、那边照样加成」。
 */
export function isStatLocked(stat: BucketableStat, contribs: readonly Contribution[]): boolean {
  if (stat === 'fireRate') return contribs.some((c) => c.locksFireRate);
  if (stat === 'multishot') return contribs.some((c) => c.locksMultishot);
  return false;
}

/** 与 `bucket` 同值，但附带拆解明细（CLAUDE.md「每个乘区都能复算」的落点） */
/**
 * 与 `bucket` 同值，但附带拆解明细（CLAUDE.md「每个乘区都能复算」的落点）。
 *
 * 两条口径都在这一个入口里：
 *
 * 1. **锁定射速 / 多重**（D-091 / 锁多重）：锁生效时该属性**所有**来源（正负都算）按 0 计，
 *    即恒等于面板值。判定见 {@link isStatLocked}。
 * 2. **乘区下限 0**（需求方 2026-11-14）：
 *    > 「先算完括号再截到 0…… 应该是一样的吧，都是 −100%」
 *
 *    先按原样算完括号与乘算，再把**最终值**截到 ≥ 0：
 *    ```
 *    value = max(0, (panel × (1+Σpct) + flat) × Πmul)
 *    ```
 *    括号 `(1+Σpct) + flat` 本身仍按原值算、也仍原样返回给拆解面板，
 *    只有最终值不会被负词条压到 0 以下。
 */
export function bucketDetail(panel: number, stat: BucketableStat, contribs: readonly Contribution[]): BucketDetail {
  // 锁定时把该属性的全部来源按 0 计：pct/flat/mul（即括号与乘算全部退化为面板值）
  const locked: boolean = isStatLocked(stat, contribs);
  const pct: number = locked ? 0 : sumPct(contribs, stat);
  const flat: number = locked ? 0 : sumFlat(contribs, stat);
  const mul: number = locked ? 1 : productMul(contribs, stat);
  const raw: number = (panel * (1 + pct) + flat) * mul;
  const value: number = Math.max(0, raw);
  return {
    stat: stat,
    panel: panel,
    pct: pct,
    flat: flat,
    mul: mul,
    value: value,
    // 锁定时该属性的来源全按 0 计，拆解面板里不再列出（列出来也与值对不上）
    contributors: locked ? [] : contribs.filter((c) => c.stat === stat && c.active !== false),
  };
}

/** 暴率 / 暴伤 / 射速这类"两段式"属性的面板 + 加成展示（供 UI 的「基础面板/加成后面板」对照） */export interface PanelPair {
  stat: BucketableStat;
  base: number;
  after: number;
}

export function panelPairs(panelStats: Partial<Record<BucketableStat, number>>, contribs: readonly Contribution[]): PanelPair[] {
  const out: PanelPair[] = [];
  for (const [stat, base] of Object.entries(panelStats) as [BucketableStat, number][]) {
    out.push({ stat, base, after: bucket(base, stat, contribs) });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 基伤乘区（§5.2 双基本值）
//
// 放在本文件而不是 `segment.ts` / `weapon-state.ts`：这两个文件里都要用它，
// 而 `segment` 已从 `weapon-state` 取 `overForStacks`——再反向依赖就成环了。
// 本文件只依赖 `contributions` / `damage-types` / `weapon` 的类型，没有回边。
// ─────────────────────────────────────────────────────────────

/** 类镀层（冷颤）固定满层数（需求方 2026-11-06：「冷颤固定是十层」） */
export const FROZEN_FULL_STACKS = 10;

/**
 * 镀层类伤害乘区（A-03 已定案，见 D-024）。
 *
 * ```
 * 镀层加量 = x% × a × y
 *   x = 每层百分比（Mod 的 +X%，已在 Contribution.amount 里）
 *   y = 叠加上限（击杀后获得的 buff 层数，默认取 Mod 描述的最大值）
 *   a = 目标身上异常状态的**种类数**（不是层数：中毒 5 层只算 1 种）
 * ```
 * 返回值是**小数口径**（1.2 = +120%），直接进基伤括号。
 */
export function overForStacks(
  contribs: readonly Contribution[],
  coStacks: number,
  statusTypes = 0,
): number {
  if (coStacks <= 0 || statusTypes <= 0) return 0;
  const co = contributionsFor(contribs, 'co').filter((c) => c.form === 'pct');
  let total = 0;
  for (const c of co) total += (c.amount / 100) * statusTypes * coStacks;
  return total;
}

/**
 * **类镀层但只认某一种异常状态**的加成（D-086）。
 *
 * 需求方 2026-11-06：「次要·冷颤是类镀层加成，但是只对冰冻层数生效。可以设置成
 * 直接给满层数的类镀层加成，只有直接非灵化加成伤害才能享受。」
 *
 * 与 `overForStacks` 的区别：
 * - `overForStacks` 按**所有**异常状态的种类数 `a` 算（异况超量 / 镀层系列）；
 * - 这里只按**指定元素**的层数算，且**直接给满层**（读 `coStacks` 之外的固定层数）。
 *
 * @param contribs 全部贡献（`stat: 'coFreeze'` 等专用属性键）
 * @param stat     要取的属性键（`coFreeze` = 只认冰冻层数）
 * @param stacks   该元素在目标身上的层数（UI 给"满层"即最大值）
 */
export function overForElement(
  contribs: readonly Contribution[],
  stat: ContribStat,
  stacks: number,
): number {
  if (stacks <= 0) return 0;
  const co = contributionsFor(contribs, stat).filter((c) => c.form === 'pct');
  let total = 0;
  for (const c of co) total += (c.amount / 100) * stacks;
  return total;
}

/**
 * §5.2：基伤**两路**。
 *
 * 需求方 2026-11-14：灵化被动的「+N 基础伤害」是**固定值**（不是百分比），
 * 它与面板基伤是基伤乘区里的两路，**各自走自己的系数**：
 * ```
 * 基伤 = 面板基伤分布 × k_普通 + 被动基伤分布 × k_被动
 * k_普通 = max(0, 1 + Σ基伤%) + 镀层 + 冷颤     ← 吃镀层 / 冷颤
 * k_被动 = max(0, 1 + Σ基伤%)                   ← 只吃基伤%，不吃镀层 / 冷颤
 * ```
 * · 范围伤害（`kind === 'explosiveAttack'`）两路都只吃 `1 + Σ基伤%`（镀层 / 冷颤都不吃）；
 * · 玄骸那一份已经在玄骸并入时进了面板，走 k_普通（D-017）。
 *
 * 本函数是**唯一实现**：`segment.ts` 的结算链与 `weapon-state.ts` 的基伤面板都调它。
 *
 * @param passiveBase 被动基伤分布（已按该段原始面板平摊）。不传 / 空 = 没有被动，
 *   行为与改动前逐位一致
 */
export function applyBaseDamage(
  panelWithKuva: DamageSpread,
  seg: Pick<DamageSegment, 'kind'>,
  contribs: readonly Contribution[],
  coStacks = 0,
  statusTypes = 0,
  passiveBase?: DamageSpread,
): DamageSpread {
  // 基伤乘区最低 0（需求方 2026-11-14）：负基伤词条可以把括号压成负数，
  // 与 `bucketDetail()` 同一口径 —— 算完括号再截到 0。
  const g: number = Math.max(0, 1 + sumPct(contribs, 'baseDamage'));
  const isAoe: boolean = seg.kind === 'explosiveAttack';
  // 类镀层（冷颤，D-086）：**固定满层**，不吃 AoE。
  //   于是"面板显示的基伤"和"实际结算的基伤"对不上。现在两条路共用本函数的判定。
  const freezeCo: number = isAoe ? 0 : overForElement(contribs, 'coFreeze', FROZEN_FULL_STACKS);
  // 普通那一路：非 AoE 才吃镀层 / 冷颤
  const k: number = Math.max(0, isAoe ? g : g + overForStacks(contribs, coStacks, statusTypes) + freezeCo);
  const out: DamageSpread = {};
  for (const [t, v] of Object.entries(panelWithKuva) as [DamageType, number][]) {
    if (typeof v === 'number' && v !== 0) out[t] = v * k;
  }
  // 被动那一路：只吃 Σ基伤%（AoE 段与普通段一样，都只吃 g）
  if (passiveBase && spreadTotal(passiveBase) > 0) {
    const kPassive: number = Math.max(0, g);
    for (const [t, v] of Object.entries(passiveBase) as [DamageType, number][]) {
      if (typeof v !== 'number' || v === 0) continue;
      out[t] = (out[t] ?? 0) + v * kPassive;
    }
  }
  return out;
}

/**
 * 把武器级被动里「+N 基础伤害（固定值）」按**该段自己的原始面板分布（玄骸前）**平摊。
 *
 * 需求方 2026-11-14：「要按'原始面板分布'平摊，但每段的面板分布不同」
 * —— 所以平摊基数取**这一段自己**的 `damage`，不是武器主面板。
 *
 * 例：某段 60 冲击 + 40 切割，被动 +50 → 冲击 30 / 切割 20。
 *
 * @param segmentDamage 该段自己的原始面板分布
 * @param passives      武器级被动列表（`weapon.passives`）
 * @returns 平摊后的分布；没有这类被动时返回 `undefined`（下游据此走单路，行为不变）
 */
export function passiveBaseDamageOf(
  segmentDamage: DamageSpread,
  passives: readonly { kind: string; amount: number }[] | undefined,
): DamageSpread | undefined {
  if (!passives?.length) return undefined;
  let total = 0;
  for (const p of passives) if (p.kind === 'baseDamageFlat') total += p.amount;
  if (total === 0) return undefined;
  const panelTotal = spreadTotal(segmentDamage);
  if (!(panelTotal > 0)) return undefined;
  const out: DamageSpread = {};
  for (const [t, v] of Object.entries(segmentDamage) as [DamageType, number][]) {
    if (typeof v !== 'number' || v === 0) continue;
    out[t] = total * (v / panelTotal);
  }
  return out;
}