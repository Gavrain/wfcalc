/**
 * 右侧「拆解」面板 + 异常状态明细。
 *
 * 拆解对象用**稳定的定位信息**记住（mod id / arcane key），真正重算挂在 `_rerender()`
 * 的最后一次——任何让输出变化的状态都会让它跟着刷新。
 *
 * 需要外壳的三件事通过 `wireDetailDeps()` 注入（避免 `app.js ⇄ 本模块` 成环）：
 * `rerender`（重画整页）、`effectiveMode`（当前生效模式）、
 * `selectedVariantIdx`（勾选的攻击方式）、`simulateEquip`（模拟装上一张卡）。
 */
import { DOT_TYPES, NON_DAMAGE_STATUS_TYPES, critAverage, critTiers } from '../../core/src/index.ts';
import { arcaneDisplayStats, arcaneToContributions } from '../../data/src/adapter.ts';
import { store } from './app-store.js';
import { ELEMENT_COLOR, ELEMENT_LABEL, fmt, fmtPct } from './app-store.js';
import { $, el, fmtGain } from './ui-dom.js';
import { modName } from './app-data.js';
import { collapsibleBlock, dotRow } from './ui-parts.js';
import { statLabel, modStatText, modLockNotes } from './ui-labels.js';
import {
  coInfo, currentContributions, dotMetricRoleOf, gainOf, isDotMetric, isPerStackMetric,
  isTotalLikeMetric, metricValueOf, runCompute,
} from './app-compute.js';

/** 外壳注入的能力 */
let _rerender = () => {};
let _effectiveMode = () => null;
let _selectedVariantIdx = () => [];
let _simulateEquip = () => null;

export function wireDetailDeps(deps) {
  if (deps.rerender) _rerender = deps.rerender;
  if (deps.effectiveMode) _effectiveMode = deps.effectiveMode;
  if (deps.selectedVariantIdx) _selectedVariantIdx = deps.selectedVariantIdx;
  if (deps.simulateEquip) _simulateEquip = deps.simulateEquip;
}

const DETAIL_PLACEHOLDER = '点击备选 Mod 或赋能查看拆解';

export let detailTarget = null;

/** 换枪时清空拆解目标（拆解区回到提示文案） */
export function clearDetailTarget() {
  detailTarget = null;
}
/**
 * 异常状态明细：**按攻击方式分段显示**（需求方 2026-11-12）。
 *
 * 每段有自己的命中分布 → 触发池与每跳伤害都不同，所以不能合并成一个数。
 *
 * **需求方 2026-11-12（续）**：
 * > 「把非伤害性异常也加上去，标上 xx 层/秒就行，不需要后面那个伤害。」
 * > 「复合元素在前，然后冰，然后冲击穿刺。」
 * > 「折叠起来以后只是内部项隐藏，标题还是要展示出来，不然没地方展开了。」
 * > 「折叠状态能保存到浏览器储存里面吗，可以就存。」
 *
 * 所以每段分两组：**会掉血的**（DoT 五种，带 /层/秒 伤害）和
 * **不掉血的**（只有 xx 层/秒）。两组的标题都可点折叠，状态存 `localStorage`。
 */
/**
 * 异常状态明细：**按攻击方式分段显示**（需求方 2026-11-12）。
 *
 * 每段有自己的命中分布 → 触发池与每跳伤害都不同，所以不能合并成一个数。
 *
 * **需求方 2026-11-12（续）**：
 * > 「把非伤害性异常也加上去，标上 xx 层/秒就行，不需要后面那个伤害。」
 * > 「用会掉血的和不会掉血的也太土了吧，叫伤害型异常和非伤害型异常啊。」
 * > 「没有对应类型的时候就隐藏。」
 * > 「外面的异常状态我觉得可以去掉，不要这一层，就里面两层单独折叠就好了。」
 *
 * 所以每个攻击方式下只有**两组**，各自可折叠，**没有外层"异常状态"标题**：
 *   · 伤害型异常：DoT 五种 + 爆炸，带 /层/秒 伤害；
 *   · 非伤害型异常：只有 xx 层/秒。
 * 某一组没有任何类型时**整组不画**（标题也不画）。
 */
