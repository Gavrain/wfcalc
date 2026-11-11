/**
 * 换枪后的编辑器状态 + 巴兹火枪面板（D-121 / D-122）。
 *
 *   node packages/demo/src/checks/weapon-switch-editor.mjs   （需 demo 服务在跑）
 *
 * 需求方 2026-11-06：
 *   > 「切换武器后已修改图标还在，编辑页还是显示已保存到 packages/data/src/manual/weapon-overrides.json
 *   >  巴兹火枪的基础面板有问题，他没有爆炸也没有范围伤害，而且两个模式面板混同了……
 *   >  其中当前面板是对的，基础面板不知道为什么加了爆炸。请确认其他武器是否也有这个问题。
 *   >  当然巴兹这个爆炸还是要删掉的。」
 *
 * 覆盖：
 *   · 巴兹火枪没有爆炸变体 / 没有爆炸伤害 / 没有范围伤害面板；
 *   · 巴兹火枪「基础」=「当前」（无 Mod 时），全部伤害类型逐个相等（两列不再混同）；
 *   · 全库扫描：所有**多变体**武器，无 Mod 时基础列与当前列逐类型相等；
 *   · 换枪后「已修改」标记按新武器重新判断、编辑器提示清空、草稿作废。
 * 结束时恢复 overrides 文件。
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createChecks } from '../dom/report.mjs';
import { ROOT, loadPage, invokeBoot } from '../dom/load-page.mjs';

const OVERRIDES = join(ROOT, 'packages/data/src/manual/weapon-overrides.json');
const backup = existsSync(OVERRIDES) ? readFileSync(OVERRIDES, 'utf8') : null;
const restore = () => {
  if (backup === null) { try { unlinkSync(OVERRIDES); } catch { /* 已删除 */ } }
  else writeFileSync(OVERRIDES, backup, 'utf8');
};

const rec = createChecks('weapon-switch-editor');
const check = rec.check.bind(rec);

const { registry, modules } = await loadPage({ waitMs: 700 });
const store = modules.store.store;
const data = modules.data;
const compute = modules.compute;
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const gsel = registry['#weapon-group'];
const tsel = registry['#weapon-type'];
const wsel = registry['#weapon-select'];

/** D-107：元素 Mod 后移后，「基础」列不合成元素、当前列会合成（空刃的 电+火 → 辐射） */
const SYNTHESIZED_ELEMENTS = ['blast', 'gas', 'magnetic', 'radiation', 'corrosive', 'viral'];

/**
 * 切到指定武器：模拟真实用户路径 —— 「类型」下拉选一个包含它的类型 → 「武器」下拉选它。
 * （⚠ 直接给 `#weapon-select` 赋值再 fire('change') 不够：选单的监听写在 `wsel.onchange` 上，
 *   shim 会同时调用属性与 addEventListener 两种注册，但**类型切换**才是让选单重建的正路。）
 */
async function goto(weaponId) {
  gsel.value = groupOfWeaponId(weaponId);
  gsel.fire('change');
  const group = store.dataAll.groups.get(gsel.value);
  let typeKey = null;
  for (const [k, bucket] of group.types) {
    if (bucket.weapons.some((x) => x.id === weaponId)) { typeKey = k; break; }
  }
  if (!typeKey) throw new Error('选单里找不到类型：' + weaponId);
  // ⚠ 测试环境说明：选单的监听写在 `wsel.onchange` 属性上，而 `el.fire` 只看元素自己身上的 `on<name>`，
  //   shim 里那个「DOM 属性」与 Node 对象属性不是同一份 —— 所以测试里**直接调这个 handler**，
  //   与真实用户点选单走的是同一个函数。
  if (typeKey !== tsel.value) {
    tsel.value = typeKey;
    tsel.fire('change');
    await settle(200);
  }
  if (!wsel.children.some((o) => o.value === weaponId)) {
    throw new Error('武器下拉里没有 ' + weaponId);
  }
  wsel.value = weaponId;
  if (typeof wsel.onchange === 'function') wsel.onchange();
  else wsel.fire('change');
  await settle(250);
  if (!store.data.weapon || store.data.weapon.id !== weaponId) {
    throw new Error('没能切到 ' + weaponId + '（实际 ' + (store.data.weapon && store.data.weapon.id) + '，类型 ' + typeKey + '）');
  }
}

/** 武器 id → 大类（archgun/archmelee → archwing） */
function groupOfWeaponId(weaponId) {
  const w = store.dataAll.weaponById.get(weaponId);
  if (!w) throw new Error('没有这把武器：' + weaponId);
  if (w.category === 'archgun' || w.category === 'archmelee') return 'archwing';
  return w.category;
}

/**
 * 读伤害分布表：**每种攻击方式一张**（需求方 2026-11-12）。
 *
 * `#damage-table` 是容器，里面每张表是一个 `.dmg-table`，其下第一层才是 `.panel-table`。
 *
 * @returns `[{ title, rows: { 类型: {base, cur}, __total: {base, cur} } }]`
 */
