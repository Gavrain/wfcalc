/**
 * 武器编辑器（D-044，仅开发态）。D-105 从 `app.js` 整块搬出来。
 *
 * 可编辑：面板数值 / 伤害分布 / trigger / 每段 procChance。
 * 不可编辑：面板总伤（恒等于 Σ damage，只读显示）。
 * 保存：POST /__save-weapon → packages/data/src/manual/weapon-overrides.json
 *
 * ⚠ 这里只做"编辑与保存"，**不负责**把 overrides 合进武器数据
 *   （那一份在 `weapon-override.js`，页面与测试共用）。
 */
import { isKuvaFamily } from '../../core/src/index.ts';
import { ELEMENT_LABEL, store } from './app-store.js';
import { mergeWeaponOverride } from './weapon-override.js';

/**
 * 宿主注入的两个回调（app.js 提供）：
 *   · `flash(msg)`      顶部提示条
 *   · `renderAll()`     整页重渲染（合并 override 之后调用）
 */
let deps = { flash: () => {}, renderAll: () => {} };
export function setEditorDeps(next) {
  deps = { ...deps, ...next };
}

/**
 * 一个模式内全部变体的全部段（D-080）。与 app.js 里的 modeSegments 同义——
 * app.js 是普通脚本不能导出，所以两边各留一份，改一处要同步另一处。
 */
function modeSegments(m) {
  if (!m) return [];
  const out = [];
  for (const v of m.variants || []) for (const s of v.segments || []) out.push(s);
  return out;
}

/** 与本页其它模块同款的辅助函数（app.js 是普通脚本，跨文件只能各留一份） */
/** 与本页其它模块一致的取元素写法 */
const $ = (s) => document.querySelector(s);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const EDITABLE_WEAPON_FIELDS = [
  ['critChance', '暴击几率', 'ratio'],
  ['critMultiplier', '暴击伤害', 'x'],
  // 触发几率只在这里编辑；模式里不再重复出现（D-048）
  ['statusChance', '触发几率', 'ratio'],
  ['fireRate', '射速', 'num'],
  ['magazineSize', '弹匣容量', 'num'],
  ['reloadTime', '装填时间', 'num'],
];

const TRIGGER_OPTIONS = [
  'auto', 'burst', 'semi', 'charged', 'active', 'held', 'duplex', 'none', 'unknown',
];

/**
 * 发射器类型的展示名与特点说明（D-048）。
 * 下拉显示「中文名（特点）」，同时保留英文原值，方便人工核对数据。
 */
const TRIGGER_LABELS = {
  auto: ['全自动', '按住持续射击'],
  semi: ['半自动', '每点一次打一发'],
  burst: ['点射', '一次扣扳机打出多连发'],
  charged: ['蓄力', '按住蓄力后释放，伤害通常更高'],
  active: ['主动', '需手动触发，如次要开火'],
  held: ['持续引导', '按住持续输出，如光束类'],
  duplex: ['双发', '扣扳机与松开各打一发'],
  none: ['无', '武器本身不直接射击'],
  unknown: ['未标注', '数据未给出，待人工确认'],
};

export function triggerLabel(t) {
  const e = TRIGGER_LABELS[t];
  return e ? e[0] + '（' + e[1] + '）' : t;
}

/** 编辑器工作副本（打开时从 store.data.weapon 深拷贝） */
let editorDraft = null;
/** 只读的武器名（标题用；D-108 不在草稿里，因为服务器不收 name/nameZh） */
let editorTitle = { name: '', nameZh: '' };
/**
 * 打开编辑器时的**武器 id**（D-122）。换枪后旧草稿必须作废——
 * 否则拿 A 的草稿去改 current 会按 `weaponId` 写错武器，或者保存消息还停在上一把枪上。
 */
let editorWeaponId = null;

export async function detectDevMode() {
  try {
    const r = await fetch('/__dev');
    if (!r.ok) return false;
    const j = await r.json();
    return Boolean(j && j.canEdit);
  } catch {
    return false; // 静态部署：没有后端 → 不显示编辑入口
  }
}