export function renderDotDetail(res) {
  const dotBox = $('#dot-detail');
  dotBox.innerHTML = '';

  const m = _effectiveMode();
  const picked = _selectedVariantIdx();
  const variants = m && m.variants ? picked.map(function (i) { return m.variants[i]; }).filter(Boolean) : [];
  const segDetails = res.output.dotBySegment || [];

  // 每段占 `segments` 的哪一截（与伤害分布表同一套游标）
  const starts = [];
  {
    let cursor = 0;
    for (const v of variants) {
      starts.push(cursor);
      cursor += (v.segments || []).length;
    }
  }

  // 先把每段的两组行都算出来，再按组包进可折叠的块
  const blocks = [];
  for (let vi = 0; vi < variants.length; vi++) {
    const v = variants[vi];
    const segCount = (v.segments || []).length;
    const from = starts[vi];
    const dmgRows = [];
    const nonDmgRows = [];
    for (let k = from; k < from + segCount; k++) {
      const d = segDetails[k];
      if (!d) continue;
      for (let i = 0; i < DOT_TYPES.length; i++) {
        const t = DOT_TYPES[i];
        const per = d.dotPerType[t] || 0;
        const stacks = d.stacksPerType[t] || 0;
        if (per <= 0 && stacks <= 0) continue;
        dmgRows.push({ type: t, per, stacks, unit: ' /层/秒' });
      }
      // 爆炸单独算（D-031）：它是独立机制，perStack 是「每层结算伤害」，不是每秒
      const b = d.blast;
      if (b && b.stacksPerSecond > 0) {
        dmgRows.push({ type: 'blast', per: b.perStack, stacks: b.stacksPerSecond, unit: ' /层' });
      }
      // 非伤害型异常：只标层/秒，没有后面的伤害数
      const nd = d.nonDamageStacks || {};
      for (let i = 0; i < NON_DAMAGE_STATUS_TYPES.length; i++) {
        const t = NON_DAMAGE_STATUS_TYPES[i];
        const stacks = nd[t] || 0;
        if (stacks <= 0) continue;
        nonDmgRows.push({ type: t, stacks });
      }
    }
    // 两组都空就不画这一段
    if (dmgRows.length === 0 && nonDmgRows.length === 0) continue;

    // 分段标题：只有一种攻击方式时不显示（免得啰嗦）
    const segLabel = variants.length > 1 ? (v.label || '伤害') : null;
    blocks.push({ segLabel, dmgRows, nonDmgRows });
  }

  if (blocks.length === 0) {
    dotBox.append(el('div', 'muted', '无伤害型异常'));
    return;
  }

  const multiSeg = blocks.some(function (b) { return b.segLabel; });
  for (const blk of blocks) {
    if (blk.segLabel) dotBox.append(el('div', 'dot-seg-title', blk.segLabel));

    // 伤害型异常：默认展开；没有就不画
    if (blk.dmgRows.length > 0) {
      dotBox.append(collapsibleBlock('dot-dmg', '伤害型异常', blk.dmgRows.length, function (body) {
        for (const r of blk.dmgRows) body.append(dotRow(r, true));
      }, multiSeg ? blk.segLabel : null));
    }

    // 非伤害型异常：默认收起；没有就不画（需求方 2026-11-12：「没有对应类型的时候就隐藏」）
    if (blk.nonDmgRows.length > 0) {
      dotBox.append(collapsibleBlock('dot-nondmg', '非伤害型异常', blk.nonDmgRows.length, function (body) {
        for (const r of blk.nonDmgRows) body.append(dotRow(r, false));
      }, multiSeg ? blk.segLabel : null));
    }
  }
}

/** 记下要点开拆解的对象 */
export function selectDetail(target) {
  detailTarget = target;
  renderDetail();
}

/** 按当前配装重算拆解；没有选中对象就显示提示 */
export function renderDetail() {
  const box = $('#detail');
  if (!box) return;
  box.innerHTML = '';
  if (!detailTarget) {
    box.append(el('div', 'muted', DETAIL_PLACEHOLDER));
    return;
  }
  const row = resolveDetailTarget(detailTarget);
  if (!row) {
    detailTarget = null;
    box.append(el('div', 'muted', DETAIL_PLACEHOLDER));
    return;
  }
  paintDetail(box, row);
}

/**
 * 把"拆解对象"还原成当前配装下的那一行。
 *   · Mod：按 id 从当前武器的可装列表里重新取（换枪后取不到 → 自动清空拆解）；
 *   · 赋能：按 key 从当前武器的赋能列表里取。
 */
function resolveDetailTarget(target) {
  if (target.kind === 'arcane') {
    const arc = store.data && store.data.arcaneByKey ? store.data.arcaneByKey.get(target.key) : null;
    return arc ? { kind: 'arcane', arc: arc, key: target.key } : null;
  }
  const mod = store.data && store.data.modById ? store.data.modById.get(target.id) : null;
  if (!mod) return null;
  return { kind: 'mod', mod: mod, id: target.id, exilus: target.exilus };
}

