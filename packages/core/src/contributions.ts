/**
 * 贡献（Contribution）：把 Mod / 赋能 / 自定义加成**全部摊成同一张表**。
 *
 * 口径来源：依据：核心事实 第 1 节与第 8 节。
 *   · `form`：三种输入形态（D-019 三选一）——
 *       'pct'  百分比加算   （+165% 基伤）
 *       'flat' 绝对值加算   （暴率 +5 点，私法套装即此类）
 *       'mul'  独立乘算     （×1.6）
 *   · `amount`：一律用**百分比口径**（165 = +165%），flat 用属性自身的单位（暴率 5 = +5 个百分点）。
 *   · `scope`：'hit' 只作用于命中、'dot' 只作用于 DoT、'both' 两者都吃。
 */
import type { DamageType } from './damage-types.ts';

/**
 * 派系（依据：核心事实 第 5 节）。
 *
 * 放在本文件而非 `main.ts`：`ContribStat` 的 `faction:<Faction>` 分支要引用它，
 * 而 `main.ts` 已 import 本文件——写在 main.ts 里会形成类型层的环依赖。
 */
export type Faction =
  | 'grineer'
  | 'corpus'
  | 'infested'
  | 'orokin'
  | 'murmur'
  /**
   * 1999 版本的两个势力（D-163，需求方 2026-11-12：「内核要补上这两个派系。
   * 对应的派系歧视mod是存在的」）。派系歧视类 Mod 与裂罅的派系词条都按这两个键走。
   */
  | 'techrot'
  | 'scaldra'
  /**
   * Sentient（S 系）：与 Orokin **不是**同一系（需求方 2026-11-17）。
   * 牺牲系列 Mod 的「对 Sentient 伤害」落在这里。
   * 注意：界面派系下拉**没有**这一项（需求方 2026-11-17），所以目前只影响数据正确性。
   */
  | 'sentient'
  | 'none';

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
  /**
   * 异常状态持续时间（需求方 2026-11-18）：**拉长 DoT 的存活时长**。
   * 每层独立计时，活满「6 秒 × (1 + Σ持续%)」才掉；跳数跟着变多，单跳伤害不变。
   */
  | 'statusDuration'
  | 'fireRate'
  | 'magazine'
  | 'reloadSpeed'
  /** 弹药效率（D-084）：**不**直接乘伤害，只通过 `effectiveAmmo` 换算成等效弹匣/最大弹药 */
  | 'ammoEfficiency'
  | 'headshotDamage'
  /**
   * 处决伤害（需求方 2026-11-13）：**独立乘区**，乘区内相加、再与前面所有乘区相乘。
   * 只有画龙点睛 / 猎人骨锯会贡献；不判断攻击类型（「跟普通攻击区分不开」）。
   */
  | 'finisherDamage'
  /**
   * 震地伤害（需求方 2026-11-13）：**独立乘区**，只对「震地 / 重型震地」生效
   * （模式带 `_slam` 标记才乘）。
   */
  | 'slamDamage'
  /**
   * **打身体时的伤害减少**（需求方 2026-11-13，细心瞄准的 `-45% Bodyshot Damage`）。
   *
   * 原话：「-45% 身体伤害就是减少未开启爆头配置的情况下，伤害总降」——
   * 所以它**只在「关闭爆头」时**生效（打身体），开启爆头时整条不生效。
   * 数值是负的百分比（-45 = 打身体时总伤害 ×(1−0.45)）。
   */
  | 'bodyshotDamage'
  /**
   * **近战·刃影**（D-189，需求方 2026-11-13）：基础暴击命中时追加一次攻击的概率。
   *
   * ```
   * 触发条件 = 主命中「正好是一级暴击」（k = 1）；二级及以上不触发
   * 追加那一下 = 按同一暴击率独立再判（未暴击 / 一级 / 二级都可能）
   * ```
   * 需求方原话：「一级暴击才触发，二级暴击时刃影可是不触发的」。
   *
   * 数值口径：百分比（满级 100），`amount / 100` 就是 `w`。
   * 落到哪两个量（需求方 2026-11-13 定）：
   *   · **命中平均** ×(1 + w·P1)                    —— 多打一下，直伤就多
   *   · **异常叠层期望** ×(1 + w·P1)                —— 追加是独立攻击，自己也触发异常
   *   · DoT / 爆炸的**每跳基础值不放大**（原话：「不放大 dot 基础值，只放大叠层」）
   * 实现见 `crit.ts` 的 `bladeShadowMultiplier`，接入点在 `segment.ts` 与 `output.ts`。
   */
  | 'bladeShadow'
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
  /**
   * 锁定多重射击（需求方 2026-11-13）。
   *
   * 敏锐主武 / 敏锐手枪的原文是 `Multishot cannot be modified`——与半自动炮轰系列的
   * `Fire Rate cannot be modified` 同构：挂上这个标记后，**所有多重来源
   * （正的负的都算）都不生效**，多重恒为面板值。
   *
   * ⚠ 与 `locksFireRate` 不同，多重是在**贡献层面**过滤的（`multishot()` 直接读贡献表，
   * 不走输入层的乘区快照），所以数据层给多重加成挂上这个标记即生效，见 `adapter.ts`。
   */
  locksMultishot?: boolean;
  /**
   * 这条加成在**重击系**攻击上额外 ×2（D-155）。
   *
   * 来源是 Mod 描述里的 `(x2 for Heavy Attacks)`：斩铁 / 镀层斩铁 / 牺牲斩铁 /
   * Amalgam Ripkas 斩铁，以及裂罅的暴击词条。需求方 2026-11-13：
   * > 「近战的固定暴击率词条例如斩铁或者裂罅mod上都会带有重击时*2，
   * >   对重击和重型震地生效。」
   *
   * 只挂在 `critChance` 上（同张卡上的暴伤 / 派系伤害不乘）。
   * 内核在暴击阶段按「重击模式 → 这部分贡献 ×2」重算暴率，见 `crit.ts`。
   */
  heavyX2?: boolean;
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

/**
 * 按属性取数的**索引**：属性 → 该属性的全部贡献。
 *
 * 建索引是 O(n)，之后每次取数是 O(1)，不再是每取一个属性就扫一遍全表。
 * 用 `WeakMap` 挂在贡献数组上：数组本身是配装不可变快照，同一份数组反复取数时
 * 索引自动复用；数组被换掉（换配装）时旧索引随之回收，不会串味。
 */
const indexByContribs = new WeakMap<readonly Contribution[], Map<string, Contribution[]>>();

/** 取（必要时建立）某份贡献数组的属性索引 */
function indexOf(contribs: readonly Contribution[]): Map<string, Contribution[]> {
  let idx = indexByContribs.get(contribs);
  if (idx) return idx;
  idx = new Map();
  for (const c of contribs) {
    let list = idx.get(c.stat);
    if (!list) { list = []; idx.set(c.stat, list); }
    list.push(c);
  }
  indexByContribs.set(contribs, idx);
  return idx;
}

/** 按属性精确取生效贡献 */
export function contributionsFor(
  contribs: readonly Contribution[],
  stat: ContribStat,
  filter: ContributionFilter = {},
): Contribution[] {
  // 走索引取该属性的条子集，再按作用范围过滤。
  // ⚠ 保持**原有顺序**：元素两两合成要按 `slot` 排，顺序乱了会合成错。
  const all = indexOf(contribs).get(stat);
  if (!all) return [];
  if (!filter.scope) return all.filter((c) => isContribActive(c));
  return all.filter((c) => isContribActive(c, filter.scope));
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
