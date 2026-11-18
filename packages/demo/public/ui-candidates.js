/**
 * 备选 Mod 区：筛选按钮、候选卡、增幅显示。
 *
 * 每张候选卡的「增幅」由 `app-compute` 算（统一入口 `gainOfPair`），
 * 这里只负责把它画出来并排序。
 *
 * 外壳依赖通过 `wireCandidatesDeps()` 注入。
 */
import { store } from './app-store.js';
import { SLOT_COUNT } from './app-store.js';
import { $, el, fmtGain } from './ui-dom.js';
import { isExilusMod, isModAllowedOnWeapon, modName } from './app-data.js';
import { modStackFactor, modToContributions } from '../../data/src/adapter.ts';
import {
  coModGain, currentContributions, dotGainForCandidate, INFINITE_GAIN, isDotMetric, isPerStackMetric,
  isTotalLikeMetric, metricValueOf, runCompute, trialSlotNow,
} from './app-compute.js';
import { modLockNotes, modStatText, setNoteOf, statLabel } from './ui-labels.js';
import { makeDraggable, makeDropTarget } from './ui-slots.js';
import { selectDetail } from './ui-detail.js';

/** 外壳注入 */
function _simulateEquip(...args) { return injected.simulateEquip(...args); }

function _swapWithCandidateCard(...args) { return injected.swapWithCandidateCard(...args); }

const injected = {
  candidateWindowGain: () => null,
  insertAt: () => null,
  isDotWindowMetric: () => null,
  isDotWindowMetricDetailRoleIsSplit: () => null,
  renderAll: () => null,
  simulateEquip: () => null,
  swapWithCandidateCard: () => null,
};

export function wireCandidatesDeps(deps) {
  const missing = Object.keys(injected).filter((k) => typeof deps[k] !== 'function');
  if (missing.length) console.error('[ui-candidates] 缺少注入：' + missing.join(', '));
for (const k of Object.keys(injected)) {
    if (typeof deps[k] === 'function') injected[k] = deps[k];
  }
}

function _candidateWindowGain(...args) { return injected.candidateWindowGain(...args); }
function _insertAt(...args) { return injected.insertAt(...args); }
function _isDotWindowMetric(...args) { return injected.isDotWindowMetric(...args); }
function _isDotWindowMetricDetailRoleIsSplit(...args) { return injected.isDotWindowMetricDetailRoleIsSplit(...args); }
function _renderAll(...args) { return injected.renderAll(...args); }

const FILTER_OPTIONS = [
  ['all', '全部'],
  ['damage', '伤害'],
  ['multishot', '多重'],
  ['crit', '暴击'],
  ['element', '元素'],
  ['physical', '物理'],
  ['fireRate', '射速'],
  ['status', '触发'],
  ['exilus', '劣化'],
  ['other', '其他'],
];
/**
 * Mod 归类（用于筛选）。
 *
 * ⚠ 「触发」类必须包含**带触发几率词条的元素卡**（如 火/毒 Mod 常带 `+触发几率`），
 *   之前只看 `statusChance` 一条，导致 高触发率元素卡 被归到「元素」而漏在「触发」里。
 * 归类优先级：伤害 > 多重 > 暴击 > 元素 > 射速 > 触发 > 其他。
 */
export function filterKeysOf(mod) {
  const keys = new Set();
  for (let i = 0; i < mod.stats.length; i++) {
    const s = mod.stats[i];
    const stat = s.stat;
    if (stat === 'baseDamage' || s.key === 'co') keys.add('damage');
    else if (stat === 'multishot') keys.add('multishot');
    // 弱点暴击率（敏锐主武 / 敏锐手枪）：开爆头时并进暴击率乘区，所以算「暴击」类
    // 依据：核心事实 §3.2（弱点暴击率与普通暴击率同一个乘区）
    else if (stat === 'critChance' || stat === 'critMultiplier' || stat === 'weakpointCritChance') keys.add('crit');
    else if (stat.indexOf('elemental:') === 0) keys.add('element');
    else if (stat.indexOf('physical:') === 0) keys.add('physical');
    else if (stat === 'fireRate') keys.add('fireRate');
    else if (stat === 'statusChance' || stat === 'statusDamage' || stat === 'statusDuration') keys.add('status');
    else keys.add('other');
  }
  // 「劣化」单独一栏：当前被判为功能类（可进劣化槽）的卡，
  // 便于核对"有没有影响伤害的卡被误判成功能类"（D-040）
  if (isExilusMod(mod)) keys.add('exilus');
  return keys;
}

/** 一张卡归到哪个筛选类（取优先级最高的那一类） */
export function filterKeyOf(mod) {
  const keys = filterKeysOf(mod);
  const rank = {
    damage: 0, multishot: 1, crit: 2, element: 3, physical: 4,
    fireRate: 5, status: 6, exilus: 7, other: 8,
  };
  let best = 'other';
  for (const k of keys) if (rank[k] < rank[best]) best = k;
  return best;
}

