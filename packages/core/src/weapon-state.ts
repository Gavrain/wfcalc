/**
 * `WeaponState`：把计算链抽成**输入层 / computed 层**，下游读 computed，不重算。
 *
 * 设计意图（`docs/变量依赖图.md`，D-075）；
 * 元素合成部分调 `elements.ts`（D-102 拆出，去掉与 `main.ts` 的双向依赖）：
 *
 * ```
 * w.面板.*              输入的原子值
 * w.<属性>%Mod[]        输入的 Mod 列表（同名属性可以有好几张）
 * w.<属性>绝对加成[]
 *          │
 *          ▼ computed（只算一次）
 * w.当前<属性>          = f(面板, %Mod, 绝对值, 乘算)
 * w.新面板              = 面板.伤害分布 ⊕ 玄骸加成
 * w.基伤面板            = 新面板 × 基伤
 * w.元素槽位[]          = 基伤面板 × 元素/物理 %（合成前，各占一槽）
 * w.命中分布            = 元素槽位两两合成
 * ```
 *
 * **关键约束**：
 *   · 暴击乘区读 `state.computed.当前暴击率`，不再回面板重算；
 *   · 基伤读 `state.computed.新面板`，不再重新叠玄骸；
 *   · `w.新面板` / `w.命中分布` 是 **`Record<DamageType, number>`（数组形态）**，
 *     因为基础面板本来就好几种元素；
 *   · `w.元素槽位` 是数组，合成前**不合并**（自带元素与 Mod 元素各自独立）；
 *   · **面板多重来自 `mode.multishot`**，不是常量 1（57 把武器自带多重）。
 */
import type { AttackMode, DamageSegment, Weapon } from './weapon.ts';
import { panelStats } from './weapon.ts';
import type { Contribution, ContribStat } from './contributions.ts';
import { contributionsFor, sumFlat, sumPct } from './contributions.ts';
import type { DamageSpread, DamageType } from './damage-types.ts';
import { spreadTotal } from './damage-types.ts';
import type { BucketDetail, BucketableStat } from './buckets.ts';
import { bucket, bucketDetail } from './buckets.ts';
import type { Faction } from './contributions.ts';
import { applyElements } from './elements.ts';

/** 一张 Mod 的贡献（保留来源，便于逐乘区拆解） */
export interface ContribEntry {
  /** 来源 id（Mod id / 赋能 key / 'custom'） */
  src: string;
  /** 百分比口径（165 = +165%）；flat 用属性自身单位 */
  amount: number;
}

/** 输入层：不可再分 */
export interface WeaponStateInputs {
  /** 面板（模式 override 优先，D-050） */
  readonly panel: {
    readonly damage: DamageSpread;
    readonly critChance: number;
    readonly critMultiplier: number;
    readonly statusChance: number;
    readonly fireRate: number;
    readonly magazineSize: number;
    readonly reloadTime: number;
    /** **面板多重**（`mode.multishot`），不是常量 1 */
    readonly multishot: number;
  };
  /** 百分比加算（每类属性一个数组，因为可以有好几张 Mod） */
  readonly pct: Readonly<Record<BucketableStat, readonly ContribEntry[]>>;
  /** 绝对值加算 */
  readonly flat: Readonly<Record<BucketableStat, readonly ContribEntry[]>>;
  /** 独立乘算 */
  readonly mul: Readonly<Record<BucketableStat, readonly ContribEntry[]>>;
  /** 元素 %（`elemental:heat` 等，保留具体类型） */
  readonly elemental: readonly { stat: ContribStat; src: string; amount: number }[];
  /** 物理 % */
  readonly physical: readonly { stat: ContribStat; src: string; amount: number }[];
  /** 玄骸加成；非玄骸武器也在，值为 `{ type: null, ratio: 0 }` */
  readonly kuva: { readonly type: DamageType | null; readonly ratio: number };
}

