/**
 * 一站式入口：从「武器 + 模式 + 贡献」算出全部口径与计算链状态树（`compute()`）。
 *
 * ```
 * buildContext → 每段 upstream（玄骸 → 基伤，computed）
 *              → 每段 resolveSegment（复用 upstream）
 *              → 汇总（全部段 / 按变体）
 *              → 主段 buildOutput / WeaponState（buildWeaponState 已含元素合成）
 * ```
 * 下游（UI、报告脚本、增幅分析）一律读 `state` / `perSegment`，不要自己从面板 + Mod 重算。
 */
import type { DamageSpread } from './damage-types.ts';
import { spreadTotal } from './damage-types.ts';
import type { AttackMode, DamageSegment, Weapon } from './weapon.ts';
import { allSegments, panelStats } from './weapon.ts';
import type { Contribution } from './contributions.ts';
import { addSpread } from './elements.ts';
import { bucketDetail } from './buckets.ts';
import type { WeaponState } from './weapon-state.ts';
import { buildWeaponState } from './weapon-state.ts';
import type { Ctx, CtxOptions } from './ctx.ts';
import { buildContext } from './ctx.ts';
import type { SegmentResult } from './segment.ts';
import { resolveSegment } from './segment.ts';
import type { OutputBreakdown } from './output.ts';
import { buildOutput } from './output.ts';

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
  variantIndex?: number,
): ComputeResult {
  // D-120：单变体结算。传了 `variantIndex` 就**只算这一个面板变体**，
  // `segments` / `totalSpread` / `spreadByVariant` 都只含它——以前把「直接命中 + 爆炸」
  // 摊平后一起累加，界面的「基础」列把两个变体加在了一起（巴兹火枪的基础面板凭空多出爆炸 40）。
  // 不传则保持原行为（所有变体一起算）。
  const only = variantIndex !== undefined ? mode.variants?.[variantIndex] : undefined;
  const scopedMode: AttackMode = only ? { ...mode, variants: [only] } : mode;
  const ctx: Ctx = buildContext(weapon, scopedMode, contribs, options, beam);

  // D-080：段只属于变体，模式上不再有 `segments`。这里把（已缩到选中变体的）各段摊平：
  // 每个段仍独立结算，结果按变体顺序排列。
  const segs: DamageSegment[] = allSegments(scopedMode);

  // ── 每段的上游 computed 只算一次；逐段结算与 state 共用这一份（D-075）──
  // 之前 `resolveSegment()` 与 state 各算一遍玄骸→基伤，
  // 主段被计算两次，且 state 只覆盖第一段（60 把多段武器受影响）。
  const ups = segs.map((seg) => segmentUpstream(weapon, scopedMode, contribs, ctx, seg));
  const segments: SegmentResult[] = segs.map((seg, i) =>
    resolveSegment(ctx, seg, { 新面板: ups[i]!.state.computed.新面板, 基伤面板: ups[i]!.state.computed.基伤面板 }),
  );

  const totalSpread: DamageSpread = {};
  for (const s of segments) addSpread(totalSpread, s.finalHit);
  const moddedPanelTotal = spreadTotal(totalSpread);

  // 按变体分组累计（D-096）：段顺序 = allSegments(scopedMode) = 各变体段按序拼接
  const spreadByVariant: DamageSpread[] = [];
  {
    let cursor = 0;
    for (const variant of scopedMode.variants) {
      const acc: DamageSpread = {};
      for (let i = 0; i < variant.segments.length; i++) {
        const segRes = segments[cursor + i];
        if (!segRes) continue;
        addSpread(acc, segRes.finalHit);
      }
      cursor += variant.segments.length;
      spreadByVariant.push(acc);
    }
  }

  const output: OutputBreakdown = buildOutput(weapon, scopedMode, contribs, segments[0]!, ctx);

  // ── 计算链状态树：主段（D-075），downstream 一律从这里取值 ──
  // buildWeaponState 已含元素合成（D-102），所以 perSegment 直接就是完整 computed。
  const state: WeaponState = ups[0]!.state;
  const perSegment: WeaponState[] = ups.map((u) => u.state);
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
