/**
 * 保存接口 `/__save-weapon` 的校验规则（D-044 / D-046 / D-050 / D-080）。
 *
 *   node packages/demo/src/checks/editor-save.mjs   （需 demo 服务在跑）
 *
 * 只测"服务器收不收、写成什么"，不跑 DOM：读回写在
 * `packages/data/src/manual/weapon-overrides.json` 里的内容。
 * 结束时恢复原文件（原来没有就删掉）。
 */
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createChecks } from '../dom/report.mjs';
import { ROOT } from '../dom/load-page.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5178';
const OVERRIDES = join(ROOT, 'packages/data/src/manual/weapon-overrides.json');
const backup = existsSync(OVERRIDES) ? await readFile(OVERRIDES, 'utf8') : null;

const rec = createChecks('editor-save');
const check = rec.check.bind(rec);

/** D-083 形状：段只在 variants[].segments 里 */
function variantsOf(damage = { impact: 7.13, puncture: 6.21, slash: 9.66 }) {
  return [{
    id: 'direct',
    label: '直接命中',
    segments: [{ kind: 'impact', aoe: false, damage, procChance: 0.31 }],
  }];
}

const post = (body) =>
  fetch(`${BASE}/__save-weapon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });

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
    modes: [{ id: 'primary', role: 'normal', trigger: 'auto', procChance: 0.31, variants: variantsOf() }],
  };
  const saveRes = await post(payload);
  const saveJson = await saveRes.json();
  check('合法编辑保存成功', saveRes.ok && saveJson.ok);

  const written = JSON.parse(await readFile(OVERRIDES, 'utf8'));
  check('文件里记录了该武器', Boolean(written.KuvaKarak));
  check('带 _manual 标记', written.KuvaKarak._manual === true);
  check('中文 note 没有乱码', written.KuvaKarak.note === '人工核对：暴击几率 23% → 24%');
  check('暴击几率已更新为 0.24', written.KuvaKarak.critChance === 0.24);
  check('模式按 variants 形状写回', Array.isArray(written.KuvaKarak.modes[0].variants));

  // ── 3. 非法字段被拒 ──
  const bad1 = await post({ weaponId: 'KuvaKarak', totalDamage: 999, modes: [] });
  const bad1j = await bad1.json();
  check('面板总伤等非法字段被拒绝', bad1.status === 400 && !bad1j.ok);
  check('错误信息点名字段', (bad1j.errors || []).some((e) => e.includes('totalDamage')));

  // ── 4. 缺少 variants 被拒（D-083）──
  const bad2 = await post({
    weaponId: 'KuvaKarak',
    modes: [{ id: 'primary', trigger: 'auto', segments: [{ kind: 'impact', damage: { impact: 1 } }] }],
  });
  const bad2j = await bad2.json();
  check('模式上直接挂 segments 被拒（缺 variants）', bad2.status === 400 && !bad2j.ok);
  check('错误信息点名 variants', (bad2j.errors || []).some((e) => e.includes('variants')));

  // ── 5. 分段里的非法字段被拒 ──
  const bad3 = await post({
    weaponId: 'KuvaKarak',
    modes: [{
      id: 'primary', trigger: 'auto',
      variants: [{ id: 'direct', label: 'L', segments: [{ kind: 'impact', damage: { impact: 1 }, critChance: 9 }] }],
    }],
  });
  const bad3j = await bad3.json();
  check('分段里的非法字段被拒', bad3.status === 400 && !bad3j.ok);

  // ── 6. 负的伤害值被拒 ──
  const bad4 = await post({
    weaponId: 'KuvaKarak',
    modes: [{ id: 'primary', trigger: 'auto', variants: [{ id: 'direct', label: 'L', segments: [{ kind: 'impact', damage: { impact: -5 } }] }] }],
  });
  check('负的伤害值被拒', bad4.status === 400);
} finally {
  if (backup === null) { try { await unlink(OVERRIDES); } catch { /* */ } }
  else await writeFile(OVERRIDES, backup, 'utf8');
}

rec.finish();
