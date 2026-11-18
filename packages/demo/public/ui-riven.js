/**
 * 裂罅（紫卡）编辑器与列表。
 *
 * 这一块自成一体：上方选组合、左边拼词条、右边选待选词条，整张裂罅是一个实体。
 * 与其它 UI 模块一样**只负责画与绑事件**；数值与换算在 `app-riven.js` / 内核。
 *
 * 与外壳的关系是**注入**而不是互相 import：
 * 重新渲染由外壳通过 `wireRivenRerender()` 传进来，避免 `app.js ⇄ 本模块` 成环。
 */
import { store } from './app-store.js';
import { $, el, flash, fmtGain } from './ui-dom.js';
import {
  formatRivenRange, formatRivenValue, isRivenInstalled, rivenComboNow, rivenDefOf,
  rivenFilledCount, rivenRawRange, rivenScopeOf, rivenSliderScale,
  rivenSlotKind, rivenTableNow, rivenValueFor, setRivenCombo, setRivenEntry, setRivenEntryValue,
  placeRivenEntry,
} from './app-riven.js';
import { RIVEN_COMBOS, RIVEN_SCOPE_LABEL, rivenDisplayUnit } from '../../data/src/manual/riven.ts';
import { rivenCandidateGain, rivenEntryGain, rivenGain } from './app-compute.js';

/** 外壳注入的「重新渲染」回调 */
let _rerender = () => {};
/** 外壳注入的拖拽辅助（定义在 app.js，注入进来避免成环） */
let _makeDraggable = () => {};
/** 外壳注入的「模拟装上一张卡」 */
let _simulateEquip = () => null;

/**
 * 由外壳在启动时调用：把需要的能力注进来。
 * 用注入而不是 `import`，是因为外壳本身要 `import` 本模块，互相引用会成环。
 */
export function wireRivenDeps(deps) {
  if (deps.rerender) _rerender = deps.rerender;
  if (deps.makeDraggable) _makeDraggable = deps.makeDraggable;
  if (deps.simulateEquip) _simulateEquip = deps.simulateEquip;
}

/** 由外壳在启动时调用，把 renderAll 注进来 */

// ─────────────────────────────────────────────────────────────
// 裂罅 Mod 区（D-162，需求方 2026-11-12）
//
// 放在「备选 Mod」上方、可折叠：上方切四种组合，左边拼这张裂罅的词条，
// 右边是待选词条（按当前 min/平均/max 口径算出的数值区间 + 单条收益）。
// 整张裂罅是**一个实体**：装进槽位后这里继续编辑，两边同步。
// ─────────────────────────────────────────────────────────────

/** 组合按钮（上方一排单选） */
function renderRivenCombos() {
  const box = $('#riven-combo');
  if (!box) return;
  box.innerHTML = '';
  box.className = 'filter-group';
  const cur = store.riven ? store.riven.combo : '2pos';
  for (const c of RIVEN_COMBOS) {
    const btn = el('button', 'filter-btn' + (cur === c.id ? ' active' : ''), c.label);
    btn.type = 'button';
    btn.title = c.pos + ' 条正面' + (c.neg ? ' + 1 条负面' : '，无负面');
    btn.addEventListener('click', function () {
      setRivenCombo(c.id);
      _rerender();
    });
    box.append(btn);
  }
}

/**
 * 属性基准（最低 / 平均 / 最高）。
 *
 * ⚠ **只影响右栏待选区**（需求方 2026-11-12）：
 *   切换它**不会**改动已经选进裂罅的词条数值——那是用户调好的实际数值，
 *   切换基准只是换个视角看待选区里还没选的那些词条。
 *   已选词条的数值只能通过它自己的滑杆 / 输入框改。
 */
function renderRivenValueModes() {
  const box = $('#riven-value-mode');
  if (!box) return;
  box.innerHTML = '';
  box.className = 'filter-group';
  const cur = store.ui.rivenValueMode;
  for (const [id, label] of [['min', '最低'], ['avg', '平均'], ['max', '最高']]) {
    const btn = el('button', 'filter-btn' + (cur === id ? ' active' : ''), label);
    btn.type = 'button';
    btn.addEventListener('click', function () {
      store.ui.rivenValueMode = id;
      // 只重画右栏待选区（含排序与增幅），**不动**已选词条的数值
      const table = rivenTableNow();
      if (table) {
        renderRivenValueModes();
        renderRivenCandidates(table);
      }
    });
    box.append(btn);
  }
}