export function openEditor() {
  // D-108：草稿里**不放** name / nameZh（也不能改）。
  // 它们是只读展示用的，而服务器白名单（server.mjs 的 EDITABLE_WEAPON_FIELDS）只收
  // 六个面板数值字段；带上去的话每一次保存都会被 400 拒掉
  // （「武器字段「name」不可编辑」「武器字段「nameZh」不可编辑」）。
  // 标题需要的名字从只读的 `editorTitle` 取。
  editorDraft = JSON.parse(JSON.stringify({
    weaponId: store.data.weapon.id,
    // ⚠ 武器级 6 个字段**不再照抄 current**（那是合并过本武器已有 override 的值）——
    //   照抄会让"打开→什么都不改→保存"也把当前覆盖写成武器级，换枪后这些值还会跟着走（D-122）。
    //   这里留空（`null`），只有真正改过的字段才写；「当前生效值」由渲染时读 `effectiveOf()`。
    critChance: null,
    critMultiplier: null,
    statusChance: null,
    fireRate: null,
    magazineSize: null,
    reloadTime: null,
    modes: store.data.weapon.modes.map(function (m) {
      // D-080：段只属于变体；编辑器按变体编辑
      const firstSeg = m.variants[0] && m.variants[0].segments[0];
      return {
        id: m.id,
        role: m.role,
        trigger: m.trigger,
        procChance: firstSeg ? firstSeg.procChance : 0,
        // D-050：模式级面板覆盖（没写就是空，编辑时会按需填）
        override: m.override ? { ...m.override } : undefined,
        variants: m.variants.map(function (v) {
          return {
            id: v.id,
            label: v.label,
            ...(v.override ? { override: { ...v.override } } : {}),
            segments: v.segments.map(function (s) {
              return { kind: s.kind, aoe: s.aoe, damage: { ...s.damage }, procChance: s.procChance };
            }),
          };
        }),
      };
    }),
  }));
  editorWeaponId = store.data.weapon.id;
  editorTitle = { name: store.data.weapon.name, nameZh: store.data.weapon.nameZh };
  // D-122：每次打开都清空上一次的提示（否则换枪后还停着「已保存到 …weapon-overrides.json」）
  const msg = $('#editor-msg');
  if (msg) { msg.textContent = ''; msg.className = 'editor-msg'; }
  $('#editor-overlay').style.display = 'flex';
  renderEditor();
}

/**
 * 换枪后重置编辑器（D-122）。
 *
 * 旧草稿属于上一把武器，留着会因为 `weaponId` 而**写错武器**；
 * 状态栏里的「已保存到 …」也不再成立。所以换枪时：关掉并作废草稿、清空提示。
 */
export function resetEditorForWeaponSwitch() {
  const msg = $('#editor-msg');
  if (msg) { msg.textContent = ''; msg.className = 'editor-msg'; }
  editorDraft = null;
  editorWeaponId = null;
  const ov = $('#editor-overlay');
  if (ov) ov.style.display = 'none';
}

/** 编辑器显示用的「当前生效值」：模式 override → 武器级 → generated 原值 */
function effectiveOf(key) {
  const w = store.data && store.data.weapon;
  return w ? w[key] : undefined;
}

/** 武器级可编辑字段（与 `EDITABLE_WEAPON_FIELDS` 同源） */
const DRAFT_TOP_FIELDS = EDITABLE_WEAPON_FIELDS.map(function (f) { return f[0]; });

/**
 * 只保留**真正改过**的部分，交给服务器（D-122）。
 *
 * ```
 * · 武器级 6 个字段：值为 null / undefined 就不传（打开编辑器后没动过）；
 * · 模式：只有 `override` 非空、或段与当前武器不同时才保留；
 * · 变体：始终带（段的删除/改值都记在变体上）。
 * ```
 */
