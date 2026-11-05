import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  tauStatusChanceMultiplier,
  tauBonusPercent,
  applyTauToStatusChance,
  TAU_MAX_STACKS,
} from '../src/index.ts';

describe('Tau 异常状态', () => {
  it('无层数时不提供加成', () => {
    assert.equal(tauStatusChanceMultiplier(0), 1);
  });

  it('每层 +10%', () => {
    assert.equal(tauStatusChanceMultiplier(1), 1.1);
    assert.equal(tauStatusChanceMultiplier(5), 1.5);
  });

  it('需求方给出的示例：5 层、触发 210% → 315%', () => {
    assert.equal(applyTauToStatusChance(210, 5), 315);
  });

  it('最多 10 层，即 +100%', () => {
    assert.equal(tauStatusChanceMultiplier(TAU_MAX_STACKS), 2);
    assert.equal(tauBonusPercent(TAU_MAX_STACKS), 100);
  });

  it('超过上限时按上限计算', () => {
    assert.equal(tauStatusChanceMultiplier(15), 2);
  });

  it('负数或小数层数被规范化', () => {
    assert.equal(tauStatusChanceMultiplier(-3), 1);
    assert.equal(tauStatusChanceMultiplier(2.7), 1.2);
  });

  it('对已超过 100% 的触发率同样生效', () => {
    assert.equal(applyTauToStatusChance(250, 4), 350);
  });
});
