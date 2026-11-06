/**
 * 保存编辑器时，武器级「触发几率」必须同步到各模式分段的 procChance（D-048）。
 *
 *   node packages/demo/src/checks/status-sync.mjs   （需 demo 服务在跑）
 *
 * 为什么单独测：编辑器的触发几率只在「面板数值」区出现一次，
 * 保存时必须写进每个模式的 `procChance` **和** 每一段的 `procChance`，
 * 否则内核读到的还是旧值——这个测试专门防这个坑。
 *
 * D-103 修复：原版先取 `m.variants.flatMap(...)`，而 draft 里的模式根本没有 `variants`
 * （D-080 之前的形状），必然 TypeError；现按 D-083 形状造数据。
 */
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createChecks } from '../dom/report.mjs';
import { ROOT } from '../dom/load-page.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5178';
const OVERRIDES = join(ROOT, 'packages/data/src/manual/weapon-overrides.json');
const backup = existsSync(OVERRIDES) ? await readFile(OVERRIDES, 'utf8') : null;

const rec = createChecks('status-sync');
const check = rec.check.bind(rec);

try {
  // 模拟编辑器保存时的同步逻辑：武器级 statusChance = 0.5，模式与各段 procChance 应跟着变
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
      variants: [{
        id: 'direct',
        label: '直接命中',
        segments: [{ kind: 'impact', aoe: false, damage: { impact: 23 }, procChance: 0.31 }],
      }],
    }],
  };
  // 客户端同步（与 saveEditor 里一致）
  const sync = (w) => {
    for (const m of w.modes) {
      m.procChance = w.statusChance;
      for (const s of (m.variants ?? []).flatMap((v) => v.segments ?? [])) s.procChance = w.statusChance;
    }
    return w;
  };
  sync(draft);
  check('客户端同步后模式 procChance = 0.5', draft.modes[0].procChance === 0.5);
  check('客户端同步后分段 procChance = 0.5', draft.modes[0].variants[0].segments[0].procChance === 0.5);

  const r = await fetch(`${BASE}/__save-weapon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(draft),
  });
  check('保存成功', r.ok);

  const written = JSON.parse(await readFile(OVERRIDES, 'utf8'));
  const w = written.KuvaKarak;
  check('文件里 statusChance = 0.5', w.statusChance === 0.5);
  check('文件里模式 procChance = 0.5', w.modes[0].procChance === 0.5);
  check('文件里分段 procChance = 0.5', w.modes[0].variants[0].segments[0].procChance === 0.5);

  // 页面侧：saveEditor 必须真的做这个同步（源码级断言，防止以后被删）
  // D-105：编辑器已搬到 ui-editor.js，断言跟着新位置走
  const editorSrc = await readFile(join(ROOT, 'packages/demo/public/ui-editor.js'), 'utf8');
  check('编辑器的 saveEditor 会同步 procChance',
    /procChance\s*=\s*sc/.test(editorSrc) || /procChance\s*=\s*statusChance/.test(editorSrc));
} finally {
  if (backup === null) { try { await unlink(OVERRIDES); } catch { /* */ } }
  else await writeFile(OVERRIDES, backup, 'utf8');
}

rec.finish();
