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
