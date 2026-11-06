/**
 * D-066：弹匣 / 装填 Mod 必须在**面板**上可见，且装填要影响六秒异常状态总伤。
 *
 * bug 背景：
 *   ① `panelPairs` 只有 5 项，没有 `magazineSize` / `reloadTime`，
 *      界面那行直接读武器原始值 → 弹匣/装填 Mod 在面板上看不出任何变化；
 *   ② 六秒总伤其实**已经**吃装填（通过开火时间线），只是卡拉克打不满 6 秒
 *      所以看不出来 —— 这点需要断言锁住，避免被当成 bug 又改坏。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const { compute } = core as any;

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

/** 弹匣 12、射速 10 → 1.2 秒打空，会频繁装填 */
const shortMag = (reloadTime = 2) => ({
  id: 'T', name: 'T', critChance: 0, critMultiplier: 2, statusChance: 1,
  fireRate: 10, magazineSize: 12, reloadTime,
  modes: [{ id: 'primary', role: 'normal', trigger: 'auto', multishot: 1,
    variants: [{ id: 'direct', label: '直接命中', segments: [{ kind: 'impact', procChance: 1, damage: { slash: 100 } }] }] }],
});

const reloadMod = (pct: number) => [{ stat: 'reloadSpeed', form: 'pct', amount: pct, source: 'x' }];
const magMod = (pct: number) => [{ stat: 'magazine', form: 'pct', amount: pct, source: 'x' }];

const dot6s = (r: any) => r.output.lines.find((l: any) => l.id === 'dot6s').value;

describe('弹匣 / 装填面板（D-066）', () => {
  it('panelPairs 里有 magazineSize 与 reloadTime', () => {
    const w = shortMag();
    const r = compute(w, w.modes[0], [], {}, false);
    assert.ok(r.panelPairs.magazineSize, '缺少 magazineSize');
    assert.ok(r.panelPairs.reloadTime, '缺少 reloadTime');
    near(r.panelPairs.magazineSize.base, 12);
    near(r.panelPairs.reloadTime.base, 2);
  });

  it('弹匣 Mod 改变 panelPairs.magazineSize.after', () => {
    const w = shortMag();
    const r = compute(w, w.modes[0], magMod(100), {}, false);
    near(r.panelPairs.magazineSize.base, 12);
    near(r.panelPairs.magazineSize.after, 24);
  });

  it('装填 Mod 缩短 panelPairs.reloadTime.after（速度% → 时间）', () => {
    const w = shortMag();
    const r = compute(w, w.modes[0], reloadMod(100), {}, false);
    near(r.panelPairs.reloadTime.base, 2);
    // 速度 +100% → 时间减半
    near(r.panelPairs.reloadTime.after, 1);
  });

  it('装填 Mod 加速时，时间是变**短**而不是变长', () => {
    const w = shortMag();
    const r = compute(w, w.modes[0], reloadMod(50), {}, false);
    assert.ok(r.panelPairs.reloadTime.after < r.panelPairs.reloadTime.base,
      `+50% 速度应缩短时间：${r.panelPairs.reloadTime.after} 应 < ${r.panelPairs.reloadTime.base}`);
    near(r.panelPairs.reloadTime.after, 2 / 1.5);
  });
});

describe('装填影响六秒异常状态总伤（D-066）', () => {
  it('装填加速 → 六秒总伤提升（打不满 6 秒的枪）', () => {
    const w = shortMag();
    const a = compute(w, w.modes[0], [], {}, false);
    const b = compute(w, w.modes[0], reloadMod(50), {}, false);
    assert.ok(dot6s(b) > dot6s(a),
      `装填加速后总伤应上升：${dot6s(a).toFixed(2)} → ${dot6s(b).toFixed(2)}`);
  });

  it('装填变慢 → 六秒总伤下降', () => {
    const w = shortMag();
    const a = compute(w, w.modes[0], [], {}, false);
    const b = compute(w, w.modes[0], reloadMod(-50), {}, false);
    assert.ok(dot6s(b) < dot6s(a),
      `装填变慢后总伤应下降：${dot6s(a).toFixed(2)} → ${dot6s(b).toFixed(2)}`);
  });

  it('弹匣加大 → 六秒总伤提升（少装填一次）', () => {
    const w = shortMag();
    const a = compute(w, w.modes[0], [], {}, false);
    const b = compute(w, w.modes[0], magMod(200), {}, false);
    assert.ok(dot6s(b) > dot6s(a),
      `弹匣加大后总伤应上升：${dot6s(a).toFixed(2)} → ${dot6s(b).toFixed(2)}`);
  });

  it('打满 6 秒的枪（弹匣 70、射速 10）：装填不影响总伤', () => {
    const w = shortMag();
    w.magazineSize = 70; // 7 秒才打空
    const a = compute(w, w.modes[0], [], {}, false);
    const b = compute(w, w.modes[0], reloadMod(50), {}, false);
    near(dot6s(b), dot6s(a));
  });

  it('装填时间越长，总伤单调下降', () => {
    const values = [3, 2, 1, 0.5].map((rt) => dot6s(compute(shortMag(rt), shortMag(rt).modes[0], [], {}, false)));
    // 数组是"装填从长到短"，总伤应单调上升
    for (let i = 1; i < values.length; i++) {
      assert.ok(values[i] > values[i - 1], `装填缩短应提升总伤：${JSON.stringify(values)}`);
    }
  });
});