/** 一个元素槽位（合成前） */
export interface StateSlot {
  type: DamageType;
  amount: number;
  /** 排队顺序：Mod 0~7、自带元素 9~12 */
  order: number;
  source: 'panel' | 'mod';
  sourceId?: string;
  fromMod: boolean;
}

/** computed 层：每个量与它依赖的输入/computed */
export interface WeaponStateComputed {
  readonly 当前暴击率: number;
  readonly 当前暴击伤害: number;
  readonly 当前触发率: number;
  readonly 当前射速: number;
  /** **面板多重 × (1+Σ%) + Σ绝对值** */
  readonly 当前多重: number;
  readonly 当前弹匣: number;
  /** 等效弹匣（**加成的**弹匣 × 弹药效率倍数），两位小数（D-129：基础列取 `panelStats` 的弹匣，即倍数 1） */
  readonly 等效弹匣: number;
  /** 弹药效率倍数（1 = 无加成）；≈ D-084 的 `a/(1-x)` 除以面板弹匣 */
  readonly 弹药效率倍数: number;
  readonly 当前装填时间: number;
  /** 面板 + 玄骸加成（**数组形态**） */
  readonly 新面板: DamageSpread;
  /** 新面板的合计（玄骸加成后的新面板总伤） */
  readonly 新面板总伤: number;
  /** 新面板 × (1 + Σ基伤%)（**数组形态**） */
  readonly 基伤面板: DamageSpread;
  readonly 基伤面板总伤: number;
  /** 合成前的元素槽位（**数组**，各自独立） */
  readonly 元素槽位: readonly StateSlot[];
  /** 合成后的命中分布（**数组形态**） */
  readonly 命中分布: DamageSpread;
  readonly 命中分布总伤: number;
}

export interface WeaponState {
  readonly weapon: Weapon;
  readonly mode: AttackMode;
  readonly segment: DamageSegment;
  readonly contribs: readonly Contribution[];
  readonly beam: boolean;
  readonly faction: Faction;
  readonly coStacks: number;
  readonly coStatusTypes: number;
  readonly inputs: WeaponStateInputs;
  readonly computed: WeaponStateComputed;
  /** 每个乘区的拆解（面板值 / Σpct / Σflat / Πmul / 最终值 / 贡献者） */
  readonly buckets: readonly BucketDetail[];
}

/**
 * 参与乘区骨架的属性。
 *
 * 注意 `faction` **不在** `BucketableStat` 里：派系加成按 `faction:<派系>` 分键
 * （第 5.2 节「异派系只一个生效」），由 `factionFor()` 单独取，不参与通用骨架。
 */
/**
 * 冰冻"满层"的层数（D-086）。需求方：「次要·冷颤……直接给满层数的类镀层加成」。
 * 冰冻按 10 层打满计；改这个常量即可调整。
 */
export const FROZEN_FULL_STACKS = 10;

const BUCKET_STATS: readonly BucketableStat[] = [
  'baseDamage',
  'multishot',
  'critChance',
  'critMultiplier',
  'statusChance',
  'fireRate',
  'statusDamage',
  'magazine',
  'reloadSpeed',
];

