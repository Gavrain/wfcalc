/**
 * 武器编辑器接口测试（D-044）。
 *   node packages/demo/src/verify-editor.mjs
 *
 * 需要 demo 服务在 127.0.0.1:5178 运行（npm run demo）。
 * 测试会**临时写入** weapon-overrides.json，结束时恢复原状。
 */
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));
const BASE = 'http://127.0.0.1:5178';
const OVERRIDES = join(ROOT, 'packages/data/src/manual/weapon-overrides.json');

const checks = [];
const check = (n, p) => checks.push([n, Boolean(p)]);

const backup = existsSync(OVERRIDES) ? await readFile(OVERRIDES, 'utf8') : null;

try {
  // ── 1. 开发态探针 ──
  const dev = await (await fetch(`${BASE}/__dev`)).json();
  check('存在 /__dev 探针', dev && dev.dev === true);
  check('探针声明可编辑', dev.canEdit === true);

  // ── 2. 合法保存（UTF-8 中文 note）──
  const payload = {
    weaponId: 'KuvaKarak',
    critChance: 0.24,
    critMultiplier: 2.1,
    statusChance: 0.31,
    fireRate: 11.6667,
    magazineSize: 70,
    reloadTime: 1.7,
    note: '人工核对：暴击几率 23% → 24%',
    modes: [{
      id: 'primary', role: 'normal', trigger: 'auto', procChance: 0.31,
      segments: [{ kind: 'impact', aoe: false, damage: { impact: 7.13, puncture: 6.21, slash: 9.66 }, procChance: 0.31 }],
    }],
  };
  const saveRes = await fetch(`${BASE}/__save-weapon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  const saveJson = await saveRes.json();
  check('合法编辑保存成功', saveRes.ok && saveJson.ok);

  const written = JSON.parse(await readFile(OVERRIDES, 'utf8'));
  check('文件里记录了该武器', Boolean(written.KuvaKarak));
  check('带 _manual 标记', written.KuvaKarak._manual === true);
  check('中文 note 没有乱码', written.KuvaKarak.note === '人工核对：暴击几率 23% → 24%');
  check('暴击几率已更新为 0.24', written.KuvaKarak.critChance === 0.24);

  // ── 3. 非法字段被拒 ──
  const bad1 = await fetch(`${BASE}/__save-weapon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ weaponId: 'KuvaKarak', totalDamage: 999, modes: [] }),
  });
  const bad1j = await bad1.json();
  check('面板总伤等非法字段被拒绝', bad1.status === 400 && !bad1j.ok);
  check('错误信息点名字段', (bad1j.errors || []).some((e) => e.includes('totalDamage')));

  // ── 4. 负伤害被拒 ──
  const bad2 = await fetch(`${BASE}/__save-weapon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      weaponId: 'KuvaKarak', modes: [{
        id: 'primary', trigger: 'auto', procChance: 0.3,
        segments: [{ kind: 'impact', aoe: false, damage: { impact: -5 }, procChance: 0.3 }],
      }],
    }),
  });
  const bad2j = await bad2.json();
  check('负伤害值被拒绝', bad2.status === 400 && !bad2j.ok);

  // ── 5. 增删伤害类型 ──
  const addType = {
    weaponId: 'KuvaKarak', modes: [{
      id: 'primary', role: 'normal', trigger: 'auto', procChance: 0.31,
      segments: [{
        kind: 'impact', aoe: false,
        damage: { impact: 7.13, heat: 3.5 }, // 删掉了 puncture/slash，新增 heat
        procChance: 0.31,
      }],
    }],
  };
  const addRes = await fetch(`${BASE}/__save-weapon`, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(addType),
  });
  check('增删伤害类型可保存', addRes.ok);
  const w2 = JSON.parse(await readFile(OVERRIDES, 'utf8'));
  const dmg = w2.KuvaKarak.modes[0].segments[0].damage;
  check('新增的 heat 已写入', dmg.heat === 3.5);
  check('删除的 puncture/slash 已消失', dmg.puncture === undefined && dmg.slash === undefined);

  // ── 6. trigger 可改 ──
  const trigRes = await fetch(`${BASE}/__save-weapon`, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      weaponId: 'KuvaKarak', modes: [{
        id: 'primary', role: 'normal', trigger: 'burst', procChance: 0.31,
        segments: [{ kind: 'impact', aoe: false, damage: { impact: 23 }, procChance: 0.31 }],
      }],
    }),
  });
  check('trigger 可保存', trigRes.ok);
  const w3 = JSON.parse(await readFile(OVERRIDES, 'utf8'));
  check('trigger 已改为 burst', w3.KuvaKarak.modes[0].trigger === 'burst');

  // ── 7. 读回接口 ──
  const readback = await (await fetch(`${BASE}/__weapon-overrides`)).json();
  check('读回接口返回已保存内容', Boolean(readback.KuvaKarak));
} finally {
  // 恢复原状
  if (backup === null) {
    try { await unlink(OVERRIDES); } catch { /* 本来就没有 */ }
  } else {
    await writeFile(OVERRIDES, backup, 'utf8');
  }
}

let ok = true;
for (const [n, p] of checks) {
  if (!p) ok = false;
  console.log(`${p ? '✔' : '✖'} ${n}`);
}
console.log(`\n共 ${checks.length} 项，${checks.filter((c) => c[1]).length} 通过`);
process.exit(ok ? 0 : 1);
