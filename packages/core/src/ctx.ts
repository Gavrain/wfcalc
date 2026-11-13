/**
 * 结算上下文：一次计算用的"武器 + 模式 + 贡献 + 选项"打包。
 *
 * 只有类型与一个构造函数，不依赖任何计算阶段，所以链条上每个阶段都能引用它。
 */
import type { DamageType } from './damage-types.ts';
import type { AttackMode, Weapon } from './weapon.ts';
import type { Contribution, Faction } from './contributions.ts';

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
  /**
   * 近战**连击倍率**（需求方 2026-11-13）。
   *
   * 急进猛突（+X% 暴率 × 连击倍率）、创口溃烂（+X% 触发 × 连击倍率）用它；
   * 界面上近战武器始终显示这个框，默认 **12x**（凯旋之爪满层为 13x）。
   */
  comboMultiplier?: number;
  /**
   * 次要·爆发的**爆发层数**（需求方 2026-11-13）。
   *
   * 描述是「消耗所有连击倍率，每层消耗的连击倍率 +20% 暴率 / +20% 暴伤」，
   * 层数 = 被消耗的连击倍率。界面装上次要·爆发才显示这个框，默认 **12 层**，最高 13。
   */
  burstStacks?: number;
  /**
   * 「N 秒异常总伤 / N 秒总伤」的窗口长度（秒，D-171，需求方 2026-11-13）。
   *
   * 以前写死 6 秒；现在界面上可以选 1~6 秒。缺省 = 6（行为与以前一致）。
   * 只有整数秒：曲线是**逐秒累加**的，小数秒怎么切分尚未确认，不收。
   */
  dotWindowSeconds?: number;
}

/** 「N 秒」窗口的默认长度（秒） */
export const DEFAULT_DOT_WINDOW_SECONDS = 6;

/** 窗口秒数的允许范围（需求方 2026-11-13：「6 后面就不要了」） */
export const DOT_WINDOW_MIN_SECONDS = 1;
export const DOT_WINDOW_MAX_SECONDS = 6;

/**
 * 把调用方给的窗口秒数归一到合法值：整数、夹在 1~6、非法值回退到 6。
 *
 * 为什么要夹：窗口是**逐秒循环**的上限，传 0 会得到全 0、传小数会让"第几秒"失去意义。
 */
export function normalizeDotWindowSeconds(v: number | undefined): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < DOT_WINDOW_MIN_SECONDS) return DEFAULT_DOT_WINDOW_SECONDS;
  return Math.min(DOT_WINDOW_MAX_SECONDS, n);
}

export interface Ctx {
  weapon: Weapon;
  mode: AttackMode;
  /** 全部贡献（Mod / 赋能 / 自定义），已摊成同一张表 */
  contribs: readonly Contribution[];
  options: CtxOptions;
  /**
   * 射线标记。**由模式自己决定**（D-148）：取 `mode.beam`。
   *
   * 以前是调用方传的布尔值（D-010 人工表），现已改为数据层按扳机 + `shot_type` 判好写在模式上，
   * 所以同一个武器的不同模式可以有各自的取值（幻离子的射线主模式 vs 子母弹副模式）。
   */
  beam: boolean;
  headshot: HeadshotOptions;
  faction: Faction;
  /** 镀层类叠层数 y */
  coStacks: number;
  /** 镀层类：目标异常状态种类数 a */
  coStatusTypes: number;
  /** 「N 秒异常总伤 / N 秒总伤」的窗口长度（秒，已归一到 1~6 的整数，D-171） */
  dotWindowSeconds: number;
}

/**
 * 该模式是不是射线（D-148）。**只认扳机**：`trigger === 'held'`。
 *
 * 数据层按 WFCD 把扳机归一好（`Held` → `'held'`），所以这里不需要额外的标记字段。
 */
export function isBeamMode(mode: AttackMode): boolean {
  return mode.trigger === 'held';
}

/**
 * 构造结算上下文。
 *
 * 「是不是射线」**不再由调用方传入**（D-148）：直接取 `mode.beam`，
 * 数据层按扳机（`Held`）+ `shot_type`（`Hit-Scan`）判好后写在模式上。
 */
export function buildContext(
  weapon: Weapon,
  mode: AttackMode,
  contribs: readonly Contribution[],
  options: CtxOptions = {},
): Ctx {
  const headshot: HeadshotOptions = options.headshot ?? { enabled: false, multiplier: 3.0 };
  return {
    weapon,
    mode,
    contribs,
    options,
    beam: isBeamMode(mode),
    headshot,
    faction: options.faction ?? 'none',
    coStacks: options.coStacks ?? 0,
    coStatusTypes: options.coStatusTypes ?? 0,
    dotWindowSeconds: normalizeDotWindowSeconds(options.dotWindowSeconds),
  };
}