function compactDraft(draft) {
  const out = { weaponId: draft.weaponId };
  for (const k of DRAFT_TOP_FIELDS) {
    if (draft[k] !== null && draft[k] !== undefined) out[k] = draft[k];
  }
  out.modes = (draft.modes || []).map(function (m) {
    const mode = { id: m.id, role: m.role, trigger: m.trigger, procChance: m.procChance };
    if (m.override && Object.keys(m.override).length) mode.override = m.override;
    mode.variants = (m.variants || []).map(function (v) {
      const variant = { id: v.id, label: v.label };
      if (v.override) variant.override = v.override;
      variant.segments = (v.segments || []).map(function (s) {
        return { kind: s.kind, aoe: s.aoe, damage: s.damage, procChance: s.procChance };
      });
      return variant;
    });
    return mode;
  });
  return out;
}

export function closeEditor() {
  $('#editor-overlay').style.display = 'none';
}

export function renderEditor() {
  const body = $('#editor-body');
  body.innerHTML = '';
  if (!editorDraft) return;

  $('#editor-title').textContent = '编辑：' + (editorTitle.nameZh || editorTitle.name) + '（' + editorTitle.name + '）';

  // ── 每个模式一组：面板数值 + 发射器类型 + 伤害分布（D-050）──
  // 不同模式的面板可能不同（灵化模式、三模式武器），所以面板数值挂在模式上，模式在最上面。
  for (let mi = 0; mi < editorDraft.modes.length; mi++) {
    const mode = editorDraft.modes[mi];
    body.append(el('h3', 'editor-section', '模式：' + mode.id));

    // 面板数值（该模式自己的；未填则回退武器级）
    const grid = el('div', 'editor-grid');
    for (let i = 0; i < EDITABLE_WEAPON_FIELDS.length; i++) {
      const key = EDITABLE_WEAPON_FIELDS[i][0];
      const label = EDITABLE_WEAPON_FIELDS[i][1];
      const kind = EDITABLE_WEAPON_FIELDS[i][2];
      const row = el('label', 'editor-field');
      row.append(el('span', 'editor-label', label));
      const input = el('input', 'editor-input');
      input.type = 'number';
      input.step = '0.01';
      // 当前生效值 = 模式 override ?? 武器级（武器级为空时读当前武器的实际值）
      const draftTop = editorDraft[key];
      const effective = mode.override && mode.override[key] !== undefined
        ? mode.override[key]
        : (draftTop !== null && draftTop !== undefined ? draftTop : effectiveOf(key));
      if (kind === 'ratio') {
        input.value = String(+(effective * 100).toFixed(4));
        input.dataset.percent = '1';
      } else {
        input.value = String(effective);
      }
      input.addEventListener('input', function (e) {
        const raw = Number(e.target.value);
        const v = input.dataset.percent ? raw / 100 : raw;
        if (!Number.isFinite(v)) return;
        // 写进该模式的 override
        mode.override = mode.override || {};
        mode.override[key] = v;
        // 触发几率同时同步到分段（内核读的是段上的 procChance）
        if (key === 'statusChance') {
          mode.procChance = v;
          for (const s of modeSegments(mode)) s.procChance = v;
        }
      });
      row.append(input);
      grid.append(row);
    }
    body.append(grid);

    // 发射器类型：中文名 + 括号特点说明（D-048）。
    // 触发几率**不**在这里重复出现——它属于武器级字段，只在「面板数值」里编辑。
    const metaRow = el('div', 'editor-meta-row');

    const tField = el('label', 'editor-field');
    tField.append(el('span', 'editor-label', '发射器类型'));
    const tSel = el('select');
    for (let i = 0; i < TRIGGER_OPTIONS.length; i++) {
      const key = TRIGGER_OPTIONS[i];
      const o = el('option', '', triggerLabel(key));
      o.value = key;
      tSel.append(o);
    }
    tSel.value = TRIGGER_OPTIONS.indexOf(mode.trigger) >= 0 ? mode.trigger : 'unknown';
    tSel.addEventListener('change', function (e) { mode.trigger = e.target.value; });
    tField.append(tSel);
    metaRow.append(tField);

    body.append(metaRow);

    // 伤害分布（可增删类型）
    body.append(el('div', 'editor-sub', '伤害分布'));
    const dmgWrap = el('div', 'editor-dmg-list');
    renderEditorDamage(mode, dmgWrap, mi);
    body.append(dmgWrap);

    // 「添加伤害类型」放在面板总伤**上面**：
    // 下拉选类型（D-049，不再自动取第一个可用项）+ 添加按钮
    const addRow = el('div', 'editor-add-row');

    const _ms0 = modeSegments(mode)[0];
    const used = new Set(Object.keys(_ms0 ? _ms0.damage : {}));
    const avail = Object.keys(ELEMENT_LABEL).filter(function (t) { return !used.has(t); });

    const addSel = el('select', 'editor-add-select');
    for (let i = 0; i < avail.length; i++) {
      const o = el('option', '', ELEMENT_LABEL[avail[i]]);
      o.value = avail[i];
      addSel.append(o);
    }
    addRow.append(addSel);

    const addBtn = el('button', 'btn-ghost', '+ 添加伤害类型');
    addBtn.type = 'button';
    if (!avail.length) {
      addBtn.disabled = true;
      addSel.disabled = true;
      addSel.append(el('option', '', '（已无可用类型）'));
    }
    (function (m, sel) {
      addBtn.addEventListener('click', function () {
        const t = sel.value;
        if (!t) return;
        const seg = modeSegments(m)[0];
        if (!seg) return;
        seg.damage[t] = 0;
        renderEditor();
      });
    })(mode, addSel);
    addRow.append(addBtn);

    body.append(addRow);

    // 面板总伤（只读，由分布求和）
    const total = el('div', 'editor-total');
    fillEditorTotal(total, mode);
    total.dataset.totalFor = String(mi);
    body.append(total);
  }
}

