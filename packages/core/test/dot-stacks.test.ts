/**
 * D-036：异常状态层数必须以「层/秒」为单位（单发层数 × 射速）。
 *
 * 回归背景：之前 `stacksPerType` 存的是**单发**层数，界面按「层/秒」显示，
 * 卡拉克（射速 11.67）显示成 0.59 层/秒，实际应为约 6.9 层/秒。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const { compute, DOT_TYPES } = core as any;

/** 造一把“射速高、带元素、带触发”的枪，用于验证层数单位 */
const weapon: any = {
  id: 'TestRifle',
  name: 'Test Rifle',
  critChance: 0.23,
  critMultiplier: 2.1,
  statusChance: 0.31,
  fireRate: 11.6667,
  magazineSize: 70,
  reloadTime: 1.7,
};

const mode: any = {
  id: 'primary',
  role: 'primary',
  trigger: 'auto',
  multishot: 1,
  segments: [{ kind: 'physical', procChance: 0.31, damage: { heat: 100 } }],
};

const contribs: any[] = [
  { stat: 'multishot', form: 'pct', amount: 90, source: 'split_chamber' },
  { stat: 'elemental:heat', form: 'pct', amount: 90, source: 'hellfire' },
];

describe('异常状态层数单位（D-036）', () => {
  it('每秒层数 = 单发层数 × 射速（不是单发层数）', () => {
    const res = compute(weapon, mode, contribs, {}, false);
    const out: any = res.output;
    const fireRate: number = out.fireRate;
    assert.ok(fireRate > 0, '射速应大于 0');

    const stacks: number = out.stacksPerType.heat ?? 0;
    assert.ok(stacks > 1, `每秒层数应 > 1，实际 ${stacks}`);
    // 若误存单发层数，则 stacks / fireRate 会远大于 1
    assert.ok(stacks / fireRate < 1, `stacks/fireRate 应是单发层数（<1），实际 ${stacks / fireRate}`);
  });

  it('层数与 DoT 每秒伤害自洽', () => {
    const res = compute(weapon, mode, contribs, {}, false);
    const out: any = res.output;
    for (const t of DOT_TYPES) {
      const stacks: number | undefined = out.stacksPerType[t];
      const perSec: number | undefined = out.dotPerType[t];
      if (!stacks || !perSec) continue;
      assert.ok(Number.isFinite(perSec / stacks), `${t} 比值应有限`);
      assert.ok(perSec / stacks > 0, `${t} 每层伤害应为正`);
    }
  });
});
