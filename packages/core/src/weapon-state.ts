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
import type { AttackMode, DamageSegment, ModeVariant, Weapon } from './weapon.ts';
import { panelStats } from './weapon.ts';
import type { Contribution, ContribStat } from './contributions.ts';
import { contributionsFor, sumFlat, sumPct } from './contributions.ts';
import type { DamageSpread, DamageType } from './damage-types.ts';
import { spreadTotal } from './damage-types.ts';
import type { BucketDetail, BucketableStat } from './buckets.ts';
import { applyBaseDamage, bucket, bucketDetail } from './buckets.ts';
import { critBucketContribs } from './crit.ts';
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
  /** **等效弹匣**（需求方 2026-11-15 A6+A7）：桶弹匣 × 1/(1−弹药效率)，弹药效率上限 0.75。 */
  readonly 当前弹匣: number;
  /** 等效弹匣（**与 `当前弹匣` 同值**；保留旧字段名供既有调用点） */
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
  /** 计算该状态时的选项快照（爆头开关 / 叠层等），面板与结算必须读同一份 */
  readonly options: {
    readonly headshotEnabled: boolean;
    readonly headshotMultiplier: number;
  };
}

/**
 * 参与乘区骨架的属性。
 *
 * 注意 `faction` **不在** `BucketableStat` 里：派系加成按 `faction:<派系>` 分键
 * （第 5.2 节「异派系只一个生效」），由 `factionFor()` 单独取，不参与通用骨架。
 */
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
 * 基伤乘区相关（`overForStacks` / `overForElement` / `applyBaseDamage` / `FROZEN_FULL_STACKS`）
 * 的实现已移到 `buckets.ts`。
 *
 * 为什么搬：`segment.ts` 与 `weapon-state.ts` **都要用**基伤乘区，
 * 而 `segment` 已经从 `weapon-state` 取 `overForStacks`——若 `weapon-state` 反向
 * 依赖 `segment` 的 `applyBaseDamage` 就成环。放到 `buckets.ts`（只依赖
 * contributions / damage-types / weapon 的类型）即可两边共用同一个实现。
 */
export { overForElement, overForStacks, FROZEN_FULL_STACKS, applyBaseDamage } from './buckets.ts';

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
 * ⚠ **需求方 2026-11-15（A7）**：弹药效率的上限是 **0.75**（不是 0.95），
 * 即等效弹匣最多为面板的 **4 倍**；`x` 在内部夹到 `[0, 0.75]`。
 *
 * @param panelMagazine 面板弹匣（未经弹药效率）
 * @param contribs 全部贡献（取 `ammoEfficiency` 的 pct 之和，小数口径）
 */
export const AMMO_EFFICIENCY_MAX = 0.75;

export function ammoEfficiencyMultiplier(contribs: readonly Contribution[]): number {
  const x = sumPct(contribs, 'ammoEfficiency');
  const clamped = Math.min(Math.max(x, 0), AMMO_EFFICIENCY_MAX);
  return 1 / (1 - clamped);
}

/**
 * **等效弹匣**（需求方 2026-11-15 / A6 + A7）：三处口径统一读这一个函数。
 *
 * ```
 * 等效弹匣 = bucket(面板弹匣) × 1/(1 − 弹药效率)     ← 弹药效率夹在 [0, 0.75]
 * ```
 *
 * 「等效弹匣」单列一行，而续航秒伤公式里又自己乘了一遍弹药效率——
 * 三处各有各的算法。现在面板 / 拆解 / 续航秒伤都读它。
 */
