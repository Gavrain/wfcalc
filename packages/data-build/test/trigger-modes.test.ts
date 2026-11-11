/**
 * 「一个射击模式 = 一种扳机」（D-150）的回归测试。
 *
 * 需求方 2026-11-12：
 * > 「雌鹿射击模式不对，他是三个模式，有两个当成一个段了。检查下其他武器有没有这个问题，
 * >  一个射击模式一般只会有一个投射物命中，只有赘骨的灵化是个例外。」
 *
 * 锁住的行为：
 *   1. 名字是扳机词（`Burst Mode` / `Semi-Auto Mode` / `Auto` / `Alt-Fire` …）的攻击
 *      **各成一个射击模式**，不再并成同一模式里的「攻击方式」；
 *   2. 「同一次开火的段」仍留在同一模式：霰弹的弹丸 + 爆裂、钩铳的命中附带、
 *      磁道炮的 `Attraction Field`；
 *   3. 灵化只有一个模式（赘骨的射线 + 蓄力仍是一个灵化模式下的两种攻击方式）。
 *
 * 用最小构造数据，不依赖网络。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanWfcdWeapons, type WfcdWeapon, type WfcdAttack } from '../src/wfcd-clean.ts';

function weapon(over: Partial<WfcdWeapon> & { name: string; attacks: WfcdAttack[] }): WfcdWeapon {
  return {
    uniqueName: `/Lotus/Weapons/Test/${over.name.replace(/\s+/g, '')}`,
    productCategory: 'LongGuns',
    criticalChance: 0.2,
    criticalMultiplier: 2,
    procChance: 0.2,
    fireRate: 5,
    multishot: 1,
    ...over,
  } as WfcdWeapon;
}

/** 清洗一把最小的武器，返回它的模式 */
function modesOf(w: WfcdWeapon) {
  return cleanWfcdWeapons([w]).weapons[0]!.modes;
}

const hit = (name: string, impact: number, extra: Record<string, number> = {}): WfcdAttack => ({
  name,
  shot_type: 'Hit-Scan',
  damage: { impact, ...extra },
});

test('雌鹿：Burst Mode / Semi-Auto Mode 是「两个」射击模式，不是同一模式的两段', () => {
  const modes = modesOf(
    weapon({
      name: 'Hind',
      trigger: 'Burst',
      attacks: [hit('Burst Mode', 30), hit('Semi-Auto Mode', 60)],
    }),
  );
  assert.equal(modes.length, 2, `应为 2 个模式，实际 ${modes.length} 个：${modes.map((m) => m.id).join('/')}`);
  // 每个模式里只有一个投射物命中段
  for (const m of modes) {
    const segs = m.variants.flatMap((v) => v.segments);
    assert.equal(segs.length, 1, `模式 ${m.id} 只应有一个投射物命中段`);
  }
});

test('赤毒·雌鹿 / 狂鲨 Prime：Burst / Semi-Auto / Auto 是三个射击模式', () => {
  for (const name of ['Kuva Hind', 'Tiberon Prime']) {
    const modes = modesOf(
      weapon({
        name,
        trigger: 'Burst',
        attacks: [hit('Burst', 30), hit('Semi-Auto', 90), hit('Auto', 30)],
      }),
    );
    assert.equal(modes.length, 3, `${name} 应为 3 个模式，实际 ${modes.length} 个`);
    for (const m of modes) {
      assert.equal(m.variants.flatMap((v) => v.segments).length, 1, `${name} 的模式 ${m.id} 不应把两种扳机并进一段`);
    }
  }
});