/**
 * 裂罅数值输入框里填的数：始终是**幅度**（百分比口径），派系保留两位小数（便于拖出 0.01）。
 *
 * 显示成什么单位由旁边的「范围」文字与卡面决定，见 `formatRivenValue`。
 */
function fmtRivenInput(isFaction, amplitude) {
  return isFaction ? amplitude.toFixed(2) : amplitude.toFixed(1);
}

/**
 * 左栏：这张裂罅的词条槽。
 *
 * 正面槽在前（2 或 3 个），有负面时最后多一个负面槽。
 * 每个槽：词条下拉 + 数值滑杆 + 数字输入 + 取值范围 + 这一条的收益。
 *
 * 最上面还有一张**整张裂罅的预览卡**：显示这张裂罅的增幅、已装状态，并且可以拖到 Mod 槽装备
 * （需求方：装上去以后下方这张就不允许再拖上去了；界面文案统一用「增幅」，不用「整卡 / 本条」）。
 */
function renderRivenCompose(table) {
  const box = $('#riven-compose');
  if (!box) return;
  box.innerHTML = '';
  const combo = rivenComboNow();
  const slots = combo.pos + combo.neg;

  // ── 整张裂罅的预览卡 ──
  {
    const installed = isRivenInstalled();
    const card = el('div', 'riven-slot' + (installed ? ' installed' : ''));
    const head = el('div', 'riven-slot-head');
    head.append(el('span', 'riven-slot-tag', '裂罅'));
    head.append(el('span', 'riven-rarity', combo.label + ' · ' + rivenFilledCount() + '/' + slots + ' 条'));
    card.append(head);
    const g = rivenGain();
    if (g !== null) {
      const info = el('div', 'riven-slot-row');
      info.append(el('span', 'riven-stat-gain ' + (g >= 0 ? 'pos' : 'neg'), '增幅 ' + fmtGain(g)));
      // N 秒总伤下，裂罅卡上的增幅同样是加权拼出来的（D-175）
      if (isTotalLikeMetric()) info.append(el('span', 'gain-to-dot', 'to total'));
      card.append(info);
    }
    // 已经装进槽位时，这张不能再拖（同一个实体）；没装时可以拖到 Mod 槽
    if (!installed && rivenFilledCount() > 0) {
      _makeDraggable(card, { kind: 'riven', from: 'riven' });
      card.classList.add('draggable');
    }
    box.append(card);
  }

  for (let i = 0; i < slots; i++) {
    const kind = i < combo.pos ? 'pos' : 'neg';
    const cur = store.riven && store.riven.entries[i] ? store.riven.entries[i] : null;
    const def = cur && cur.key ? rivenDefOf(table, cur.key) : null;

    const card = el('div', 'riven-slot ' + kind + (def ? '' : ' empty'));
    const head = el('div', 'riven-slot-head');
    head.append(el('span', 'riven-slot-tag', kind === 'pos' ? '+' + (i + 1) : '−'));
    // 槽 1 的名称只做展示，**不再提供下拉选择**（需求方 2026-11-12：
    // 「从下拉框选的裂罅词条只能选择最大最小值，干脆去掉这个选择方式算了，只能拖拽」）。
    // 词条只能从右侧待选区拖进来。
    head.append(el('span', 'riven-slot-name', def ? def.label : '（未选）'));
    card.append(head);
    // ⚠ 拖拽手柄只挂在**这一行**：整张卡片可拖会让滑杆 / 输入框拖不动
    //   （需求方：「词条拖拽优于横杆拖拽了，导致很难调整。换一下」）。
    bindRivenSlotDrag(card, i, def, kind, head);

    if (def) {
      const row = el('div', 'riven-slot-row');
      // 滑杆 / 输入框一律按**这条词条的幅度**取值（正面为正、负面按幅度存正数）。
      // 显示成什么（派系倍率 / 米 / 秒 / 百分比）只由 `formatRivenValue` 决定。
      //
      // ⚠ 以前派系在界面里被换算成 1.xx 再塞进滑杆，而滑杆范围是拿倍数算的，
      //   两端对不上 → 拖动条拖不动、范围与数值不符（需求方 2026-11-14）。
      const unit = rivenDisplayUnit(def);
      const rawRange = rivenRawRange(def, kind);
      const isFaction = unit === 'faction';
      const step = isFaction ? 0.01 : 0.1;
      const curAmp = Math.min(rawRange.max, Math.max(rawRange.min, rivenValueFor(def, kind, cur.value)));
      // 滑杆认的是「显示口径」：派系要显示成倍率（0.64 ~ 0.55），其余就是幅度本身。
      // 存进状态的永远是幅度（`scale.toAmp` 换回来）。见 `app-riven.js` 的 `rivenSliderScale`。
      const scale = rivenSliderScale(def, kind);
      const minS = Math.min(scale.toSlider(rawRange.min), scale.toSlider(rawRange.max));
      const maxS = Math.max(scale.toSlider(rawRange.min), scale.toSlider(rawRange.max));
      const curS = Math.min(maxS, Math.max(minS, scale.toSlider(curAmp)));

      const range = el('input');
      range.type = 'range';
      range.min = String(minS);
      range.max = String(maxS);
      range.step = String(step);
      range.value = String(curS);

      const num = el('input');
      num.type = 'number';
      num.step = String(step);
      num.min = '0';
      num.value = fmtRivenInput(isFaction, curS);

      // ⚠ 拖动过程中**不重绘**：重绘会把正在拖的滑杆节点换掉，导致拖不动。
      //   `input`（拖动中）只把数写进状态、并同步旁边的数字框；
      //   `change`（松开鼠标）才整页重算。
      (function (index, slider, numBox, isFac, sc) {
        slider.addEventListener('input', function (e) {
          const v = Number(e.target.value);
          setRivenEntryValue(index, sc.toAmp(v));
          numBox.value = fmtRivenInput(isFac, v);
        });
        slider.addEventListener('change', function () { _rerender(); });
      })(i, range, num, isFaction, scale);
      row.append(range);

      // 输入框：回车 / 失焦（change）才重算，避免每敲一个字都重绘
      (function (index, sc) {
        num.addEventListener('change', function (e) {
          const v = Number(e.target.value);
          if (!Number.isFinite(v)) return;
          setRivenEntryValue(index, sc.toAmp(v));
          _rerender();
        });
      })(i, scale);
      row.append(num);
      card.append(row);

      const info = el('div', 'riven-slot-row');
      info.append(el('span', 'riven-range', '范围 ' + formatRivenRange(def, kind)));
      // 单条增幅：把这一条的实际值单独当作一张卡的贡献去比较
      const g = rivenEntryGain(i);
      if (g !== null) {
        info.append(el('span', 'riven-stat-gain ' + (g >= 0 ? 'pos' : 'neg'), '增幅 ' + fmtGain(g)));
        // N 秒总伤下是「续航 / 异常」加权拼出来的（D-175）
        if (isTotalLikeMetric()) info.append(el('span', 'gain-to-dot', 'to total'));
      }
      card.append(info);
    } else {
      card.append(el('div', 'riven-slot-hint', '从右侧选取词条'));
    }
    box.append(card);
  }
}

