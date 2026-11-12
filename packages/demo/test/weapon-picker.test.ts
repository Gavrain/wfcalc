/**
 * 武器切换（D-093）的纯逻辑测试。
 *
 * 需求方 2026-11-06：
 * > 「开放武器切换功能，目前暂定可以切换所有主武器。可以使用名称搜索，或者下拉栏选择，
 * > 为下拉栏加入主要次要近战空战的筛选，类别内再按类型分类。」
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEAPON_GROUPS, classifyWeapon, groupWeapons, searchWeapons, FIRE_STYLE_OPTIONS, filterByStyle, weaponMatchesStyle } from '../public/weapon-picker.js';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));

async function loadAll() {
  const files = ['primary', 'secondary', 'melee', 'archgun', 'archmelee'];
  const weapons = [];
  for (const f of files) {
    const d = JSON.parse(await readFile(join(ROOT, `packages/data/src/generated/weapons/${f}.json`), 'utf8'));
    weapons.push(...d.weapons);
  }
  const slotFile = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/mods/weapon-slots.json'), 'utf8'));
  return { weapons, slotFile };
}

describe('武器大类（主要 / 次要 / 近战 / 空战）', () => {
  it('四个大类齐全，且全部可选（D-119）', () => {
    assert.deepEqual(WEAPON_GROUPS.map((g) => g.id), ['primary', 'secondary', 'melee', 'archwing']);
    assert.deepEqual(WEAPON_GROUPS.filter((g) => g.enabled).map((g) => g.id), ['primary', 'secondary', 'melee', 'archwing']);
  });
});

describe('武器分组（大类 → 类型）', () => {
  it('主要武器分成 步枪 / 霰弹枪 / 狙击枪 / 弓 / 发射器 / 弩', async () => {
    const { weapons, slotFile } = await loadAll();
    const groups = groupWeapons(weapons, slotFile);
    const primary = groups.get('primary');
    assert.ok(primary);
    const labels = [...primary.types.values()].map((b) => b.label).sort();
    for (const want of ['步枪', '霰弹枪', '狙击枪', '弓弩', '发射器']) {
      assert.ok(labels.includes(want), `缺少类型：${want}，实际 ${labels.join('/')}`);
    }
    // D-141：新增两把重力奇点（本体 + 枢议·），主武器由 192 → 194
    // D-148：换源到 WFCD 后为 196（新增 Nunchasa / Steflos Prime 等正式武器）
    const total = [...primary.types.values()].reduce((s, b) => s + b.weapons.length, 0);
    assert.equal(total, 196);
  });

  it('发射器来自数据层 subclass（D-098）', async () => {
    const { weapons, slotFile } = await loadAll();
    const groups = groupWeapons(weapons, slotFile);
    const primary = groups.get('primary');
    assert.ok(primary);
    const launcher = primary.types.get('launcher');
    assert.ok(launcher, '应有发射器类型');
    // 已核对过的发射器（官方导出没有 launcher 类型名，由 weapon-slots.json 的 subclass 标出）
    // 需求方 2026-07-11 明确：托里德也算发射器。
    for (const name of ['食人女魔', '潘塔', '征服榴炮', '信条·典客', '托里德', '沙皇', '赤毒·布拉玛']) {
      assert.ok(
        launcher.weapons.some((w) => String(w.nameZh || w.name) === name),
        `${name} 应在发射器里`,
      );
    }
    // D-099 C：弩并入弓弩，弩不再是独立类型
    const bow = primary.types.get('bow');
    assert.ok(bow, '应有弓弩类型');
    assert.equal(primary.types.get('crossbow'), undefined, '弩不应再是独立类型');
    // 弩要留在弓弩桶里（需求方 2026-07-11：弩不能装弓箭类 Mod / 弓箭·赋能，但仍是主手弓弩）
    for (const name of ['诸葛连弩', '阿提卡', '噬蛇弩']) {
      assert.ok(
        bow.weapons.some((w) => String(w.nameZh || w.name) === name),
        `${name} 应在弓弩里`,
      );
    }
    // 真正的弓不能被误判成弩
    const slotWeapons = slotFile.weapons as Record<string, { subclass?: string; trueBow?: boolean }>;
    const crossbows = Object.entries(slotWeapons).filter(([, e]) => e.subclass === 'crossbow');
    for (const [id] of crossbows) {
      assert.ok(!slotWeapons[id]?.trueBow, `${id} 既是弩又是弓，判定冲突`);
    }
  });

  it('发射器不再出现在步枪里', async () => {
    const { weapons, slotFile } = await loadAll();
    const groups = groupWeapons(weapons, slotFile);
    const primary = groups.get('primary');
    assert.ok(primary);
    const rifle = primary.types.get('rifle');
    assert.ok(rifle);
    // 已被标成 subclass=launcher 的武器一个都不能留在步枪桶里
    for (const id of ['GrenadeLauncher', 'RocketLauncher', 'GrnCannonWeapon']) {
      assert.ok(!rifle.weapons.some((w) => w.id === id), `${id} 不该在步枪里`);
    }
  });

  it('近战按细分类型（剑 / 锤 / 匕首 …）', async () => {
    const { weapons, slotFile } = await loadAll();
    const groups = groupWeapons(weapons, slotFile);
    const melee = groups.get('melee');
    assert.ok(melee);
    assert.ok(melee.types.size > 10, `近战类型数应 >10，实际 ${melee.types.size}`);
    const labels = [...melee.types.values()].map((b) => b.label);
    assert.ok(labels.includes('剑'));
    assert.ok(labels.includes('匕首'));
  });

  it('空战把 archgun / archmelee 合到一组', async () => {
    const { weapons, slotFile } = await loadAll();
    const groups = groupWeapons(weapons, slotFile);
    const arch = groups.get('archwing');
    assert.ok(arch);
    // D-141：分离 / 分离 Prime 按需求方要求收进近战（它们本就是守护近战武器），空战组 30 → 32
    // +1 是武器库天然变化（空战锤等 Arch 武器重新进入），见 git 历史
    // D-148：换源到 WFCD 后为 28 —— WFCD 把 Deconstructor / Deconstructor Prime /
    //        Akaten / Batoten / Lacerten 这 5 把归到「同伴武器」而不是「空战近战」，
    //        它们本来就是守护 / 猎犬的近战武器，WFCD 的分类更准；武器总数没丢
    const total = [...arch.types.values()].reduce((s, b) => s + b.weapons.length, 0);
    assert.equal(total, 28);
  });

  it('组内武器按中文名排序', async () => {
    const { weapons, slotFile } = await loadAll();
    const groups = groupWeapons(weapons, slotFile);
    const primary = groups.get('primary');
    assert.ok(primary);
    const rifle = primary.types.get('rifle');
    assert.ok(rifle);
    const names = rifle.weapons.map((w) => String(w.nameZh || w.name));
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    assert.deepEqual(names, sorted);
  });
});

describe('武器名称搜索', () => {
  it('中文名能搜到', async () => {
    const { weapons } = await loadAll();
    const hits = searchWeapons(weapons, '托里德');
    assert.ok(hits.length >= 1);
    assert.ok(hits.some((w) => String(w.nameZh || w.name).includes('托里德')));
  });

  it('英文名也能搜（大小写不敏感）', async () => {
    const { weapons } = await loadAll();
    const a = searchWeapons(weapons, 'torid');
    const b = searchWeapons(weapons, 'TORID');
    assert.deepEqual(a.map((w) => w.id), b.map((w) => w.id));
    assert.ok(a.length >= 1);
  });

  it('空关键字返回空数组（不返回全部）', async () => {
    const { weapons } = await loadAll();
    assert.deepEqual(searchWeapons(weapons, ''), []);
    assert.deepEqual(searchWeapons(weapons, '   '), []);
  });

  it('搜不到时返回空数组', async () => {
    const { weapons } = await loadAll();
    assert.deepEqual(searchWeapons(weapons, 'zzzzzz不存在zzzzzz'), []);
  });
});

describe('分类函数', () => {
  it('slotEntry 缺失时不崩，归到 unknown', () => {
    const c = classifyWeapon(undefined);
    assert.equal(c.broad, 'unknown');
  });

  it('近战带 specific 时用 specific 作为类型', () => {
    const c = classifyWeapon({ slots: { broad: 'melee', specific: ['sword'] } });
    assert.equal(c.typeKey, 'sword');
    assert.equal(c.typeLabel, '剑');
  });
});

describe('弹道筛选（D-099 A）', () => {
  it('选项齐全', () => {
    assert.deepEqual(
      FIRE_STYLE_OPTIONS.map((o) => o.id),
      ['all', 'auto', 'semi', 'burst', 'charge', 'held'],
    );
  });

  it('全部弹道 = 不过滤', async () => {
    const { weapons, slotFile } = await loadAll();
    const rifle = groupWeapons(weapons, slotFile).get('primary')?.types.get('rifle');
    assert.ok(rifle);
    assert.equal(filterByStyle(rifle.weapons, 'all').length, rifle.weapons.length);
  });

  it('步枪按弹道筛出半自动（应包含半自动炮轰能装的枪）', async () => {
    const { weapons, slotFile } = await loadAll();
    const rifle = groupWeapons(weapons, slotFile).get('primary')?.types.get('rifle');
    assert.ok(rifle);
    const semi = filterByStyle(rifle.weapons, 'semi');
    assert.ok(semi.length > 0 && semi.length < rifle.weapons.length);
    for (const w of semi) {
      assert.ok((w.modes ?? []).some((m) => m.trigger === 'semi'), `${w.id} 不该在半自动里`);
    }
  });

  it('只看主模式：次要模式是半自动，不算进半自动组', () => {
    const w = { modes: [{ trigger: 'auto' }, { trigger: 'semi' }] } as never;
    assert.equal(weaponMatchesStyle(w, 'auto'), true);
    assert.equal(weaponMatchesStyle(w, 'semi'), false);
    assert.equal(weaponMatchesStyle(w, 'charge'), false);
  });

  it('active 不算射线（潘塔 / 奇点枪归发射器）', () => {
    const a = { modes: [{ trigger: 'held' }] } as never;
    const b = { modes: [{ trigger: 'active' }] } as never;
    assert.equal(weaponMatchesStyle(a, 'held'), true);
    assert.equal(weaponMatchesStyle(b, 'held'), false);
  });
});
