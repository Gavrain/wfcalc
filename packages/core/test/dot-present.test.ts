/**
 * D-055：配装里**没有**的元素不会触发，层数与秒伤必须为 0。
 *
 * bug 背景：`dotTick` 的 ① 基础值取的是**全类型之和**（§6.2 要求），
 * 所以即便配装里没有毒/火/电，也能算出非零的「每跳伤害」。
 * 但触发池里没有这个元素 → 永远叠不出层 → 层数 0、每层秒伤 0、六秒总伤 0。
 * 之前实现只算了每跳伤害，导致合计虚增。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';

const { compute, DOT_TYPES } = core as any;

const weapon: any = {
  id: 'TestRifle',
  name: 'Test Rifle',
  critChance: 0.2,
  critMultiplier: 2,
  statusChance: 0.5,
  fireRate: 10,
  magazineSize: 30,
  reloadTime: 2,
};

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

/** 只有切割的武器 */
const slashOnly: any = {
  id: 'primary', role: 'normal', trigger: 'auto', multishot: 1,
  variants: [{ id: 'direct', label: '直接命中', segments: [{ kind: 'slash', procChance: 0.5, damage: { slash: 100 } }] }],
};

describe('没有的元素不触发（D-055）', () => {
  it('只配切割时，火/毒/电/毒气/爆炸的层数与秒伤都是 0', () => {
    const res = compute(weapon, slashOnly, [], {}, false);
    const out: any = res.output;
    const seg: any = res.segments[0];
    const present = new Set(Object.keys(seg.finalHit));

    for (const t of DOT_TYPES) {
      if (present.has(t)) continue;
      near(out.stacksPerType[t] ?? 0, 0);
      near(out.dotPerType[t] ?? 0, 0);
    }
    // 切割存在，应有非零值
    assert.ok(out.dotPerType.slash > 0, '切割应有每层秒伤');
  });

  it('每层秒伤合计只包含存在的元素', () => {
    const res = compute(weapon, slashOnly, [], {}, false);
    const out: any = res.output;
    const seg: any = res.segments[0];
    const present = new Set(Object.keys(seg.finalHit));
    const sum = seg.dotTicks
      .filter((t: any) => present.has(t.type))
      .reduce((acc: number, t: any) => acc + t.tick, 0);
    near(out.dotPerSecond, sum);
  });

  it('配装里没有爆炸时，爆炸机制不产生伤害', () => {
    const res = compute(weapon, slashOnly, [], {}, false);
    const out: any = res.output;
    near(out.blast.perStack, 0);
    near(out.blast.perSecond, 0);
    assert.equal(out.blast.stacksPerSecond, 0);
  });

  it('装上火 Mod 后，火才从 0 变成非零', () => {
    const before = compute(weapon, slashOnly, [], {}, false);
    const after = compute(weapon, slashOnly, [
      { stat: 'elemental:heat', form: 'pct', amount: 90, source: 'hellfire' },
    ], {}, false);
    near(before.output.dotPerType.heat ?? 0, 0);
    assert.ok(after.output.dotPerType.heat > 0, '加了火 Mod 后火应有每层秒伤');
    assert.ok(after.output.stacksPerType.heat > 0, '加了火 Mod 后火应能叠层');
  });

  it('六秒总伤也只算存在的元素', () => {
    const res = compute(weapon, slashOnly, [], {}, false);
    const out: any = res.output;
    // 只有切割有贡献
    assert.ok(out.dot6s > 0);
    const seg: any = res.segments[0];
    const present = new Set(Object.keys(seg.finalHit));
    let expected = 0;
    for (const t of seg.dotTicks) {
      if (!present.has(t.type)) continue;
      const stacksPerSec = out.stacksPerType[t.type] ?? 0;
      // D-058：用与内核一致的开火时间线（弹匣/射速/装填）
      const firing = core.buildFiringTimeline(30, 10, 2);
      expected += core.dotSixSecondCurve(t.type, stacksPerSec, t.tick, 6, firing);
    }
    assert.ok(Math.abs(out.dot6s - expected) < 1e-6, `${out.dot6s} vs ${expected}`);
    // 不存在的元素不该贡献任何总伤
    for (const t of DOT_TYPES) {
      if (present.has(t)) continue;
      near(out.dotPerType[t] ?? 0, 0);
    }
  });

  it('合成元素：火+毒只产出毒气，火与毒本身都没了', () => {
    const res = compute(weapon, slashOnly, [
      { stat: 'elemental:heat', form: 'pct', amount: 90, source: 'hellfire' },
      { stat: 'elemental:toxin', form: 'pct', amount: 90, source: 'infected' },
    ], {}, false);
    const seg: any = res.segments[0];
    // 合成后命中分布里不应再有单独的 heat / toxin
    assert.equal(seg.finalHit.heat, undefined, '合成后不应残留火焰');
    assert.equal(seg.finalHit.toxin, undefined, '合成后不应残留毒素');
    assert.ok(seg.finalHit.gas > 0, '应产出毒气');
    near(res.output.dotPerType.heat ?? 0, 0);
    near(res.output.dotPerType.toxin ?? 0, 0);
    assert.ok(res.output.dotPerType.gas > 0, '毒气应有每层秒伤');
  });
});