export function renderEditorDamage(mode, wrap, mi) {
  wrap.innerHTML = '';
  const seg = modeSegments(mode)[0];
  if (!seg) return;
  const types = Object.keys(seg.damage);
  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    const row = el('div', 'editor-dmg-row');
    row.append(el('span', 'editor-dmg-name', ELEMENT_LABEL[t] || t));
    const input = el('input', 'editor-input');
    input.type = 'number';
    input.step = '0.01';
    input.min = '0';
    input.value = String(seg.damage[t]);
    input.addEventListener('input', function (e) {
      const v = Number(e.target.value);
      seg.damage[t] = Number.isFinite(v) && v >= 0 ? v : 0;
      input.value = String(seg.damage[t]);
      // 总伤只读，实时跟着分布变
      const totalBox = $('.editor-total[data-total-for="' + mi + '"]');
      if (totalBox) fillEditorTotal(totalBox, mode);
    });
    row.append(input);
    const del = el('button', 'btn-ghost btn-tiny', '删除');
    del.type = 'button';
    del.addEventListener('click', function () {
      delete seg.damage[t];
      renderEditor();
    });
    row.append(del);
    wrap.append(row);
  }
  if (!types.length) wrap.append(el('div', 'muted', '无伤害类型，请添加'));
}

/** 面板总伤只读显示：恒等于 Σ damage */
export function fillEditorTotal(box, mode) {
  const seg = modeSegments(mode)[0];
  let sum = 0;
  if (seg) {
    for (const v of Object.values(seg.damage)) sum += Number(v) || 0;
  }
  box.innerHTML = '';
  box.append(el('span', 'editor-label', '面板总伤'));
  box.append(el('span', 'editor-total-val', sum.toFixed(2)));
}

/**
 * 保存（D-046 / D-122）
 *
 * ⚠ 只提交**真正改过的东西**：以前把整份草稿原样发出，武器级 6 个字段不论动没动都会写进
 *   `weapon-overrides.json`，换枪后这些值会跟着带到别的武器上。现在：
 *   · 武器级字段：只在编辑器里改过才有值（`openEditor` 里留 null），没改就整条不传；
 *   · 模式 / 变体：只有该模式带 `override` 或段与 generated 不同才保留。
 */