/**
 * 镀层类伤害乘区（A-03 已定案，见 `docs/decisions.md` D-024）。
 *
 * 规则原文：「目标每具有 1 种异常状态 +x% 伤害，最多叠加 y 次」⇒
 * ```
 * 镀层加量 = x% × a × y
 *   x = 每层百分比（Mod 的 +X%，已在 Contribution.amount 里）
 *   y = 叠加上限（击杀后获得的 buff 层数，默认取 Mod 描述的最大值）
 *   a = 目标身上异常状态的**种类数**（不是层数：中毒 5 层只算 1 种）
 * ```
 * 返回值是**小数口径**（1.2 = +120%），直接进基伤括号。
 *
 * 放在本文件而不是 `main.ts`：`基伤面板` 这个 computed 要用它，
 * 若留在 `main.ts` 会形成 main ↔ weapon-state 的循环依赖。
 *
 * @param contribs 全部贡献（其中 `stat: 'co'` 的即镀层类）
 * @param coStacks 实际生效的叠层数 `y`（UI 下拉框，默认 = maxStacks）
 * @param statusTypes 目标身上的异常状态**种类数** `a`（UI 下拉框）
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
 * 共同点：都只吃**直接伤害**，不吃灵化基伤、不吃 AoE（见 `buildWeaponState` 的 `baseFactor`）。
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
 * **弹药效率 → 等效弹药倍数**（D-084）。
 *
 * 需求方 2026-11-06 的解释：弹药消耗可以是小数，为了便于计算，
 * 把它视为**等效增加最大弹药与弹匣数量**；「弹药效率为 x，则提升的弹药与弹匣为 a/(1-x)」，
 * 面板上弹匣显示两位小数。
 *
 * ## 口径推导（⚠ 与需求方给的 `a/(1-x)` 写法不同，实施的是下面这个）
 *
 * 弹药效率的定义是「每一发**实际**只消耗 `1-x` 发」。假设武器有 `a` 发、可以打 `n` 次，
 * 实际消耗与库存相等：`n · (1-x) = a` → **`n = a / (1-x)`**。
 * 所以：
 * - `a / (1-x)` 是**使用次数**（能开多少次），不是"弹药数量"；
 * - 等效**弹匣容量** = `a · (1/(1-x) - 1) = a · x/(1-x)`（即"额外多出来"的部分）。
 * 两者差一个 `a`：例如 `a = 60, x = 0.5` → 能开 **120 次**，等效弹匣 = 60 + 60 = **120**
 * （把"额外部分"加上原弹匣也正好是 120，这就是口径一致的地方）。
 *
 * 因此本函数返回：
 * ```
 * 使用次数倍数 = 1/(1-x)      （= XP 口径的 a/(1-x) ÷ a）
 * 等效弹匣     = 面板弹匣 × 使用次数倍数
 * ```
 * ⚠ `x` 在内部夹到 `[0, 0.95]`：`x = 1` 时弹匣无限（除零），面板无法展示。
 *
 * @param panelMagazine 面板弹匣（未经弹药效率）
 * @param contribs 全部贡献（取 `ammoEfficiency` 的 pct 之和，小数口径）
 */
export function ammoEfficiencyMultiplier(contribs: readonly Contribution[]): number {
  const x = sumPct(contribs, 'ammoEfficiency');
  const clamped = Math.min(Math.max(x, 0), 0.95);
  return 1 / (1 - clamped);
}

/** 面板展示用：弹匣保留两位小数（D-084） */
export function displayMagazine(value: number): number {
  return Math.round(value * 100) / 100;
}

function collect(contribs: readonly Contribution[], stat: ContribStat, form: 'pct' | 'flat' | 'mul'): ContribEntry[] {  return contributionsFor(contribs, stat)
    .filter((c) => c.form === form)
    .map((c) => ({ src: c.source, amount: c.amount }));
}

/** 各乘区的面板值（供 bucketDetail 用） */
function panelValueOf(stat: BucketableStat, ps: ReturnType<typeof panelStats>): number {
  switch (stat) {
    case 'critChance':
      return ps.critChance;
    case 'critMultiplier':
      return ps.critMultiplier;
    case 'statusChance':
      return ps.statusChance;
    case 'fireRate':
      return ps.fireRate;
    case 'multishot':
      return ps.multishot;
    case 'magazine':
      return ps.magazineSize;
    case 'reloadSpeed':
      return ps.reloadTime;
    // baseDamage 的面板值就是分布本身；statusDamage 是纯加成项，面板为 0
    default:
      return 0;
  }
}

