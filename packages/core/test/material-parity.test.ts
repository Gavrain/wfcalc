/**
 * 素材池的**对照测试**：证明它算出的汇总与计算路径（`sumPct` / `sumFlat` / `productMul`）
 * 完全一致。
 *
 * 为什么需要：素材池原本只服务展示，语义（`active` / `scope` / 锁定）只要有一点和计算路径
 * 不同，界面就会显示一个"看起来合理但算不出来"的数。等算得再多，就没法用眼睛发现了。
 *
 * 这里对**所有属性**逐个比对，并且覆盖三种容易出错的输入：
 *   · `active: false`（条件没勾）
 *   · `scope: 'hit' | 'dot'`（只作用于命中 / 异常）
 *   · 同一属性混着 pct / flat / mul
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collectMaterials } from '../src/material.ts';
import { productMul, sumFlat, sumPct } from '../src/contributions.ts';
import type { Contribution, ContribStat } from '../src/contributions.ts';

/** 造一条贡献 */
function c(
  stat: ContribStat,
  form: 'pct' | 'flat' | 'mul',
  amount: number,
  extra: Partial<Contribution> = {},
): Contribution {
  return { stat, form, amount, source: 'test', ...extra };
}

const EPS = 1e-9;

/** 取某属性的汇总（没有该桶时返回零值） */
function bucketOf(pool: ReturnType<typeof collectMaterials>, stat: string) {
  return pool.buckets.find((b) => b.key === stat);
}

/** 逐个属性比对 */
function expectParity(contribs: readonly Contribution[], scope?: 'hit' | 'dot') {
  const pool = collectMaterials(contribs, {}, scope);
  const stats = new Set(contribs.map((x) => x.stat));
  for (const stat of stats) {
    const b = bucketOf(pool, stat);
    const pctPool = b ? b.total.pct / 100 : 0; // 素材池存百分数，sumPct 返回小数
    const flatPool = b ? b.total.flat : 0;
    const mulPool = b ? b.total.mul : 1;
    const filter = scope ? { scope } : {};
    assert.ok(
      Math.abs(pctPool - sumPct(contribs, stat, filter)) < EPS,
      `${stat} 的 pct 不一致：素材池 ${pctPool}，计算路径 ${sumPct(contribs, stat, filter)}`,
    );
    assert.ok(
      Math.abs(flatPool - sumFlat(contribs, stat, filter)) < EPS,
      `${stat} 的 flat 不一致：素材池 ${flatPool}，计算路径 ${sumFlat(contribs, stat, filter)}`,
    );
    assert.ok(
      Math.abs(mulPool - productMul(contribs, stat, filter)) < EPS,
      `${stat} 的 mul 不一致：素材池 ${mulPool}，计算路径 ${productMul(contribs, stat, filter)}`,
    );
  }
}

describe('素材池与计算路径的一致性', () => {
  it('单一 pct 贡献', () => {
    expectParity([c('baseDamage', 'pct', 165)]);
  });

  it('多条 pct 相加', () => {
    expectParity([
      c('baseDamage', 'pct', 165),
      c('baseDamage', 'pct', 165),
      c('baseDamage', 'pct', 40),
    ]);
  });

  it('pct 与 flat 混合（暴击率那种）', () => {
    expectParity([
      c('critChance', 'pct', 200),
      c('critChance', 'flat', 0.05),
      c('critChance', 'flat', 0.1),
    ]);
  });

  it('mul 连乘', () => {
    expectParity([
      c('baseDamage', 'pct', 100),
      c('baseDamage', 'mul', 1.6),
      c('baseDamage', 'mul', 1.25),
    ]);
  });

  it('active: false 的条目不参与汇总', () => {
    const contribs = [
      c('baseDamage', 'pct', 165),
      c('baseDamage', 'pct', 999, { active: false }),
    ];
    expectParity(contribs);
    const pool = collectMaterials(contribs);
    const first = pool.buckets[0];
    assert.ok(first);
    assert.equal(first.total.pct, 165);
  });

  it("scope: 'hit' 的条目只在命中口径下计入", () => {
    const contribs = [
      c('baseDamage', 'pct', 100),
      c('baseDamage', 'pct', 50, { scope: 'hit' }),
      c('baseDamage', 'pct', 30, { scope: 'dot' }),
    ];
    expectParity(contribs);
    expectParity(contribs, 'hit');
    expectParity(contribs, 'dot');
  });

  it('多属性同时存在时各算各的', () => {
    expectParity([
      c('baseDamage', 'pct', 165),
      c('multishot', 'pct', 90),
      c('critChance', 'flat', 0.05),
      c('elemental:heat', 'pct', 90),
      c('faction:grineer', 'pct', 30),
    ]);
  });

  it('空输入不报错', () => {
    const pool = collectMaterials([]);
    assert.deepEqual(pool.buckets, []);
    assert.equal(pool.check.ok, true);
  });

  it('自检：条目数守恒', () => {
    const contribs = [
      c('baseDamage', 'pct', 165),
      c('baseDamage', 'pct', 40),
      c('multishot', 'pct', 90),
    ];
    const pool = collectMaterials(contribs);
    assert.equal(pool.check.ok, true);
    assert.equal(pool.check.inputCount, 3);
    assert.equal(pool.check.bucketedCount, 3);
    assert.deepEqual(pool.check.badBuckets, []);
  });
});
