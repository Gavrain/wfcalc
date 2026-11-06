/**
 * §6.2 DoT 基础值口径（回归）。
 *
 * 文档原文：① 基础命中伤 = 命中伤害中【剔除元素/物理 Mod 加量】后的值，
 *   **计入：全部伤害类型（物理 + 元素）**；② 基础触发值 = ① × 该元素系数。
 *
 * bug 背景：之前 ① 错误地取 `dotBase[该元素]`，导致 **毒气**（完全由 Mod 合成、
 * `dotBase` 里没有该项）每跳恒为 0。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const { compute } = core as any;

const weapon: any = {
  id: 'TestRifle',
  name: 'Test Rifle',
  critChance: 0,
  critMultiplier: 2,
  statusChance: 0.5,
  fireRate: 10,
  magazineSize: 30,
  reloadTime: 2,
};

/** 纯物理面板 100，靠 Mod 合成元素 */
const mode: any = {
  id: 'primary',
  role: 'primary',
  trigger: 'auto',
  multishot: 1,
  variants: [{ id: 'direct', label: '直接命中', segments: [{ kind: 'physical', procChance: 0.5, damage: { impact: 100 } }] }],
};

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

describe('DoT 基础值取全类型之和（§6.2）', () => {
  it('毒气：完全由 Mod 合成时，每跳伤害不为 0', () => {
    // 火 + 毒 → 毒气
    const contribs: any[] = [
      { stat: 'elemental:heat', form: 'pct', amount: 90, source: 'hellfire' },
      { stat: 'elemental:toxin', form: 'pct', amount: 90, source: 'infected' },
    ];
    const res = compute(weapon, mode, contribs, {}, false);
    const seg: any = res.segments[0];
    assert.ok(seg.finalHit.gas > 0, '合成后应有毒气伤害');

    const gasTick = seg.dotTicks.find((t: any) => t.type === 'gas');
    assert.ok(gasTick, '应有毒气 DoT');
    assert.ok(gasTick.tick > 0, `毒气每跳应 > 0，实际 ${gasTick.tick}`);
    // ① 基础值 = 全类型之和（**剔除元素 Mod 加量**后只剩面板的冲击 100）
    near(gasTick.baseValue, 100);
    // D-107：毒气不吃火焰%——火/毒 Mod 的加量既不在基础值里，也不额外给毒气加成
    near(gasTick.tick, 100 * 0.5);
  });

  it('① 基础值 = 剔除元素加量后的全类型合计', () => {
    // 基伤 +100% → 面板 100 变 200；元素 +90% 火
    const contribs: any[] = [
      { stat: 'baseDamage', form: 'pct', amount: 100, source: 'serration' },
      { stat: 'elemental:heat', form: 'pct', amount: 90, source: 'hellfire' },
    ];
    const res = compute(weapon, mode, contribs, {}, false);
    const seg: any = res.segments[0];
    // 命中：冲击 200 + 火 180（= 新面板 200 × 90%）
    near(seg.finalHit.impact, 200);
    near(seg.finalHit.heat, 180);
    // dotBase 剔除元素加量 → 只有冲击 200
    const heatTick = seg.dotTicks.find((t: any) => t.type === 'heat');
    near(heatTick.baseValue, 200);
    // ② × 火系数 0.5 = 100
    near(heatTick.baseTick, 200 * 0.5);
    // D-107：元素 % **不进基础值**——`tickBase` 剔掉了火 Mod 的 180，只剩冲击 200。
    //   这里 elementPct 只是展示字段；每跳值只由 baseValue × 系数 组成。
    near(heatTick.tick, heatTick.baseTick);
  });

  it('每种 DoT 类型的基础值相同（都是全类型之和），只有系数与元素%不同', () => {
    const contribs: any[] = [
      { stat: 'elemental:heat', form: 'pct', amount: 90, source: 'hellfire' },
    ];
    const res = compute(weapon, mode, contribs, {}, false);
    const seg: any = res.segments[0];
    const bases = seg.dotTicks.map((t: any) => t.baseValue);
    const uniq = [...new Set(bases.map((b: number) => Math.round(b * 1e6) / 1e6))];
    assert.equal(uniq.length, 1, `所有类型基础值应相同，实际 ${JSON.stringify(uniq)}`);
  });
});
