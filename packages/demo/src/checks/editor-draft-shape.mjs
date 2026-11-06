/**
 * 编辑器**真实草稿**的保存回归（D-108）。
 *
 *   node packages/demo/src/checks/editor-draft-shape.mjs   （需 demo 服务在跑）
 *
 * 为什么单独测：`editor-save.mjs` 的载荷是**手写的**（只有 6 个面板字段），
 * 而页面上的 `saveEditor()` 发的是 `openEditor()` 从武器数据深拷贝出的草稿——
 * 以前里面还带着 `name` / `nameZh`。两者一旦不一致，就会出现
 * 「手写载荷全绿、用户点保存 400：武器字段「name」不可编辑」。
 * 这里用真实 DOM 跑：点「编辑」→ 点「保存」→ 断言编辑器提示「已保存」。
 *
 * 另有一条**反向**断言：服务器白名单**仍然拒** name/nameZh（D-108 需求方选「不放行，
 * 只修前端」）。别把这条删掉——哪天真要放行，得先走决策确认流程。
 * 结束时恢复 overrides 文件（原来没有就删掉）。
 */
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createChecks } from '../dom/report.mjs';
import { ROOT, loadPage } from '../dom/load-page.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5178';
const OVERRIDES = join(ROOT, 'packages/data/src/manual/weapon-overrides.json');
const backup = existsSync(OVERRIDES) ? readFileSync(OVERRIDES, 'utf8') : null;

const rec = createChecks('editor-draft-shape');
const check = rec.check.bind(rec);

const restore = async () => {
  if (backup === null) { try { await unlink(OVERRIDES); } catch { /* 已删除 */ } }
  else await writeFile(OVERRIDES, backup, 'utf8');
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // ── ① 真实 DOM：打开编辑器 → 保存 ──
  const { registry, modules } = await loadPage({ waitMs: 600 });
  const weapon = modules.store.store.data.weapon;
  check('默认武器带 name/nameZh（草稿以前就是从这里带出去的）',
    typeof weapon.name === 'string' && typeof weapon.nameZh === 'string');

  registry['#open-editor'].fire('click');
  check('点击「编辑」后浮层显示', registry['#editor-overlay'].style.display === 'flex');
  check('标题不含 undefined',
    !registry['#editor-title'].textContent.includes('undefined'),
    registry['#editor-title'].textContent);
  check('标题仍显示武器名', registry['#editor-title'].textContent.includes('编辑：'));

  // 草稿是 ui-editor.js 的私有变量，这里用「保存后的请求体」反查：
  // 抓到真实 POST 的 body，断言里面没有 name/nameZh
  const realFetch = globalThis.fetch;
  let savedBody = null;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/__save-weapon') && init && init.body) savedBody = JSON.parse(init.body);
    return realFetch(url, init);
  };
  registry['#editor-save'].fire('click');
  for (let i = 0; i < 40; i++) {
    if (/已保存|保存失败/.test(registry['#editor-msg'].textContent)) break;
    await sleep(50);
  }
  globalThis.fetch = realFetch;
  const msg = registry['#editor-msg'].textContent;
  check('真实 saveEditor() 保存成功（提示「已保存」）', msg.startsWith('已保存'), msg);
  check('未再报「name 不可编辑」', !msg.includes('不可编辑'), msg);
  check('实际发出的草稿里没有 name / nameZh',
    Boolean(savedBody) && !('name' in savedBody) && !('nameZh' in savedBody));

  // ── ② 反向：服务器白名单仍然拒 name/nameZh（D-108：不放行，只修前端）──
  const mode = weapon.modes[0];
  const withName = {
    weaponId: weapon.id,
    name: weapon.name,
    nameZh: weapon.nameZh,
    critChance: weapon.critChance,
    modes: weapon.modes.map((m) => ({
      id: m.id,
      role: m.role,
      trigger: m.trigger,
      procChance: m.variants[0]?.segments[0]?.procChance ?? 0,
      variants: m.variants.map((v) => ({
        id: v.id,
        label: v.label,
        segments: v.segments.map((s) => ({ kind: s.kind, aoe: s.aoe, damage: { ...s.damage }, procChance: s.procChance })),
      })),
    })),
  };
  const r = await fetch(`${BASE}/__save-weapon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(withName),
  });
  const j = await r.json();
  check('服务器仍拒 name/nameZh（白名单不放行）',
    r.status === 400 && !j.ok &&
    (j.errors || []).some((e) => e.includes('name')) && (j.errors || []).some((e) => e.includes('nameZh')));

  const written = existsSync(OVERRIDES) ? JSON.parse(await readFile(OVERRIDES, 'utf8'))[weapon.id] : null;
  check('文件里没有 name/nameZh', Boolean(written) && !('name' in written) && !('nameZh' in written));
  // D-122：什么都没改时只写模式（面板数值挂在模式 override 上），武器级 6 个字段**不落盘**
  check('没改就保存：武器级 6 个字段不落盘',
    Boolean(written) && !['critChance', 'critMultiplier', 'statusChance', 'fireRate', 'magazineSize', 'reloadTime']
      .some((k) => k in written),
    JSON.stringify(Object.keys(written || {})));
  check('模式「' + mode.id + '」写进去了', Boolean(written && written.modes.some((m) => m.id === mode.id)));
} finally {
  await restore();
}

rec.finish();
