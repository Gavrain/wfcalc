/**
 * 卡面上的**小标签**：增幅徽章、贡献词条、裂罅词条、镀层加成。
 *
 * 只拼 DOM 与文字；数值全部由 `app-compute` / `app-riven` 给。
 * 外壳的唯一依赖 `arcaneStackLabel` 走注入。
 */
import { store } from './app-store.js';
import { el, fmtGain } from './ui-dom.js';
import { coModGain, gainOf, isDotMetric, isTotalLikeMetric } from './app-compute.js';
import { arcaneDisplayStats, isConditionOverloadMod, modStackFactor } from '../../data/src/adapter.ts';
import { modLockNotes, modStatText, setNoteOf, statLabel } from './ui-labels.js';
import {
  formatRivenValue, rivenComboNow, rivenDefOf, rivenTableNow, rivenValueFor,
} from './app-riven.js';

/** 外壳注入：赋能叠层小标签（依赖 store.data，暂留 app.js） */
let _arcaneStackLabel = () => null;

export function wireChipsDeps(deps) {
  if (deps.arcaneStackLabel) _arcaneStackLabel = deps.arcaneStackLabel;
}
/**
 * 一张卡上的「贡献」标签。
 *
 * 在 DoT 相关口径（异常加权单层秒伤 / 六秒异常总伤）下，数值后面跟一个 `to dot` 小字，
 * 说明这是「对异常伤害」的口径（D-171）；`∞` 表示这张卡让该异常从无到有。
 *
 * @param gain 提升比例；null = 无贡献（不显示）
 */
export function gainBadge(gain) {
  if (gain === null || gain === undefined) return null;
  const cls = gain > 0.0005 ? 'up' : gain < -0.0005 ? 'down' : 'flat';
  const wrap = el('div', 'slot-gain');
  wrap.append(el('span', 'slot-gain-val ' + cls, fmtGain(gain)));
  if (isDotMetric()) wrap.append(el('span', 'gain-to-dot', 'to dot'));
  // D-175：N 秒总伤下的增幅是「续航 / 异常」加权拼出来的，标个小字说明来源
  else if (isTotalLikeMetric()) wrap.append(el('span', 'gain-to-dot', 'to total'));
  return wrap;
}

/**
 * 卡面上的词条小标签。
 *
 * 需求方 2026-11-13：**弹匣容量 / 换弹速度也要显示**——它们影响「续航秒伤」，不是功能卡，
 * 以前因为 `bucket === 'utility'` 被整行跳过，于是「装了野火只看得到 +60% 火焰」，
 * 看起来像只算了一条。
 */
export function statChips(mod) {
  // D-116：无限叠层类（弹能过继等）的值按「每层 × 满层」显示，与内核取的值一致
  const stacks = modStackFactor(mod.id);
  const wrap = el('div', 'slot-stats');
  for (let i = 0; i < mod.stats.length; i++) {
    const s = mod.stats[i];
    if (!s.bucket) continue;
    const max = s.levelValues[s.levelValues.length - 1] * stacks;
    wrap.append(el('span', 'slot-stat', statLabel(s.stat) + ' ' + modStatText(s, max, mod.descriptionEn)));
  }
  // 需求方 2026-11-13：锁射速 / 锁多重写进卡面（原文就是这两句）
  for (const note of modLockNotes(mod)) wrap.append(el('span', 'slot-stat slot-lock', note));
  // 套装提示：只标本卡所属那一套（需求方 2026-11-18）
  const setNote = setNoteOf(mod);
  if (setNote) wrap.append(el('span', 'slot-stat slot-set', setNote));
  return wrap;
}

/**
 * 赋能 → 卡片上的词条小标签（D-116）。**只列真正参与伤害计算的词条**，
 * 与内核拿到的贡献同一份来源（`arcaneDisplayStats`），所以"显示的"就是"算的"。
 */
export function arcaneStatChips(arc) {
  const out = [];
  const stats = arcaneDisplayStats(arc);
  for (let i = 0; i < stats.length; i++) {
    const st = stats[i];
    out.push(el('span', 'slot-stat', statLabel(st.stat) + ' +' + (Math.round(st.amount * 100) / 100) + '%'));
  }
  // 需求方 2026-11-13：叠加类赋能不再只显示「每层值」——
  // 卡面上写满层值，数值与计算一致（霜冻 / 毒侵 / 电压 / 耀炎）。
  const stacks = _arcaneStackLabel(arc);
  if (stacks) out.push(el('span', 'slot-stat slot-stack', stacks));
  return out;
}

/** 裂罅卡上的词条小标签（紫色样式，与普通 Mod 的 `slot-stat` 区分） */
export function rivenSlotChips() {
  const out = [];
  const table = rivenTableNow();
  const r = store.riven;
  if (!table || !r) return out;
  const combo = rivenComboNow();
  for (let i = 0; i < r.entries.length; i++) {
    const e = r.entries[i];
    if (!e || !e.key) continue;
    const def = rivenDefOf(table, e.key);
    if (!def) continue;
    const kind = i < combo.pos ? 'pos' : 'neg';
    out.push(el('span', 'slot-stat riven-stat', def.label + ' ' + formatRivenValue(def, kind, rivenValueFor(def, kind, e.value))));
  }
  return out;
}

/**
 * 已装卡上的贡献徽标（D-117）。
 *
 * 普通卡：`gainOf`（拿掉它重算）。镀层类卡：拿掉后「异况数 × 层数」也没了，
 * 边距贡献的定义依然成立，但 `gainOf` 在"拿掉后指标为 0"时返回 null（界面不显示），
 * 而镀层卡恰恰是唯一能带来"全部基伤"的卡之一——改用 `coModGain` 的口径（装上 vs 当前）。
 */
export function coSlotGain(mod) {
  if (mod && isConditionOverloadMod(mod)) {
    const g = coModGain(mod);
    if (g !== null) return g;
  }
  return gainOf(mod ? mod.id : null);
}