/**
 * 爆炸异常（D-031）行为测试。
 *   node --test --experimental-strip-types --test-isolation=none "packages/core/test/blast.test.ts"
 *
 * D-031 修订要点：范围伤害**不是"再乘 3 倍"，而是每层系数从 0.3 换成 3**。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BLAST, applyElements, applyKuvaBonus, blastDetail } from '../src/index.ts';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const QUIET = { factionPct: 0, statusDamagePct: 0, critDamageMul: 1, headshotMul: 1 };

describe('爆炸异常（D-031）', () => {
  it('每层伤害 = 基础 × 0.3 × (1+派系) × 暴击伤害 × 异常伤害 × 伤害弱点', () => {
    const d = blastDetail(100, 5, { factionPct: 0.55, statusDamagePct: 0.6, critDamageMul: 2, headshotMul: 1 });
    near(d.perStack, 100 * 0.3 * 1.55 * 2 * 1.6);
  });

  it('满层后每层系数 0.3 → 3（是系数换成 3，不是乘 3 倍）', () => {
    const d = blastDetail(100, 1, QUIET);
    near(d.perStack, 30); // 100 × 0.3
    near(d.perStackDetonated, 300); // 100 × 3
    // 每层系数换成 3 后正好是原来的 10 倍
    near(d.perStackDetonated / d.perStack, 10);
  });

  it('1.5 秒内能叠满 10 层 → 触发范围伤害', () => {
    // 每秒 8 层 → 10/8 = 1.25 秒 ≤ 1.5 秒
    const d = blastDetail(100, 8, QUIET);
    assert.equal(d.reachesMaxInWindow, true);
    near(d.timeToMaxSeconds, 1.25);
    assert.equal(d.splashActive, true);
    near(d.splashPerSecond, 300 * BLAST.maxStacks); // 每层 300 × 10 层
  });

  it('1.5 秒内叠不满 → 无范围伤害，主目标按实际层数均摊', () => {
    // 每秒 4 层 → 1.5 秒只有 6 层
    const d = blastDetail(100, 4, QUIET);
    assert.equal(d.reachesMaxInWindow, false);
    assert.equal(d.timeToMaxSeconds, null);
    assert.equal(d.splashActive, false);
    near(d.splashPerSecond, 0);
    near(d.perSecond, 30 * 4 * 1.5); // 每层 30 × 1.5 秒内累积 6 层
  });

  it('没有爆炸层数时全为 0', () => {
    const d = blastDetail(100, 0, QUIET);
    near(d.perSecond, 0);
    near(d.splashPerSecond, 0);
    assert.equal(d.splashActive, false);
  });

  it('范围伤害与主目标伤害分别累计 6 秒', () => {
    const fast = blastDetail(100, 8, QUIET);
    near(fast.total6s, fast.perSecond * 6);
    near(fast.splash6s, fast.splashPerSecond * 6);
    const slow = blastDetail(100, 4, QUIET);
    near(slow.total6s, slow.perSecond * 6);
    near(slow.splash6s, 0);
  });

  it('常量符合 D-031：延迟 1.5 秒、10 层、0.3 / 3 系数、5 米', () => {
    assert.equal(BLAST.delaySeconds, 1.5);
    assert.equal(BLAST.maxStacks, 10);
    assert.equal(BLAST.perStackCoef, 0.3);
    assert.equal(BLAST.detonateCoef, 3.0);
    assert.equal(BLAST.radiusMeters, 5);
  });

  it('D-022：玄骸加成选冲击时，那份冲击享受 +冲击% Mod', () => {
    // 面板 100 冲击（无元素），玄骸冲击 50% → 新面板冲击 = 150
    // +100% 冲击 Mod → 冲击 = 150 × 2 = 300
    const contribs = [{ stat: 'physical:impact' as const, form: 'pct' as const, amount: 100, source: 'm' }];
    const withKuva = applyElements(applyKuvaBonus({ impact: 100 }, { type: 'impact', ratio: 0.5 }), contribs, 'hit');
    near(withKuva.v.impact, 300);
    // 无玄骸时：100 × 2 = 200
    const noKuva = applyElements({ impact: 100 }, contribs, 'hit');
    near(noKuva.v.impact, 200);
  });

  it('D-022：玄骸是元素（火）时，不被物理 %Mod 放大', () => {
    const contribs = [{ stat: 'physical:impact' as const, form: 'pct' as const, amount: 100, source: 'm' }];
    const r = applyElements(applyKuvaBonus({ impact: 100 }, { type: 'heat', ratio: 0.5 }), contribs, 'hit');
    near(r.v.impact, 200); // 面板冲击 100 × 2
    near(r.v.heat, 50); // 玄骸火 50，不受冲击 Mod 影响
  });
});
