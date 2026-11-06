/**
 * 面板与玄骸加成的两个回归（需求方 2026-11-06）。
 *
 * 1. **非玄骸武器不能吃到玄骸元素加成**：界面隐藏了加成条，计算层也必须真的不传，
 *    否则会出现"加成条没了，但伤害分布里还多出一个元素"。
 * 2. **基础面板必须合计该变体的所有段**：血肢（Hema）的自带病毒在 `attack` 段，
 *    `impact` 段只有物理三元素；只读 `segments[0]` 会把自带病毒漏掉。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compute } from '../../core/src/index.ts';
import type { AttackMode, Weapon } from '../../core/src/weapon.ts';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));

async function weapons() {
  const d = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/weapons/primary.json'), 'utf8'));
  return d.weapons as Weapon[];
}

/** 把模式压平成"只有当前变体的段"，与 demo 的 effectiveMode 一致 */
function flat(mode: AttackMode): AttackMode {
  return { ...mode, segments: mode.variants[0]!.segments } as unknown as AttackMode;
}

/** 面板基础分布 = 该变体所有段的伤害合计 */
function baseSpread(mode: AttackMode): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of mode.variants[0]!.segments) {
    for (const [t, v] of Object.entries(s.damage)) {
      if (typeof v === 'number' && v !== 0) out[t] = (out[t] ?? 0) + v;
    }
  }
  return out;
}

describe('非玄骸武器不吃玄骸加成', () => {
  it('不传 kuva 时伤害分布里没有玄骸元素', async () => {
    const all = await weapons();
    const torid = all.find((w) => w.id === 'BioWeapon');
    assert.ok(torid);
    const mode = flat(torid.modes[0]!);
    const spread = compute(torid, mode, [], { kuva: null } as never, false).totalSpread;
    // 托里德本体是毒素武器，不该出现毒气（那是火+毒的合成结果）
    assert.equal(spread.gas, undefined, '非玄骸武器不应出现玄骸合成元素');
    assert.ok((spread.toxin ?? 0) > 0);
  });

  it('传了 kuva 才会合成玄骸元素（对照）', async () => {
    const all = await weapons();
    const torid = all.find((w) => w.id === 'BioWeapon');
    assert.ok(torid);
    const mode = flat(torid.modes[0]!);
    const spread = compute(torid, mode, [], { kuva: { type: 'heat', ratio: 0.6 } } as never, false).totalSpread;
    assert.ok((spread.gas ?? 0) > 0, '传了 kuva 应出现毒气');
  });
});

describe('血肢只有病毒，没有物理（D-095）', () => {
  for (const id of ['InfestedBurstRifle', 'CodaHema']) {
    it(`${id} 的伤害分布里没有物理三元素`, async () => {
      const all = await weapons();
      const w = all.find((x) => x.id === id);
      assert.ok(w, `找不到 ${id}`);
      const spread = baseSpread(w.modes[0]!);
      assert.equal(spread.impact, undefined, '血肢没有冲击');
      assert.equal(spread.puncture, undefined, '血肢没有穿刺');
      assert.equal(spread.slash, undefined, '血肢没有切割');
      assert.ok((spread.viral ?? 0) > 0, '自带病毒必须在');
    });
  }

  it('血肢总伤 = 纯病毒 47', async () => {
    const all = await weapons();
    const w = all.find((x) => x.id === 'InfestedBurstRifle');
    assert.ok(w);
    const spread = baseSpread(w.modes[0]!);
    const total = Object.values(spread).reduce((a, b) => a + b, 0);
    assert.equal(total, 47);
    assert.equal(spread.viral, 47);
    assert.equal(Object.keys(spread).length, 1, '只有病毒一种');
  });

  it('对照：普通步枪（Kuva Karak）仍然有物理三元素', async () => {
    const all = await weapons();
    const w = all.find((x) => x.id === 'KuvaKarak');
    assert.ok(w);
    const spread = baseSpread(w.modes[0]!);
    assert.ok((spread.impact ?? 0) > 0);
    assert.ok((spread.puncture ?? 0) > 0);
    assert.ok((spread.slash ?? 0) > 0);
  });
});
