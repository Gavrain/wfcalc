/**
 * 端到端：保存 override → 页面加载后武器数据确实被改（原 `verify-override-e2e.mjs`，D-046）。
 *
 *   node packages/demo/src/checks/override-e2e.mjs   （需 demo 服务在跑）
 *
 * 做法：用 DOM shim 跑一次 app.js 的 boot，对比"有/无 override"两种情况下
 *       面板显示值是否不同。结束时恢复 overrides 文件。
 *
 * D-103：shim / app.js 装载 / 打字机路径都走 `dom/load-page.mjs`，
 * 这里只写"写入 → 重启 → 读数"的业务断言。
 */
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createChecks } from '../dom/report.mjs';
import { ROOT, loadPage, invokeBoot } from '../dom/load-page.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5178';
const OVERRIDES = join(ROOT, 'packages/data/src/manual/weapon-overrides.json');
const backup = existsSync(OVERRIDES) ? await readFile(OVERRIDES, 'utf8') : null;

const rec = createChecks('override-e2e');
const check = rec.check.bind(rec);

/** 起一次页面，返回读面板的小函数 */
async function bootAndReadPanel() {
  const { registry, modules } = await loadPage({ waitMs: 600 });
  const weapon = modules.store.store.data.weapon;
  const read = () => {
    const rows = registry['#panel-table'].children;
    const critRow = rows.find((r) => r.textContent.includes('暴击几率'));
    const speedRow = rows.find((r) => r.textContent.includes('射速'));
    return { crit: critRow ? critRow.textContent : '', speed: speedRow ? speedRow.textContent : '' };
  };
  const first = read();
  return {
    first,
    weapon,
    /** 重启页面后再读（同一次进程里，模拟刷新） */
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
 * 用**当前默认武器**做端到端，不写死卡拉克（2026-11-06 默认武器改成步枪第一把）。
 *
 * ⚠ 基线值从 dataAll 里现取现算，不假设"暴击 23%、射速 11.6667"——
 *   那样一换默认武器就会假红。override 写回值与基线保持同一 shape（D-083 的 variants 形状）。
 */
function payloadFor(weapon) {
  const mode = weapon.modes[0];
  const variant = (mode.variants ?? [])[0] ?? { id: 'direct', label: '直接命中', segments: [] };
  return {
    weaponId: weapon.id,
    critChance: 0.30,
    fireRate: 8,
    note: 'e2e 测试',
    modes: [{
      id: mode.id, role: mode.role ?? 'normal', trigger: mode.trigger ?? 'auto', procChance: mode.procChance ?? 0.31,
      variants: [{
        id: variant.id,
        label: variant.label,
        segments: variant.segments ?? [],
      }],
    }],
  };
}

try {
  // ── 基线（无 override）──
  try { await unlink(OVERRIDES); } catch { /* 本来就没有 */ }
  const page = await bootAndReadPanel();
  const before = page.first;
  const weapon = page.weapon;
  check('基线：默认武器是 ' + weapon.id, Boolean(weapon && weapon.id));
  check('基线：暴击几率 ' + (weapon.critChance * 100).toFixed(2) + '%',
    before.crit.includes((weapon.critChance * 100).toFixed(2) + '%'));
  check('基线：射速 ' + weapon.fireRate, before.speed.includes(weapon.fireRate.toFixed(3)));

  // ── 写入 override：暴击几率 → 30%，射速 → 8 ──
  // D-083：段只在 variants[].segments 里，模式上不能再有 segments
  const payload = payloadFor(weapon);
  const saveRes = await fetch(`${BASE}/__save-weapon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  check('保存成功', saveRes.ok);

  const after = await page.reboot();
  check('页面已用上新的暴击几率（30%）', after.crit.includes('30.00%'));
  check('页面已用上新的射速（8）', after.speed.includes('8.000'));
  check('数值确实变了', after.crit !== before.crit && after.speed !== before.speed);

  // ── 恢复 ──
  await restore();
  const restored = await page.reboot();
  check('删除 override 后恢复原值',
    restored.crit.includes((weapon.critChance * 100).toFixed(2) + '%'));
} finally {
  await restore();
}

rec.finish();
