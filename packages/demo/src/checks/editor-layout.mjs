/**
 * 编辑器布局与文案检查（原 `verify-editor-layout.mjs`，D-047 / D-048 / D-049 / D-051）。
 *
 *   node packages/demo/src/checks/editor-layout.mjs   （需 demo 服务在跑）
 *
 * 打开开发态编辑器，检查 DOM 顺序、字段文案与 CSS 对齐规则。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collect } from '../dom/shim.mjs';
import { createChecks } from '../dom/report.mjs';
import { ROOT, loadPage } from '../dom/load-page.mjs';

const { registry, modules } = await loadPage({ waitMs: 600 });
const rec = createChecks('editor-layout');
const check = rec.check.bind(rec);

// 断言跟随**当前默认武器**（2026-11-06 起是步枪第一把，可能有多个模式、
// 元素分布也与卡拉克不同），不再假设"单模式 + 物理三属性"。
const weapon = modules.store.store.data.weapon;
const modeCount = weapon.modes.length;
const firstSegDamage = (function () {
  for (const m of weapon.modes) {
    for (const v of (m.variants ?? [])) {
      const s = (v.segments ?? [])[0];
      if (s && s.damage) return s.damage;
    }
  }
  return {};
})();

// 打开编辑器
registry['#open-editor'].fire('click');
const body = registry['#editor-body'];

/** 子节点在父节点里的下标（顺序断言用） */
function indexOfChild(node, child) { return node.children.indexOf(child); }

// ── 1. 发射器类型在模式元信息行内（D-048：触发几率不再重复出现在这里）──
const metaRows = collect(body, 'editor-meta-row');
check('有模式元信息行', metaRows.length >= 1);
if (metaRows.length) {
  const fields = metaRows[0].children.filter((c) => (c.className || '').includes('editor-field'));
  check('元信息行只有 1 个字段（发射器类型）', fields.length === 1);
  check('该字段是发射器类型', fields[0] && fields[0].textContent.includes('发射器类型'));
  check('模式区不再有触发几率', !metaRows[0].textContent.includes('触发几率'));
}

// ── 1b. 触发几率只在「面板数值」区出现一次（每个模式一份，不再跨模式重复）──
{
  const text = body.textContent;
  const occurrences = (text.match(/触发几率/g) || []).length;
  check('每个模式各一份触发几率（' + modeCount + ' 个模式 → ' + occurrences + ' 份）',
    occurrences === modeCount);
  const sectionTitles = body.children
    .filter((c) => (c.className || '').includes('editor-section'))
    .map((c) => c.textContent);
  check('第一个分区是模式而不是面板数值', sectionTitles[0] && sectionTitles[0].startsWith('模式：'));
  check('模式分区数量 = 武器模式数', sectionTitles.length === modeCount);
  check('只有一个模式时才只有一个分区', (modeCount === 1) === (sectionTitles.length === 1));
  const secIdx = body.children.findIndex((c) => (c.className || '').includes('editor-section'));
  const gridIdx = body.children.findIndex((c) => (c.className || '').includes('editor-grid'));
  check('面板数值紧跟模式标题', gridIdx === secIdx + 1);
}

// ── 1c. 发射器类型带中文与括号说明（D-048）──
{
  const sel = collect(body, 'editor-meta-row')[0].children.find(
    (c) => (c.tagName || '') === 'LABEL')?.children.find((c) => (c.tagName || '') === 'SELECT');
  check('找到触发类型下拉', Boolean(sel));
  if (sel) {
    const labels = sel.children.map((o) => o.textContent);
    check('下拉有 9 个选项', labels.length === 9);
    check('选项是中文名+括号解释', labels.every((t) => /^[^（]+（.+）$/.test(t)));
    check('全自动的解释正确', labels.includes('全自动（按住持续射击）'));
    check('未标注的解释正确', labels.some((t) => t.startsWith('未标注（')));
    const values = sel.children.map((o) => o.value);
    check('value 保留英文原值', values.includes('auto') && values.includes('charged'));
  }
}

// ── 2. 「添加伤害类型」在面板总伤**上方** ──
const addRow = collect(body, 'editor-add-row')[0];
const addBtn = addRow;
const totalBox = collect(body, 'editor-total')[0];
check('存在添加伤害类型按钮', Boolean(addBtn));
check('存在面板总伤', Boolean(totalBox));
if (addBtn && totalBox) {
  check('添加按钮在总伤之前', indexOfChild(body, addBtn) < indexOfChild(body, totalBox));
}

