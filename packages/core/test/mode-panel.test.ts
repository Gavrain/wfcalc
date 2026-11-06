/**
 * D-050：面板数值下沉到模式级。
 *
 * 取值顺序：模式 override → 武器级回退。
 * 关键保证：**没写 override 的武器行为完全不变**。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';
import { modeWithSegments } from './_helpers.ts';

const { compute } = core as any;

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

/** 三模式武器：模拟「狂鲨」这类每个模式暴击都不同的情况 */
function makeWeapon(): core.Weapon {
  return {
    id: 'TestTriple',
    name: 'Test Triple',
    category: 'primary',
    critChance: 0.2,
    critMultiplier: 2,
    statusChance: 0.3,
    fireRate: 10,
    magazineSize: 30,
    reloadTime: 2,
    modes: [
      modeWithSegments(
        { id: 'primary', role: 'normal', trigger: 'auto', bullets: 1, multishot: 1 },
        [{ kind: 'impact', aoe: false, procChance: 0.3, damage: { impact: 100 } }],
      ),
      modeWithSegments(
        {
          id: 'mode2', role: 'normal', trigger: 'semi', bullets: 1, multishot: 1,
          // 模式级覆盖部分字段
          override: { critChance: 0.5, critMultiplier: 3, fireRate: 4 },
        },
        [{ kind: 'impact', aoe: false, procChance: 0.3, damage: { impact: 100 } }],
      ),
      modeWithSegments(
        {
          id: 'incarnon', role: 'incarnon', trigger: 'auto', bullets: 1, multishot: 1,
          override: { critChance: 0.35, magazineSize: 12, reloadTime: 1 },
        },
        [{ kind: 'impact', aoe: false, procChance: 0.3, damage: { impact: 100 } }],
      ),
    ] satisfies core.AttackMode[],
  };
}

describe('面板数值下沉到模式级（D-050）', () => {
  it('没写 override 的模式完全用武器级（行为不变）', () => {
    const w = makeWeapon();
    const res = compute(w, w.modes[0], [], {}, false);
    const seg: any = res.segments[0];
    near(seg.critChance, 0.2);
    near(seg.critDamage, 2);
    near(res.output.fireRate, 10);
  });

  it('模式级覆盖的暴击/暴伤生效', () => {
    const w = makeWeapon();
    const res = compute(w, w.modes[1], [], {}, false);
    const seg: any = res.segments[0];
    near(seg.critChance, 0.5);
    near(seg.critDamage, 3);
  });

  it('模式级覆盖的射速生效', () => {
    const w = makeWeapon();
    const res = compute(w, w.modes[1], [], {}, false);
    near(res.output.fireRate, 4);
  });

  it('只覆盖部分字段时，其余仍回退武器级', () => {
    const w = makeWeapon();
    const res = compute(w, w.modes[2], [], {}, false);
    const seg: any = res.segments[0];
    near(seg.critChance, 0.35); // 覆盖了
    near(seg.critDamage, 2); // 没覆盖 → 回退
    near(res.output.fireRate, 10); // 没覆盖 → 回退
  });

  it('模式级弹匣/装填生效，影响持续伤害', () => {
    const w = makeWeapon();
    const a = compute(w, w.modes[0], [], {}, false);
    const b = compute(w, w.modes[2], [], {}, false);
    // incarnon 弹匣 12、装填 1 秒；primary 弹匣 30、装填 2 秒
    assert.notEqual(a.output.lines.find((l: any) => l.id === 'sustainedDps').value,
      b.output.lines.find((l: any) => l.id === 'sustainedDps').value);
  });

  it('三个模式可以算出三套不同的暴击', () => {
    const w = makeWeapon();
    const ccs = w.modes.map((m: any) => compute(w, m, [], {}, false).segments[0].critChance);
    assert.equal(new Set(ccs).size, 3, `三个模式暴率应各不相同，实际 ${JSON.stringify(ccs)}`);
  });

  it('Mod 加成仍叠加在模式面板之上（不是替代）', () => {
    const w = makeWeapon();
    const withMod = compute(w, w.modes[1], [
      { stat: 'critChance', form: 'pct', amount: 100, source: 'point_strike' },
    ], {}, false);
    // 面板 0.5 × (1+100%) = 1.0
    near(withMod.segments[0].critChance, 1.0);
  });

  it('panelStats 是唯一取值入口：override 优先于武器级', () => {
    const w = makeWeapon();
    const ps = core.panelStats(w, w.modes[1]!);
    near(ps.critChance, 0.5);
    near(ps.critMultiplier, 3);
    near(ps.fireRate, 4);
    near(ps.magazineSize, 30); // 未覆盖 → 回退
    near(ps.reloadTime, 2); // 未覆盖 → 回退
  });
});
