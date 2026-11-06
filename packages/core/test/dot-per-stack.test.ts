/**
 * D-043：「每层秒伤」= 单层 DoT 每秒伤害，**与层数、射速、多重都无关**。
 * 「六秒总伤」才乘层数（触发率 × 元素占比 × 多重 × 射速）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const { compute } = core as any;

const base = {
  critChance: 0.2,
  critMultiplier: 2,
  statusChance: 0.5,
  magazineSize: 30,
  reloadTime: 2,
};

const mode: any = {
  id: 'primary',
  role: 'primary',
  trigger: 'auto',
  multishot: 1,
  variants: [{ id: 'direct', label: '直接命中', segments: [{ kind: 'physical', procChance: 0.5, damage: { slash: 100 } }] }],
};

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const perStack = (fr: number) =>
  compute({ ...base, id: 'X', name: 'X', fireRate: fr }, mode, [], {}, false).output.dotPerSecond as number;
const sixSec = (fr: number) =>
  compute({ ...base, id: 'X', name: 'X', fireRate: fr }, mode, [], {}, false).output.dot6s as number;

describe('每层秒伤与射速无关（D-043）', () => {
  it('射速 10 → 20，每层秒伤不变', () => {
    near(perStack(10), perStack(20));
  });

  it('射速 1 → 100，每层秒伤仍不变', () => {
    near(perStack(1), perStack(100));
  });

  it('六秒总伤随射速增长（但受装填空窗影响，不是严格线性）', () => {
    // D-058：射速翻倍后弹匣消耗更快、装填占比更高，所以增长**慢于**线性
    const ratio = sixSec(20) / sixSec(10);
    assert.ok(ratio > 1, `射速翻倍后总伤应上升，实际比值 ${ratio}`);
    assert.ok(ratio < 2, `受装填空窗影响，比值应小于 2，实际 ${ratio}`);
  });

  it('每层秒伤等于**实际存在**的类型的每跳伤害之和（不含层数/射速/多重）', () => {
    const res = compute({ ...base, id: 'X', name: 'X', fireRate: 10 }, mode, [], {}, false);
    const seg: any = res.segments[0];
    // D-055：只累加配装里真的有的元素（面板仅 slash）
    const present = new Set(Object.keys(seg.finalHit));
    const sum = seg.dotTicks
      .filter((t: any) => present.has(t.type))
      .reduce((acc: number, t: any) => acc + t.tick, 0);
    near(res.output.dotPerSecond, sum);
    // 没有的元素贡献必须为 0
    for (const t of core.DOT_TYPES) {
      if (!present.has(t)) near(res.output.dotPerType[t] ?? 0, 0);
    }
  });

  it('多重 Mod 不改变每层秒伤，但会提高六秒总伤', () => {
    const noMs = compute({ ...base, id: 'X', name: 'X', fireRate: 10 }, mode, [], {}, false);
    const withMs = compute({ ...base, id: 'X', name: 'X', fireRate: 10 }, mode, [
      { stat: 'multishot', form: 'pct', amount: 90, source: 'split_chamber' },
    ], {}, false);
    near(withMs.output.dotPerSecond, noMs.output.dotPerSecond);
    assert.ok(withMs.output.dot6s > noMs.output.dot6s, '多重应提高六秒总伤');
  });
});
