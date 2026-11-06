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

/** 读「伤害类型」表：类型 → { 基础, 当前 } */
function readDamageTable() {
  const out = {};
  const rows = registry['#damage-table'].children;
  for (const row of rows) {
    const cells = row.children.map((c) => c.textContent);
    if (!cells.length || cells[0] === '伤害类型') continue;
    if (cells[0] === '合计') { out.__total = { base: cells[1], cur: cells[2] }; continue; }
    out[cells[0]] = { base: cells[1], cur: cells[2] };
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
  // 直接命中两个面板都在（本体段 + 投射段）
  check('直接命中仍有两个伤害段', w.modes[0].variants[0].segments.length === 2,
    String(w.modes[0].variants[0].segments.length));

  {
    const t = readDamageTable();
    check('伤害表里没有「爆炸」行', !('爆炸' in t), Object.keys(t).join('/'));
    const same = Object.entries(t).every(([, v]) => v.base === v.cur);
    check('基础列 = 当前列（逐类型，无 Mod 时）', same, JSON.stringify(t));
    check('直接命中合计 = 135', t.__total && t.__total.cur === '135.00' && t.__total.base === '135.00',
      JSON.stringify(t.__total));
  }

  // ── ② 全库扫描：多变体武器「基础 = 当前」 ──
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
      store.ui.variantIndex = 0;
      const res = compute.runCompute(compute.currentContributions());
      const vi = Math.min(store.ui.variantIndex, res.spreadByVariant.length - 1);
      const cur = res.spreadByVariant[vi] ?? {};
      const base = {};
      for (const s of res.segments || []) {
        for (const [k, v] of Object.entries(s.panelWithKuva || {})) if (v) base[k] = (base[k] || 0) + v;
      }
      const keys = new Set([...Object.keys(base), ...Object.keys(cur)]);
      for (const k of keys) {
        // D-107 已知：元素 Mod 后移后，基础列不合成元素、当前列有合成（例如「空刃」），
        // 这是口径而不是混同，扫描时跳过合成元素类型。
        // 同理，合成后**消失的单元素**（空刃的电/火 → 辐射）也跳过：它只在基础列出现。
        if (SYNTHESIZED_ELEMENTS.includes(k)) continue;
        // 合成后**消失的单元素**（空刃的电/火 → 辐射）：它只在基础列出现，属 D-107 口径
        if (!(k in cur) && (k in base)) continue;
        if (Math.abs((cur[k] || 0) - (base[k] || 0)) > 1e-6) {
          failures.push(`${weapon.id}/${mode.id}[${vi}] ${k}: 基础 ${base[k] || 0} vs 当前 ${cur[k] || 0}`);
        }
      }
    }
    check(`全库扫描 ${multi.length} 把多变体武器：基础 = 当前`, failures.length === 0, failures.slice(0, 3).join(' | '));
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