// ── 3. 伤害分布在元信息行之后、添加按钮之前 ──
const dmgSub = collect(body, 'editor-sub')[0];
check('伤害分布标题存在', Boolean(dmgSub));
if (dmgSub && addBtn) {
  check('顺序为 元信息行 → 伤害分布 → 添加按钮 → 总伤',
    indexOfChild(body, metaRows[0]) < indexOfChild(body, dmgSub) &&
    indexOfChild(body, dmgSub) < indexOfChild(body, addBtn));
}

// ── 3b. 添加伤害类型是一个下拉选择，而不是固定顺序（D-049）──
{
  const sel = addRow.children.find((c) => (c.className || '').includes('editor-add-select'));
  check('添加区有 select', Boolean(sel) && sel.tagName === 'SELECT');
  if (sel) {
    const values = sel.children.map((o) => o.value);
    // 只断言"已有的不再出现在可选里"，不写死是哪三种（2026-11-06 起默认武器可能带合成元素）
    const existing = Object.keys(firstSegDamage);
    check('可选类型不含已存在的（' + (existing.join('/') || '无') + '）',
      existing.every((t) => !values.includes(t)));
    check('可选类型里含 heat（可以主动选它）', values.includes('heat'));
    check('可选类型里含 toxin', values.includes('toxin'));
    check('可选项显示为中文名（tau 除外）',
      sel.children.every((o) => /[\u4e00-\u9fa5]/.test(o.textContent) || o.value === 'tau'));
    check('多个可选项（不是只能加一种）', values.length > 1);

    const target = values[values.length - 1];
    sel.value = target;
    const btn = addRow.children.find((c) => (c.className || '').includes('btn-ghost'));
    check('找到添加按钮', Boolean(btn));
    if (btn) {
      btn.fire('click');
      const body2 = registry['#editor-body'];
      const nameOfTarget = sel.children.find((o) => o.value === target).textContent;
      const dmgRows = collect(body2, 'editor-dmg-row');
      const names = dmgRows.map((r) => r.textContent);
      check('加进去的是所选的类型（' + nameOfTarget + '）', names.some((t) => t.includes(nameOfTarget)));
    }
  }
}

// ── 4. 括号提示已去掉 ──
const bodyText = body.textContent;
check('总伤不再带括号说明', !bodyText.includes('由分布自动求和'));
check('不再出现「（由」样式提示', !bodyText.includes('由分布自动求和，不可编辑'));

// ── 5. CSS 对齐规则 ──
const css = await readFile(join(ROOT, 'packages/demo/public/app.css'), 'utf8');
check('editor-field 不再 space-between', !/\.editor-field\s*\{[^}]*space-between/.test(css));
check('有 .editor-meta-row 规则', css.includes('.editor-meta-row'));
check('有 .editor-add-row 规则', css.includes('.editor-add-row'));
check('添加区有下拉选择器', css.includes('.editor-add-select'));
check('editor-total 规则只有一条', (css.match(/\.editor-total \{/g) || []).length === 1);

// ── 6. 词条名等宽 + 纵向节奏统一（D-051）──
{
  const labelRule = css.match(/\.editor-label \{[^}]*\}/);
  const dmgNameRule = css.match(/\.editor-dmg-name \{[^}]*\}/);
  check('有 .editor-label 规则', Boolean(labelRule));
  check('有 .editor-dmg-name 规则', Boolean(dmgNameRule));

  const w1 = labelRule && labelRule[0].match(/width:\s*(\d+)px/);
  const w2 = dmgNameRule && dmgNameRule[0].match(/width:\s*(\d+)px/);
  check('词条名使用固定宽度', Boolean(w1) && Boolean(w2));
  check('两类词条名宽度一致', w1 && w2 && w1[1] === w2[1]);
  check('宽度不再依赖 min-width（那样会随内容伸缩）',
    !/min-width:\s*\d+px/.test((dmgNameRule || [''])[0]));

  const secRule = (css.match(/\.editor-section \{[^}]*\}/) ?? [''])[0];
  const secTop = secRule.match(/margin:\s*(\d+)px/);
  check('分区标题有较大的上间隔（≥18px）', secTop && Number(secTop[1]) >= 18);

  const subRule = (css.match(/\.editor-sub \{[^}]*\}/) ?? [''])[0];
  const gridRule = (css.match(/\.editor-grid \{[^}]*\}/) ?? [''])[0];
  check('伤害分布小标题有独立间隔', /margin:\s*\d+px 0 \d+px/.test(subRule));
  check('面板数值网格行间距 ≥10px', /gap:\s*\d+px\s+\d+px/.test(gridRule) &&
    Number((gridRule.match(/gap:\s*(\d+)px/) ?? [0, 0])[1]) >= 10);
}

rec.finish();
