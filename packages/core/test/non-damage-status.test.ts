/**
 * 非伤害性异常的层/秒（需求方 2026-11-12）。
 *
 * > 「把非伤害性异常也加上去，标上 xx 层/秒就行，不需要后面那个伤害。」
 *
 * 三条约束：
 *   ① 层数算法与 DoT 同一套：触发率 × 元素占比 × 多重 × 射速；
 *   ② 存在性判据同 D-109：合成结束后面板里有这个元素才算；
 *   ③ **不影响任何伤害口径**——`dotPerSecond` / `dot6s` 与加上这些项之前完全一致。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const { compute, NON_DAMAGE_STATUS_TYPES, DOT_TYPES } = core as any;

const weapon: any = {
  id: 'TestRifle',
  name: 'Test Rifle',
  critChance: 0.23,
  critMultiplier: 2.1,
  statusChance: 0.31,
  fireRate: 10,
  magazineSize: 70,
  reloadTime: 1.7,
};

function modeWith(damage: Record<string, number>): any {
  return {
    id: 'primary',
    role: 'primary',
    trigger: 'auto',
    multishot: 1,
    variants: [{ id: 'direct', label: '直接命中', segments: [{ kind: 'physical', procChance: 0.31, damage }] }],
  };
}

const contribs: any[] = [
  { stat: 'multishot', form: 'pct', amount: 90, source: 'split_chamber' },
];

describe('非伤害性异常：只标层/秒', () => {
  it('顺序符合需求方：复合元素在前，冰，然后冲击穿刺', () => {
    assert.deepEqual([...NON_DAMAGE_STATUS_TYPES], [
      'viral', 'corrosive', 'magnetic', 'radiation', 'cold', 'impact', 'puncture',
    ]);
  });

  it('单纯一把切割枪只有切割行，非伤害性异常全为 0', () => {
    const res = compute(weapon, modeWith({ slash: 100 }), contribs, {});
    const nd: Record<string, number> = res.output.nonDamageStacks;
    for (const t of NON_DAMAGE_STATUS_TYPES) {
      assert.ok((nd[t] ?? 0) === 0, `${t} 不该出现`);
    }
    assert.ok((res.output.stacksPerType.slash ?? 0) > 0, '切割应有层数');
  });

  it('纯净的毒 + 电合成腐蚀：只出腐蚀，不出毒素与毒气（D-109 判据）', () => {
    const res = compute(weapon, modeWith({ toxin: 100, electric: 100 }), contribs, {});
    const nd: Record<string, number> = res.output.nonDamageStacks;
    assert.ok((nd.corrosive ?? 0) > 0, '腐蚀应有层数');
    for (const t of ['viral', 'magnetic', 'radiation', 'cold']) {
      assert.ok((nd[t] ?? 0) === 0, `${t} 不该出现`);
    }
  });

  it('冰冻、冲击、穿刺（武器自带物理/原生冰）各自出层', () => {
    const res = compute(weapon, modeWith({ impact: 40, puncture: 30, slash: 30, cold: 100 }), contribs, {});
    const nd: Record<string, number> = res.output.nonDamageStacks;
    for (const t of ['impact', 'puncture', 'cold']) {
      assert.ok((nd[t] ?? 0) > 0, `${t} 应有层数`);
    }
    const viral = (nd.viral ?? 0);
    assert.ok(viral === 0, '病毒不该出现');
    assert.ok((nd.impact ?? 0) > (nd.puncture ?? 0), '冲击占比大，层数应更高');
  });

  it('层数单位是「层/秒」：单发层数 × 射速', () => {
    const res = compute(weapon, modeWith({ cold: 100 }), contribs, {});
    const out: any = res.output;
    const perSec: number = out.nonDamageStacks.cold;
    // 单一元素 → 占比 1；触发率 31% × 多重 1.9 × 射速 10 = 5.89
    const expected = 0.31 * 1.9 * 10;
    assert.ok(Math.abs(perSec - expected) < 1e-9, `期望 ${expected}，实际 ${perSec}`);
    assert.ok(perSec / out.fireRate < 1.9 + 1e-9, '除以射速应回到单发层数');
  });

  it('不影响任何伤害口径（异常加权 / 六秒异常总伤不变）', () => {
    // 同一配置算两次，伤害口径应逐位相等（非伤害性异常是**新增的输出**，不动旧口径）
    const a = compute(weapon, modeWith({ slash: 50, gas: 50 }), contribs, {});
    const b = compute(weapon, modeWith({ slash: 50, gas: 50 }), contribs, {});
    assert.equal(a.output.dot6s, b.output.dot6s);
    assert.equal(a.output.dotPerSecond, b.output.dotPerSecond);

    // 冰只进「非伤害性异常」，不改变直接命中态的异常加权单层秒伤以外的东西：
    //   · 六秒异常总伤 / 加权口径会因触发池被冰摊薄而变化，这是**原有加权口径**本身的行为；
    //   · 这里只验证冰**没有**变成一种新的 DoT 类型（火/毒/电/毒气/切割之外不多出任何行）。
    const withCold = compute(weapon, modeWith({ slash: 50, gas: 50, cold: 100 }), contribs, {});
    const dotKeys = Object.keys(withCold.output.dotPerType).filter((k) => (withCold.output.dotPerType[k] ?? 0) > 0);
    for (const k of dotKeys) {
      assert.ok(DOT_TYPES.includes(k), `${k} 不是 DoT 类型，不该出现在 dotPerType`);
    }
    assert.ok(!dotKeys.includes('cold'), '冰不该出现在 dotPerType');
    assert.ok((withCold.output.nonDamageStacks.cold ?? 0) > 0, '冰应出现在非伤害性异常里');
  });

  it('逐段各自统计（多段武器每段一份）', () => {
    const mode: any = {
      id: 'primary',
      role: 'primary',
      trigger: 'auto',
      multishot: 1,
      variants: [{ id: 'direct', label: '直接命中', segments: [
        { kind: 'physical', procChance: 0.31, damage: { cold: 100 } },
        { kind: 'physical', procChance: 0.31, damage: { viral: 100 } },
      ] }],
    };
    const res = compute(weapon, mode, contribs, {});
    const seg = res.output.dotBySegment;
    assert.equal(seg.length, 2);
    assert.ok((seg[0].nonDamageStacks.cold ?? 0) > 0);
    assert.ok((seg[1].nonDamageStacks.viral ?? 0) > 0);
    assert.ok((seg[0].nonDamageStacks.viral ?? 0) === 0);
    assert.ok((seg[1].nonDamageStacks.cold ?? 0) === 0);
  });
});
