/**
 * 镀层加成端到端：数据层每层值 × 异况数量 × 叠层上限（需求方 2026-11-06 口径）
 *   步枪才能：每层 40% × 3 异况 × 2 层 = 240%
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { overForStacks } from '../../core/src/weapon-state.ts';
import type { Contribution } from '../../core/src/contributions.ts';

const coat = (perStack: number): Contribution[] => [{ stat: 'co', form: 'pct', amount: perStack, source: 'x' }];

describe('镀层加成端到端（每层值 × 异况数 × 叠层上限）', () => {
  it('步枪才能：每层 40% × 3 异况 × 2 层 = 240%', () => {
    const r = overForStacks(coat(40), 2, 3);
    assert.ok(Math.abs(r - 2.4) < 1e-9, `实际 ${r}`);
  });

  it('通晓霰弹枪：每层 40% × 3 异况 × 2 层 = 240%', () => {
    const r = overForStacks(coat(40), 2, 3);
    assert.ok(Math.abs(r - 2.4) < 1e-9);
  });

  it('准确射手：每层 40% × 3 异况 × 3 层 = 360%', () => {
    const r = overForStacks(coat(40), 3, 3);
    assert.ok(Math.abs(r - 3.6) < 1e-9);
  });

  it('异况超量：每层 80% × 3 异况 × 1 层 = 240%', () => {
    const r = overForStacks(coat(80), 1, 3);
    assert.ok(Math.abs(r - 2.4) < 1e-9);
  });

  it('异况数为 0 → 不生效（默认值）', () => {
    assert.equal(overForStacks(coat(40), 2, 0), 0);
  });
});
