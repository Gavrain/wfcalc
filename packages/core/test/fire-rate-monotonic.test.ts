/**
 * D-067：射速不能给六秒异常状态总伤带来负收益。
 *
 * bug 背景：`buildFiringTimeline` 用**整秒**判定开火/装填，导致开火秒数是阶梯函数：
 *   射速 16.92 → 开火 4 秒，射速 25.08 → 开火 5 秒，射速 30.33 → 又掉回 4 秒。
 * 于是「私法热诚 +45% 射速」在特定配置下变成 -5.94%。
 *
 * 修正：按**毫秒精度**积分开火区间，得到每秒开火占比，叠层按占比折算。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const { compute, firingFraction, isFiringAt } = core as any;

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const mk = (fr: number, mag = 70, reload = 1.7) => ({
  id: 'T', name: 'T', critChance: 0, critMultiplier: 2, statusChance: 1,
  fireRate: fr, magazineSize: mag, reloadTime: reload,
  modes: [{ id: 'primary', role: 'normal', trigger: 'auto', multishot: 1,
    variants: [{ id: 'direct', label: '直接命中', segments: [{ kind: 'impact', procChance: 1, damage: { slash: 100, heat: 50 } }] }] }],
});

const dot6s = (fr: number, mag = 70, reload = 1.7) => {
  const w = mk(fr, mag, reload);
  return compute(w, w.modes[0], [], {}).output.lines.find((l: any) => l.id === 'dot6s').value;
};

describe('射速单调性（D-067）', () => {
  it('射速从 5 扫到 60，六秒总伤单调不减', () => {
    let prev = -1;
    for (let fr = 5; fr <= 60; fr += 2.5) {
      const v = dot6s(fr);
      assert.ok(v >= prev - 1e-9, `射速 ${fr} 时总伤 ${v} 低于前一档 ${prev}`);
      prev = v;
    }
  });

  it('私法热诚（+45% 射速）在各基础射速下收益恒为正', () => {
    for (const fr of [10, 15, 20, 25, 30, 40, 50]) {
      const a = dot6s(fr);
      const b = dot6s(fr * 1.45);
      assert.ok(b > a, `基础射速 ${fr}：加射速后 ${b} 应大于 ${a}`);
    }
  });

  it('原 bug 配置：射速 25.08 → 30.33 不再是负收益', () => {
    const a = dot6s(25.083);
    const b = dot6s(30.333);
    assert.ok(b > a, `30.33 的总伤 ${b} 应大于 25.08 的 ${a}`);
  });
});

describe('毫秒精度开火占比（D-067）', () => {
  it('打满 6 秒的枪 → 每秒开火占比都是 1', () => {
    // 弹匣 70 ÷ 射速 10 = 7 秒
    for (let s = 1; s <= 6; s++) near(firingFraction(70, 10, 1.7, s), 1);
  });

  it('占比落在 [0, 1] 内', () => {
    for (const fr of [12, 20, 30]) {
      for (let s = 1; s <= 6; s++) {
        const f = firingFraction(70, fr, 1.7, s);
        assert.ok(f >= 0 && f <= 1, `占比越界：${f}`);
      }
    }
  });

  it('装填期确实有部分秒的开火占比小于 1', () => {
    // 射速 30 → 2.33 秒打空、1.7 秒装填 → 循环 4.03 秒，6 秒内必有装填
    let partial = 0;
    for (let s = 1; s <= 6; s++) {
      if (firingFraction(70, 30, 1.7, s) < 1) partial++;
    }
    assert.ok(partial > 0, '6 秒窗口内应出现装填');
  });

  it('装填占比随射速升高而升高（收益递减的根源）', () => {
    // 打空耗时 = mag/fr，会随射速下降；循环里装填占比 = reload / (mag/fr + reload)
    const reloadShare = (fr: number) => 1.7 / (70 / fr + 1.7);
    assert.ok(reloadShare(60) > reloadShare(10),
      '射速越高，装填时间在循环里占比越大 —— 所以收益递减但不为负');
  });

  it('isFiringAt 与 firingFraction 口径一致', () => {
    // 全程开火时，任意时刻都在开火
    assert.equal(isFiringAt(70, 10, 1.7, 3), true);
    near(firingFraction(70, 10, 1.7, 3), 1);
  });

  it('数据缺失时按全程开火（不崩）', () => {
    near(firingFraction(0, 10, 2, 1), 1);
    near(firingFraction(70, 0, 2, 1), 1);
  });

  // ── D-068：装填期间 DoT **一直在跳**，只是不叠新层 ──
  it('装填期间累计层数不变，但每秒伤害照常累加', () => {
    // 弹匣 10、射速 10 → 1 秒打空、装填 2 秒
    // 逐秒开火占比：1, 0, 0, 1, 0, 0
    // 用**纯切割**武器，避免热/元素合成的干扰
    const w: any = mk(10, 10, 2);
    // D-080：段只属于变体——直接改变体内的段
    w.modes[0].variants[0].segments[0].damage = { slash: 100 };
    const r = compute(w, w.modes[0], [], {});
    const seg: any = r.segments[0];
    const tick = seg.dotTicks.find((t: any) => t.type === 'slash').tick;
    const perSec = r.output.stacksPerType.slash;

    let stacks = 0;
    let manual = 0;
    const perSecondDamage: number[] = [];
    for (let s = 1; s <= 6; s++) {
      const frac = firingFraction(10, 10, 2, s);
      stacks += perSec * frac;      // 只有新增层受开火影响
      manual += tick * stacks;      // 每秒都结算，无论是否装填
      perSecondDamage.push(tick * stacks);
    }

    // 与内核一致
    near(r.output.lines.find((l: any) => l.id === 'dot6s').value, manual);

    // 装填的秒（占比 0）伤害不为 0 —— 证明在继续跳
    // （noUncheckedIndexedAccess 下数组元素是 `number | undefined`，用 `!` 断言已取到）
    assert.equal(firingFraction(10, 10, 2, 2), 0, '第 2 秒应是装填');
    assert.ok(perSecondDamage[1]! > 0, '装填的第 2 秒伤害应大于 0');
    assert.equal(firingFraction(10, 10, 2, 3), 0, '第 3 秒应是装填');
    assert.ok(perSecondDamage[2]! > 0, '装填的第 3 秒伤害应大于 0');

    // 装填秒的伤害与前一秒相同（层数没变）
    near(perSecondDamage[1]!, perSecondDamage[0]!);
    near(perSecondDamage[2]!, perSecondDamage[1]!);
    // 但开火那秒层数增加，伤害变高
    assert.ok(perSecondDamage[3]! > perSecondDamage[2]!, '重新开火后伤害应上升');
  });
});