function paintDetail(box, row) {
  const isArcane = row.kind === 'arcane';
  const mod = isArcane ? null : row.mod;
  const arc = isArcane ? row.arc : null;
  const name = isArcane ? (arc.name.zh || arc.name.en) : modName(mod);
  box.append(el('h3', '', name));

  // ── 词条列表：只列真正参与计算的（与内核贡献同源） ──
  const ul = el('ul', 'detail-list');
  if (isArcane) {
    const stats = arcaneDisplayStats(arc);
    for (let i = 0; i < stats.length; i++) {
      ul.append(el('li', '', statLabel(stats[i].stat) + ' +' + (Math.round(stats[i].amount * 100) / 100) + '%'));
    }
    if (!stats.length) ul.append(el('li', 'muted', '无伤害词条（不参与伤害计算）'));
  } else {
    for (let i = 0; i < mod.stats.length; i++) {
      const s = mod.stats[i];
      const max = s.levelValues[s.levelValues.length - 1];
      ul.append(el('li', '', statLabel(s.stat) + '：' + modStatText(s, max, mod.descriptionEn)));
    }
    // 需求方 2026-11-13：锁射速 / 锁多重的限制写进详情（原文就这两句）
    for (const note of modLockNotes(mod)) ul.append(el('li', 'muted', note));
  }
  box.append(ul);
  // 需求方 2026-11-13：没有伤害词条的赋能**写明原因**，不留空白让人猜
  if (isArcane) {
    const reason = arcaneZeroReason(arc);
    if (reason) box.append(el('div', 'detail-note', '不参与伤害计算：' + reason));
  }

  // ── 当前 / 装备后 ──
  const curContribs = currentContributions();
  const cur = runCompute(curContribs);
  let next = null;
  let nextContribs = null;
  if (isArcane) {
    const extra = arcaneToContributions(arc);
    // 与卡上收益同一口径：没装镀层卡时，镀层类贡献要连带层次数一起模拟
    nextContribs = curContribs.concat(extra);
    next = runCompute(nextContribs);
  } else {
    // 用与备选区一致的模拟方式（装到空位，不顶掉已有 Mod）
    nextContribs = _simulateEquip(mod, row.exilus);
    if (!nextContribs) {
      box.append(el('div', 'muted', '当前配置已满，无法装备这张 Mod'));
      return;
    }
    next = runCompute(nextContribs);
  }

  const out = el('table', 'detail-table');
  const oh = el('tr');
  ['输出口径', '当前', '装备后', '增幅'].forEach(function (h) { oh.append(el('th', '', h)); });
  out.append(oh);
  for (let i = 0; i < cur.output.lines.length; i++) {
    const c = cur.output.lines[i];
    const n = next.output.lines[i];
    const g = c.value === 0 ? null : n.value / c.value - 1;
    const tr = el('tr');
    if (c.id === store.ui.metric) tr.classList.add('highlight');
    tr.append(el('td', '', c.label));
    tr.append(el('td', '', fmt(c.value)));
    tr.append(el('td', '', fmt(n.value)));
    tr.append(el('td', g === null ? '' : g >= 0 ? 'pos' : 'neg', fmtPct(g)));
    out.append(tr);
  }
  box.append(out);

  // ── 面板（D-130 / D-132）：一张表，行按「依赖顺序」排：
  //   暴击几率 → 暴击伤害 → 平均暴击倍率 → 触发几率 → 多重 → 射速 → 弹匣 → 装填。
  //   以前暴击几率/暴击伤害既在「面板」表里、又在「暴击」表里出现一次（D-132：合到一张表）。
  //   只列**真的会变**的行；没变化的行不出现（拆解本身就是"装上它之后"）。
  //   需求方 2026-11-15（A6）：弹匣那一行已经是**等效弹匣**，不再单列「等效弹匣」行。
  {
    const cn = cur.state.ui && cur.state.ui.computed;
    const nn = next.state.ui && next.state.ui.computed;
    const curSeg = cur.segments[0];
    const seg = next.segments[0];
    const pairs = [
      ['暴击几率', curSeg.critChance, seg.critChance, 'pct'],
      ['暴击伤害', curSeg.critDamage, seg.critDamage, 'x'],
      ['平均暴击倍率', critAverage(1, curSeg.critChance, curSeg.critDamage), critAverage(1, seg.critChance, seg.critDamage), 'x'],
      ['触发几率', cur.panelPairs.statusChance.after, next.panelPairs.statusChance.after, 'pct'],
      ['多重射击', cur.panelPairs.multishot.after, next.panelPairs.multishot.after, 'num3'],
      ['射速', cur.panelPairs.fireRate.after, next.panelPairs.fireRate.after, 'num3'],
      ['弹匣容量', cur.panelPairs.magazineSize.after, next.panelPairs.magazineSize.after, 'num2'],
      ['装填时间', cur.panelPairs.reloadTime.after, next.panelPairs.reloadTime.after, 'num3'],
    ];
    const show = function (v, kind) {
      if (!Number.isFinite(v)) return '—';
      if (kind === 'pct') return (v * 100).toFixed(2) + '%';
      if (kind === 'x') return '×' + v.toFixed(2);
      return v.toFixed(kind === 'num2' ? 2 : 3);
    };
    const rows = [];
    for (const [label, a, b, kind] of pairs) {
      if (!Number.isFinite(b) || Math.abs(b - a) <= 1e-9) continue;
      rows.push([label, a, b, kind]);
    }
    if (rows.length) {
      const pbox = el('div', 'merge-box');
      pbox.append(el('div', 'section-title', '面板'));
      const pt = el('table', 'detail-table');
      const ph = el('tr');
      ['', '当前', '装备后', '增幅'].forEach(function (h) { ph.append(el('th', '', h)); });
      pt.append(ph);
      for (const [label, a, b, kind] of rows) {
        const tr = el('tr');
        tr.append(el('td', '', label));
        tr.append(el('td', '', show(a, kind)));
        tr.append(el('td', '', show(b, kind)));
        const g = a > 0 ? b / a - 1 : null;
        tr.append(el('td', g === null ? '' : g >= 0 ? 'pos' : 'neg', fmtPct(g)));
        pt.append(tr);
      }
      pbox.append(pt);
      box.append(pbox);
    }
    // 显式读一遍 `cn`，避免"当前状态"在将来被误用来算变化率（口径见 D-084）
    void cn;
  }

  // 暴击分档（D-033 / D-038）：按**装上它之后**的暴击参数重新分档。
  // （D-132：暴击几率/暴击伤害已并进上面的「面板」表，这里只剩分档。）
  const nextSeg = next.segments[0];
  const ct = critTiers(nextSeg.critChance, nextSeg.critDamage);
  const tierBox = el('div', 'merge-box');
  tierBox.append(el('div', 'section-title', '暴击分档'));
  tierBox.append(el('div', 'merge-src', ct.map(function (t) {
    return '等级 ' + t.k + '：' + (t.prob * 100).toFixed(1) + '% × ' + t.mul.toFixed(2);
  }).join('　')));
  tierBox.append(el('div', 'merge-src', '平均 ' + critAverage(1, nextSeg.critChance, nextSeg.critDamage).toFixed(3) + ' 倍'));
  box.append(tierBox);
}

