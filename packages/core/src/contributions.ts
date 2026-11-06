/**
 * 贡献（Contribution）：把 Mod / 赋能 / 自定义加成**全部摊成同一张表**。
 *
 * 口径来源：`docs/伤害公式.md` 第 1 节与第 8 节。
 *   · `form`：三种输入形态（D-019 三选一）——
 *       'pct'  百分比加算   （+165% 基伤）
 *       'flat' 绝对值加算   （暴率 +5 点，私法套装即此类）
 *       'mul'  独立乘算     （×1.6）
 *   · `amount`：一律用**百分比口径**（165 = +165%），flat 用属性自身的单位（暴率 5 = +5 个百分点）。
 *   · `scope`：'hit' 只作用于命中、'dot' 只作用于 DoT、'both' 两者都吃。
 */
import type { DamageType } from './damage-types.ts';

/**
 * 派系（`docs/乘区归属表.md` 第 5 节）。
 *
 * 放在本文件而非 `main.ts`：`ContribStat` 的 `faction:<Faction>` 分支要引用它，
 * 而 `main.ts` 已 import 本文件——写在 main.ts 里会形成类型层的环依赖。
 */
export type Faction = 'grineer' | 'corpus' | 'infested' | 'orokin' | 'murmur' | 'none';

/**
 * 可被加成的属性。
 *
 * 元素/物理/派系用**模板字面量**表达，而不是宽 `'faction'`：
 * 派系乘区只认「目标所属派系」那一条（第 5.2 节，异派系 ×1），
 * 如果键写成宽 `'faction'`，内核就无法区分是打 Grineer 还是打 Corpus 的加成。
 */
export type ContribStat =
  | 'baseDamage'
  | 'innateBaseDamage'
  | 'co'
  /**
   * 类镀层、但**只认冰冻层数**（D-086，次要·冷颤）：
   * 每层冰冻 +45% 伤害，只吃直接非灵化伤害。
   */
  | 'coFreeze'
  | 'multishot'
  | 'critChance'
  | 'critMultiplier'
  | 'statusChance'
  | 'statusDamage'
  | 'fireRate'
  | 'magazine'
  | 'reloadSpeed'
  /** 弹药效率（D-084）：**不**直接乘伤害，只通过 `effectiveAmmo` 换算成等效弹匣/最大弹药 */
  | 'ammoEfficiency'
  | 'headshotDamage'
  | 'weakpointCritChance'
  | 'weakpointDamage'
  | 'targetSlot'
  | 'utility'
  | `elemental:${DamageType}`
  | `physical:${DamageType}`
  | `faction:${Faction}`;

export type ContribForm = 'pct' | 'flat' | 'mul';
export type ContribScope = 'hit' | 'dot' | 'both';

export interface Contribution {
  stat: ContribStat;
  form: ContribForm;
  /** 百分比口径：165 = +165%；flat 用属性自身单位；mul 用倍数（1.6 = ×1.6） */
  amount: number;
  /** 缺省 'both' */
  scope?: ContribScope;
  /** 来源 id（mod id / arcane key / 'custom'），用于逐乘区拆解 */
  source: string;
  /** 槽位序号（元素两两合成用，§5.3 的 `order`） */
  slot?: number;
  /** 条件类是否被用户勾选生效（A-04 / D-019）。false 的贡献**不参与计算**。 */
  active?: boolean;
  /** 展示用的中文说明，如「膛线 +165%」 */
  label?: string;
  /**
   * 锁定射速（D-091）。
   *
   * 半自动炮轰系列（Semi-Pistol/Rifle/Shotgun Cannonade）的负面效果：
   * 「Fire Rate cannot be modified」。挂上这个标记后，
   * **所有射速来源（正的和负的）都不生效**，射速恒为基础射速。
   */
  locksFireRate?: boolean;
}

export interface ContributionFilter {
  scope?: 'hit' | 'dot';
}

/** 该贡献是否在当前 scope 下生效 */
export function isContribActive(c: Contribution, scope?: 'hit' | 'dot'): boolean {
  if (c.active === false) return false;
  if (!scope) return true;
  const s = c.scope ?? 'both';
  return s === 'both' || s === scope;
}

/** 按属性精确取生效贡献 */
export function contributionsFor(
  contribs: readonly Contribution[],
  stat: ContribStat,
  filter: ContributionFilter = {},
): Contribution[] {
  return contribs.filter((c) => c.stat === stat && isContribActive(c, filter.scope));
}

/** Σ pct（返回值是**小数**：165 → 1.65） */
export function sumPct(
  contribs: readonly Contribution[],
  stat: ContribStat,
  filter: ContributionFilter = {},
): number {
  return contributionsFor(contribs, stat, filter)
    .filter((c) => c.form === 'pct')
    .reduce((a, c) => a + c.amount / 100, 0);
}

/** Σ flat（保留属性自身单位） */
export function sumFlat(
  contribs: readonly Contribution[],
  stat: ContribStat,
  filter: ContributionFilter = {},
): number {
  return contributionsFor(contribs, stat, filter)
    .filter((c) => c.form === 'flat')
    .reduce((a, c) => a + c.amount, 0);
}

/** Π mul（多个乘算连乘） */
export function productMul(
  contribs: readonly Contribution[],
  stat: ContribStat,
  filter: ContributionFilter = {},
): number {
  return contributionsFor(contribs, stat, filter)
    .filter((c) => c.form === 'mul')
    .reduce((a, c) => a * c.amount, 1);
}
