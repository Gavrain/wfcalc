/**
 * 纯逻辑：`mergeWeaponOverride` 的合并规则（原 `verify-override-merge.mjs`，D-046）。
 *
 *   node packages/demo/src/checks/override-merge.mjs
 *
 * **不需要服务器、不需要 DOM**：D-103 把函数从 `app.js` 抽到了
 * `public/weapon-override.js`，这里直接 import 真实实现——
 * 以前是拿正则从 app.js 里抠函数体，app.js 一改结构测试就红。
 *
 * 造数据时按 **D-083 之后的形状**：段只在 `variants[].segments` 里，
 * 模式上不再有 `segments`。
 */
import { mergeWeaponOverride } from '../../public/weapon-override.js';
import { createChecks } from '../dom/report.mjs';

const rec = createChecks('override-merge');
const check = rec.check.bind(rec);
const clones = (o) => JSON.parse(JSON.stringify(o));

/** 造一把与 generated 同形的武器（D-080 / D-083 形状） */
function makeWeapon() {
  return {
    id: 'KuvaKarak',
    name: 'Kuva Karak',
    critChance: 0.23,
    critMultiplier: 2.1,
    statusChance: 0.31,
    fireRate: 11.6667,
    magazineSize: 70,
    reloadTime: 1.7,
    modes: [{
      id: 'primary',
      role: 'normal',
      trigger: 'auto',
      multishot: 1,
      variants: [{
        id: 'direct',
        label: '直接命中',
        segments: [{
          kind: 'impact',
          aoe: false,
          damage: { impact: 7.13, puncture: 6.21, slash: 9.66 },
          procChance: 0.31,
        }],
      }],
    }],
  };
}

/** 段按变体顺序摊平（与 app.js 的 modeSegments 同义） */
const segsOf = (m) => (m.variants ?? []).flatMap((v) => v.segments ?? []);

// ── 1. 标量覆盖 ──
{
  const w = makeWeapon();
  mergeWeaponOverride(w, { critChance: 0.24, reloadTime: 1.5 });
  check('暴击几率被覆盖', w.critChance === 0.24);
  check('装填时间被覆盖', w.reloadTime === 1.5);
  check('未提及的字段保持原值', w.fireRate === 11.6667 && w.magazineSize === 70);
}

// ── 1b. 白名单之外的字段一律不写 ──
{
  const w = makeWeapon();
  mergeWeaponOverride(w, { id: 'hacked', name: 'x', totalDamage: 999, critChance: 0.3 });
  check('id / name 不会被 override 改写', w.id === 'KuvaKarak' && w.name === 'Kuva Karak');
  check('非白名单字段（totalDamage）不写入', w.totalDamage === undefined);
  check('白名单字段照常写入', w.critChance === 0.3);
}

// ── 2. 模式按 id 匹配，不按数组下标 ──
{
  const w = makeWeapon();
  w.modes.push({
    id: 'mode2', role: 'alt', trigger: 'burst', multishot: 1,
    variants: [{ id: 'direct', label: '直接命中', segments: [{ kind: 'impact', aoe: false, damage: { impact: 10 }, procChance: 0.2 }] }],
  });
  mergeWeaponOverride(w, {
    modes: [{ id: 'mode2', trigger: 'charged', role: 'alt', procChance: 0.2 }],
  });
  check('按 id 匹配到 mode2', w.modes[1].trigger === 'charged');
  check('没有误改 primary', w.modes[0].trigger === 'auto');
}

// ── 3. 不存在的模式被忽略，不凭空创建 ──
{
  const w = makeWeapon();
  mergeWeaponOverride(w, { modes: [{ id: 'nope', trigger: 'burst' }] });
  check('不凭空创建模式', w.modes.length === 1);
  check('没有残留 nope', !JSON.stringify(w).includes('nope'));
}

// ── 4. 模式级面板 override（D-050）──
{
  const w = makeWeapon();
  mergeWeaponOverride(w, {
    modes: [{ id: 'primary', override: { critChance: 0.45, critMultiplier: 3.5, bogus: 1 } }],
  });
  const ov = w.modes[0].override;
  check('override 写进模式', Boolean(ov) && ov.critChance === 0.45 && ov.critMultiplier === 3.5);
  check('override 里的非法键被丢弃', ov && ov.bogus === undefined);

  const w2 = makeWeapon();
  mergeWeaponOverride(w2, { modes: [{ id: 'primary', override: { critChance: -1 } }] });
  check('负数 override 原样写入（校验在 server 侧）', w2.modes[0].override && w2.modes[0].override.critChance === -1);

  const w3 = makeWeapon();
  mergeWeaponOverride(w3, { modes: [{ id: 'primary', override: { bogus: 1 } }] });
  check('全是非法键时 override 被清掉', w3.modes[0].override === undefined);
}

// ── 5. damage 整体替换（支持删除类型）──
{
  const w = makeWeapon();
  mergeWeaponOverride(w, {
    modes: [{
      id: 'primary',
      segments: [{ kind: 'impact', aoe: false, damage: { impact: 7.13, heat: 3.5 }, procChance: 0.31 }],
    }],
  });
  const d = segsOf(w.modes[0])[0].damage;
  check('新增 heat 生效', d.heat === 3.5);
  check('删除的 puncture/slash 不会复活', d.puncture === undefined && d.slash === undefined);
  check('删除是整体替换而非逐键合并', Object.keys(d).sort().join(',') === 'heat,impact');
}

// ── 6. 模式下发 procChance 会同步到该模式的全部段（D-048）──
{
  const w = makeWeapon();
  mergeWeaponOverride(w, { modes: [{ id: 'primary', procChance: 0.55 }] });
  check('段 procChance 被同步为 0.55', segsOf(w.modes[0]).every((s) => s.procChance === 0.55));
}

// ── 7. 重复合并不叠加（关键回归）──
{
  const base = makeWeapon();
  const ov = { fireRate: 12, critChance: 0.3 };
  const first = mergeWeaponOverride(clones(base), ov);
  const second = mergeWeaponOverride(clones(base), ov);
  const third = mergeWeaponOverride(clones(base), ov);
  check('重复合并结果稳定（不叠加）',
    first.fireRate === second.fireRate && second.fireRate === third.fireRate && first.fireRate === 12);
  check('base 本身没被污染', base.fireRate === 11.6667);
}

// ── 8. 无 override 时原样返回 ──
{
  const w = makeWeapon();
  const before = JSON.stringify(w);
  mergeWeaponOverride(w, undefined);
  check('无 override 时不变', JSON.stringify(w) === before);
}

// ── 9. 非法数值不写入 ──
{
  const w = makeWeapon();
  mergeWeaponOverride(w, { critChance: NaN, fireRate: 'abc', magazineSize: Infinity });
  check('NaN 不写入', w.critChance === 0.23);
  check('非数字不写入', w.fireRate === 11.6667);
  check('Infinity 不写入', w.magazineSize === 70);
}

rec.finish();