/**
 * 构建 `WeaponState`。
 *
 * ⚠ 这里做「把输入算成 computed」，包括 `元素槽位` / `命中分布` ——
 * 元素合成调的是 `elements.ts` 的 `applyElements()`（与结算链共用同一个实现）。
 *
 * > D-102：之前这一段由调用方（`main.ts` 的 `buildState()`）在返回后补填，
 * > 造成 `main ↔ weapon-state` 双向依赖；现在依赖方向是 `weapon-state → elements`，单向。
 */
export function buildWeaponState(
  weapon: Weapon,
  mode: AttackMode,
  contribs: readonly Contribution[],
  opts: {
    beam: boolean;
    faction: Faction;
    coStacks: number;
    coStatusTypes: number;
    kuva?: { type: DamageType; ratio: number } | undefined;
    segment: DamageSegment;
  },
): { state: WeaponState } {
  const ps = panelStats(weapon, mode);

  // ── 输入层 ──
  const pct = {} as Record<BucketableStat, ContribEntry[]>;
  const flat = {} as Record<BucketableStat, ContribEntry[]>;
  const mul = {} as Record<BucketableStat, ContribEntry[]>;
  for (const stat of BUCKET_STATS) {
    pct[stat] = collect(contribs, stat, 'pct');
    flat[stat] = collect(contribs, stat, 'flat');
    mul[stat] = collect(contribs, stat, 'mul');
  }
  // 锁定射速（D-091）：半自动炮轰系列「Fire Rate cannot be modified」——
  // 一旦有任意贡献带这个标记，**所有**射速来源（正的负的都算）都不生效。
  const lockedFireRate = contribs.some((c) => c.locksFireRate);
  if (lockedFireRate) {
    pct.fireRate = [];
    flat.fireRate = [];
    mul.fireRate = [];
  }

  const inputs: WeaponStateInputs = {
    panel: {
      damage: { ...opts.segment.damage },
      critChance: ps.critChance,
      critMultiplier: ps.critMultiplier,
      statusChance: ps.statusChance,
      fireRate: ps.fireRate,
      magazineSize: ps.magazineSize,
      reloadTime: ps.reloadTime,
      multishot: ps.multishot,
    },
    pct,
    flat,
    mul,
    elemental: contribs
      .filter((c) => c.stat.startsWith('elemental:'))
      .map((c) => ({ stat: c.stat, src: c.source, amount: c.amount })),
    physical: contribs
      .filter((c) => c.stat.startsWith('physical:'))
      .map((c) => ({ stat: c.stat, src: c.source, amount: c.amount })),
    kuva: opts.kuva ? { type: opts.kuva.type, ratio: opts.kuva.ratio } : { type: null, ratio: 0 },
  };

  // ── 乘区拆解（唯一取值入口；下游读 computed，不再各自重算）──
  // ⚠ 传的是**过滤后**的 contribs（锁定射速时射速来源已被剔除），
  //   不能传原始 contribs，否则锁定射速会被绕过。
  const bucketContribs = lockedFireRate ? contribs.filter((c) => c.stat !== 'fireRate') : contribs;
  const buckets: BucketDetail[] = BUCKET_STATS.map((stat) =>
    bucketDetail(panelValueOf(stat, ps), stat, bucketContribs),
  );
  const byStat = (stat: BucketableStat): number => buckets.find((b) => b.stat === stat)?.value ?? 0;

  // ── computed 层 ──
  const 当前多重 = byStat('multishot');
  const 新面板总伤 = spreadTotal(inputs.panel.damage) * (1 + inputs.kuva.ratio);
  // 新面板 = 面板 + {玄骸元素: 面板总伤 × 比例}（非玄骸 ratio = 0，逐型相加仍是原样）
  const 新面板: DamageSpread = { ...inputs.panel.damage };
  if (inputs.kuva.type) {
    const amount = spreadTotal(inputs.panel.damage) * inputs.kuva.ratio;
    新面板[inputs.kuva.type] = (新面板[inputs.kuva.type] ?? 0) + amount;
  }

  // ── 基伤面板 ──
  // ⚠ 必须与 `applyBaseDamage()` **完全相同**：基伤系数 k = (1 + Σ基伤%) + 镀层加量，
  //   且镀层**不吃 AoE 段**（D-024：爆炸段只吃普通基伤）。
  //   之前这里只写了 `1 + sumPct(baseDamage)`，漏掉 `overForStacks`，
  //   导致镀层 Mod（步枪才能等）在 state 里完全不生效。
  const g = 1 + sumPct(contribs, 'baseDamage');
  const co = overForStacks(contribs, opts.coStacks, opts.coStatusTypes);
  // 类镀层（只认冰冻层数，D-086）：同样只吃直接非灵化伤害，不吃 AoE
  // 类镀层（冷颤）：**固定满层**，不读配置里的异况层数（需求方 2026-11-06 澄清：
  // 「冷颤固定是十层，不参考这个」）。这个输入框只服务于镀层系列的"异况数量"。
  const freezeCo = overForElement(contribs, 'coFreeze', FROZEN_FULL_STACKS);
  // 「只有**直接非灵化**加成伤害才能享受」（需求方 2026-11-06）：
  //   · AoE 段（explosiveAttack）不吃；
  //   · 灵化模式（mode.role === 'incarnon'）不吃。
  const isAoeSeg = opts.segment.kind === 'explosiveAttack';
  const isIncarnonMode = mode.role === 'incarnon';
  const baseFactor = isAoeSeg ? g : g + co + (isIncarnonMode ? 0 : freezeCo);
  const 基伤面板: DamageSpread = {};
  for (const [t, v] of Object.entries(新面板) as [DamageType, number][]) {
    if (typeof v === 'number' && v !== 0) 基伤面板[t] = v * baseFactor;
  }

  const reloadSpeedMul = 1 + sumPct(contribs, 'reloadSpeed');
  // 弹药效率（D-084）：只影响弹匣/最大弹药，不进伤害乘区
  const ammoMul = ammoEfficiencyMultiplier(contribs);
  const 当前弹匣 = byStat('magazine');
  const 等效弹匣 = displayMagazine(当前弹匣 * ammoMul);

  // 元素合成（合成前各占一槽 → 两两配对），与 `resolveSegment()` 共用同一实现
  const el = applyElements(基伤面板, contribs, 'hit');

  return {
    state: {
      weapon,
      mode,
      segment: opts.segment,
      contribs,
      beam: opts.beam,
      faction: opts.faction,
      coStacks: opts.coStacks,
      coStatusTypes: opts.coStatusTypes,
      inputs,
      buckets,
      computed: {
        当前暴击率: byStat('critChance'),
        当前暴击伤害: byStat('critMultiplier'),
        当前触发率: byStat('statusChance'),
        当前射速: byStat('fireRate'),
        当前多重,
        当前弹匣,
        弹药效率倍数: ammoMul,
        等效弹匣,
        当前装填时间: inputs.panel.reloadTime > 0 && reloadSpeedMul > 0
          ? inputs.panel.reloadTime / reloadSpeedMul
          : inputs.panel.reloadTime,
        新面板,
        新面板总伤,
        基伤面板,
        基伤面板总伤: spreadTotal(基伤面板),
        元素槽位: el.slots,
        命中分布: el.v,
        命中分布总伤: spreadTotal(el.v),
      },
    },
  };
}

/** 便捷：某个乘区的最终值（暴击乘区用它取值，而不是自己从面板重算） */
export function statValue(state: WeaponState, stat: BucketableStat): number {
  const b = state.buckets.find((x) => x.stat === stat);
  if (b) return b.value;
  return bucket(0, stat, state.contribs);
}

/** 便捷：绝对值求和 */
export function sumFlatOf(state: WeaponState, stat: BucketableStat): number {
  return sumFlat(state.contribs, stat);
}
