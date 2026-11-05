/**
 * D-060：DoT 加权每层秒伤 —— 按触发占比加权。
 *
 * 触发是互斥的（一次触发只落在一个类型上），所以合计不能直接相加。
 * ```
 * 加权每层秒伤 = Σ_t ( 该类型每层秒伤 × 该类型占比 )
 * ```
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const { compute } = core as any;

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const weapon: any = {
  id: 'TestRifle', name: 'Test',
  critChance: 0, critMultiplier: 2, statusChance: 0.5,
  fireRate: 10, magazineSize: 30, reloadTime: 2,
  modes: [{
    id: 'primary', role: 'normal', trigger: 'auto', multishot: 1,
    segments: [{ kind: 'physical', procChance: 0.5, damage: { slash: 100 } }],
  }],
};

/** 切割 100 + 火焰 100，各占 50% */
const slashPlusHeat: any[] = [
  { stat: 'elemental:heat', form: 'pct', amount: 100, source: 'hellfire' },
];

describe('DoT 加权每层秒伤（D-060 / D-061）', () => {
  /** 只累加「有 DoT 的类型」作为分母（D-061） */
  const dotTotalOf = (spread: any) => core.DOT_TYPES.reduce((a: number, t: string) => a + (spread[t] ?? 0), 0);

  it('加权合计 = Σ(每层秒伤 × 占比)，分母只算有 DoT 的类型', () => {
    const res = compute(weapon, weapon.modes[0], slashPlusHeat, {}, false);
    const seg: any = res.segments[0];
    const present = new Set(Object.keys(seg.finalHit));
    const denom = dotTotalOf(seg.finalHit);

    let expected = 0;
    for (const t of seg.dotTicks) {
      if (!present.has(t.type)) continue;
      const share = (seg.finalHit[t.type] ?? 0) / denom;
      expected += t.tick * share;
    }
    near(res.output.dotPerSecond, expected);
  });

  it('无 DoT 的类型（冲击/穿刺）不参与加权', () => {
    // 面板 100 冲击 + 火 Mod 90% → 冲突 100 + 火 90；
    // 冲击无 DoT，分母只算火 90 → 火焰占比 = 100%
    const w2: any = { ...weapon, modes: [{
      id: 'primary', role: 'normal', trigger: 'auto', multishot: 1,
      segments: [{ kind: 'impact', procChance: 0.5, damage: { impact: 100 } }],
    }] };
    const res = compute(w2, w2.modes[0], [
      { stat: 'elemental:heat', form: 'pct', amount: 90, source: 'h' },
    ], {}, false);
    const seg: any = res.segments[0];
    const heatTick = seg.dotTicks.find((t: any) => t.type === 'heat');
    // 冲击不参与 → 火焰占比 100% → 加权值 = 火焰每层秒伤
    near(res.output.dotPerSecond, heatTick.tick);
  });

  it('各占 50% 时，合计是未加权的一半', () => {
    const res = compute(weapon, weapon.modes[0], slashPlusHeat, {}, false);
    const seg: any = res.segments[0];
    const present = new Set(Object.keys(seg.finalHit));
    let unweighted = 0;
    for (const t of seg.dotTicks) {
      if (!present.has(t.type)) continue;
      unweighted += t.tick;
    }
    // 命中分布只有 slash 与 heat，各 100，各占 50%
    near(res.output.dotPerSecond, unweighted * 0.5);
    assert.ok(res.output.dotPerSecond < unweighted, '加权后应小于未加权');
  });

  it('单个 DoT 类型占 100% 时，加权值等于它自己的每层秒伤', () => {
    // 只有切割，无元素
    const res = compute(weapon, weapon.modes[0], [], {}, false);
    const seg: any = res.segments[0];
    const slashTick = seg.dotTicks.find((t: any) => t.type === 'slash');
    near(res.output.dotPerSecond, slashTick.tick);
  });

  it('「每层秒伤」单值仍是不含权重的原始值（供展示各类型）', () => {
    const res = compute(weapon, weapon.modes[0], slashPlusHeat, {}, false);
    const seg: any = res.segments[0];
    const heatTick = seg.dotTicks.find((t: any) => t.type === 'heat');
    // dotPerType 存的是原始每层秒伤，不加权
    near(res.output.dotPerType.heat, heatTick.tick);
  });

  it('占比变化会改变加权结果', () => {
    const a = compute(weapon, weapon.modes[0], [
      { stat: 'elemental:heat', form: 'pct', amount: 100, source: 'h' },
    ], {}, false);
    const b = compute(weapon, weapon.modes[0], [
      { stat: 'elemental:heat', form: 'pct', amount: 300, source: 'h' },
    ], {}, false);
    // 火焰占比越高，加权结果越接近纯火焰的每层秒伤
    assert.notEqual(a.output.dotPerSecond, b.output.dotPerSecond);
  });

  it('六秒总伤不受加权改动影响（它本来就乘了占比）', () => {
    const res = compute(weapon, weapon.modes[0], slashPlusHeat, {}, false);
    const seg: any = res.segments[0];
    const present = new Set(Object.keys(seg.finalHit));
    const firing = core.buildFiringTimeline(30, 10, 2);
    let expected = 0;
    for (const t of seg.dotTicks) {
      if (!present.has(t.type)) continue;
      expected += core.dotSixSecondCurve(
        t.type, res.output.stacksPerType[t.type] ?? 0, t.tick, 6, firing,
        core.stacksPerShot(t.type, seg.finalHit, seg.procChance, slashPlusHeat, false),
      );
    }
    near(res.output.dot6s, expected);
  });

  it('输出口径名称已改为「DoT 加权每层秒伤」', () => {
    const res = compute(weapon, weapon.modes[0], [], {}, false);
    const line = res.output.lines.find((l: any) => l.id === 'dotPerSecond');
    assert.equal(line.label, 'DoT 加权每层秒伤');
  });
});
