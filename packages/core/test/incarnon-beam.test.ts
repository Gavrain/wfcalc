/**
 * 真实武器回归：灵化射线的「单弹头 = 单次射击」（D-160）。
 *
 * 需求方 2026-11-12：
 * > 「盗贼 赘骨 野猪 托里德的灵化是射线，注意赘骨的两个 charge 不是射线。」
 * > 「但是布莱顿又不是射线，你这样也不对」
 *
 * 射线的口径（乘区归属表 0.1）：多重**并进单弹头**，所以「单弹头」与「单次射击」相等，
 * 且 DoT 每跳也吃多重。实弹则相反：单弹头不含多重。
 *
 * 这里读**生成好的真实数据**，防止数据层再把这四把的射线标丢掉。
 */
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as core from '../src/index.ts';

const { compute } = core as any;

type AnyWeapon = Record<string, any>;

/** 读生成数据里的某把武器 */
function load(category: 'primary' | 'secondary', englishName: string): AnyWeapon {
  const url = new URL(`../../data/src/generated/weapons/${category}.json`, import.meta.url);
  const json = JSON.parse(readFileSync(url, 'utf8'));
  const w = json.weapons.find((x: AnyWeapon) => x.name === englishName);
  assert.ok(w, `生成数据里找不到 ${englishName}`);
  return w!;
}

/** 分裂膛室：+90% 多重（MODS 里也有，但手写贡献不依赖 Mod 数据） */
const MS = [{ stat: 'multishot', form: 'pct', amount: 90, source: 'split_chamber' }];

const incMode = (w: AnyWeapon) => {
  const m = w.modes.find((x: AnyWeapon) => x.role === 'incarnon');
  assert.ok(m, `${w.name} 应有灵化模式`);
  return m!;
};

/**
 * 灵化模式里段上**是否写了 `beam`**（数据层只写正面标记，不写 `false`）。
 * 内核的 `SegmentResult.beam` 是"最终是否按射线算"（含跟随模式扳机），
 * 不能用来区分数据标记，所以这里直接读数据。
 *
 * ⚠ JSON 里缺省字段读出来是 `null` 而不是 `undefined`，统一归一成 `undefined`。
 */
const segmentBeamFlags = (mode: AnyWeapon): Array<boolean | undefined> =>
  mode.variants.flatMap((v: AnyWeapon) =>
    v.segments.map((s: AnyWeapon) => (s.beam === true ? true : undefined)));

/** 灵化里标签含某字的变体的下标 */
const variantIndex = (mode: AnyWeapon, label: string): number => {
  const i = mode.variants.findIndex((v: AnyWeapon) => String(v.label).includes(label));
  assert.ok(i >= 0, `找不到「${label}」变体，实际：${mode.variants.map((v: AnyWeapon) => v.label).join(' / ')}`);
  return i;
};

describe('灵化射线：单弹头 = 单次射击（D-160）', () => {
  const cases: Array<{ cat: 'primary' | 'secondary'; name: string }> = [
    { cat: 'primary', name: 'Torid' },
    { cat: 'primary', name: 'Boar' },
    { cat: 'primary', name: 'Boar Prime' },
    { cat: 'secondary', name: 'Furis' },
  ];

  for (const { cat, name } of cases) {
    it(`${name}：装了多重后单弹头仍等于单次射击`, () => {
      const w = load(cat, name);
      const m = incMode(w);
      assert.deepEqual(segmentBeamFlags(m), [true], `${name} 灵化段应标成射线（beam: true）`);
      const r = compute(w, m, MS, { kuva: null, faction: 'none' });
      // 多重确实生效了（否则"相等"没有意义）
      assert.ok(r.panelPairs.multishot.after > 1.5, '多重 Mod 应生效');
      assert.ok(Math.abs(r.output.pelletPerHit - r.output.perShot) < 1e-9,
        `单弹头 ${r.output.pelletPerHit} ≠ 单次射击 ${r.output.perShot}`);
      assert.equal(r.segments[0].beam, true, '内核也应按射线算');
    });
  }

  it('托里德：单弹头就是整段伤害（射线合并为一跳）', () => {
    const w = load('primary', 'Torid');
    const r = compute(w, incMode(w), [], { kuva: null, faction: 'none' });
    // 51 毒素 × 暴击期望（29% / 3.1x） = 51 × (1 + 0.29 × 2.1)
    const expected = 51 * (1 + 0.29 * 2.1);
    assert.ok(Math.abs(r.output.pelletPerHit - expected) < 1e-6, `${r.output.pelletPerHit} vs ${expected}`);
    assert.equal(r.output.multishot, 1);
  });

  it('布莱顿 Prime：灵化不是射线，多重仍分开（反例锁住）', () => {
    const w = load('primary', 'Braton Prime');
    const m = incMode(w);
    assert.ok(segmentBeamFlags(m).every((b) => b === undefined), '布莱顿灵化段不该带 beam 标记（实弹）');
    const direct = variantIndex(m, '直接命中');
    const r = compute(w, m, MS, { kuva: null, faction: 'none' }, [direct]);
    assert.equal(r.segments[0].beam, false, '布莱顿灵化是实弹');
    assert.ok(r.output.perShot > r.output.pelletPerHit * 1.5,
      `实弹应满足 单次射击 > 单弹头：${r.output.pelletPerHit} / ${r.output.perShot}`);
  });

  it('赘骨：射线变体单弹头=单次射击；蓄力变体不相等', () => {
    const w = load('secondary', 'Onos');
    const m = incMode(w);
    // 只有 Held 那条写了 beam: true，蓄力 / 范围伤害都没有
    const flags = segmentBeamFlags(m);
    assert.deepEqual(flags, [true, undefined, undefined], `赘骨的段标记应为 [true, undefined, undefined]，实际 ${JSON.stringify(flags)}`);

    const beamIdx = variantIndex(m, '射线');
    const b = compute(w, m, MS, { kuva: null, faction: 'none' }, [beamIdx]);
    assert.equal(b.segments[0].beam, true);
    assert.ok(Math.abs(b.output.pelletPerHit - b.output.perShot) < 1e-9,
      `射线：单弹头 ${b.output.pelletPerHit} ≠ 单次射击 ${b.output.perShot}`);

    const chargeIdx = variantIndex(m, '蓄力');
    const c = compute(w, m, MS, { kuva: null, faction: 'none' }, [chargeIdx]);
    // 蓄力本体不是射线（WFCD 把它错记成 Hit-Scan，靠名字判成 charge）
    assert.ok(c.output.perShot > c.output.pelletPerHit * 1.5,
      `蓄力应满足 单次射击 > 单弹头：${c.output.pelletPerHit} / ${c.output.perShot}`);
  });
});