/**
 * 给左栏**一个词条槽**加上拖拽 / 放置能力（与 Mod 槽同一套交互）。
 *
 * ⚠ **拖拽手柄是槽顶那一行**（`head`），不是整张卡片：
 *   整卡可拖会把滑杆 / 输入框的鼠标操作一起吞掉，导致滑杆拖不动
 *   （需求方：「词条拖拽优于横杆拖拽了，导致很难调整。换一下」）。
 *   放置目标（`drop`）仍然挂整张卡片，拖到卡片哪个位置都能放。
 *
 * | 操作 | 结果 |
 * |---|---|
 * | 从右栏待选区拖一条词条进来 | 放进这个槽；槽里原有的词条退回待选区 |
 * | 从别的词条槽拖进来 | 两个词条**互换位置** |
 * | 从槽顶那一行把词条拖出到右栏 / 拖出裂罅区 | 卸下（回到待选区） |
 * | 拖到不放（被拒） | 不动 |
 */
function bindRivenSlotDrag(card, index, def, kind, head) {
  // ── 拖出源：只有装了词条的槽才能拖，手柄是顶部那一行 ──
  const handle = head || card;
  if (def) {
    _makeDraggable(handle, { kind: 'rivenEntry', index: index, from: 'riven-slot' });
    handle.classList.add('draggable');
  }

  // ── 放置目标：整张卡片 ──
  card.addEventListener('dragover', function (e) {
    const p = store.dragPayload;
    if (!rivenSlotAccepts(p, kind)) {
      card.classList.remove('drop-target');
      return;
    }
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    card.classList.add('drop-target');
  });
  card.addEventListener('dragleave', function () { card.classList.remove('drop-target'); });
  card.addEventListener('drop', function (e) {
    const p = store.dragPayload;
    if (!rivenSlotAccepts(p, kind)) return;
    e.preventDefault();
    card.classList.remove('drop-target');
    dropHappened = true; // 成功放进裂罅，dragend 时不要当成「拖出去卸下」
    if (p.kind === 'rivenEntry') {
      placeRivenEntry(index, rivenEntryKeyAt(p.index), p.index);
    } else if (p.kind === 'rivenStat') {
      placeRivenEntry(index, p.key);
    }
    store.dragPayload = null;
    _rerender();
  });
}