test('信标 / 炮台独立成模式，模式名就是它们自己（D-150，需求方 2026-11-12）', () => {
  const buz = modesOf(
    weapon({
      name: 'Buzlok',
      trigger: 'Auto',
      attacks: [
        { name: 'Normal Attack', shot_type: 'Projectile', damage: { impact: 30, puncture: 24, slash: 6 } },
        { name: 'Beacon', shot_type: 'Projectile', damage: { puncture: 3 } },
      ],
    }),
  );
  assert.equal(buz.length, 2, `巴兹火枪应为 2 个模式，实际 ${buz.length} 个`);
  assert.equal(buz[1]!.variants.length, 1, '信标自成一个模式，一个攻击方式');
  assert.equal(buz[1]!.variants[0]!.label, '直接命中');
  assert.equal(buz[1]!.variants[0]!.segments[0]!.damage.puncture, 3);

  const az = modesOf(
    weapon({
      name: 'Azima',
      trigger: 'Auto',
      attacks: [
        { name: 'Normal Attack', shot_type: 'Hit-Scan', damage: { impact: 2, puncture: 5, slash: 13 } },
        { name: 'Turret Expiry', damage: { blast: 75 } },
      ],
    }),
  );
  assert.equal(az.length, 2, `方位角应为 2 个模式，实际 ${az.length} 个`);
  assert.equal(az[1]!.variants[0]!.segments[0]!.damage.blast, 75);
});

test('附肢寄生者：感染鱼叉单开一个射击模式，`Contact` 子段不重复成两行毒素', () => {
  // WFCD 原文把同一次鱼叉命中拆成两条：Infested Harpoon + Infested Harpoon Contact（各 15 毒素）。
  // 需求方 2026-11-12 晚：「鱼叉也单开成一个射击模式（像信标、炮台那样）」
  // 且「附肢寄生者那个是**感染鱼叉**不是毒云」。
  const modes = modesOf(
    weapon({
      name: 'Paracyst',
      trigger: 'Burst',
      attacks: [
        { name: 'Normal Attack', shot_type: 'Projectile', damage: { toxin: 33 }, status_chance: 30 },
        { name: 'Infested Harpoon', shot_type: 'Projectile', damage: { toxin: 15 }, status_chance: 30 },
        { name: 'Infested Harpoon Contact', damage: { toxin: 15 }, status_chance: 30 },
      ],
    }),
  );
  assert.equal(modes.length, 2, `应为 2 个模式（主射击 + 感染鱼叉），实际 ${modes.length} 个`);
  // 需求方 2026-11-12：模式名是「感染鱼叉」（模式里只有一种攻击方式，所以那个变体叫「直接命中」）
  const harpoon = modes[1]!;
  const segs = harpoon.variants.flatMap((v) => v.segments);
  assert.equal(segs.length, 1, `感染鱼叉只应有 1 段毒素，实际 ${segs.length} 段`);
  assert.equal(segs[0]!.damage.toxin, 15);
  assert.equal(harpoon.variants.length, 1, '鱼叉模式里只有一个攻击方式');
  // 模式名（`_label`）就是它自己的名字
  assert.equal((harpoon as { _label?: string })._label, '感染鱼叉');
});

test('弹道武器的副模式名 = 触发它的那条攻击名（模式名不是攻击方式名）', () => {
  // 需求方 2026-11-12：「信标、炮台独立成模式」——模式要叫「信标」/「炮台」
  const buz = modesOf(
    weapon({
      name: 'Buzlok',
      trigger: 'Auto',
      attacks: [
        { name: 'Normal Attack', shot_type: 'Projectile', damage: { impact: 30 } },
        { name: 'Beacon', shot_type: 'Projectile', damage: { puncture: 3 } },
      ],
    }),
  );
  assert.equal(buz[1]!.variants[0]!.label, '直接命中');
  const az = modesOf(
    weapon({
      name: 'Azima',
      trigger: 'Auto',
      attacks: [
        { name: 'Normal Attack', shot_type: 'Hit-Scan', damage: { impact: 2 } },
        { name: 'Turret Expiry', damage: { blast: 75 } },
      ],
    }),
  );
  assert.equal(az.length, 2);
});

test('同一次开火的段留在同一模式：霰弹弹丸 + 爆裂', () => {
  const modes = modesOf(
    weapon({
      name: 'Astilla',
      trigger: 'Auto',
      attacks: [
        { name: 'Slug Impact', shot_type: 'Projectile', damage: { impact: 100 } },
        { name: 'Glass Explosion', shot_type: 'AoE', damage: { puncture: 49, slash: 91 } },
      ],
    }),
  );
  assert.equal(modes.length, 1, '霰弹的爆裂与弹丸同属一个射击模式');
  const ids = modes[0]!.variants.map((v) => v.id);
  assert.deepEqual(ids, ['direct', 'blast'], '一个模式内两个攻击方式：直接命中 + 范围伤害');
});

