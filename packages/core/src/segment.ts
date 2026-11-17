/**
 * 单段结算：L0 面板切段 → ① 玄骸 → ② 基伤 → ③④⑤ 元素 → L3 暴击/爆头 → DoT 基础值。
 *
 * ```
 * L0 面板切段           buildVectors
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
import type { AttackMode, ModeVariant } from './weapon.ts';
import { allSegments } from './weapon.ts';
import type { Contribution, Faction } from './contributions.ts';
import { sumPct } from './contributions.ts';
import type { Ctx } from './ctx.ts';
import type { ApplyElementsResult } from './elements.ts';
import { applyElements } from './elements.ts';
import { applyBaseDamage } from './buckets.ts';
import type { DamageLine } from './crit.ts';
import {
  critChanceTotal,
  critDamageTotal,
  bladeShadowMultiplier,
  damageLine,
  expectedHitMultiplier,
  headshotMultiplier,
  bodyshotMultiplier,
} from './crit.ts';
import type { DoTType, DotTickDetail } from './dot.ts';
import { DOT_TYPES, dotTick, multishot } from './dot.ts';

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
 * 镀层类伤害乘区 / 基伤乘区 / 被动基伤平摊，实现都在 `buckets.ts`。
 *
 * 这里原样转出以保持既有导入路径不变（D-024 的 `overForStacks` 一直是`
 * `segment.ts` 的对外导出面）。
 */
export { applyBaseDamage, overForStacks, passiveBaseDamageOf } from './buckets.ts';

// ─────────────────────────────────────────────────────────────
// 派系乘区（D-013：命中结算前乘一次、DoT 每跳再乘一次）
// ─────────────────────────────────────────────────────────────

const FACTION_STATS: Readonly<Record<Exclude<Faction, 'none'>, `faction:${Faction}`>> = {
  grineer: 'faction:grineer',
  corpus: 'faction:corpus',
  infested: 'faction:infested',
  orokin: 'faction:orokin',
  murmur: 'faction:murmur',
  // D-163：1999 的两个势力（派系歧视 Mod 与裂罅派系词条都会落到这两个键）
  techrot: 'faction:techrot',
  scaldra: 'faction:scaldra',
};

export function factionFor(faction: Faction, contribs: readonly Contribution[]): number {
  if (faction === 'none') return 0;
  // 派系乘区最低 0（需求方 2026-11-14）：负派系裂罅词条不能把伤害乘成负的。
  // 返回的是「Σpct」，下游统一用 `1 + factionPct`；这里把下界压到 −1（= 倍率 0）。
  return Math.max(-1, sumPct(contribs, FACTION_STATS[faction]));
}

// ─────────────────────────────────────────────────────────────
// 完整单段结算
// ─────────────────────────────────────────────────────────────

