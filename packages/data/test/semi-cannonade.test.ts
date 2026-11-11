/**
 * 半自动炮轰系列（D-091，需求方 2026-11-06）。
 *
 * 需求方原话：
 * > 「半自动系列 mod 有一个负面是锁定射速为基础射速，（负射速加成也不生效）现在做这个，
 * > 另外半自动系列 mod 只能装备在只有一个射击模式，且该射击模式为半自动的武器上。
 * > 注意，只考虑武器本身的射击模式，不考虑灵化模式的射击模式，
 * > 因为灵化模式是后面附加到武器上的。」
 *
 * 三张卡：Semi-Pistol / Semi-Rifle / Semi-Shotgun Cannonade
 * 描述：`Only compatible with Semi-Auto Trigger. Fire Rate cannot be modified.`
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isSemiAutoOnlyWeapon,
  isSemiCannonade,
  modToContributions,
  SEMI_CANNONADE_MODS,
  type ModRecord,
} from '../src/adapter.ts';
import { buildWeaponState } from '../../core/src/weapon-state.ts';
import type { Contribution } from '../../core/src/contributions.ts';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));
const mods = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/mods/mods.json'), 'utf8')).mods as ModRecord[];
const byId = new Map(mods.map((m) => [m.id, m]));

function mod(id: string): ModRecord {
  const m = byId.get(id);
  assert.ok(m, `mods.json 里没有 ${id}`);
  return m;
}

describe('半自动炮轰系列：识别', () => {
  it('三张卡都被识别为半自动炮轰', () => {
    assert.equal(SEMI_CANNONADE_MODS.size, 3);
    for (const id of ['semi_pistol_cannonade', 'semi_rifle_cannonade', 'semi_shotgun_cannonade']) {
      assert.equal(isSemiCannonade(mod(id)), true, id);
    }
  });

  it('普通 Mod 不会被误判', () => {
    assert.equal(isSemiCannonade(mod('serration')), false);
    assert.equal(isSemiCannonade(mod('galvanized_aptitude')), false);
  });

  it('贡献上带 locksFireRate 标记（底色伤害词条也带）', () => {
    const c = modToContributions(mod('semi_rifle_cannonade'));
    assert.ok(c.length > 0);
    for (const x of c) assert.equal(x.locksFireRate, true, `${x.stat} 应带标记`);
  });

  it('普通 Mod 的贡献不带这个标记', () => {
    const c = modToContributions(mod('serration'));
    assert.ok(c.length > 0);
    for (const x of c) assert.notEqual(x.locksFireRate, true);
  });
});

describe('半自动炮轰系列：装备条件（只看武器本身的射击模式）', () => {
  it('只有 1 个 semi 模式 → 可装', () => {
    assert.equal(isSemiAutoOnlyWeapon([{ trigger: 'semi', role: 'normal' }]), true);
  });

  it('只有 1 个 auto 模式 → 不可装', () => {
    assert.equal(isSemiAutoOnlyWeapon([{ trigger: 'auto', role: 'normal' }]), false);
  });

  it('2 个模式（半自动 + 其它）→ 不可装', () => {
    assert.equal(
      isSemiAutoOnlyWeapon([
        { trigger: 'semi', role: 'normal' },
        { trigger: 'unknown', role: 'normal' },
      ]),
      false,
    );
  });

  it('灵化模式不参与判定：本体 semi + 灵化 → 可装', () => {
    assert.equal(
      isSemiAutoOnlyWeapon([
        { trigger: 'semi', role: 'normal' },
        { trigger: 'auto', role: 'incarnon' },
      ]),
      true,
    );
  });

  it('灵化不参与判定：本体 auto + 灵化 → 仍不可装', () => {
    assert.equal(
      isSemiAutoOnlyWeapon([
        { trigger: 'auto', role: 'normal' },
        { trigger: 'semi', role: 'incarnon' },
      ]),
      false,
    );
  });

  it('本体有多种模式 + 灵化 → 不可装（灵化剔掉后仍有 2 个）', () => {
    assert.equal(
      isSemiAutoOnlyWeapon([
        { trigger: 'charge', role: 'normal' },
        { trigger: 'charge', role: 'charged' },
        { trigger: 'charge', role: 'incarnon' },
      ]),
      false,
    );
  });

  it('没有模式信息 → 不可装（保守）', () => {
    assert.equal(isSemiAutoOnlyWeapon([]), false);
    assert.equal(isSemiAutoOnlyWeapon(undefined), false);
  });

  it('真实武器：Torid 只有 1 个射击模式（毒云并入爆炸变体），可装', async () => {
    const w = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/weapons/primary.json'), 'utf8'));
    const torid = w.weapons.find((x: { id: string }) => x.id === 'BioWeapon');
    assert.ok(torid, '找不到 Torid');
    // D-092：毒云（无 projectile 的 impact 段）不再算独立模式——它现在并进主模式的爆炸段里。
    // D-148：换源到 WFCD 后，托里德的**灵化形态**被识别成独立模式（role=incarnon），
    //        这是对的；`isSemiAutoOnlyWeapon` 本来就会剔掉灵化模式，所以仍然可装。
    const ownModes = torid.modes.filter((m: { role: string }) => m.role !== 'incarnon');
    assert.equal(ownModes.length, 1, '剔掉灵化后应只剩 1 个射击模式');
    assert.equal(ownModes[0].trigger, 'semi');
    // 主模式里应含一段 AoE（毒云），不另起模式
    const segs = ownModes[0].variants.flatMap((v: { segments: { aoe?: boolean }[] }) => v.segments);
    assert.ok(segs.some((s: { aoe?: boolean }) => s.aoe), '毒云/爆炸段应在主模式内');
    assert.equal(isSemiAutoOnlyWeapon(torid.modes), true);
  });
});

/** 最小武器 + 模式 + 段（buildWeaponState 的参数形态） */
const WEAPON = {
  id: 'TestGun',
  name: 'Test Gun',
  modes: [],
  // 面板值必须给全，否则 panelStats 返回 undefined → 射速变 NaN
  fireRate: 5,
  magazineSize: 10,
  reloadTime: 2,
  multishot: 1,
} as unknown as Parameters<typeof buildWeaponState>[0];