/** 某个词条槽当前的词条 key（没有返回空串） */
function rivenEntryKeyAt(index) {
  const e = store.riven && store.riven.entries[index];
  return e && e.key ? e.key : '';
}

/** 这个词条槽能不能接受这次拖拽 */
function rivenSlotAccepts(payload, kind) {
  if (!payload) return false;
  if (payload.kind === 'rivenStat') return payload.statKind === kind;
  if (payload.kind === 'rivenEntry') {
    // 词条槽之间互换：正负必须同类
    return rivenSlotKind(payload.index) === kind;
  }
  return false;
}

/**
 * 右栏：待选词条（当前组合、当前属性基准下的数值 + 增幅）。
 *
 * 交互与 Mod 备选区一致：**拖拽**。
 *   · 拖到左栏某个词条槽 = 放进那个槽（槽里原有的词条退回待选区）；
 *   · 拖到左栏空白处 = 放进第一个同类空槽。
 * 已经选进左栏的词条仍然显示（灰掉），但它就是「已装备」，不能再拖。
 * 同时保留点击作为「放进第一个同类空槽」的快捷方式。
 */
export function renderRivenCandidates(table) {
  const box = $('#riven-candidates');
  if (!box) return;
  box.innerHTML = '';
  const combo = rivenComboNow();
  const used = new Set();
  if (store.riven) for (const e of store.riven.entries) if (e && e.key) used.add(e.key);
  const raw = (store.ui.rivenSearch || '').trim().toLowerCase();
  // 「-」/「−」开头 = 只搜负面词条（需求方 2026-11-13：输入 - 搜不到负面）
  const negOnly = /^[-−]/.test(raw);
  const q = negOnly ? raw.slice(1).trim() : raw;

  const rows = [];
  // 正面、负面各列一遍（负面只在有负面槽时出现）
  const pools = [{ kind: 'pos', list: table.positive }];
  if (combo.neg) pools.push({ kind: 'neg', list: table.negative });

  for (const p of pools) {
    if (negOnly && p.kind !== 'neg') continue;
    for (const d of p.list) {
      // ⚠ 裂罅词条表里元素 / 物理行的 labelEn 可能缺失（模板里只写了中文），
      //   以前直接 .toLowerCase() 会抛错让整个搜索失效 —— 这里容错成空串。
      const zh = String(d.label || '').toLowerCase();
      const en = String(d.labelEn || '').toLowerCase();
      if (q && zh.indexOf(q) < 0 && en.indexOf(q) < 0) continue;
      rows.push({ kind: p.kind, def: d });
    }
  }

  if (!rows.length) {
    box.append(el('div', 'riven-empty', '没有匹配的词条'));
    return;
  }

  // 排序前的准备：增幅只算一次（要跑计算，别在比较函数里反复调用）
  const sort = store.ui.rivenSort || 'default';
  for (const row of rows) {
    row.gain = rivenCandidateGain(row.def, row.kind);
    row.value = rivenValueFor(row.def, row.kind);
  }
  sortRivenRows(rows, sort);

  for (const row of rows) {
    const isUsed = used.has(row.def.key);
    const node = el('div', 'riven-row' + (isUsed ? ' used' : ''));
    node.append(el('span', 'riven-row-name', (row.kind === 'neg' ? '− ' : '') + row.def.label));
    // 数值列显示**当前属性基准**（最低/平均/最高）下的值，悬停时给出完整范围
    const shown = formatRivenValue(row.def, row.kind, row.value);
    const valEl = el('span', 'riven-row-val', shown);
    valEl.title = '范围 ' + formatRivenRange(row.def, row.kind);
    node.append(valEl);
    // 已选中的词条：`rivenCandidateGain` 内部会直接返回左栏那一条的增幅（D-173），
    // 两处永远是同一个数
    const gainCell = el('span', 'riven-row-gain ' + (row.gain === null ? '' : !Number.isFinite(row.gain) ? 'pos' : row.gain >= 0 ? 'pos' : 'neg'),
      row.gain === null ? '—' : fmtGain(row.gain));
    // N 秒总伤下，待选区这些数也是加权拼出来的（D-175）
    if (isTotalLikeMetric() && row.gain !== null) gainCell.title = 'to total';
    node.append(gainCell);

    if (!isUsed) {
      // 拖拽载荷：kind 'rivenStat'，带词条 key 与它属于正面还是负面
      _makeDraggable(node, { kind: 'rivenStat', key: row.def.key, statKind: row.kind, from: 'riven-list' });
      node.classList.add('draggable');
      (function (def, kind) {
        node.addEventListener('click', function () {
          if (store.dragPayload && store.dragPayload.kind === 'rivenStat') return; // 拖拽刚结束，不算点击
          const target = rivenFirstFreeSlot(kind);
          if (target < 0) {
            flash((kind === 'pos' ? '正面' : '负面') + '词条已经选满');
            return;
          }
          setRivenEntry(target, def.key);
          _rerender();
        });
      })(row.def, row.kind);
    }
    box.append(node);
  }
}