export interface SegmentResult {
  kind: DamageSegment['kind'] | string;
  /** 该段自己的触发几率（0~1），逐段算 DoT 叠层时要用 */
  procChance: number;
  /**
   * 该段是否射线。
   *
   * ⚠ **按段判**（需求方 2026-11-12），不是按模式：模式扳机 `held` + 该段自己的 `beam` 标记。
   * 方块弹 / 引爆 / 换弹那几段会被一起当成射线（DoT 每跳也乘多重），是错的。
   */
  beam: boolean;
  /** 该段所属的阵营（派系第二次乘算要用） */
  faction: Faction;
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
  /** DoT / 爆炸的基础分布（不含元素加量；已乘期望倍率 / 派系 / 射线多重）。 */
  tickBaseScaled: DamageSpread;
  /** 暴率 / 暴伤（已含 Mod） */
  critChance: number;
  critDamage: number;
  /** 单个弹头（未乘多重 / 未乘暴击） */
  singlePelletSpread: DamageSpread;
  /** 命中伤害三行（单弹头，已乘暴击与爆头） */
  line: DamageLine;
  /** DoT 每跳明细 */
  dotTicks: DotTickDetail[];
  /**
   * 该段分摊到的武器级被动基伤分布（需求方 2026-11-14）；没有被动时为 `undefined`。
   *
   * 从入参 `seg.passiveBaseDamage` 原样带出，供界面展示与排查"被动的 +N 加在哪一段"。
   */
  passiveBaseDamage?: DamageSpread;
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
  upstream?: { 新面板: DamageSpread; 基伤面板: DamageSpread; variant?: ModeVariant | undefined },
): SegmentResult {
  const { weapon, mode, contribs } = ctx;
  const panel: DamageSpread = { ...seg.damage };
  /**
   * 这一段所属攻击方式的面板 override（C2，需求方 2026-11-15）。
   *
   * 暴率 / 暴伤 / 触发率都要按「变体 override → 模式 override → 武器级」取——
   * 于是「爆炸段自己有不同暴率」的武器，段面板和结算都不对。
   */
  const panelMode: AttackMode = upstream?.variant?.override
    ? { ...mode, override: { ...(mode.override ?? {}), ...upstream.variant.override } }
    : mode;

  // ── 该段是不是射线（需求方 2026-11-12：**按段判**；D-160 补齐段级扳机）──
  //
  // 优先级（从强到弱）：
  //   ① 段自己声明了 `beam`（数据层只写正面标记）→ 以它为准；
  //   ② 段所在的**攻击方式**有自己的扳机（`variant.trigger`）→ 以它为准；
  //      典型是赘骨的灵化：射线变体 `held`、蓄力变体 `charge`。⛔ 若漏掉这一层，
  //      `ctx.beam` 会回退到模式扳机（灵化模式是 `held`），蓄力变体会被误算成射线；
  //   ③ 否则跟随模式扳机（= `ctx.beam`）。
  const isBeam: boolean = seg.beam ?? (seg.trigger ? seg.trigger === 'held' : ctx.beam);

  /**
   * §2.2 / 表 0.1：**射线的多重并进单弹头伤害**（多条激光打同一目标合并成一跳），
   * 实弹的单弹头不含多重。
   *
   * 需求方 2026-11-12：
   * > 「就是合成一跳啊，而且是乘了多重mod的合成一跳。」
   *
   * 所以射线段：
   *   ① DoT 基础值 × 当前多重（面板多重 × (1+Σ多重%) + Σ绝对值）
   *   ② 命中伤害 × 当前多重（此前 `perShot` 一律再乘一次，射线会**重复乘**，这里对齐成一次）
   * 实弹段这一项恒为 1（多重由 L6 的 `perShot = 单弹头 × 多重` 统一处理）。
   */
  const msMul: number = isBeam ? multishot(contribs, weapon, mode) : 1;

  // ② 基伤
  //   上游给过就直接取 computed，避免重复计算（数值同一份）
  //
  // 需求方 2026-11-14：武器级被动「+N 基础伤害」走基伤的**第二路**
  //（只吃 Σ基伤%，不吃镀层 / 冷颤），分布已按本段原始面板平摊好（`seg.passiveBaseDamage`）。
  const panelWithKuva: DamageSpread = upstream ? upstream.新面板 : applyKuvaBonus(panel, ctx.options.kuva);
  const baseAfterBaseDamage: DamageSpread = upstream
    ? upstream.基伤面板
    : applyBaseDamage(panelWithKuva, seg, contribs, ctx.coStacks, ctx.coStatusTypes, seg.passiveBaseDamage);

  // ③④⑤⑥ 元素 / 物理加量
  const elementResult: ApplyElementsResult = applyElements(baseAfterBaseDamage, contribs, 'hit');
  const finalHit: DamageSpread = elementResult.v;
  /**
   * 需求方 2026-11-13：**处决伤害 / 震地伤害是独立乘区**，不是基伤。
   *
   * 原话：「处决是开新乘区啊，只是不需要单独做处决开关」「他们是震地伤害乘区，可不是基伤」。
   *
   * ```
   * 处决乘区 = 1 + Σ处决伤害%      ← 只有画龙点睛 / 猎人骨锯会贡献，平时恒为 1
   * 震地乘区 = 1 + Σ震地伤害%      ← 只有震波会贡献，且**只对震地 / 重型震地生效**
   * ```
   * 两者都在元素合成**之后**乘上去（乘区内相加、乘区之间相乘），
   * 所以不会和基伤 Mod 互相稀释。
   *
   * ⚠ 处决不做攻击类型判定（需求方：「处决就直接正常生效就行，因为跟普通攻击区分不开」）；
   *    震地**必须**按 `mode._slam` 判定（需求方：「震波需要加标签判定啊，只对震地和重型震地生效」）。
   */
  // 需求方 2026-11-14：独立乘区同样**最低 0**（负处决 / 负震地伤害不能把伤害乘成负的）
  const finisherMul: number = Math.max(0, 1 + sumPct(contribs, 'finisherDamage'));
  const slamMul: number = mode._slam === true ? Math.max(0, 1 + sumPct(contribs, 'slamDamage')) : 1;
  // 需求方 2026-11-13：细心瞄准的 -45% 身体伤害 —— 只在**关闭爆头**（打身体）时生效
  const bodyMul: number = bodyshotMultiplier(contribs, ctx.headshot.enabled);
  const specialMul: number = finisherMul * slamMul * bodyMul;
  const finalHitWithSpecial: DamageSpread = specialMul === 1 ? finalHit : scaleSpread(finalHit, specialMul);

  /**
   *
   * 需求方 2026-11-06（Q6 定案）：「暴击后不加元素的命中基础值……元素 mod 的作用不对，
   * 火加毒确实是会合成毒气，但是他仍然是火焰加成，不会对毒气 dot 加成。」
   * 所以元素 % **不在基础值里乘**，而是按"它自己的类型"在 `dotTick` 的 ③ 单独生效。
   */
  const finalHitNoAdd: DamageSpread = applyElements(baseAfterBaseDamage, contribs, 'dotBase').v;

  /**
   * 每跳用的「基础命中值」（D-107 / Q6 定案，需求方 2026-11-12 定为**口径 B**）：
   * **不含元素/物理 Mod 加量**的命中分布，含处决 / 震地 / 身体。
   *
   * 却被各自乘一遍、算成两个名字不同、值相同的东西。现在只保留这一条，
   * 乘期望倍率 / 派系 / 多重之后得到 `tickBaseScaled`——DoT 每跳与爆炸基础值共用。
   *
   * ⚠ 命中的口径用**含**元素加量的 `finalHitWithSpecial`；DoT 基础值用**不含**的这一份。
   */
  const tickBaseRaw: DamageSpread = specialMul === 1 ? finalHitNoAdd : scaleSpread(finalHitNoAdd, specialMul);

  // L3 暴击 + 爆头
  // 需求方 2026-11-15：弱点暴击率与普通暴击率是**同一乘区里的 Σ%**，已在 `critChanceTotal` 内部并入，
  const cc = critChanceTotal(weapon, contribs, panelMode, ctx.headshot.enabled);
  const cd = critDamageTotal(weapon, contribs, panelMode);
  const hsMul = headshotMultiplier(contribs, ctx.headshot.multiplier);
  // 所以上了「对 Grineer +55%」这类卡，命中伤害/爆发/持续都不动，只有 DoT 变了。
  const factionPct = factionFor(ctx.faction, contribs);
  const factionMul = 1 + factionPct;
  // 需求方 2026-11-13：处决 / 震地两个独立乘区已经并进 `finalHitWithSpecial`，
  // 命中伤害直接用它，避免后面再乘一次。
  const vTotal = spreadTotal(finalHitWithSpecial);
  /**
   * 命中伤害三行。
   *
   * 射线：`vTotal × 多重`——表 0.1「射线单弹头 = 基础伤害项 × (1+Σ多重%)，
   * 与单次射击相同」。这样命中伤害与 DoT 基础值（同样乘了 `msMul`）**同源**，
   * 不会再出现"命中没吃多重、DoT 吃了"或反过来的错配。
   * 实弹：`msMul` 恒为 1，行为与改动前完全一致。
   */
  const line: DamageLine = damageLine(vTotal * msMul, cc, cd, ctx.headshot.enabled, hsMul, factionMul);
  /**
   * **D-189：近战·刃影**（需求方 2026-11-13）。
   *
   * 主命中为一级暴击时追加一次攻击，追加那一下按同一暴击率独立再判。
   * ```
   * 刃影倍率 = 1 + w·P1(cc)         ← crit.ts 的 bladeShadowMultiplier
   * 增益（相对同一配装去掉刃影）= w·P1(cc)，与暴伤无关
   * ```
   * **只乘到「期望」上**（命中平均行）：
   *   · 白字行 / 暴击行仍是单次结算的倍率，不乘（否则看起来像刃影连不暴击都放大）；
   *   · **DoT / 爆炸的每跳基础值不放大**——需求方：「不放大 dot 基础值。只放大叠层」，
   *     叠层那一侧在 `output.ts` 的 `bladeShadowMultiplier` 里处理。
   */
  const bladeMul: number = bladeShadowMultiplier(cc, sumPct(contribs, 'bladeShadow'));
  if (bladeMul !== 1) line.average *= bladeMul;

  /**
   * **DoT 基础值 / 爆炸基础值 = 基础命中分布 × 期望倍率 × 派系 × 多重**（D-062 / D-063）。
   * 需求方口径：
   *   「爆头影响基础值计算。爆头暴击也是对基础值生效，dot 部分都应该以基础值为准。
   *     参考暴击，dot 部分会额外生效的只有派系伤害和元素异常状态伤害这两种词条，
   *     射速和多重影响的是叠层。」
   *   「爆头倍率为 3 的时候如果没暴击，就还是三倍的爆头倍率。爆头暴击这个两倍
   *     只在又暴击又开启了爆头时产生，如果有未暴击白字需要加权计算。」
   *
   * 用 `damageLine` 的**期望倍率**，而不是把 ×2 恒定乘上去：
   *   非爆头：`(1−cc)·1 + cc·cd`
   *   爆头：  `(1−cc)·hsM + cc·hsM·cd·2`     ← ×2 只作用于**暴击那一支**
   * 展开后即 `1 + cc(cd−1)`（非爆头）或 `hsM·(1 + cc(2cd−1))`（爆头）。
   *
   * D-136：派系必须**在这里**乘进去（§5.2「命中结算前一次」）——上一轮（D-135）把派系只加到了
   * 命中分行 `damageLine()` 上，DoT 的基础值里没有它，于是"命中吃、DoT 不吃"。
   *
   * `tickBaseScaled`），值相同却各算一遍；现在只有这一个，`dotTicks` 与爆炸基础值共用。
   */
  const tickBaseScaled: DamageSpread = scaleSpread(
    tickBaseRaw,
    expectedHitMultiplier(cc, cd, ctx.headshot.enabled, hsMul) * factionMul * msMul,
  );

  // 单弹头分布（供"加成后面板"与触发占比展示）：元素加量已含，暴击单列。
  // 射线：多重并进单弹头（表 0.1「射线单弹头 = 基础伤害项 × (1+Σ多重%)」）。
  const singlePelletSpread: DamageSpread = isBeam ? scaleSpread(finalHitWithSpecial, msMul) : finalHitWithSpecial;

  const dotTicks: DotTickDetail[] = DOT_TYPES.map((t: DoTType) =>
    dotTick(tickBaseScaled, t, contribs, { factionPct, headshot: ctx.headshot, headshotMul: hsMul }),
  );

  return {
    kind: seg.kind,
    // D-148 / 需求方 2026-11-12：逐段算 DoT 叠层需要每段自己的触发率 / 射线标记 / 派系
    procChance: seg.procChance,
    beam: isBeam,
    faction: ctx.faction,
    panel,
    panelWithKuva,
    baseAfterBaseDamage,
    finalHit: finalHitWithSpecial,
    elementDetail: elementResult,
    /**
     * DoT / 爆炸的基础分布（需求方 2026-11-14 收敛后的**唯一**一份）：
     * = 不含元素加量的命中 × 处决/震地/身体 × 期望倍率 × 派系 × 多重（射线）。
     *
     * `dotBase` 与 `tickBaseScaled` 是同一个值；`tickBase` 只服务于测试里的自证式断言
     * （用未乘的那份再乘回去比结果），没有独立信息——需求方指出后一并删除，
     * 测试改为直接拿**面板数字**断言。
     */
    tickBaseScaled,
    critChance: cc,
    critDamage: cd,
    singlePelletSpread,
    line,
    dotTicks,
    // 武器级被动基伤（需求方 2026-11-14）：原样带出供展示 / 排查，没被动时为 undefined
    ...(seg.passiveBaseDamage ? { passiveBaseDamage: seg.passiveBaseDamage } : {}),
  };
}