describe('D-109：异常是否存在，只看「当前面板复合后」有没有这个元素', () => {
  const kuva = (type: string) => ({
    kuva: { type, ratio: 0.6 }, faction: 'none', headshot: { enabled: false, multiplier: 3 },
  });
  const mod = (stat: string, slot: number) => ({ stat, form: 'pct', amount: 90, source: stat, slot });
  const rowsOf = (res: any) => {
    const out: string[] = [];
    for (const t of core.DOT_TYPES) {
      const per = res.output.dotPerType[t] ?? 0;
      const st = res.output.stacksPerType[t] ?? 0;
      if (per > 0 || st > 0) out.push(t);
    }
    return out.sort();
  };

  it('只有火 Mod、没有毒 → 不该出现毒气行', () => {
    const res = compute(weapon, slashOnly, [mod('elemental:heat', 0)], {}, false);
    assert.ok(!(res.segments[0].finalHit.gas > 0), '命中分布里不该有毒气');
    assert.ok(!rowsOf(res).includes('gas'), '界面上不该有毒气行');
  });

  it('「电+毒+火」按槽位合成为腐蚀+火时，不该出现毒气行', () => {
    // 槽位顺序：电(0) 毒(1) → 腐蚀；火(2) 留下
    const res = compute(weapon, slashOnly, [
      mod('elemental:electric', 0), mod('elemental:toxin', 1), mod('elemental:heat', 2),
    ], {}, false);
    const seg: any = res.segments[0];
    assert.ok(seg.finalHit.corrosive > 0, '应有腐蚀');
    assert.ok(seg.finalHit.heat > 0, '应有火焰');
    assert.ok(!(seg.finalHit.gas > 0), '不该有毒气');
    assert.ok(!rowsOf(res).includes('gas'), '界面上不该有毒气行');
  });

  it('火+毒真的合成毒气时，毒气行必须出现且有层数', () => {
    const res = compute(weapon, slashOnly, [
      mod('elemental:heat', 0), mod('elemental:toxin', 1),
    ], {}, false);
    assert.ok(res.segments[0].finalHit.gas > 0, '应合成出毒气');
    assert.ok(rowsOf(res).includes('gas'), '界面上应有毒气行');
    assert.ok((res.output.stacksPerType.gas ?? 0) > 0, '毒气应有层数');
  });

  it('玄骸火参与合成（需求方选 B）：玄骸火 + 毒 Mod 会合成毒气', () => {
    const res = compute(weapon, slashOnly, [mod('elemental:toxin', 0)], kuva('heat'), false);
    assert.ok(res.segments[0].finalHit.gas > 0, '玄骸火应与毒合成毒气');
    assert.ok(rowsOf(res).includes('gas'), '界面上应有毒气行');
  });

  it('显示与叠层一致：显示出的 DoT 行，层数都必须 > 0', () => {
    const cases = [
      [mod('elemental:heat', 0)],
      [mod('elemental:toxin', 0)],
      [mod('elemental:heat', 0), mod('elemental:toxin', 1)],
      [mod('elemental:electric', 0), mod('elemental:toxin', 1), mod('elemental:heat', 2)],
    ];
    for (const contribs of cases) {
      for (const opts of [{}, kuva('heat')]) {
        const res = compute(weapon, slashOnly, contribs, opts, false);
        for (const t of core.DOT_TYPES) {
          const per = res.output.dotPerType[t] ?? 0;
          const st = res.output.stacksPerType[t] ?? 0;
          if (per <= 0 && st <= 0) continue;
          assert.ok(st > 0, t + ' 显示了每层伤害 ' + per + ' 但层数为 0');
        }
      }
    }
  });
});
