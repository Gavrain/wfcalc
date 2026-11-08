/**
 * 灵化武器识别（D-100，需求方 2026-11-06）。
 *
 * 需求方反馈：
 * > 「不对，伯斯顿那个是灵化模式，而且暴击伤害是3倍，我给你一份全的灵化武器列表。」
 *
 * 官方 `ExportWeapons` **没有灵化标记**（`defaultUpgrades` 是玄骸元素/近战姿态），
 * 灵化形态的触发方式又五花八门，所以用灰机 wiki 的清单做人工层：
 * `packages/data/src/manual/incarnon.ts`（95 把，抓取于 2026-11-06）。
 *
 * 数值暂不收录（需求方：先不填数值，只做识别）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INCARNON_WEAPONS, incarnonInfoOf } from '../src/manual/incarnon.ts';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));

describe('灵化清单（人工层）', () => {
  it('收录 95 把（wiki 2026-11-06 快照）', () => {
    assert.equal(Object.keys(INCARNON_WEAPONS).length, 95);
  });

  it('原生灵化武器都在', () => {
    for (const name of ['Felarx', 'Innodem', 'Laetum', 'Phenmor', 'Praedos', 'Onos', 'Ruvox', 'Thalys']) {
      const e = incarnonInfoOf(name);
      assert.ok(e, `${name} 应在清单里`);
      assert.equal(e.kind, 'innate');
    }
  });

  it('灵化之源武器标为 genesis', () => {
    for (const name of ['Braton', 'Burston', 'Torid', 'Soma', 'Vectis']) {
      const e = incarnonInfoOf(name);
      assert.ok(e, `${name} 应在清单里`);
      assert.equal(e.kind, 'genesis');
    }
  });

  it('uniqueName 的紧凑写法也能匹配（BratonPrime / DualToxocyst）', () => {
    assert.ok(incarnonInfoOf('BratonPrime'));
    assert.ok(incarnonInfoOf('DualToxocyst'));
    // 与清单里的显示名指向同一条
    assert.equal(incarnonInfoOf('BratonPrime')?.source, incarnonInfoOf('Braton Prime')?.source);
  });

  it('变体前缀写法也能匹配（PrimeBurston ↔ Burston Prime）', () => {
    assert.equal(incarnonInfoOf('PrimeBurston')?.source, incarnonInfoOf('Burston Prime')?.source);
    assert.equal(incarnonInfoOf('VandalBraton')?.source, incarnonInfoOf('Braton Vandal')?.source);
  });

  it('非灵化武器查不到', () => {
    assert.equal(incarnonInfoOf('KuvaKarak'), undefined);
    assert.equal(incarnonInfoOf('Serration'), undefined);
    assert.equal(incarnonInfoOf(undefined), undefined);
  });
});

describe('数据层：灵化模式已被单独标记', () => {
  async function loadWeapons(cat: string) {
    const d = JSON.parse(await readFile(join(ROOT, `packages/data/src/generated/weapons/${cat}.json`), 'utf8'));
    return d.weapons as { id: string; name: string; nameZh?: string; modes: { id: string; role: string; trigger: string }[] }[];
  }

  it('伯斯顿 Prime = 点射 + 灵化（不再显示成两个普通模式）', async () => {
    const ws = await loadWeapons('primary');
    const w = ws.find((x) => x.id === 'PrimeBurston');
    assert.ok(w);
    assert.equal(w.modes.length, 2);
    assert.equal(w.modes[0]!.role, 'normal');
    assert.equal(w.modes[0]!.trigger, 'burst');
    assert.equal(w.modes[1]!.role, 'incarnon');
  });

  it('布莱顿 Prime 的灵化模式被标出来', async () => {
    const ws = await loadWeapons('primary');
    const w = ws.find((x) => x.id === 'BratonPrime');
    assert.ok(w);
    assert.equal(w.modes.filter((m) => m.role === 'incarnon').length, 1);
  });

  it('灵化标记只出现在清单内的武器上（抽样对照）', async () => {
    const ws = await loadWeapons('primary');
    const karak = ws.find((x) => x.id === 'KuvaKarak');
    assert.ok(karak);
    assert.equal(karak.modes.filter((m) => m.role === 'incarnon').length, 0);
  });
});

describe('灵化模式不参与半自动炮轰的装备判定', () => {
  it('伯斯顿：点射本身就不符合，装不了', async () => {
    const { isSemiAutoOnlyWeapon } = await import('../src/adapter.ts');
    const d = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/weapons/primary.json'), 'utf8'));
    const w = d.weapons.find((x: { id: string }) => x.id === 'PrimeBurston');
    assert.ok(w);
    assert.equal(isSemiAutoOnlyWeapon(w.modes), false);
  });

  it('灵化模式即使 trigger 是 semi 也不影响（只有本体 semi 才行）', async () => {
    const { isSemiAutoOnlyWeapon } = await import('../src/adapter.ts');
    // 本体 burst + 灵化 semi → 不可装
    assert.equal(
      isSemiAutoOnlyWeapon([
        { trigger: 'burst', role: 'normal' },
        { trigger: 'semi', role: 'incarnon' },
      ]),
      false,
    );
    // 本体 semi + 灵化 auto → 可装
    assert.equal(
      isSemiAutoOnlyWeapon([
        { trigger: 'semi', role: 'normal' },
        { trigger: 'auto', role: 'incarnon' },
      ]),
      true,
    );
  });
});