/** 当前筛选是否命中这张卡 */
export function matchesFilter(mod, filter) {
  if (filter === 'all') return true;
  // 「劣化」栏：只看"能否进劣化槽"，与主归类无关
  if (filter === 'exilus') return isExilusMod(mod);

  const base = filterKeyOf(mod);
  if (base === filter) return true;
  // 「触发」这一栏额外收「带触发词条的卡」（不论主归类）
  if (filter === 'status' && filterKeysOf(mod).has('status')) return true;
  return false;
}

/** 筛选按钮组：单选语义，当前项高亮 */
export function renderFilterButtons() {
  const box = $('#candidate-filter');
  box.innerHTML = '';
  for (let i = 0; i < FILTER_OPTIONS.length; i++) {
    const id = FILTER_OPTIONS[i][0];
    const btn = el('button', 'filter-btn' + (store.ui.filter === id ? ' active' : ''), FILTER_OPTIONS[i][1]);
    btn.type = 'button';
    btn.addEventListener('click', function () {
      store.ui.filter = id;
      _renderAll();
    });
    box.append(btn);
  }
}

/**
 * 「拖到备选区的**某张卡**上」= 与该卡互换（D-115）。
 *
 * 整块备选区才是「拖回来卸下」（D-040）；落在某张卡上时卡片会拦下 drop，这里处理：
 *
 * | 从哪拖来                 | 目标卡    | 结果                                             |
 * |--------------------------|-----------|--------------------------------------------------|
 * | 槽位里的 Mod             | 备选 Mod  | 两张互换：目标卡进源槽，槽里那张回备选区         |
 * | 其它槽位里的 Mod         | 备选 Mod  | 同上（源槽腾空）                                 |
 * | 赋能槽里的赋能           | 备选赋能  | 两个赋能互换                                     |
 * | 从备选区拖来 / 类型不符  | 备选卡    | 不接受 → 交给 `#candidate-list` 的 drop = 卸下   |
 *
 * 目标卡是什么类型只看**卡自己**（`p.kind`），不看它在备选区的哪一栏，避免选单筛选后错配。
 */
export function candidateCardAccepts(targetPayload) {
  const p = store.dragPayload;
  if (!p || !targetPayload) return false;
  if (p.kind !== targetPayload.kind) return false;
  if (p.from === 'list') return false;
  if (p.kind === 'mod') {
    // 劣化槽 ↔ 备选**功能类** Mod：直接互换（顺手修掉"旧卡被静默顶掉"）
    if (p.from === 'exilus') return Boolean(targetPayload.exilus);
    // 普通槽 ↔ 普通备选 Mod：互换（功能 Mod 不能进普通槽）
    if (p.from === 'slot') return !targetPayload.exilus;
    return false;
  }
  if (p.kind === 'arcane') {
    // D-134：只允许换到**同一大类**的赋能卡上（近战赋能不能换到主要赋能槽里）
    return p.from === 'arcane' && (!p.category || !targetPayload.category || p.category === targetPayload.category);
  }
  return false;
}

export function candidateCard(row) {
  const mod = row.mod;
  const card = el('div', 'cand');
  const payload = { kind: 'mod', id: mod.id, exilus: row.exilus, from: 'list' };
  makeDraggable(card, payload);
  // D-115：把已装备的卡拖到**这张备选卡**上 = 互换（槽里那张回到备选区）。
  makeDropTarget(card, function () { return candidateCardAccepts(payload); }, function () { _swapWithCandidateCard(payload); });
  // 卡片自己拦下 drop，否则会冒泡到 #candidate-list 被当成"拖回备选区 = 卸下"
  card.addEventListener('drop', function (e) { e.stopPropagation(); });

  const top = el('div', 'cand-top');
  top.append(el('span', 'cand-name', modName(mod)));
  // 需求方 2026-11-13：「劣化 mod 有单独的 tag」——可进劣化槽的卡单独标出来
  if (mod.exilus === true) top.append(el('span', 'tag', '劣化'));
  card.append(top);

  const statText = [];
  for (let i = 0; i < mod.stats.length; i++) {
    const s = mod.stats[i];
    // 卡面只显示**会影响结算**的属性：判据是内核键 `contribStat`（不是 `bucket`）。
    // 状态持续（statusDuration）不属于任何伤害乘区（bucket 为 null），但它影响
    // DoT 的存活时长，必须显示——以前按 bucket 判会把它当成「无伤害加成」。
    // 依据：核心事实 §6.3（异常状态持续时间）
    if (!s.bucket && !s.contribStat) continue;
    const max = s.levelValues[s.levelValues.length - 1] * modStackFactor(mod.id);
    statText.push(statLabel(s.stat) + ' ' + modStatText(s, max, mod.descriptionEn));
  }
  for (const note of modLockNotes(mod)) statText.push(note);
  const setNote = setNoteOf(mod);
  if (setNote) statText.push(setNote);
  card.append(el('div', 'cand-stats', statText.join(' · ') || '无伤害加成'));

  const gainEl = el('div', 'cand-gain');
  gainEl.append(el('span', 'gain-label', '增幅'));
  const cls = row.gain === null ? '' : !Number.isFinite(row.gain) ? 'pos' : row.gain >= 0.00005 ? 'pos' : row.gain <= -0.00005 ? 'neg' : '';
  gainEl.append(el('span', 'gain-val ' + cls, fmtGain(row.gain) || '—'));
  // DoT 口径下的 `to dot` 小字（D-171）；N 秒总伤下是加权拼出来的，标 `to total`（D-175）
  if (isDotMetric() && row.gain !== null) gainEl.append(el('span', 'gain-to-dot', 'to dot'));
  else if (isTotalLikeMetric() && row.gain !== null) gainEl.append(el('span', 'gain-to-dot', 'to total'));
  card.append(gainEl);

  card.addEventListener('click', function () { selectDetail({ kind: 'mod', id: mod.id, exilus: row.exilus }); });
  return card;
}

