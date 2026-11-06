/**
 * 编辑器的**关键流程**回归：每个槽位与触发几率改完都能存进 `weapon-overrides.json`，
 * 并且重新合并后确实生效（D-116）。
 *
 *   node packages/demo/src/checks/editor-edit-save.mjs   （需 demo 服务在跑）
 *
 * 为什么要有它：`editor-draft-shape.mjs` 只测"原样打开再保存"，**没有改过任何字段**。
 * 只要任何一个输入框写错了草稿的键名，原样保存照样绿，而需求方一改就 400
 * （D-114 就是这么漏过去的：`name` / `nameZh` 混进草稿）。
 *
 * 覆盖：
 *   · 6 个槽位（暴击几率 / 暴击伤害 / 触发几率 / 射速 / 弹匣容量 / 装填时间）逐个改值并保存；
 *   · 面板数值在两个模式里**各改一次**（D-050：面板挂在模式 override 上）；
 *   · 伤害分布改值并保存；
 *   · 写入文件的字段与值都对，且**不带** name/nameZh；
 *   · 提交后页面（重新合并 overrides）里这些值真的变了。
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

const rec = createChecks('editor-edit-save');
const check = rec.check.bind(rec);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const restore = async () => {
  if (backup === null) { try { await unlink(OVERRIDES); } catch { /* 已删除 */ } }
  else await writeFile(OVERRIDES, backup, 'utf8');
};

/** 编辑器正文里第 `mi` 个模式的 `.editor-grid`（面板数值那一组） */
function gridOf(body, mi) {
  const grids = body.children.filter((c) => (c.className || '').includes('editor-grid'));
  return grids[mi] ?? null;
}

/** `.editor-grid` 里某个字段的 input：<label> 下第一项是名字、第二项是 input */
function fieldInput(body, mi, label) {
  const grid = gridOf(body, mi);
  if (!grid) return null;
  for (const row of grid.children) {
    const kids = row.children ?? [];
    if (kids.length >= 2 && kids[0].textContent === label) return kids[1];
  }
  return null;
}

function typeInput(input, value) {
  input.value = String(value);
  input.fire('input');
}