const SEG = { kind: 'attack', damage: { impact: 10 }, procChance: 0.2 } as unknown as Parameters<typeof buildWeaponState>[3]['segment'];

const MODE = {
  id: 'primary',
  role: 'normal',
  trigger: 'semi',
  bullets: 1,
  multishot: 1,
  variants: [{ id: 'direct', label: '直接命中', segments: [SEG] }],
} as unknown as Parameters<typeof buildWeaponState>[1];

function stateWith(contribs: Contribution[]) {
  return buildWeaponState(WEAPON, MODE, contribs, {
    beam: false,
    faction: 'none',
    coStacks: 0,
    coStatusTypes: 0,
    segment: SEG,
  });
}

describe('半自动炮轰系列：锁定射速', () => {
  /** 构造一个带射速加成的贡献 */
  const fr = (amount: number): Contribution => ({ stat: 'fireRate', form: 'pct', amount, source: 'test', label: `射速 ${amount}%` });
  const lock: Contribution = { stat: 'baseDamage', form: 'pct', amount: 240, source: 'semi_rifle_cannonade', locksFireRate: true };

  it('没有锁定时，射速加成正常生效', () => {
    const s = stateWith([fr(60)]);
    assert.ok(s.state.computed.当前射速 > 0);
  });

  it('有锁定时，正射速加成被忽略', () => {
    const plain = stateWith([]);
    const withLock = stateWith([fr(60), lock]);
    assert.equal(withLock.state.computed.当前射速, plain.state.computed.当前射速);
  });

  it('有锁定时，负射速加成同样被忽略（需求方明确要求）', () => {
    const plain = stateWith([]);
    const withLock = stateWith([fr(-50), lock]);
    assert.equal(withLock.state.computed.当前射速, plain.state.computed.当前射速);
  });
});
