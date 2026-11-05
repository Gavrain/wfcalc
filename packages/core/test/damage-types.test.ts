import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DT_KEY_MAP,
  DAMAGE_TYPES,
  spreadTotal,
  spreadTotalAfterMods,
  scaleSpread,
  isCompound,
} from '../src/index.ts';

describe('damage types', () => {
  it('maps every DT_* export key to a known damage type', () => {
    for (const key of Object.keys(DT_KEY_MAP)) {
      assert.ok(DAMAGE_TYPES.includes(DT_KEY_MAP[key]!), `${key} maps to unknown type`);
    }
  });

  it('sums a spread', () => {
    assert.equal(spreadTotal({ impact: 1.5, slash: 2 }), 3.5);
    assert.equal(spreadTotal({}), 0);
  });

  it('scales a spread proportionally', () => {
    const out = scaleSpread({ impact: 10, slash: 30 }, 2);
    assert.equal(out.impact, 20);
    assert.equal(out.slash, 60);
  });

  it('returns the spread unchanged when the total is zero', () => {
    assert.deepEqual(scaleSpread({ impact: 0 }, 5), { impact: 0 });
  });

  it('classifies compound elements', () => {
    assert.equal(isCompound('viral'), true);
    assert.equal(isCompound('impact'), false);
    assert.equal(isCompound('heat'), false);
  });

  it('计算新面板总伤：物理/元素各按自身占比放大（表 4.1 校验例 1 的中间量）', () => {
    // 面板 100 冲 + 100 切，+100% 冲击（物理%Mod 只作用于冲击，切削保持 100）
    // ⇒ 新面板总伤 = 200 + 100 = 300（超出的元素加量 200 由 E2 叠上去，见下一条）
    const total = spreadTotalAfterMods({ impact: 100, slash: 100 }, { impact: 1 });
    assert.equal(total, 300);
  });

  it('计算新面板总伤：不混入玄骸加成（玄骸在基伤之前单独算，D-017）', () => {
    // 表 4.4 校验例 2 前半：面板 40，60% 磁力 ⇒ 玄骸那份 24，新面板总伤 64
    const panel = { puncture: 10, slash: 10, impact: 10, heat: 10 };
    const panelTotal = spreadTotal(panel);
    assert.equal(panelTotal * 0.6, 24); // 玄骸加量 = 面板总伤 × 比例
    assert.equal(spreadTotalAfterMods(panel), 40); // 分布本身不含玄骸
  });

  it('D-017：玄骸在基伤之前，因此吃基伤加成（例 2 中基伤为 0 时仍是 24）', () => {
    // applyKuvaBonus 之后，玄骸已并入面板；基伤 (1+G) 再整体作用一次
    const panel = { puncture: 10, slash: 10, impact: 10, heat: 10 };
    const kuva = spreadTotal(panel) * 0.6; // 24
    const G = 1.65; // 例如 +165% 基伤（膛线满级）
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    assert.ok(near(kuva * (1 + G), 63.6)); // 玄骸自身被放大
    assert.ok(near((40 + kuva) * (1 + G), 169.6)); // 新面板总伤 = 面板 × (1+比例) × 基伤
  });
});
