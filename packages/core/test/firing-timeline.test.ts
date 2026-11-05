/**
 * D-058：开火时间线 —— 打满弹匣后要空出装填时间，期间不叠层。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const { buildFiringTimeline, dotSixSecondCurve } = core as any;

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

describe('开火时间线（D-058）', () => {
  it('弹匣够打满 6 秒 → 全程开火', () => {
    // 弹匣 70、射速 10 → 7 秒，够 6 秒
    const f = buildFiringTimeline(70, 10, 2);
    const timeline = [1, 2, 3, 4, 5, 6].map(f);
    assert.deepEqual(timeline, [true, true, true, true, true, true]);
  });

  it('弹匣只够打 3 秒、装填 2 秒 → 第 4、5 秒是装填', () => {
    // 弹匣 30、射速 10 → 3 秒打完，装填 2 秒 → 循环 5 秒
    const f = buildFiringTimeline(30, 10, 2);
    // 第 1~3 秒开火，第 4~5 秒装填，第 6 秒重新开火
    assert.deepEqual([1, 2, 3, 4, 5, 6].map(f), [true, true, true, false, false, true]);
  });

  it('装填期间不叠层 → 六秒总伤低于全程开火', () => {
    const always = dotSixSecondCurve('toxin', 2, 10, 6, () => true);
    const f = buildFiringTimeline(30, 10, 2);
    const withReload = dotSixSecondCurve('toxin', 2, 10, 6, f);
    assert.ok(withReload < always, `有装填 ${withReload} 应小于全程开火 ${always}`);
  });

  it('装填时间越长，六秒总伤越低', () => {
    const short = dotSixSecondCurve('toxin', 2, 10, 6, buildFiringTimeline(30, 10, 1));
    const long = dotSixSecondCurve('toxin', 2, 10, 6, buildFiringTimeline(30, 10, 4));
    assert.ok(long < short, `装填 4 秒 ${long} 应小于装填 1 秒 ${short}`);
  });

  it('射速翻倍后装填占比变高 → 总伤增长慢于线性', () => {
    const a = dotSixSecondCurve('toxin', 1, 10, 6, buildFiringTimeline(30, 10, 2));
    const b = dotSixSecondCurve('toxin', 2, 10, 6, buildFiringTimeline(30, 20, 2));
    assert.ok(b / a < 2, `比值应小于 2，实际 ${b / a}`);
  });

  it('弹匣数据缺失时按全程开火（不崩）', () => {
    const f = buildFiringTimeline(0, 10, 2);
    assert.equal(f(1), true);
    assert.equal(f(6), true);
  });

  it('火焰在装填期间也停止累加', () => {
    // 每秒 2 层、每层 1，装填造成第 4、5 秒空窗
    const f = buildFiringTimeline(30, 10, 2);
    const heat = dotSixSecondCurve('heat', 2, 1, 6, f);
    // 累计：开火秒才累加 → t1=2,t2=4,t3=6,t4=6,t5=6,t6=8
    // 每跳 = 单层 × 累计 → 2+4+6+6+6+8 = 32
    near(heat, 32);
  });
});
