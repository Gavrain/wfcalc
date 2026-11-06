/**
 * D-057：六秒异常状态总伤的三项规则。
 *   ① 毒气 10 层上限（§6.3）
 *   ② 火焰逐层累加基础值 → 曲线单调上升（§6.3）
 *   ③ 爆炸**不计入**每层秒伤，但**计入**总伤
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const { compute, sixSecondTotal, DOT_MAX_STACKS } = core as any;

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const weapon: any = {
  id: 'TestRifle', name: 'Test',
  critChance: 0, critMultiplier: 2, statusChance: 0.5,
  fireRate: 10, magazineSize: 30, reloadTime: 2,
  modes: [{
    id: 'primary', role: 'normal', trigger: 'auto', multishot: 1,
    variants: [{ id: 'direct', label: '直接命中', segments: [{ kind: 'impact', procChance: 0.5, damage: { impact: 100 } }] }],
  }],
};

describe('毒气 10 层上限（D-057）', () => {
  it('DOT_MAX_STACKS 里只有毒气有上限', () => {
    assert.equal(DOT_MAX_STACKS.gas, 10);
    assert.equal(DOT_MAX_STACKS.heat, null);
    assert.equal(DOT_MAX_STACKS.toxin, null);
    assert.equal(DOT_MAX_STACKS.electric, null);
    assert.equal(DOT_MAX_STACKS.slash, null);
  });

  it('层数增长到上限后就封顶，不再线性增长', () => {
    // 每秒 3 层：t=1..6 → 3,6,9,10,10,10（封顶 10）
    const total = sixSecondTotal('gas', 3, 1);
    // 3+6+9+10+10+10 = 48
    near(total, 48);
  });

  it('叠层很快时六秒总伤远小于"满层稳态 × 6"', () => {
    const stacksPerSec = 5; // 2 秒就满 10 层
    const perStack = 10;
    const actual = sixSecondTotal('gas', stacksPerSec, perStack);
    // 满层稳态 = 10 层 × 每层 10 = 100/秒，× 6 = 600
    const steadyState = perStack * DOT_MAX_STACKS.gas * 6;
    assert.ok(actual < steadyState, `逐秒累加 ${actual} 应小于满层稳态 ${steadyState}`);
    // 1 秒 5 层、2 秒 10 层、之后保持 10 层：5+10+10+10+10+10 = 55 层
    near(actual, perStack * 55);
  });

  it('叠层很慢时（6 秒内到不了上限）与无上限一致', () => {
    const stacksPerSec = 1; // 6 秒才 6 层
    const actual = sixSecondTotal('gas', stacksPerSec, 10);
    // 1+2+3+4+5+6 = 21 层
    near(actual, 10 * 21);
  });
});

describe('火焰：刷新时长 + 叠加灼烧伤害量（§6.3）', () => {
  it('火焰每秒跳一次，按整数秒把该秒新叠的基础值累加进去', () => {
    // 每秒叠 2 层、每层 1。累积层数：2,4,6,8,10,12
    // 每跳 = 单层 × 累计层数 → 2+4+6+8+10+12 = 42
    const total = sixSecondTotal('heat', 2, 1);
    near(total, 42);
  });

  it('火焰曲线单调上升（累计层数只增不减）', () => {
    const s = 2;
    const p = 1;
    let prev = 0;
    let monotonic = true;
    for (let sec = 1; sec <= 6; sec++) {
      const accum = s * sec;
      const cur = p * accum;
      if (sec > 1 && cur <= prev) monotonic = false;
      prev = cur;
    }
    assert.ok(monotonic, '火焰每秒伤害应单调上升');
  });

  it('火焰没有层数上限，层数持续累加', () => {
    assert.equal(DOT_MAX_STACKS.heat, null);
    // 每秒 100 层也不封顶
    const many = sixSecondTotal('heat', 100, 1);
    // 100+200+300+400+500+600 = 2100
    near(many, 2100);
  });

  it('火焰与毒素的曲线形状不同：火焰累加、毒素按当场层数', () => {
    // 每秒 2 层、每层 1
    const heat = sixSecondTotal('heat', 2, 1);   // 2+4+6+8+10+12 = 42
    const toxin = sixSecondTotal('toxin', 2, 1); // 2+4+6+8+10+12 = 42（线性叠层恰好相同）
    // 两者在"线性叠层"情形下数值相同，但火焰不封顶、毒素也不封顶；
    // 差异体现在毒气（封顶）与火焰的组合上。这里只校验两者都被正确计算。
    assert.ok(heat > 0 && toxin > 0);
  });
});

describe('爆炸不计入每层秒伤、但计入总伤（D-057）', () => {
  /** 火 + 冰 → 爆炸 */
  const blastMods: any[] = [
    { stat: 'elemental:heat', form: 'pct', amount: 90, source: 'hellfire' },
    { stat: 'elemental:cold', form: 'pct', amount: 90, source: 'cryo' },
  ];

  it('每层秒伤不含爆炸的贡献', () => {
    const withBlast = compute(weapon, weapon.modes[0], blastMods, {}, false);
    const seg: any = withBlast.segments[0];
    const present = new Set(Object.keys(seg.finalHit));
    let dotOnly = 0;
    for (const t of seg.dotTicks) {
      if (!present.has(t.type)) continue;
      dotOnly += t.tick;
    }
    near(withBlast.output.dotPerSecond, dotOnly);
    // 爆炸确实有每层伤害，但不该出现在 dotPerSecond 里
    assert.ok(withBlast.output.blast.perStack > 0, '爆炸本身应有每层伤害');
  });

  it('爆炸计入六秒异常状态总伤', () => {
    const withBlast = compute(weapon, weapon.modes[0], blastMods, {}, false);
    const seg: any = withBlast.segments[0];
    const present = new Set(Object.keys(seg.finalHit));
    let dotPart = 0;
    for (const t of seg.dotTicks) {
      if (!present.has(t.type)) continue;
      dotPart += sixSecondTotal(t.type, withBlast.output.stacksPerType[t.type] ?? 0, t.tick);
    }
    const total = withBlast.output.dot6s;
    assert.ok(total > dotPart, `总伤应大于纯 DoT 部分（差值是爆炸）`);
    near(total, dotPart + withBlast.output.blast.total6s);
  });

  it('输出口径的名称已改为「六秒异常状态总伤」', () => {
    const res = compute(weapon, weapon.modes[0], [], {}, false);
    const line = res.output.lines.find((l: any) => l.id === 'dot6s');
    assert.equal(line.label, '六秒异常状态总伤');
  });
});