export function effectiveMagazine(
  panelMagazine: number,
  contribs: readonly Contribution[],
): number {
  return bucket(panelMagazine, 'magazine', contribs) * ammoEfficiencyMultiplier(contribs);
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
    /** 爆头开关（需求方 2026-11-15）：弱点暴击率只在开爆头时并入暴率 */
    headshotEnabled?: boolean;
    headshotMultiplier?: number;
    /** 该段所属的攻击方式（面板 override 用，C2） */
    variant?: ModeVariant | undefined;
  },
): { state: WeaponState } {
  // C2（需求方 2026-11-15）：面板取值顺序「变体 override → 模式 override → 武器级」。
const ps = panelStats(weapon, mode, opts.variant);

  // ── 输入层 ──
  const pct = {} as Record<BucketableStat, ContribEntry[]>;
  const flat = {} as Record<BucketableStat, ContribEntry[]>;
  const mul = {} as Record<BucketableStat, ContribEntry[]>;
  for (const stat of BUCKET_STATS) {
    pct[stat] = collect(contribs, stat, 'pct');
    flat[stat] = collect(contribs, stat, 'flat');
    mul[stat] = collect(contribs, stat, 'mul');
  }
  // 锁定射速（D-091）/ 锁定多重（需求方 2026-11-13）：
  // 这里的 pct/flat/mul 是**输入层快照**，供界面展示"这条贡献原本是多少"，
  // 不做任何过滤——「锁没锁、锁了按 0 计」统一由乘区入口 `bucketDetail()` 判定。
  //   等于同一件事在两处各判一次：快照显示 0、伤害路径却拿到原始加成，两边对不上
  //   （锁射速时装射速卡，连发秒伤照样涨）。现在只留 `bucketDetail()` 一处。

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
  // 传**原始** contribs：锁射速 / 锁多重由 `bucketDetail()` 自己判（见 `isStatLocked`），
  // 这里再过滤一遍就会和伤害路径（`fireRateFinal()` / `multishot()`）判出两套结果。
  //
  // 需求方 2026-11-15（A1 / A2）：**弱点暴击率与普通暴击率是同一个乘区里的 Σ%**（开爆头时计入），
  // **重击 ×2 也要体现在面板上**。两件事的折算只写在 `critBucketContribs()` 一处，
  // 面板 / 拆解（这里）与结算（`critChanceTotal()`）都调它，保证三处永远是同一个数。
  const bucketContribsHeavy: readonly Contribution[] = critBucketContribs(
    contribs,
    mode._heavy === true,
    opts.headshotEnabled === true,
  );
  const buckets: BucketDetail[] = BUCKET_STATS.map((stat) =>
    bucketDetail(panelValueOf(stat, ps), stat, bucketContribsHeavy),
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
  // **直接调用真正的基伤乘区 `applyBaseDamage()`**（需求方 2026-11-14：
  // 「这两个肯定应该是一样的，伤害分布不是应该直接调用基伤和其他的乘区吗」）。
  //
  // 「灵化模式不吃冷颤」的判断。那份与 `applyBaseDamage()` 已经分叉——
  // 它按"整个模式是不是灵化"整段关掉冷颤，而口径是"只有被动基伤那一路不吃"，
  // 面板基伤那一路照样该吃。分叉还会让面板展示与实际结算对不上。
  // 现在只有一个实现，这里只负责把上游参数传进去。
  const 基伤面板: DamageSpread = applyBaseDamage(
    新面板,
    opts.segment,
    contribs,
    opts.coStacks,
    opts.coStatusTypes,
    opts.segment.passiveBaseDamage,
  );

  const reloadSpeedMul = 1 + sumPct(contribs, 'reloadSpeed');
  // 弹药效率（D-084 / 需求方 2026-11-15 A6+A7）：等效弹匣 = 桶弹匣 × 1/(1−x)（x 夹在 [0,0.75]）。
  // 面板「弹匣容量」、拆解、续航秒伤**都读 `等效弹匣`**，不再一处一个算法。
  const ammoMul = ammoEfficiencyMultiplier(contribs);
  const 等效弹匣值 = effectiveMagazine(inputs.panel.magazineSize, contribs);
  const 当前弹匣 = displayMagazine(等效弹匣值);
  const 等效弹匣 = displayMagazine(等效弹匣值);

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
      options: {
        headshotEnabled: opts.headshotEnabled === true,
        headshotMultiplier: opts.headshotMultiplier ?? 3,
      },
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