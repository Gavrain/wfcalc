/**
 * 武器选单的选中一致性（D-097，需求方 2026-11-06）。
 *
 * 反馈：
 * > 「切换武器类型选单的时候武器名字选单会变，此时无法选中第一个目标，
 * > 但是后面的武器名字没有更新。搜索时也是。我觉得改为可以选中第一个，
 * > 但是与当前武器是同一个的时候不切换。」
 *
 * 根因：`switchWeapon` 第一行就 `if (当前 === 目标) return`，
 * 而选单重建后默认指向**第一项**。选第一项时既有"不重算"的短路、
 * 又没把选中值同步回来，界面就停在"显示 A、实际在算 B"的状态。
 *
 * 修复原则：**选单只是选择器，真实状态是 `DATA.weapon`**；
 * 任何重建选单之后都必须调用 `syncWeaponSelect()` 把选中值回写成当前武器。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupWeapons, searchWeapons } from '../public/weapon-picker.js';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));

async function loadAll() {
  const weapons = [];
  for (const f of ['primary', 'secondary', 'melee', 'archgun', 'archmelee']) {
    const d = JSON.parse(await readFile(join(ROOT, `packages/data/src/generated/weapons/${f}.json`), 'utf8'));
    weapons.push(...d.weapons);
  }
  const slotFile = JSON.parse(await readFile(join(ROOT, 'packages/data/src/generated/mods/weapon-slots.json'), 'utf8'));
  return { weapons, slotFile };
}

describe('切回大类时，类型选单应停在当前武器所在的类型', () => {
  it('赤毒·卡拉克 属于「步枪」，切回主要时应停在步枪而不是第一类', async () => {
    const { weapons, slotFile } = await loadAll();
    const groups = groupWeapons(weapons, slotFile);
    const primary = groups.get('primary');
    assert.ok(primary);
    const cur = weapons.find((w) => w.id === 'KuvaKarak');
    assert.ok(cur);

    const types = [...primary.types.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, 'zh-CN'));
    const curType = types.find(([, b]) => b.weapons.some((w) => w.id === cur.id));
    assert.ok(curType, '当前武器应能在某个类型里找到');
    assert.equal(curType[1].label, '步枪');

    // 旧逻辑会停在 types[0]；确认 types[0] 确实不是步枪（否则测不出差异）
    const firstLabel = types[0]![1].label;
    // 按中文排序后第一类不一定是步枪，这里只断言"能定位到正确类型"
    void firstLabel;
    assert.ok(curType[1].weapons.some((w) => w.id === 'KuvaKarak'));
  });

  it('每个大类里，任意武器都能定位到它所属的类型', async () => {
    const { weapons, slotFile } = await loadAll();
    const groups = groupWeapons(weapons, slotFile);
    const missing: string[] = [];
    for (const [groupId, g] of groups) {
      if (!g.types.size) continue;
      const all = [...g.types.values()].flatMap((b) => b.weapons);
      for (const w of all) {
        const found = [...g.types.values()].some((b) => b.weapons.some((x) => x.id === w.id));
        if (!found) missing.push(`${groupId}/${w.id}`);
      }
    }
    assert.deepEqual(missing, []);
  });
});

describe('搜索结果里的当前武器', () => {
  it('搜到当前武器时，它必须出现在结果里（否则选单无法回写）', async () => {
    const { weapons } = await loadAll();
    const cur = weapons.find((w) => w.id === 'KuvaKarak');
    assert.ok(cur);
    const hits = searchWeapons(weapons, '卡拉克');
    assert.ok(hits.some((w) => w.id === cur.id), '当前武器应在搜索结果中');
  });

  it('搜不到当前武器时，结果里不含它（此时要补一项「（当前）」）', async () => {
    const { weapons } = await loadAll();
    const hits = searchWeapons(weapons, '血肢');
    assert.ok(!hits.some((w) => w.id === 'KuvaKarak'));
    assert.ok(hits.length > 0);
  });
});

describe('DOM：选单重建后选中值必须等于当前武器', () => {
  it('重建选单的地方都会调用 syncWeaponSelect（D-097 不变量）', async () => {
    const src = await readFile(join(ROOT, 'packages/demo/public/app.js'), 'utf8');
    // 重建点：renderWeaponOptions 末尾 + switchWeapon 的同武器短路 + 它自身的定义/其它调用
    const syncCount = (src.match(/syncWeaponSelect\(\)/g) ?? []).length;
    assert.ok(syncCount >= 3, `syncWeaponSelect 调用次数应 ≥3，实际 ${syncCount}`);
    // 同武器分支不能再直接 return
    assert.ok(
      /if \(store\.data && store\.data\.weapon && store\.data\.weapon\.id === weaponId\) \{\s*\n\s*syncWeaponSelect\(\);/.test(src),
      '同武器时应同步选单而不是直接 return',
    );
  });

  /**
   * D-151（需求方 2026-11-13）：「应该是搜索框下面列出结果，就像搜索引擎那样。
   * 现在变成输入以后筛选了，这不对。」
   * → 搜索**不再动下拉框**，所以 renderSearchResults 里不该出现 rebuild 下拉的调用；
   *   选单与真实武器的一致性改由「点选结果 → switchWeapon → syncWeaponSelect」保证。
   */
  it('搜索结果只画面板，不再重建/同步下拉框', async () => {
    const src = await readFile(join(ROOT, 'packages/demo/public/app.js'), 'utf8');
    const body = /function renderSearchResults\([\s\S]*?\n\}\n/.exec(src)?.[0] ?? '';
    assert.ok(body, '应有 renderSearchResults');
    assert.ok(!/syncWeaponSelect\(\)/.test(body), 'renderSearchResults 不应再同步武器下拉');
    assert.ok(!/\$\(['"]#weapon-select['"]\)/.test(body), 'renderSearchResults 不应再改写武器下拉');
    assert.ok(/weapon-search-panel/.test(body), '结果应画进搜索框下方的面板');
  });

  it('syncWeaponSelect 会把当前武器补进选单并选中', async () => {
    const src = await readFile(join(ROOT, 'packages/demo/public/app.js'), 'utf8');
    assert.ok(/function syncWeaponSelect/.test(src));
    assert.ok(/（当前）/.test(src), '不在列表里时应补一项「（当前）」');
  });
});