export async function saveEditor() {
  const msg = $('#editor-msg');
  msg.textContent = '保存中…';
  msg.className = 'editor-msg';
  // 换枪后草稿已经作废（D-122）——不能再拿上一把枪的草稿去写文件
  if (!editorDraft || (store.data && store.data.weapon && editorDraft.weaponId !== store.data.weapon.id)) {
    msg.textContent = '保存失败：武器已切换，请重新打开编辑器';
    msg.className = 'editor-msg neg';
    return;
  }
  // D-050：触发几率挂在模式的 override 上；保存前仍要同步到分段的 procChance，
  // 否则内核读段上的旧值。
  for (const m of editorDraft.modes || []) {
    const sc = m.override && m.override.statusChance;
    if (Number.isFinite(sc)) {
      m.procChance = sc;
      for (const s of modeSegments(m)) s.procChance = sc;
    }
  }
  try {
    const r = await fetch('/__save-weapon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(compactDraft(editorDraft)),
    });
    const j = await r.json();
    if (!j.ok) {
      msg.textContent = '保存失败：' + (j.errors || []).join('；');
      msg.className = 'editor-msg neg';
      return;
    }
    msg.textContent = '已保存到 ' + j.path;
    msg.className = 'editor-msg pos';
    // D-046：保存后立即重新合并并重渲染，不需要刷新页面
    await reloadWeaponOverrides(true);
    deps.flash('已保存并生效');
  } catch (err) {
    msg.textContent = '保存失败：' + String(err);
    msg.className = 'editor-msg neg';
  }
}

/**
 * overrides 合并（D-046）
 *
 * 优先级：generated < manual/weapon-overrides.json
 * 规则（实现见 ./weapon-override.js，页面与纯逻辑测试共用同一份）：
 *   · 武器级 6 个数值字段 → 标量覆盖
 *   · 模式按 **id** 匹配（不按下标），匹配不到则忽略并警告
 *   · 分段按下标覆盖 damage / procChance
 *   · damage **整体替换**（因为编辑器允许删除某个伤害类型）
 *   · 未出现在 override 里的字段保留 generated 原值
 */

/** 读取 overrides 并应用到当前武器，然后重渲染 */
export async function reloadWeaponOverrides(applyToWeapon) {
  try {
    const r = await fetch('/__weapon-overrides');
    if (!r.ok) return;
    const all = await r.json();
    store.data.overrides = all || {};
    if (applyToWeapon) {
      // 每次都从「generated 的深拷贝」出发再合并，保证不会叠加
      const fresh = JSON.parse(JSON.stringify(store.data.baseWeapon));
      store.data.weapon = mergeWeaponOverride(fresh, store.data.overrides[store.data.baseWeapon.id]);
      // 玄骸系判定也可能随 name/variant 变化，重新算一次
      store.data.isKuva = isKuvaFamily(store.data.weapon.id, store.data.weapon.variantType, store.data.weapon.name);
      deps.renderAll();
    }
    renderModifiedBadge();
  } catch {
    /* 静态部署下没有这个接口，忽略 */
  }
}

export function renderModifiedBadge() {
  const badge = $('#modified-badge');
  if (!badge) return;
  const has = Boolean(store.data.overrides && store.data.overrides[store.data.weapon.id]);
  badge.style.display = has ? '' : 'none';
}

export function wireEditor() {
  const openBtn = $('#open-editor');
  if (openBtn) openBtn.addEventListener('click', openEditor);
  const closeBtn = $('#editor-close');
  if (closeBtn) closeBtn.addEventListener('click', closeEditor);
  const saveBtn = $('#editor-save');
  if (saveBtn) saveBtn.addEventListener('click', saveEditor);
  const resetBtn = $('#editor-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      editorDraft = null;
      closeEditor();
      deps.flash('已放弃本次编辑');
    });
  }
  // 点遮罩关闭
  const overlay = $('#editor-overlay');
  if (overlay) {
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeEditor();
    });
  }
}
