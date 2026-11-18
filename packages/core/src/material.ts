/**
 * 素材池（v2 的第一步）：把扁平贡献**按乘区键分组**，并给出每个键的**汇总值**。
 *
 * 依据：核心事实 §11（内核只吃结构化事实）+ `docs/specs/架构设计/core-v2-架构设计.md` §4。
 *
 * ```
 * Contribution[]  ──collectMaterials()──►  MaterialBucket[]
 *                                   ├─ 每条素材（带来源，可追溯）
 *                                   └─ 汇总（pct / flat / mul 各自求和）
 * ```
 *
 * **只做分组与求和，不改任何计算**：现有计算路径仍读 `Contribution[]`，
 * 这里的产物目前只服务"验证页"与"拆解"这类**展示**用途。
 * 等展示侧确认无误后，计算侧才逐步改成读素材池。
 *
 * 两种"镀层"单独成键（不进普通百分比）：
 *   · `co`      每层值，实际加量 = 每层值 × 异况种类数 a × 叠层 y
 *   · `coFreeze` 每层值，实际加量 = 每层值 × 冰冻层数
 * 它们的贡献是**动态**的，混进普通百分比会看错。
 */
import type { Contribution, ContribForm, ContribStat } from './contributions.ts';

/** 一条素材：来自某个来源的一次加成 */
export interface MaterialEntry {
  /** 百分比口径（165 = +165%）；flat 用属性自身单位；mul 用倍数 */
  value: number;
  form: ContribForm;
  /** 来源 id（mod id / arcane key / riven / 套装名…） */
  source: string;
  /** 槽位序号（元素两两合成用） */
  slot?: number;
  /** 展示用中文说明（如「膛线 +165%」） */
  label?: string;
  /** 条件类是否生效；`false` = 不参与计算（该条仍列出，便于核对） */
  active?: boolean;
  /** 重击时 ×2（数据给的结构化标记） */
  heavyX2?: boolean;
}

/** 一个乘区里的汇总 */
export interface MaterialTotal {
  /**
   * 该乘区是否被**锁定**（射速 / 多重）。
   * 锁定后实际值按 0 计（面板值本身不变），但 `pct` / `flat` 仍保留原值，
   * 便于界面显示「165% ×0」而不是让人以为"本来就没有"。
   */
  locked?: true;
  /** 所有 `pct` 素材之和 */
  pct: number;
  /** 所有 `flat` 素材之和 */
  flat: number;
  /** 所有 `mul` 素材之**积**（没有 mul 时为 1） */
  mul: number;
  /** 参与汇总的素材条数 */
  count: number;
}

/** 一个乘区 */
export interface MaterialBucket {
  key: string;
  entries: MaterialEntry[];
  total: MaterialTotal;
}

/** 输入层（乘区之前） */
export interface InputLayer {
  /** 玄骸元素加成；没有玄骸武器时缺省 */
  kuva?: {
    /** 加成的元素 */
    type: string;
    /** 加成比例（0.25~0.6） */
    ratio: number;
    /** 实际加到面板上的伤害量（**不是百分比**） */
    amount: number;
    /** 参与计算的段数 */
    segments: number;
  };
}

/** 素材池快照 */
export interface MaterialPool {
  /** 按键的素材池（顺序按键名升序，便于比对） */
  buckets: MaterialBucket[];
  /** 参与分组的总条数 */
  totalEntries: number;
  /**
   * **输入层**：发生在所有乘区**之前**的改动。
   *
   * 目前只有玄骸元素加成——它改的是"面板"本身（`加量 = 面板总伤 × 比例`），
   * 之后所有乘区的 pct/flat/mul 都建立在加成后的面板上。
   * 所以它**不是某个乘区的一条素材**，不能混进 `elemental:heat` 那样的桶里。
   */
  input: InputLayer;
  /**
   * 自检：**逐个乘区**核对——每个桶的汇总值必须等于该桶各素材之和。
   *
   * ⚠ 不要把不同桶的 pct 加起来：基伤与触发率是两个乘区，相加没有物理意义
   *   （旧实现把所有 pct 一起加，得到"245%"这种数字）。
   */
  check: {
    ok: boolean;
    /** 输入贡献条数 */
    inputCount: number;
    /** 分桶后条目数（应等于 inputCount） */
    bucketedCount: number;
    /** 汇总 ≠ 素材之和的桶（正常为空） */
    badBuckets: readonly string[];
  };
}

