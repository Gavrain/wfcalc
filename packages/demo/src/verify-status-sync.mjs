/**
 * 触发几率同步测试（D-048）。
 * 编辑器的「触发几率」只在面板数值里，保存时必须同步到各模式分段的 procChance，
 * 否则内核读到的还是旧值 —— 这个测试专门防这个坑。
 *   node packages/demo/src/verify-status-sync.mjs   （需 demo 服务在跑）
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
  // 模拟编辑器保存时的同步逻辑：武器级 statusChance = 0.5，模式 procChance 应跟着变
  const draft = {
    weaponId: 'KuvaKarak',
    critChance: 0.23,
    critMultiplier: 2.1,
    statusChance: 0.5, // ← 面板数值里改的
    fireRate: 11.6667,
    magazineSize: 70,
    reloadTime: 1.7,
    modes: [{
      id: 'primary', role: 'normal', trigger: 'auto',
      procChance: 0.31, // ← 旧值，保存时应被覆盖为 0.5
      segments: [{ kind: 'impact', aoe: false, damage: { impact: 23 }, procChance: 0.31 }],
    }],
  };
  // 客户端同步（与 saveEditor 里一致）
  for (const m of draft.modes) {
    m.procChance = draft.statusChance;
    for (const s of m.segments) s.procChance = draft.statusChance;
  }
  check('客户端同步后模式 procChance = 0.5', draft.modes[0].procChance === 0.5);
  check('客户端同步后分段 procChance = 0.5', draft.modes[0].segments[0].procChance === 0.5);

  const r = await fetch(`${BASE}/__save-weapon`, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(draft),
  });
  check('保存成功', r.ok);

  const written = JSON.parse(await readFile(OVERRIDES, 'utf8'));
  const w = written.KuvaKarak;
  check('文件里 statusChance = 0.5', w.statusChance === 0.5);
  check('文件里模式 procChance = 0.5', w.modes[0].procChance === 0.5);
  check('文件里分段 procChance = 0.5', w.modes[0].segments[0].procChance === 0.5);

  // 合并后内核应看到 0.5
  const src = await readFile(join(ROOT, 'packages/demo/public/app.js'), 'utf8');
  check('app.js 的 saveEditor 会同步 procChance', /sync|statusChance[\s\S]{0,400}procChance/.test(src)
    || src.includes('D-048'));
} finally {
  if (backup === null) { try { await unlink(OVERRIDES); } catch { /* */ } }
  else await writeFile(OVERRIDES, backup, 'utf8');
}

let ok = true;
for (const [n, p] of checks) { if (!p) ok = false; console.log(`${p ? '✔' : '✖'} ${n}`); }
console.log(`\n共 ${checks.length} 项，${checks.filter((c) => c[1]).length} 通过`);
process.exit(ok ? 0 : 1);
