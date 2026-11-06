/**
 * 弹药效率建模（D-084，需求方 2026-11-06）。
 *
 * 需求方原话：
 * > 「弹药消耗可以出现非整数……假设弹药效率为 x，则提升的弹匣和弹药 a 为 a/(1-x)。
 * > 面板上弹匣显示两位小数」
 *
 * 弹药效率的定义是「每一发实际只消耗 `1-x` 发」。若武器有 `a` 发、能开 `n` 次，
 * 则 `n · (1-x) = a` → **`n = a/(1-x)`**，所以：
 *   · `a/(1-x)` 是**使用次数**；
 *   · 等效弹匣里"额外多出来"的部分 = `a · x/(1-x)`。
 * 本实现返回的倍数是 `1/(1-x)`（即 `a/(1-x) ÷ a`），乘在面板弹匣上得到等效弹匣。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ammoEfficiencyMultiplier, displayMagazine } from '../../core/src/weapon-state.ts';
import type { Contribution } from '../../core/src/contributions.ts';

const eff = (pct: number): Contribution[] => [{ stat: 'ammoEfficiency', form: 'pct', amount: pct, source: 'test' }];

describe('弹药效率 → 等效弹匣（D-084）', () => {
  it('无加成时倍数为 1', () => {
    assert.equal(ammoEfficiencyMultiplier([]), 1);
  });

  it('x = 50% → 倍数 2（60 发弹匣等效 120 发）', () => {
    assert.equal(ammoEfficiencyMultiplier(eff(50)), 2);
    assert.equal(displayMagazine(60 * ammoEfficiencyMultiplier(eff(50))), 120);
  });

  it('x = 30% → 倍数 1/(1-0.3) ≈ 1.4286', () => {
    const mul = ammoEfficiencyMultiplier(eff(30));
    assert.ok(Math.abs(mul - 1 / 0.7) < 1e-9);
    assert.equal(displayMagazine(30 * mul), 42.86); // 面板显示两位小数
  });

  it('多个来源相加（主要·准星 60% 与 Mod 的 5% 加算）', () => {
    const mul = ammoEfficiencyMultiplier([...eff(60), ...eff(5)]);
    assert.ok(Math.abs(mul - 1 / 0.35) < 1e-9);
  });

  it('x = 0 与负值都不会产生异常倍数', () => {
    assert.equal(ammoEfficiencyMultiplier(eff(0)), 1);
    assert.equal(ammoEfficiencyMultiplier(eff(-10)), 1);
  });

  it('x 逼近 100% 时被夹到 0.95，不会除零', () => {
    const mul = ammoEfficiencyMultiplier(eff(100));
    assert.ok(Number.isFinite(mul));
    assert.ok(Math.abs(mul - 1 / 0.05) < 1e-9);
  });

  it('面板弹匣保留两位小数', () => {
    assert.equal(displayMagazine(42.857142857), 42.86);
    assert.equal(displayMagazine(120), 120);
  });
});
