/**
 * 端到端：模式级面板 override 保存后，页面上的暴击数据确实跟着变（D-050）。
 *
 *   node packages/demo/src/checks/mode-panel.mjs   （需 demo 服务在跑）
 *
 * ⚠ 这个文件之前是**乱码**（双重转码，中文断言里嵌着 `'`，导致整个文件 SyntaxError 跑不起来），
 *    D-103 按原意重写：写到 `modes[0].override` → 重启页面 → 面板「暴击几率」基础列应变成 45%。
 */
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createChecks } from '../dom/report.mjs';
import { ROOT, loadPage, invokeBoot } from '../dom/load-page.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5178';
const OVERRIDES = join(ROOT, 'packages/data/src/manual/weapon-overrides.json');
const backup = existsSync(OVERRIDES) ? await readFile(OVERRIDES, 'utf8') : null;

const rec = createChecks('mode-panel');
const check = rec.check.bind(rec);

/** 起一次页面，返回读面板的小函数 + 重启能力 + 当前默认武器 */
async function bootAndReadCrit() {
  const { registry, modules } = await loadPage({ waitMs: 600 });
  const weapon = modules.store.store.data.weapon;
  const read = () => {
    const rows = registry['#panel-table'].children;
    const critRow = rows.find((r) => r.textContent.includes('暴击几率'));
    const cdRow = rows.find((r) => r.textContent.includes('暴击伤害'));
    return { crit: critRow ? critRow.textContent : '', cd: cdRow ? cdRow.textContent : '' };
  };
  return {
    first: read(),
    weapon,
    async reboot() {
      await invokeBoot();
      await new Promise((r) => setTimeout(r, 400));
      return read();
    },
  };
}

const restore = async () => {
  if (backup === null) { try { await unlink(OVERRIDES); } catch { /* 已删除 */ } }
  else await writeFile(OVERRIDES, backup, 'utf8');
};

/**
 * 模式级 override 的载荷：**用当前默认武器的第一个模式**，不写死卡拉克
 * （2026-11-06 起默认武器是步枪第一把）。段沿用原数据的形状（D-083）。
 */
function payloadFor(weapon) {
  const mode = weapon.modes[0];
  const variant = (mode.variants ?? [])[0] ?? { id: 'direct', label: '直接命中', segments: [] };
  return {
    weaponId: weapon.id,
    modes: [{
      id: mode.id, role: mode.role ?? 'normal', trigger: mode.trigger ?? 'auto', procChance: mode.procChance ?? 0.31,
      override: { critChance: 0.45 },
      variants: [{ id: variant.id, label: variant.label, segments: variant.segments ?? [] }],
    }],
  };
}

try {
  try { await unlink(OVERRIDES); } catch { /* 本来就没有 */ }
  const page = await bootAndReadCrit();
  const before = page.first;
  const weapon = page.weapon;
  const basePct = (weapon.critChance * 100).toFixed(2) + '%';
  check('基线暴击几率 ' + basePct, before.crit.includes(basePct));

  // 给第一个模式写一份 override：暴击 → 45%（D-080：段在 variants[] 里）
  const payload = payloadFor(weapon);
  const r = await fetch(`${BASE}/__save-weapon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  check('保存成功', r.ok);

  const after = await page.reboot();
  check('模式级 override 生效（基础面板显示 45%）', after.crit.includes('45.00%'));
  check('暴击数据确实变了', after.crit !== before.crit);
} finally {
  await restore();
}

rec.finish();