/** 第一个同类空槽位下标（正面只看正面槽，负面只看负面槽）；没有返回 -1 */
export function rivenFirstFreeSlot(kind) {
  const combo = rivenComboNow();
  const slots = combo.pos + combo.neg;
  for (let i = 0; i < slots; i++) {
    const isThisKind = i < combo.pos ? kind === 'pos' : kind === 'neg';
    if (!isThisKind) continue;
    const e = store.riven && store.riven.entries[i];
    if (!e || !e.key) return i;
  }
  return -1;
}

/**
 * 待选词条的排序方式（D-168，需求方 2026-11-12）。
 *
 * 需求方：「属性基准筛选那边加上可以按收益排序、默认排序。或者还有什么排序你帮我想一下。」
 * 后续：「数值 和 最高值这两个排序没用，去掉。」
 *
 * | 值 | 名称 | 用途 |
 * |---|---|---|
 * | `default` | 默认 | 词条表原顺序（普通 → 物理 → 元素 → 派系），最稳定 |
 * | `gain`    | 增幅 | **最常用**：这条装进去涨得最多 |
 * | `gainAsc` | 增幅↑ | 反过来看：哪些词条增幅最低甚至为负 |
 * | `name`    | 名称 | 按中文名排，知道名字时直接找 |
 */
const RIVEN_SORT_OPTIONS = [
  ['default', '默认'],
  ['gain', '增幅'],
  ['gainAsc', '增幅↑'],
  ['negFirst', '负面优先'],
  ['name', '名称'],
];

/** 按指定方式排序（原地） */
function sortRivenRows(rows, sort) {
  const byName = function (a, b) { return a.def.label.localeCompare(b.def.label, 'zh-CN'); };
  // 增幅为 null（算不出来，例如当前指标为 0）的一律排最后，不参与比较
  const num = function (v) { return v === null || v === undefined || !Number.isFinite(v) ? -Infinity : v; };
  switch (sort) {
    case 'gain':
      rows.sort(function (a, b) { return num(b.gain) - num(a.gain) || byName(a, b); });
      break;
    case 'gainAsc':
      rows.sort(function (a, b) { return num(a.gain) - num(b.gain) || byName(a, b); });
      break;
    case 'negFirst':
      // 负面优先（需求方 2026-11-13）：先列全部负面词条，负面内部按增幅从高到低，正面跟在后面
      rows.sort(function (a, b) {
        const ra = a.kind === 'neg' ? 0 : 1;
        const rb = b.kind === 'neg' ? 0 : 1;
        if (ra !== rb) return ra - rb;
        return num(b.gain) - num(a.gain) || byName(a, b);
      });
      break;
    case 'name':
      rows.sort(byName);
      break;
    default:
      // 默认：保持词条表原顺序（rows 的构造顺序）
      break;
  }
}

