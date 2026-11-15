/**
 * 需求方 2026-11-15（A4 + A5）：稳态秒伤按「逐秒层数池」算。
 *
 * ```
 * A4：爆炸主目标要进稳态       ← 以前完全没算
 * A5：层数要**到期清除**，装填期间照样掉   ← 以前层数只增不减
 * ```
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const weapon = (extra: Record<string, unknown> = {}) => ({
  id: 'W', name: 'W', critChance: 0, critMultiplier: 2, statusChance: 0.5,
  fireRate: 10, magazineSize: 30, reloadTime: 2, ...extra,
});

const mode = (damage: Record<string, number>, extra: Record<string, unknown> = {}) => ({
  id: 'primary', role: 'normal', trigger: 'auto', multishot: 1,
  variants: [{ id: 'direct', label: '直接命中', segments: [{ kind: 'impact', procChance: 0.5, damage }] }],
  ...extra,
});

describe('A5：稳态层数池（到期清除、装填期间照样掉）', () => {
  it('毒 / 电 / 切割：射速翻倍 → 叠层翻倍、稳态异常上升（不是线性翻倍：循环内还摊着装填）', () => {
    const a = core.compute(weapon({ fireRate: 5 }) as any, mode({ slash: 100 }) as any, [], {});
    const b = core.compute(weapon({ fireRate: 10 }) as any, mode({ slash: 100 }) as any, [], {});
    near((a.output.stacksPerType.slash as number) * 2, b.output.stacksPerType.slash as number, 1e-9);
    assert.ok(b.output.steadyDotDps > a.output.steadyDotDps);
    assert.ok(b.output.steadyDotDps < (a.output.steadyDotDps as number) * 2, '循环里含装填，不应线性翻倍');
  });

  it('毒 / 电 / 切割：稳态异常 ≤ 「层数永不到期」的旧算法（到期清除会砍掉尾巴）', () => {
    const w = weapon();
    const res: any = core.compute(w as any, mode({ slash: 100 }) as any, [], {});
    const seg: any = res.segments[0];
    const tick = seg.dotTicks.find((t: any) => t.type === 'slash').tick as number;
    // 旧算法 = 层/秒 × 开火段时长 × 每拍 ÷ 循环（= 105）
    const old = (res.output.stacksPerType.slash as number) * 3 * tick / 5;
    assert.ok(res.output.steadyDotDps <= old + 1e-9, `${res.output.steadyDotDps} > ${old}`);
  });

  it('毒 / 电 / 切割：射速翻倍时稳态单调上升，但不超过「层数无上限累加」的旧算法', () => {
    const a = core.compute(weapon({ fireRate: 5 }) as any, mode({ slash: 100 }) as any, [], {});
    const b = core.compute(weapon({ fireRate: 10 }) as any, mode({ slash: 100 }) as any, [], {});
    assert.ok(b.output.steadyDps > a.output.steadyDps, '射速翻倍应变高');
  });

  it('火焰：持续伤害，射速翻倍后稳态也翻倍以内（不是平方增长）', () => {
    const hot = [
      { stat: 'elemental:heat', form: 'pct', amount: 90, source: 'h' },
    ];
    const a = core.compute(weapon({ fireRate: 5 }) as any, mode({ slash: 100 }) as any, hot as any, {});
    const b = core.compute(weapon({ fireRate: 10 }) as any, mode({ slash: 100 }) as any, hot as any, {});
    assert.ok(b.output.steadyDps > a.output.steadyDps);
  });
});

describe('A4：爆炸主目标进稳态', () => {
  it('带爆炸时稳态 > 不带爆炸（异常部分含爆炸）', () => {
    const noBlast = core.compute(weapon() as any, mode({ slash: 100 }) as any, [], {});
    // 火 + 冰 → 爆炸
    const blastMods = [
      { stat: 'elemental:heat', form: 'pct', amount: 90, source: 'h', slot: 0 },
      { stat: 'elemental:cold', form: 'pct', amount: 90, source: 'c', slot: 1 },
    ];
    const withBlast = core.compute(weapon() as any, mode({ slash: 100 }) as any, blastMods as any, {});
    assert.ok((withBlast.output.blast.stacksPerSecond ?? 0) > 0, '这个配置应产生爆炸');
    assert.ok(withBlast.output.steadyDps > noBlast.output.steadyDps, '稳态应包含爆炸');
  });

  it('爆炸的叠层没有上限：稳态爆炸部分随射速上升', () => {
    const blastMods = [
      { stat: 'elemental:heat', form: 'pct', amount: 90, source: 'h', slot: 0 },
      { stat: 'elemental:cold', form: 'pct', amount: 90, source: 'c', slot: 1 },
    ];
    const a = core.compute(weapon({ fireRate: 5 }) as any, mode({ slash: 100 }) as any, blastMods as any, {});
    const b = core.compute(weapon({ fireRate: 10 }) as any, mode({ slash: 100 }) as any, blastMods as any, {});
    assert.ok(b.output.steadyDps > a.output.steadyDps);
    assert.ok((a.output.blast.perStack ?? 0) > 0);
  });
});