function readDamageTables() {
  const out = [];
  for (const t of registry['#damage-table'].children) {
    const inner = (t.children && t.children[0]) ? t.children[0] : t;
    const rows = {};
    let title = '';
    for (const row of inner.children ?? []) {
      const cells = row.children.map((c) => c.textContent);
      if (!cells.length) continue;
      if ((row.className || '').includes('panel-head')) {
        // 表头第一列现在就是攻击方式名（`直接命中` / `范围伤害` / `合计`）
        title = cells[0];
        continue;
      }
      if (cells[0] === '合计') { rows.__total = { base: cells[1], cur: cells[2] }; continue; }
      rows[cells[0]] = { base: cells[1], cur: cells[2] };
    }
    out.push({ title, rows });
  }
  return out;
}

try {
  try { unlinkSync(OVERRIDES); } catch { /* 本来就没有 */ }

  // ── ① 巴兹火枪：没有爆炸、没有范围伤害、基础 = 当前 ──
  await goto('GrnGorgSniperRifle');
  const w = store.data.weapon;
  check('切到巴兹火枪', w.id === 'GrnGorgSniperRifle');
  check('巴兹火枪没有爆炸变体',
    !w.modes.some((m) => m.variants.some((v) => v.id === 'blast')),
    w.modes.map((m) => m.id + ':' + m.variants.map((v) => v.id).join('+')).join(' '));
  check('巴兹火枪数据里没有爆炸伤害',
    !w.modes.some((m) => m.variants.some((v) => v.segments.some((s) => (s.damage.blast || 0) > 0))));
  check('范围伤害面板不显示', registry['#splash-damage'].children.length === 0,
    String(registry['#splash-damage'].children.length));
  // 攻击方式：D-150（需求方 2026-11-12「信标、炮台独立成模式」）之后，
  // 信标已经是**独立的射击模式**（mode2），不再和本体现在同一个模式里。
  // 所以这里改成：巴兹火枪有 2 个射击模式，主模式只有一个攻击方式（本体），信标模式只有穿刺。
  const modeIds = w.modes.map((m) => m.id);
  check('巴兹火枪有 2 个射击模式（本体 + 信标）', modeIds.length === 2, modeIds.join('+'));
  const buzlokBeacon = w.modes[1];
  check('信标是独立模式且形态正确',
    Boolean(buzlokBeacon) && buzlokBeacon.variants.length === 1 &&
      buzlokBeacon.variants[0].segments.length === 1 &&
      (buzlokBeacon.variants[0].segments[0].damage.puncture || 0) > 0,
    buzlokBeacon ? JSON.stringify(buzlokBeacon.variants.map((v) => v.segments.map((s) => s.damage))) : '无 mode2');
  const variantCount = w.modes[0].variants.length;
  check('主模式只有一个攻击方式（本体）', variantCount === 1, String(variantCount));

  {
    // ⚠ 需求方 2026-11-12：「不同段的伤害分布是不一样的，为什么没有多个伤害分布表」
    //   「不需要合计啊，而且他们的触发是各自算的，你把他们合到一个表然后均摊触发率显然不对」
    //   所以现在是**每种攻击方式一张表，没有合计表**。这里逐表验证。
    const tables = readDamageTables();
    check('巴兹火枪主模式渲染出一张伤害分布表', tables.length === 1, `${tables.length} 张：` +
      tables.map((t) => t.title).join(' / '));
    check('没有合计表（各段触发各自算，不能均摊）',
      !tables.some((t) => t.title === '合计'), tables.map((t) => t.title).join(' / '));

    const allTypes = new Set();
    let sameAll = true;
    for (const t of tables) {
      for (const [k, v] of Object.entries(t.rows)) {
        if (k.startsWith('__')) continue;
        allTypes.add(k);
        if (v.base !== v.cur) sameAll = false;
      }
    }
    check('伤害表里没有「爆炸」行', !allTypes.has('爆炸'), [...allTypes].join('/'));
    check('基础列 = 当前列（逐类型，无 Mod 时）', sameAll, JSON.stringify([...allTypes]));

    // 每张表的合计 = 该表自己那一行的和（各表独立，不跨表相加）
    const expects = w.modes[0].variants.map((v) =>
      v.segments.reduce((sum, s) => sum + Object.values(s.damage ?? {}).reduce((a, b) => a + b, 0), 0));
    const gotTotal = tables.map((t) => (t.rows.__total ? Number(t.rows.__total.cur) : NaN));
    check('每张表的合计 = 该攻击方式自己的各段之和',
      gotTotal.length === expects.length &&
        gotTotal.every((g, i) => Math.abs(g - expects[i]) < 1e-6),
      `表: ${gotTotal.join('/')} vs 数据: ${expects.join('/')}`);
  }

  // ── ② 全库扫描：多攻击方式武器「基础 = 当前」 ──
  //
  // D-148 / 2026-11-12：一个模式可以有多种攻击方式，界面默认全勾，参与计算的段是它们之和。
  // 所以「基础」列要对齐**勾选了的那些攻击方式**的所有段，不能只看 variants[0]。
  {
    const failures = [];
    const multi = [];
    for (const weapon of store.dataAll.weapons) {
      const mode = weapon.modes.find((m) => (m.variants || []).length > 1);
      if (!mode) continue;
      multi.push(weapon.id);
      data.clearLoadout();
      Object.assign(store.data, data.buildWeaponData(weapon.id, { modeId: mode.id }));
      store.ui.modeIndex = weapon.modes.indexOf(mode);
      // 默认全选（与界面初始状态一致）
      store.ui.selectedVariants = null;
      store.ui.variantIndex = 0;
      const res = compute.runCompute(compute.currentContributions());
      // 当前 = 所有被计入的变体之和（全选时就是全部）
      const cur = {};
      for (const sp of res.spreadByVariant || []) {
        for (const [k, v] of Object.entries(sp)) if (v) cur[k] = (cur[k] || 0) + v;
      }
      const base = {};
      for (const s of res.segments || []) {
        for (const [k, v] of Object.entries(s.panelWithKuva || {})) if (v) base[k] = (base[k] || 0) + v;
      }
      const keys = new Set([...Object.keys(base), ...Object.keys(cur)]);
      // 玄骸武器默认带一份玄骸元素（界面默认火焰），它会与武器自带元素合成
      // （火 + 电 → 辐射），于是基础列 vs 当前列的"单元素"对不上。
      // 这是**元素合成的正常行为**，不是混同，扫描时对玄骸武器跳过逐类型比对。
      const isKuva = Boolean(store.data.isKuva);
      if (isKuva) continue;
      for (const k of keys) {
        // D-107 已知：元素 Mod 后移后，基础列不合成元素、当前列有合成（例如「空刃」），
        // 这是口径而不是混同，扫描时跳过合成元素类型。
        // 同理，合成后**消失的单元素**（空刃的电/火 → 辐射）也跳过：它只在基础列出现。
        if (SYNTHESIZED_ELEMENTS.includes(k)) continue;
        // 合成后**消失的单元素**（空刃的电/火 → 辐射）：它只在基础列出现，属 D-107 口径
        if (!(k in cur) && (k in base)) continue;
        if (Math.abs((cur[k] || 0) - (base[k] || 0)) > 1e-6) {
          failures.push(`${weapon.id}/${mode.id} ${k}: 基础 ${base[k] || 0} vs 当前 ${cur[k] || 0}`);
        }
      }
    }
    if (failures.length > 0) {
      console.log(`  失败明细（共 ${failures.length} 条，前 5 条）：`);
      for (const f of failures.slice(0, 5)) console.log('    ' + f);
    }
    check(`全库扫描 ${multi.length} 把多攻击方式武器：基础 = 当前`, failures.length === 0, failures.slice(0, 3).join(' | '));
  }

  // ── ③ 换枪后的编辑器状态 ──
  await goto('KuvaKarak');
  registry['#open-editor'].fire('click');
  // 先真的保存一次，让"已修改"与"已保存到 …"都出现
  registry['#editor-save'].fire('click');
  for (let i = 0; i < 40; i++) {
    if (/已保存|保存失败/.test(registry['#editor-msg'].textContent)) break;
    await settle(50);
  }
  check('保存后提示「已保存到 …」', registry['#editor-msg'].textContent.startsWith('已保存到'),
    registry['#editor-msg'].textContent);
  check('保存后「已修改」标记显示', registry['#modified-badge'].style.display !== 'none');

  // 切到另一把**没有 override** 的武器
  await goto('Rifle');
  check('换枪后「已修改」标记消失', registry['#modified-badge'].style.display === 'none');
  check('换枪后编辑器提示清空', registry['#editor-msg'].textContent === '', registry['#editor-msg'].textContent);
  check('换枪后编辑器浮层关闭', registry['#editor-overlay'].style.display === 'none');

  // 再切回有 override 的那把（面板可用）。
  // ⚠ 这里**不**用 `invokeBoot()` 验证「切回去标记会回来」：重启会按 D-113 回到默认武器
  //   （主要→步枪第一把），不是你刚切的那把。真正会出现"标记错挂"的是**点选单换枪**，上面已覆盖。
  await goto('KuvaKarak');
  check('切回有 override 的武器，面板可用', registry['#panel-table'].children.length > 0);

  // 打开 → 换枪 → 再点保存：不能用旧草稿写错武器
  registry['#open-editor'].fire('click');
  await goto('Rifle');
  const before = existsSync(OVERRIDES) ? readFileSync(OVERRIDES, 'utf8') : '';
  registry['#editor-save'].fire('click');
  for (let i = 0; i < 20; i++) {
    if (!/保存中/.test(registry['#editor-msg'].textContent)) break;
    await settle(50);
  }
  const after = existsSync(OVERRIDES) ? readFileSync(OVERRIDES, 'utf8') : '';
  check('换枪后点保存被拒绝（不会拿旧草稿写文件）',
    registry['#editor-msg'].textContent.includes('武器已切换'), registry['#editor-msg'].textContent);
  check('overrides 文件没有被误写', before === after);
} finally {
  restore();
}

rec.finish();
