/**
 * 单段结算：L0 面板切段 → ① 玄骸 → ② 基伤 → ③④⑤ 元素 → L3 暴击/爆头 → DoT 基础值。
 *
 * 执行顺序（**玄骸在基伤之前**，D-017）：
 * ```
 * L0 面板切段           buildVectors
 * ① 玄骸加成            applyKuvaBonus        ← 在基伤之前
 * ② 基伤 / 多重         applyBaseDamage / multishot
 * ③④ 物理% / 元素%      applyElements        （实现见 elements.ts）
 * ⑤ 两两合成            mergePairwise        （实现见 elements.ts）
 * L3 暴击 + 爆头        critChanceTotal / critDamageTotal / damageLine
 * L4 触发与 DoT         dotTick              （每跳明细，见 dot.ts）
 * ```
 *
 * 全部纯函数、无随机数、无隐式取整（表 2.4）；浮点只在展示层四舍五入。
 * 本文件只负责"一段怎么算"，输出口径（L6）见 `output.ts`，整把武器的汇总见 `compute.ts`。
 */
import type { DamageSpread, DamageType } from './damage-types.ts';
import { scaleSpread, spreadTotal } from './damage-types.ts';
import type { DamageSegment } from './weapon.ts';
import { allSegments } from './weapon.ts';
import type { Contribution, Faction } from './contributions.ts';
import { sumPct } from './contributions.ts';
import type { Ctx } from './ctx.ts';
import type { ApplyElementsResult } from './elements.ts';
import { applyElements } from './elements.ts';
import { overForStacks } from './weapon-state.ts';
import type { DamageLine } from './crit.ts';
import {
  critChanceTotal,
  critDamageTotal,
  damageLine,
  expectedHitMultiplier,
  headshotMultiplier,
} from './crit.ts';
import type { DoTType, DotTickDetail } from './dot.ts';
import { DOT_TYPES, dotTick } from './dot.ts';

// 多重是"触发/层数"的输入，实现在 dot.ts；这里原样转出以保持既有导入路径。
export { multishot } from './dot.ts';

// ─────────────────────────────────────────────────────────────
// L0：面板切段
// ─────────────────────────────────────────────────────────────

/**
 * §4：一个模式里的每个 segment 都是一个独立向量；单弹头不乘多重，
 * 多重统一在 L6 乘（射线例外，见 §2.2）。
 */
export function buildVectors(mode: import('./weapon.ts').AttackMode): DamageSpread[] {
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
  /**
   * 每跳用的基础分布（D-107）：命中分布**剔除元素/物理 Mod 加量**、未乘暴击。
   * 触发占比、爆炸基础值都用这一份——它们必须看"没被元素 Mod 撑大的分布"。
   */
  tickBase: DamageSpread;
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
  const elementResult: ApplyElementsResult = applyElements(baseAfterBaseDamage, contribs, 'hit');
  const finalHit: DamageSpread = elementResult.v;
  /** 命中分布**剔除元素/物理 Mod 加量**后的样子（= 玄骸 + 基伤 之后、合成之前） */
  const finalHitNoAdd: DamageSpread = applyElements(baseAfterBaseDamage, contribs, 'dotBase').v;

  // DoT 基础值（§6.2 ①）：命中的**不含元素/物理 Mod 加量**的分布。
  //
  // 需求方 2026-11-06（Q6 定案）原文：
  //   「暴击后不加元素的命中基础值，但是元素 mod 的作用不对，火加毒确实是会合成毒气，
  //     但是他仍然是火焰加成，不会对毒气 dot 加成。只有真正的原生毒气百分比加成，
  //     例如 lavos 的效价炼成，或者裂隙 mod 上的 +xxx 毒气% 才会增加毒气 dot。
  //     所以我才一定要把元素后移，火冰毒电这种 dot 是不会出现这个问题的，
  //     然后爆炸目前的设定也是不享受爆炸 mod 加成，所以只有毒气有这个问题。」
  //
  // 也就是：DoT 每跳 = Σ(未加元素加量的命中分布) × 系数 × (1 + 元素加成按命中占比分摊)
  // 元素 %**不在基础值里乘**，而是按"它自己的类型"单独生效（见 dot.doTickBase）；
  // 暴击按期望倍率施加（见下面 dotBase / tickBase 的注释）。
  const dotBaseRaw: DamageSpread = finalHitNoAdd;

  // L3 暴击 + 爆头
  const cc = critChanceTotal(weapon, contribs, ctx.mode);
  const cd = critDamageTotal(weapon, contribs, ctx.mode);
  const hsMul = headshotMultiplier(contribs, ctx.headshot.multiplier);
  // 派系（D-013：命中结算前一次）。D-135：这一项以前只进了 DoT，命中伤害完全没乘，
  // 所以上了「对 Grineer +55%」这类卡，命中伤害/爆发/持续都不动，只有 DoT 变了。
  const factionPct = factionFor(ctx.faction, contribs);
  const factionMul = 1 + factionPct;
  const vTotal = spreadTotal(finalHit);
  const line: DamageLine = damageLine(vTotal, cc, cd, ctx.headshot.enabled, hsMul, factionMul);

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
  const dotBase: DamageSpread = scaleSpread(
    dotBaseRaw,
    expectedHitMultiplier(cc, cd, ctx.headshot.enabled, hsMul) * factionMul,
  );

  /**
   * 每跳用的「基础命中值」（D-107 / Q6 定案）：
   * **不含元素/物理 Mod 加量**的命中分布（暴击由 `dotTick` 按期望倍率施加，避免重复）。
   * 元素 % 由 `dotTick` 只按"命中分布里出现的类型"分摊（见 `dotTickBase`）。
   */
  const tickBaseRaw: DamageSpread = finalHitNoAdd;
  /**
   * 与 `tickBaseRaw` 同源，但**已乘暴击/爆头期望倍率与派系**（供 `output.ts` 的触发占比与爆炸基础值用）。
   *
   * D-136：派系必须**在这里**乘进去（§5.2「命中结算前一次」）——上一轮（D-135）把派系只加到了
   * 命中分行 `damageLine()` 上，DoT 的基础值 `tickBase` 里没有它，于是"命中吃、DoT 不吃"，
   * 需求方看到的是「命中有了，但 DoT 派系加成还是 55%」。
   */
  const tickBaseScaled: DamageSpread = scaleSpread(
    finalHitNoAdd,
    expectedHitMultiplier(cc, cd, ctx.headshot.enabled, hsMul) * factionMul,
  );

  // 单弹头分布（供"加成后面板"与触发占比展示）：元素加量已含，暴击单列
  const singlePelletSpread: DamageSpread = finalHit;

  const dotTicks: DotTickDetail[] = DOT_TYPES.map((t: DoTType) =>
    dotTick(tickBaseScaled, t, contribs, { factionPct, headshot: ctx.headshot, headshotMul: hsMul }),
  );

  return {
    kind: seg.kind,
    panel,
    panelWithKuva,
    baseAfterBaseDamage,
    finalHit,
    elementDetail: elementResult,
    dotBase,
    /** 每跳用的基础分布（= 命中 − 元素加量，**未**乘暴击；触发占比/爆炸基础值取此份） */
    tickBase: tickBaseRaw,
    critChance: cc,
    critDamage: cd,
    singlePelletSpread,
    line,
    dotTicks,
  };
}