/**
 * 赋能**为什么没有伤害词条**（需求方 2026-11-13：「0 收益的必须写明原因」）。
 *
 * 只写一句话，依据是 `adapter.ts` 的 `ARCANE_STAT_OVERRIDES` 里那张"明确不生效"表。
 */
function arcaneZeroReason(arc) {
  const REASONS = {
    SecondaryOnStatusProcBonusDamage: '触发异常时额外造成 750 点伤害，是附加伤害，不是武器加成',
    ConvergeRadialAttackOnAim: '需要知道爆炸半径才能算，目前不实现',
    PrimaryPlatedRound: '按弹匣长度换算的加成，待确认',
    SplitStatusProcsOnStackedStatusHit: '「追加基本异常」的概率，不是触发几率',
    PrimaryJamEnemyWeaponsOnMagneticProc: '干扰半径（米），不是触发几率',
    SecondaryColdOnPuncture: '施加冰冻层数，不是触发几率',
    SecondaryOnRollCritChanceOnHeadshot: '+300% 暴率仅对弱点命中生效',
    ExtraProcOnProc: '二次触发的概率，不是触发几率',
    PrimaryEnergyRegenOnImpactProc: '能量回复，不影响武器伤害',
    StatusTriggerRadialDamage: '需求方定为无效果',
    GroundSlamPull: '拉拽敌人到近战范围，是控制效果',
    MeleeArcaneProjectileOnJump: '产生额外投射物，未建模',
    MeleeArcaneShockwaveOnJump: '产生额外冲击波，未建模',
    SeekerProjOnHeadshotKill: '产生额外飞射物，未建模',
    BurningCystOnKill: '触发物伤害，不是武器加成',
    IceMistOnKill: '触发物伤害，不是武器加成',
    LightningStrikeOnKill: '触发物伤害，不是武器加成',
    ToxicBloodOnKill: '触发物伤害，不是武器加成',
  };
  return REASONS[arc.key] || '';
}