/** 该条是否参与计算（`active === false` 的不算） */
function isActive(c: Contribution): boolean {
  return c.active !== false;
}

/**
 * 把贡献数组收成素材池。
 *
 * @param contribs 全部贡献（通常就是 `compute()` 收到的那个数组）
 */
export function collectMaterials(
  contribs: readonly Contribution[],
  input: InputLayer = {},
): MaterialPool {
  const map = new Map<string, MaterialEntry[]>();
  // 锁：任一贡献带标记 → 该属性整桶失效（正的负的都不算）
  let locksFireRate = false;
  let locksMultishot = false;
  for (const c of contribs) {
    if (c.locksFireRate === true) locksFireRate = true;
    if (c.locksMultishot === true) locksMultishot = true;
  }
  let totalEntries = 0;

  for (const c of contribs) {
    const entry: MaterialEntry = {
      value: c.amount,
      form: c.form,
      source: c.source,
    };
    if (c.slot !== undefined) entry.slot = c.slot;
    if (c.label !== undefined) entry.label = c.label;
    if (c.active === false) entry.active = false;
    if (c.heavyX2 === true) entry.heavyX2 = true;

    let list = map.get(c.stat);
    if (!list) { list = []; map.set(c.stat, list); }
    list.push(entry);
    totalEntries++;
  }

  const buckets: MaterialBucket[] = [];
  const badBuckets: string[] = [];
  for (const key of [...map.keys()].sort()) {
    const entries = map.get(key)!;
    const total: MaterialTotal = { pct: 0, flat: 0, mul: 1, count: 0 };
    for (const e of entries) {
      if (e.active === false) continue;
      total.count++;
      if (e.form === 'pct') total.pct += e.value;
      else if (e.form === 'flat') total.flat += e.value;
      else total.mul *= e.value;
    }
    // 逐个乘区核对：本桶的汇总必须等于本桶素材之和
    let rePct = 0, reFlat = 0, reMul = 1;
    for (const e of entries) {
      if (e.active === false) continue;
      if (e.form === 'pct') rePct += e.value;
      else if (e.form === 'flat') reFlat += e.value;
      else reMul *= e.value;
    }
    if (Math.abs(total.pct - rePct) > 1e-9
      || Math.abs(total.flat - reFlat) > 1e-9
      || Math.abs(total.mul - reMul) > 1e-9) {
      badBuckets.push(key);
    }
    if ((key === 'fireRate' && locksFireRate) || (key === 'multishot' && locksMultishot)) {
      total.locked = true;
    }
    buckets.push({ key, entries, total });
  }

  // 锁住的乘区**即使没有素材也要出现**：否则界面看不出它被锁了
  for (const [key, lockFlag] of [['fireRate', locksFireRate], ['multishot', locksMultishot]] as const) {
    if (!lockFlag || map.has(key)) continue;
    buckets.push({
      key,
      entries: [],
      total: { pct: 0, flat: 0, mul: 1, count: 0, locked: true },
    });
  }
  buckets.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const ok = badBuckets.length === 0 && buckets.reduce((a, b) => a + b.entries.length, 0) === totalEntries;
  return {
    buckets,
    totalEntries,
    input,
    check: { ok, inputCount: contribs.length, bucketedCount: totalEntries, badBuckets },
  };
}

/**
 * 当前命中分布里**有伤害的伤害类型个数**（= 敌人身上最多能有几种异况）。
 *
 * 依据：核心事实 §2（镀层类「每层值 × 异况种类数 × 叠层数」）。
 *
 * 只数**出现在命中分布里且数值 > 0** 的类型；顺序无关。
 */
export function statusTypeCount(spread: Readonly<Record<string, number | undefined>>): number {
  let n = 0;
  for (const k of Object.keys(spread)) {
    if ((spread[k] ?? 0) > 0) n++;
  }
  return n;
}