try {
  // 起点：没有 overrides（上一次运行残留时，编辑器读到的"当前值"就是上次改过的值，
  // 逐字段断言会假红）。D-122 之后"没改的字段不落盘"，残留会导致原值对不上。
  try { await unlink(OVERRIDES); } catch { /* 本来就没有 */ }
  const { registry, modules } = await loadPage({ waitMs: 600 });
  const weapon = modules.store.store.data.weapon;
  const firstModeId = weapon.modes[0].id;

  registry['#open-editor'].fire('click');
  const body = registry['#editor-body'];
  check('编辑器已打开并渲染出字段', body.children.length > 0);
  check('每个模式各有一组面板数值', body.children.filter((c) => (c.className || '').includes('editor-grid')).length === weapon.modes.length);

  const orig = {
    critChance: weapon.critChance,
    critMultiplier: weapon.critMultiplier,
    statusChance: weapon.statusChance,
    fireRate: weapon.fireRate,
    magazineSize: weapon.magazineSize,
    reloadTime: weapon.reloadTime,
  };
  const next = {
    critChance: 0.3142,
    critMultiplier: 3.21,
    statusChance: 0.4321,
    fireRate: 7.77,
    magazineSize: 33,
    reloadTime: 2.34,
  };
  const labels = {
    critChance: '暴击几率',
    critMultiplier: '暴击伤害',
    statusChance: '触发几率',
    fireRate: '射速',
    magazineSize: '弹匣容量',
    reloadTime: '装填时间',
  };

  // ── 改第一个模式的 6 个槽位 ──
  // ⚠ 先记下原值：编辑器把面板数值写进**模式 override**，那么"打开 → 改 → 保存"必然让
  //   草稿里每个模式的 override 都带上 6 个字段（没动的就是原值）。
  //   所以断言"文件里 = 新值"而不是"文件里只有改过的字段"。
  const shownPct = (k) => {
    const input = fieldInput(body, 0, labels[k]);
    return input && input.dataset && input.dataset.percent ? Number(input.value) / 100 : Number(input && input.value);
  };
  const origMode = {};
  for (const k of Object.keys(labels)) origMode[k] = shownPct(k);
  for (const [k, label] of Object.entries(labels)) {
    const input = fieldInput(body, 0, label);
    check(`字段「${label}」在编辑器里`, Boolean(input));
    if (!input) continue;
    const shown = input.dataset && input.dataset.percent ? next[k] * 100 : next[k];
    typeInput(input, shown);
  }
  // ── 其它模式也改一个（面板数值 → 该模式的 override）──
  const otherModeOverrides = [];
  for (let mi = 1; mi < weapon.modes.length; mi++) {
    const input = fieldInput(body, mi, labels.critChance);
    if (!input) continue;
    typeInput(input, next.critChance * 100);
    otherModeOverrides.push(weapon.modes[mi].id);
  }
  if (weapon.modes.length > 1) check('其它模式的面板也改到了', otherModeOverrides.length === weapon.modes.length - 1);

  // ── 改第一个模式的伤害分布 ──
  const dmgList = body.children.find((c) => (c.className || '').includes('editor-dmg-list'));
  const firstDmgRow = dmgList && dmgList.children[0];
  const dmgName = firstDmgRow && firstDmgRow.children[0] && firstDmgRow.children[0].textContent;
  const dmgInput = firstDmgRow && firstDmgRow.children[1];
  check('伤害分布可编辑', Boolean(dmgInput));
  if (dmgInput) typeInput(dmgInput, 12.5);

  // ── 保存 ──
  registry['#editor-save'].fire('click');
  for (let i = 0; i < 40; i++) {
    if (/已保存|保存失败/.test(registry['#editor-msg'].textContent)) break;
    await sleep(50);
  }
  const msg = registry['#editor-msg'].textContent;
  check('改完再保存成功（不是 400）', msg.startsWith('已保存'), msg);

  // ── 文件内容 ──
  check('overrides 文件已写出', existsSync(OVERRIDES));
  const written = existsSync(OVERRIDES) ? JSON.parse(await readFile(OVERRIDES, 'utf8'))[weapon.id] : null;
  check('文件里记录了这把武器', Boolean(written));
  const mode0 = written && written.modes.find((m) => m.id === firstModeId);
  const close = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-9;
  if (written) {
    for (const [k, label] of Object.entries(labels)) {
      // D-050：编辑器把面板数值写进**该模式的 override**，武器级字段本身不变
      check(`「${label}」写进模式 override = ${next[k]}`,
        close(mode0 && mode0.override && mode0.override[k], next[k]),
        String(mode0 && mode0.override && mode0.override[k]));
    }
    check('其它模式也写了自己的 override',
      otherModeOverrides.every((id) => {
        const m = written.modes.find((x) => x.id === id);
        return m && m.override && close(m.override.critChance, next.critChance);
      }));
    const seg0 = mode0 && mode0.variants && mode0.variants[0] && mode0.variants[0].segments && mode0.variants[0].segments[0];
    check(`伤害分布「${dmgName}」写进文件 = 12.5`,
      Boolean(seg0) && seg0.damage[dmgTypeKey(dmgName)] === 12.5,
      JSON.stringify(seg0 && seg0.damage));
    check('没有 name / nameZh 混进文件', !('name' in written) && !('nameZh' in written));
    check('带 _manual 标记', written._manual === true);
  }

  // ── 合并后当前模式生效 ──
  // ⚠ 重新合并会**换掉** `store.data.weapon` 这个对象（`mergeWeaponOverride(深拷贝)`），
  //   所以这里要重新取，不能用开头那个 `weapon` 引用。
  const merged = modules.store.store.data.weapon;
  const cur = merged.modes[0];
  const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-9;
  check('合并后当前模式的暴击几率 = ' + next.critChance,
    near(cur.override && cur.override.critChance, next.critChance),
    JSON.stringify(cur.override));
  check('合并后当前模式的触发几率 = ' + next.statusChance,
    near(cur.override && cur.override.statusChance, next.statusChance),
    JSON.stringify(cur.override));
  // 没改的槽位不该被写歪。这里只比"这一轮没动过的字段"：
  // 6 个槽位这一轮全改过，所以 `untouched` 为空时该项自然通过；
  // 触发几率另算——编辑器会把它同步到段上的 `procChance`（D-048），属已知行为。
  // ⚠ `origMode` 是改值**之前**从输入框读的原值；`next` 是这一轮的新值。
  //   （"没改的字段保持原值"无法在这里构造——6 个槽位全改过；要测它得另开一轮不碰任何输入框的保存。）
  const untouched = Object.keys(origMode).filter((k) => k !== 'statusChance' && Math.abs(next[k] - origMode[k]) < 1e-9);
  check('没改的槽位保留原值（本次为 ' + (untouched.length ? untouched.join('/') : '空集') + '）',
    untouched.every((k) => near(cur.override[k], origMode[k])),
    `文件 ${JSON.stringify(cur.override)} / 原来 ${JSON.stringify(origMode)}`);
  check('合并后「已修改」标记出现',
    registry['#modified-badge'].style.display !== 'none');
  check('测试用新值与原值不同（断言有效）',
    Object.keys(orig).every((k) => Math.abs(orig[k] - next[k]) > 1e-6));
} finally {
  await restore();
}

/** 编辑器里伤害类型显示的是中文名，文件里的键是英文类型 */
function dmgTypeKey(label) {
  const map = { 冲击: 'impact', 穿刺: 'puncture', 切割: 'slash', 火焰: 'heat', 冰冻: 'cold', 电击: 'electric', 毒素: 'toxin', 爆炸: 'blast', 毒气: 'gas', 磁力: 'magnetic', 辐射: 'radiation', 病毒: 'viral', 腐蚀: 'corrosive', 虚空: 'void', Tau: 'tau' };
  return map[label] ?? label;
}

rec.finish();
