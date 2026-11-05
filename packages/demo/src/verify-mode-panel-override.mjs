/**
 * 模式级面板 override 的保存与合并（D-050）。
 *   node packages/demo/src/verify-mode-panel-override.mjs   （需 demo 服务在跑）
 */
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));
const BASE = 'http://127.0.0.1:5178';
const OVERRIDES = join(ROOT, 'packages/data/src/manual/weapon-overrides.json');
const backup = existsSync(OVERRIDES) ? await readFile(OVERRIDES, 'utf8') : null;

const checks = [];
const check = (n, p) => checks.push([n, Boolean(p)]);

try {
  // ── 1. 带 override 的保存 ──
  const payload = {
    weaponId: 'KuvaKarak',
    modes: [{
      id: 'primary', role: 'normal', trigger: 'auto', procChance: 0.31,
      override: { critChance: 0.45, critMultiplier: 3.5 },
      segments: [{ kind: 'impact', aoe: false, damage: { impact: 23 }, procChance: 0.31 }],
    }],
  };
  const r = await fetch(`${BASE}/__save-weapon`, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  check('带 override 的保存成功', r.ok && j.ok);

  const written = JSON.parse(await readFile(OVERRIDES, 'utf8'));
  const ov = written.KuvaKarak.modes[0].override;
  check('文件里记录了模式 override', Boolean(ov));
  check('critChance 写入 0.45', ov && ov.critChance === 0.45);
  check('critMultiplier 写入 3.5', ov && ov.critMultiplier === 3.5);

  // ── 2. override 里的非法字段被拒 ──
  const bad = await fetch(`${BASE}/__save-weapon`, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      weaponId: 'KuvaKarak',
      modes: [{
        id: 'primary', trigger: 'auto', procChance: 0.31,
        override: { totalDamage: 999 },
        segments: [{ kind: 'impact', aoe: false, damage: { impact: 23 }, procChance: 0.31 }],
      }],
    }),
  });
  const bj = await bad.json();
  check('override 里的非法字段被拒绝', bad.status === 400 && !bj.ok);
  check('错误信息点名该字段', (bj.errors || []).some((e) => e.includes('totalDamage')));

  // ── 3. override 里的负数被拒 ──
  const neg = await fetch(`${BASE}/__save-weapon`, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      weaponId: 'KuvaKarak',
      modes: [{
        id: 'primary', trigger: 'auto', procChance: 0.31,
        override: { critChance: -0.5 },
        segments: [{ kind: 'impact', aoe: false, damage: { impact: 23 }, procChance: 0.31 }],
      }],
    }),
  });
  check('override 里的负数被拒绝', neg.status === 400);

  // ── 4. 合并逻辑：override 写进模式并在内核生效 ──
  const appSrc = await readFile(join(ROOT, 'packages/demo/public/app.js'), 'utf8');
  check('合并逻辑处理 override', appSrc.includes('om.override') && appSrc.includes('target.override'));
  check('编辑器把面板数值写进模式 override', appSrc.includes('mode.override[key] = v'));
} finally {
  if (backup === null) { try { await unlink(OVERRIDES); } catch { /* */ } }
  else await writeFile(OVERRIDES, backup, 'utf8');
}

let ok = true;
for (const [n, p] of checks) { if (!p) ok = false; console.log(`${p ? '✔' : '✖'} ${n}`); }
console.log(`\n共 ${checks.length} 项，${checks.filter((c) => c[1]).length} 通过`);
process.exit(ok ? 0 : 1);