test('同一次开火的段留在同一模式：钩铳的命中附带 + 范围', () => {
  const modes = modesOf(
    weapon({
      name: 'Arquebex',
      trigger: 'Auto',
      attacks: [
        { name: 'Normal Attack', shot_type: 'Hit-Scan', damage: { impact: 24, puncture: 168, slash: 48 } },
        { name: 'Normal Attack', shot_type: 'Projectile', damage: { impact: 100 } },
        { name: 'Radial Attack', shot_type: 'AoE', damage: { blast: 9000, heat: 3000 } },
      ],
    }),
  );
  // 需求方：「一个射击模式一般只会有一个投射物命中，只有赘骨的灵化是个例外」
  // 钩铳的 10 点是命中附带，不是第二个射击模式
  const aoeModes = modes.filter((m) => m.variants.some((v) => v.segments.some((s) => s.aoe)));
  assert.equal(aoeModes.length, 1, '范围伤害只属于一个模式');
});

test('同一次开火的附属段留在同一模式：磁道炮的吸引场', () => {
  const modes = modesOf(
    weapon({
      name: 'Ferrox',
      trigger: 'Charge',
      attacks: [
        { name: 'Charged Shot', shot_type: 'Hit-Scan', damage: { impact: 300 } },
        { name: 'Radial Attack', shot_type: 'AoE', damage: { blast: 100 } },
        { name: 'Spear Throw', shot_type: 'Projectile', damage: { impact: 200 } },
        { name: 'Attraction Field', shot_type: 'AoE', damage: { magnetic: 20 } },
      ],
    }),
  );
  // Charged Shot（锚点）+ Radial Attack 一个模式；Spear Throw（独立模式）+ Attraction Field 一个模式
  assert.equal(modes.length, 2, `应为 2 个模式，实际 ${modes.length} 个`);
});

test('开镜以后是另一个射击模式（D-150 第四轮，猛毒）', () => {
  // 需求方 2026-11-12：「换，开镜以后不是一个模式了」
  // WFCD：`Normal Attack`（冲击 96.9）+ `3.5x Zoom Radial Attack`（病毒 53，缺 shot_type）
  const modes = modesOf(
    weapon({
      name: 'Komorex',
      trigger: 'Semi',
      attacks: [
        { name: 'Normal Attack', shot_type: 'Projectile', damage: { impact: 9.7, puncture: 40.74, slash: 46.56 }, status_chance: 35 },
        { name: '3.5x Zoom Radial Attack', damage: { viral: 53 }, status_chance: 34 },
      ],
    }),
  );
  assert.equal(modes.length, 2, `猛毒应为 2 个模式（普通 / 开镜），实际 ${modes.length} 个`);
  assert.equal((modes[1] as { _label?: string })._label, '开镜');
  assert.deepEqual(modes[1]!.variants[0]!.segments[0]!.damage, { viral: 53 });
});

test('灵化仍然只有一个模式：赘骨的射线 + 蓄力是两种攻击方式', () => {
  const modes = modesOf(
    weapon({
      name: 'Onos',
      trigger: 'Auto',
      attacks: [
        { name: 'Normal Attack', shot_type: 'Projectile', damage: { puncture: 220 } },
        { name: 'Incarnon Form Held Damage', shot_type: 'Projectile', damage: { radiation: 30 } },
        { name: 'Incarnon Form Charge Attack', shot_type: 'Hit-Scan', damage: { heat: 2200 } },
        { name: 'Incarnon Form Charge Radial Attack', shot_type: 'AoE', damage: { heat: 1100 } },
      ],
    }),
  );
  const incarnon = modes.filter((m) => m.role === 'incarnon');
  assert.equal(incarnon.length, 1, '灵化永远只有一个模式');
  const labels = incarnon[0]!.variants.map((v) => v.label);
  assert.ok(labels.includes('射线'), `灵化下应有「射线」：${labels.join('/')}`);
  assert.ok(labels.includes('蓄力'), `灵化下应有「蓄力」：${labels.join('/')}`);
});