/** 排序按钮组（单选，当前项高亮） */
function renderRivenSortButtons() {
  const box = $('#riven-sort');
  if (!box) return;
  box.innerHTML = '';
  box.className = 'filter-group';
  const cur = store.ui.rivenSort || 'default';
  for (const [id, label] of RIVEN_SORT_OPTIONS) {
    const btn = el('button', 'filter-btn' + (cur === id ? ' active' : ''), label);
    btn.type = 'button';
    btn.addEventListener('click', function () {
      store.ui.rivenSort = id;
      const table = rivenTableNow();
      if (table) {
        renderRivenSortButtons();
        renderRivenCandidates(table);
      }
    });
    box.append(btn);
  }
}

/** 裂罅区顶部的摘要（收起时也能看到"现在是什么组合、几条词条"） */
function renderRivenSummary() {
  const box = $('#riven-summary');
  if (!box) return;
  const scope = rivenScopeOf();
  const table = rivenTableNow();
  const scopeLabel = scope ? RIVEN_SCOPE_LABEL[scope] : '—';
  if (!table) {
    box.textContent = '（' + scopeLabel + ' · 该类裂罅数据待补）';
    return;
  }
  if (!store.riven) {
    box.textContent = '（' + scopeLabel + ' · 未创建）';
    return;
  }
  const combo = rivenComboNow();
  const filled = rivenFilledCount();
  const total = combo.pos + combo.neg;
  box.textContent = '（' + scopeLabel + ' · ' + combo.label + ' · ' + filled + '/' + total + ' 条' + (isRivenInstalled() ? ' · 已装备' : '') + '）';
}

/** 裂罅区整块 */
export function renderRiven() {
  const area = $('#riven-area');
  if (!area) return;
  const table = rivenTableNow();
  const body = $('#riven-body');
  const toggle = $('#riven-toggle');
  if (!body) return;

  renderRivenSummary();
  if (toggle) toggle.classList.toggle('open', Boolean(store.ui.rivenOpen));
  body.hidden = !store.ui.rivenOpen;
  // 折叠提示随状态切换：收起时「点击展开」，展开时「点击折叠」
  const hint = $('#riven-hint');
  if (hint) hint.textContent = store.ui.rivenOpen ? '点击折叠' : '点击展开';

  // 这类武器没有裂罅数据（目前只有步枪有）：展开也只看得到一句提示
  if (!table) {
    if (store.ui.rivenOpen) {
      for (const sel of ['#riven-compose', '#riven-candidates', '#riven-combo', '#riven-value-mode']) {
        const b = $(sel);
        if (b) b.innerHTML = '';
      }
      const box = $('#riven-compose');
      if (box) box.append(el('div', 'riven-slot-hint', '该武器类型的裂罅数据还没整理，暂时不能配裂罅。'));
    }
    return;
  }

  if (!store.ui.rivenOpen) return;
  renderRivenCombos();
  renderRivenValueModes();
  renderRivenSortButtons();
  renderRivenCompose(table);
  renderRivenCandidates(table);
  const searchBox = $('#riven-search');
  if (searchBox && document.activeElement !== searchBox) searchBox.value = store.ui.rivenSearch;
}

// ─────────────────────────────────────────────────────────────
// 拆解
// ─────────────────────────────────────────────────────────────

/**
 * 拆解（D-038 / D-125）：展示当前选中的那只**装备**（Mod 或赋能）装上后的影响。
 *
 * 需求方 2026-11-06：「拆解也对赋能生效」——以前只有备选 Mod 有拆解，
 * 赋能点不动。现在两者共用这一份：
 *   · Mod：沿用「装到空位 / 换掉收益最差那张」的模拟（`simulateEquip`）；
 *   · 赋能：在贡献列表上追加它的贡献（与 `arcanePreviewGain` 同一口径），
 *     并且**不比整体指标** —— 逐口径列出，看得见"这个赋能到底改了哪些数"。
 * 结束时恢复 overrides 文件。
 */