export function renderCandidates(res) {
  const base = currentContributions();
  const baseValue = metricValueOf(res);
  const list = $('#candidate-list');
  list.innerHTML = '';

  const rows = [];
  const mods = store.data.availableMods;
  // 已装备的 Mod 不在备选区重复显示（D-034）
  const installed = new Set();
  for (let i = 0; i < SLOT_COUNT; i++) if (store.modSlots[i]) installed.add(store.modSlots[i]);
  if (store.exilusModId) installed.add(store.exilusModId);

  for (let i = 0; i < mods.length; i++) {
    const mod = mods[i];
    if (installed.has(mod.id)) continue;
    // D-091：武器不满足装备条件的 Mod 不出现在备选区
    if (!isModAllowedOnWeapon(mod)) continue;
    if (!matchesFilter(mod, store.ui.filter)) continue;
    const name = modName(mod);
    if (store.ui.search && name.toLowerCase().indexOf(store.ui.search.toLowerCase()) < 0) continue;

    const exilus = isExilusMod(mod);
    // 模拟"装备这张 Mod"（D-169，需求方 2026-11-12 选 2A）：
    // 普通卡**临时占一个额外槽位**，不动用户的 8 个槽，所以满槽也能算出增幅；
    // 额外槽位排在所有已有槽之后，不会抢走已有卡的元素配对对象。
    // D-117：镀层类卡的收益要吃「异况数 × 层数」，走 `coModGain`（配置区不再显示推演小字）
    // 模拟"装备这张 Mod"（D-169，需求方 2026-11-12 选 2A）：
    // 普通卡**临时占一个额外槽位**，不动用户的 8 个槽，所以满槽也能算出增幅；
    // 额外槽位排在所有已有槽之后，不会抢走已有卡的元素配对对象。
    // D-117：镀层类卡的收益要吃「异况数 × 层数」，走 `coModGain`（配置区不再显示推演小字）
    const coGain = coModGain(mod);
    const nextContribs = coGain === null ? _simulateEquip(mod, exilus) : null;
    let gain = coGain;
    if (nextContribs) {
      // D-171：DoT 口径下的规则要用「**装上之后**」的配装判断
      //（待选卡还没进配装，用当前配装算合成看不到它的元素）
      // 试算槽号由内核给（需求方 2026-11-15 B2：排在自带 / 玄骸元素之后），不要写死 8
      const own = modToContributions(mod, mod.maxRank, trialSlotNow());
      if (isTotalLikeMetric()) {
        // D-177 / D-180：总量类口径（N 秒总伤 / 稳态秒伤）
        gain = _candidateWindowGain(base, nextContribs, own, res);
      } else {
        const after = metricValueOf(runCompute(nextContribs));
        if (_isDotWindowMetric() && after > 0 && _isDotWindowMetricDetailRoleIsSplit(own, nextContribs)) {
          // D-176：N 秒异常总伤下，元素没形成 DoT 的元素卡只算触发率那部分
          gain = dotGainForCandidate(own, nextContribs, res);
        } else if (baseValue > 0) {
          // 其余口径如实算：包括「加电把火 DoT 打散」这种 −100%
          gain = after / baseValue - 1;
        } else {
          // 当前为 0、装上后 > 0 → 这张卡让该指标从无到有，增幅 +∞
          gain = after > 0 ? INFINITE_GAIN : 0;
        }
      }
    }
    rows.push({ mod: mod, gain: gain, exilus: exilus });
  }

  rows.sort(function (a, b) {
    if (a.gain === null) return 1;
    if (b.gain === null) return -1;
    return b.gain - a.gain;
  });

  for (let i = 0; i < rows.length; i++) list.append(candidateCard(rows[i]));
  $('#candidate-count').textContent = rows.length + ' / ' + store.data.availableMods.length;
}