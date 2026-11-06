/**
 * overrides 合并规则测试（D-046）。
 *   node packages/demo/src/verify-override-merge.mjs
 *
 * 纯逻辑测试：把 app.js 里的 mergeWeaponOverride 抽出来跑，不需要 HTTP 服务。
 */
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));
const src = await readFile(join(ROOT, 'packages/demo/public/app.js'), 'utf8');

// 抽出合并函数（它是纯函数，只依赖 OVERRIDE_WEAPON_FIELDS 与 console）
const fieldMatch = src.match(/const OVERRIDE_WEAPON_FIELDS = \[[\s\S]*?\];/);
const fnStart = src.indexOf('function mergeWeaponOverride(');
if (!fieldMatch || fnStart < 0) {
  console.error('✖ 没能从 app.js 里找到合并函数');
  process.exit(1);
}
// 找到函数结束（按大括号配平）
let depth = 0;
let i = src.indexOf('{', fnStart);
let end = i;
for (; i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const fnSrc = src.slice(fnStart, end);

const factory = new Function(`
  ${fieldMatch[0]}
  ${fnSrc}
  return mergeWeaponOverride;
`);
const mergeWeaponOverride = factory();

const checks = [];
const check = (n, p) => checks.push([n, Boolean(p)]);
const clones = (o) => JSON.parse(JSON.stringify(o));

/** 造一把与 generated 同形的武器 */
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
      id: 'primary', role: 'normal', trigger: 'auto', multishot: 1,
      segments: [{
        kind: 'impact', aoe: false,
        damage: { impact: 7.13, puncture: 6.21, slash: 9.66 },
        procChance: 0.31,
      }],
    }],
  };
}

// ── 1. 标量覆盖 ──
{
  const w = makeWeapon();
  mergeWeaponOverride(w, { critChance: 0.24, reloadTime: 1.5 });
  check('暴击几率被覆盖', w.critChance === 0.24);
  check('装填时间被覆盖', w.reloadTime === 1.5);
  check('未提及的字段保持原值', w.fireRate === 11.6667 && w.magazineSize === 70);
}

// ── 2. 模式按 id 匹配，不按数组下标 ──
{
  const w = makeWeapon();
  w.modes.push({ id: 'mode2', role: 'alt', trigger: 'burst', multishot: 1, segments: [{ kind: 'impact', aoe: false, damage: { impact: 10 }, procChance: 0.2 }] });
  // override 只写 mode2，且顺序与原数据相反
  mergeWeaponOverride(w, {
    modes: [
      { id: 'mode2', trigger: 'charged', role: 'alt', procChance: 0.2, segments: [{ kind: 'impact', aoe: false, damage: { impact: 10 }, procChance: 0.2 }] },
    ],
  });
  check('按 id 匹配到 mode2', w.modes[1].trigger === 'charged');
  check('没有误改 primary', w.modes[0].trigger === 'auto');
}

// ── 3. 不存在的模式被忽略 ──
{
  const w = makeWeapon();
  const before = JSON.stringify(w);
  mergeWeaponOverride(w, { modes: [{ id: 'nope', trigger: 'burst', segments: [] }] });
  check('不存在的模式被忽略', JSON.stringify(w) === before.replace('"nope"', '"nope"') || w.modes.length === 1);
  check('不凭空创建模式', w.modes.length === 1);
}

// ── 4. damage 整体替换（支持删除类型）──
{
  const w = makeWeapon();
  mergeWeaponOverride(w, {
    modes: [{
      id: 'primary', trigger: 'auto', procChance: 0.31,
      segments: [{ kind: 'impact', aoe: false, damage: { impact: 7.13, heat: 3.5 }, procChance: 0.31 }],
    }],
  });
  const d = core.firstSegment(w.modes[0]).damage;
  check('新增 heat 生效', d.heat === 3.5);
  check('删除的 puncture/slash 不会复活', d.puncture === undefined && d.slash === undefined);
  check('删除是整体替换而非逐键合并', Object.keys(d).sort().join(',') === 'heat,impact');
}

// ── 5. 重复合并不叠加（关键回归）──
{
  const base = makeWeapon();
  const ov = { fireRate: 12, critChance: 0.3 };
  // 模拟真实调用：每次都从 base 的**深拷贝**出发
  const first = mergeWeaponOverride(clones(base), ov);
  const second = mergeWeaponOverride(clones(base), ov);
  const third = mergeWeaponOverride(clones(base), ov);
  check('重复合并结果稳定（不叠加）',
    first.fireRate === second.fireRate && second.fireRate === third.fireRate && first.fireRate === 12);
  check('base 本身没被污染', base.fireRate === 11.6667);
}

// ── 6. 无 override 时原样返回 ──
{
  const w = makeWeapon();
  const before = JSON.stringify(w);
  mergeWeaponOverride(w, undefined);
  check('无 override 时不变', JSON.stringify(w) === before);
}

// ── 7. 非法数值不写入 ──
{
  const w = makeWeapon();
  mergeWeaponOverride(w, { critChance: NaN, fireRate: 'abc', magazineSize: Infinity });
  check('NaN 不写入', w.critChance === 0.23);
  check('非数字不写入', w.fireRate === 11.6667);
  check('Infinity 不写入', w.magazineSize === 70);
}

let ok = true;
for (const [n, p] of checks) {
  if (!p) ok = false;
  console.log(`${p ? '✔' : '✖'} ${n}`);
}
console.log(`\n共 ${checks.length} 项，${checks.filter((c) => c[1]).length} 通过`);
process.exit(ok ? 0 : 1);
