/**
 * 裂罅 Mod 的**计算衔接层**（D-162，需求方 2026-11-12）。
 *
 * 裂罅不是 `mods.json` 里的卡：它是一张「用户自己拼出来的」组合 Mod，
 * 由「组合（2+/2+1−/3+/3+1−）」+「若干条词条 + 每条的实际数值」组成。
 * 本文件负责三件事：
 *
 *   1. 管理 `store.riven` 的形状（新建 / 加词条 / 换词条 / 改数值 / 换组合）；
 *   2. 把这张裂罅翻成内核的 `Contribution[]`（与普通 Mod 走同一套乘区）；
 *   3. 提供界面要用的取值（按 min / 平均 / max 统一口径）。
 *
 * 口径都在 `packages/data/src/manual/riven.ts`，这里只做形状搬运与状态维护，不碰 DOM。
 *
 * ⚠ 本文件是**纯 JS**（浏览器直接跑，不经过剥类型）：类型信息见 `app-riven.d.ts`。
 */
import { rivenToContributions as coreRivenToContributions } from '../../core/src/input/riven.ts';
import {
  RIVEN_DISPOSITION,
  rivenComboOf,
  roundRiven,
  rivenDisplayUnit,
  rivenDisplayValue,
  rivenStatRange,
  rivenStatTableOf,
} from '../../data/src/manual/riven.ts';
import { store } from './app-store.js';

/** 裂罅在 Mod 槽里的占位 id（与 `app-store.js` 的 `RIVEN_SLOT_ID` 是同一个值） */
export const RIVEN_SLOT = '__riven__';

/**
 * 当前武器属于哪一类裂罅。
 *
 * 需求方 2026-11-12：裂罅分「步枪 / 霰弹 / 次要 / 近战 / 空战 / 守护」六类。
 * **守护武器没有自己的词条表**——需求方原话：「守护武器是对应分到他对应类型的裂罅」，
 * 所以守护枪械按 `weapon-slots.json` 的槽位宽类归到步枪 / 霰弹 / 近战，再取那一类的表。
 *
 * 分类依据（先判空战，再按槽位宽类）：
 *   · 带 `archgun` 标记或槽位是 `archgun` → 空战；
 *   · `shotgun` → 霰弹，`pistol` → 次要，`melee` → 近战；
 *   · 其余枪械（含守护 / 同伴枪械）→ 步枪。
 */
export function rivenScopeOf() {
  const data = store.data;
  if (!data || !data.weapon) return null;
  const entry = data.slotEntry || {};
  const broad = (entry.slots && entry.slots.broad) || '';
  // 空战：槽位宽类或 modKinds 上是 archgun（空战近战的宽类仍是 melee，靠 modKinds 判）
  if (broad === 'archgun') return 'archgun';
  if (Array.isArray(entry.modKinds) && entry.modKinds.includes('archgun')) return 'archgun';
  if (broad === 'shotgun') return 'shotgun';
  if (broad === 'pistol') return 'secondary';
  if (broad === 'melee') return 'melee';
  return 'rifle';
}

/**
 * 当前武器的**倾向**。
 *
 * 游戏已取消倾向变动，全库统一 1.2（`RIVEN_DISPOSITION`）；
 * 近战页面里另有 8 把**空战近战**标着 0.5，属于这一类（`AXIOM_AEGIS_...` 之类，
 * 见 `data.md` D-164 的待确认项）——它们被归进空战后会用空战的表，不受 0.5 影响。
 *
 * ⚠ 这里**只做展示用**：真正参与数值计算的是 `riven.ts` 的 `rivenStatRange()`，
 *   它已经乘过 `RIVEN_DISPOSITION`。不要在页面侧再乘一次（需求方 2026-11-14）。
 */
export function rivenDispositionNow() {
  return RIVEN_DISPOSITION;
}

/** 当前武器的裂罅词条表；这一类没有数据时返回 `null`（界面显示「待补」） */
export function rivenTableNow() {
  const scope = rivenScopeOf();
  return scope ? rivenStatTableOf(scope) : null;
}

/** 当前这张裂罅（没建过返回 null） */
export function currentRiven() {
  return store.riven;
}

/** 裂罅是否已经装进某个 Mod 槽；返回槽位号，没装返回 -1 */
export function rivenInstalledSlot() {
  for (let i = 0; i < store.modSlots.length; i++) if (store.modSlots[i] === RIVEN_SLOT) return i;
  return -1;
}

export function isRivenInstalled() {
  return rivenInstalledSlot() >= 0;
}

/** 取词条定义（正负两边都查） */
export function rivenDefOf(table, key) {
  return table.positive.find((s) => s.key === key) ?? table.negative.find((s) => s.key === key) ?? null;
}

/** 当前组合 */
export function rivenComboNow() {
  return rivenComboOf(store.riven ? store.riven.combo : '2pos');
}

/** 第 `index` 条词条是正面还是负面（正面槽在前，负面槽在最后一条） */
export function rivenSlotKind(index) {
  return index >= rivenComboNow().pos ? 'neg' : 'pos';
}

/** 当前组合下的槽位总数 */
export function rivenSlotCount() {
  const c = rivenComboNow();
  return c.pos + c.neg;
}

/** 已经填了几条词条 */
export function rivenFilledCount() {
  if (!store.riven) return 0;
  return store.riven.entries.filter((e) => e && e.key).length;
}

/** 取值口径（min / 平均 / max） */
export function rivenValueModeNow() {
  return store.ui.rivenValueMode === 'min' || store.ui.rivenValueMode === 'max' ? store.ui.rivenValueMode : 'avg';
}

/**
 * 一条词条按当前取值口径的**幅度**（正面为正、负面按幅度存正数，百分比口径）。
 *
 * 显示成什么（倍率 / 百分比 / 米）由 `formatRivenValue` 决定；这里只取数。
 *
 * @param {object} def 词条定义
 * @param {'pos'|'neg'} kind
 * @param {number} [value] 如果给了实际值，就用它；没给就用当前属性基准（min/平均/max）
 */
export function rivenValueFor(def, kind, value) {
  if (value !== undefined && Number.isFinite(value)) return value;
  const mode = rivenValueModeNow();
  const r = rivenStatRange(def, rivenComboNow(), kind);
  return mode === 'min' ? r.min : mode === 'max' ? r.max : r.avg;
}

/**
 * 一条词条按当前口径的**原始百分比值**（派系是 +45 这种），用于填进 `RivenEntry.value`。
 *
 * ⚠ 区间一律取自 `riven.ts` 的 `rivenStatRange()`（唯一公式：基准 × 系数 × 倾向 1.2）。
 *   以前这里自己抄了一遍 `def.base × coef × 1.2`，与 `riven.ts` 各写一份，
 *   两边一改就对不上（需求方 2026-11-14：「只要保证只乘一次就行了」）。
 */
export function rivenRawValueFor(def, kind) {
  const r = rivenStatRange(def, rivenComboNow(), kind);
  const mode = rivenValueModeNow();
  const v = mode === 'min' ? r.min : mode === 'max' ? r.max : r.avg;
  return roundRiven(v);
}

/**
 * 一条词条在当前组合下的**原始区间**（min / 平均 / max，百分比口径）。
 *
 * 界面滑杆与输入框要用它：滑杆允许的范围就是这条词条理论上能洗出的范围。
 * 同样取自 `rivenStatRange()`，不在这里重写公式。
 */
export function rivenRawRange(def, kind) {
  const r = rivenStatRange(def, rivenComboNow(), kind);
  return { avg: r.avg, min: r.min, max: r.max };
}

/**
 * 一条词条（或它的一个数值）**显示用**的文本（需求方 2026-11-14）。
 *
 * | 类 | 显示 | 例 |
 * |---|---|---|
 * | 派系 | **倍率，前面带 ×**（负面也是 0.xx） | 正面 `×1.54`、负面 `×0.73` |
 * | 后坐力 | 裂罅数值是百分比：正面**降低**、负面**增加** | 正面 `−128.3%`、负面 `+21.4%` |
 * | 穿透 / 攻击范围 / 连击持续时间 | **不带 %**（米 / 秒） | `3.2m`、`2.3m`、`9.6s` |
 * | 其余（含裂罅的弹匣 / 弹药上限） | 百分比 | `+106.9%` |
 *
 * `raw` 是**幅度**（正面为正、负面按幅度存正数），方向与单位都在这里决定。
 */
export function formatRivenValue(def, kind, raw, withMark = true) {
  const unit = rivenDisplayUnit(def);
  // ⚠ 这里收的一律是**幅度**（正面为正、负面按幅度存正数）：区间、卡面、标签、待选区都传幅度。
  //   后坐力**包进来**：正面是「降低」、负面是「增加」，见下方 `recoilSign`。
  if (unit === 'faction') {
    // 派系是**倍率**（正面 1.53 / 负面 0.56），前面用 ×，与普通词条的 +/− 区分（需求方 2026-11-14）。
    // 不带 ×：滑杆刻度（0.xx）与滑杆旁的数字框，那里只放纯数字。
    const mul = (kind === 'pos' ? 1 + raw / 100 : 1 - raw / 100).toFixed(2);
    return withMark ? '×' + mul : mul;
  }
  const signed = unit === 'recoil' ? raw * recoilSign(kind) : kind === 'neg' ? -raw : raw;
  const sign = signed >= 0 ? '+' : '−';
  const abs = Math.abs(signed).toFixed(1);
  if (unit === 'flat') {
    // 裂罅里固定量的词条：穿透 / 攻击范围（米）、连击持续时间（秒）。
    // 弹匣 / 弹药上限在裂罅上是**百分比**，不在这里（需求方 2026-11-14）。
    if (def.key === 'comboDuration') return sign + abs + 's';
    return sign + abs + 'm';
  }
  // 其余是百分比
  return sign + abs + '%';
}

/**
 * 后坐力的**显示方向**（需求方 2026-11-14：「正面记作降低、负面记作增加」）。
 *
 * ```
 * 正面词条 → 后坐力降低 → 显示 −X%
 * 负面词条 → 后坐力增加 → 显示 +Y%
 * ```
 * 只影响显示；滑杆 / 输入框存的仍是幅度。
 */
export function recoilSign(kind) {
  return kind === 'neg' ? 1 : -1;
}

/** 一条词条**显示区间**的文本：`+115.4% ~ +141.1%`（派系 `1.46 ~ 1.56`；穿透这类固定值不带 %） */
export function formatRivenRange(def, kind) {
  // 区间一律是**幅度**：方向与单位都交给 formatRivenValue 处理（负面在那里翻正负）
  const r = rivenStatRange(def, rivenComboNow(), kind);
  return formatRivenValue(def, kind, r.min) + ' ~ ' + formatRivenValue(def, kind, r.max);
}

/**
 * 滑杆 / 数字框的**显示口径**（需求方 2026-11-14：「范围 0.64~0.55 但拖动是 36.45~44.55」）。
 *
 * 滑杆拖的是词条的**幅度**（36.45 ~ 44.55），但派系要显示成倍率（0.64 ~ 0.55），
 * 所以两端 = **把幅度按 `formatRivenValue` 换算回来的数**，保证滑杆两端与「范围」文字一致：
 *
 * ```
 * 普通词条：toSlider = toAmp = 数值本身
 * 派系正面：toSlider(幅度) = 1 + 幅度/100，toAmp(滑杆值) = (滑杆值 − 1) × 100
 * 派系负面：toSlider(幅度) = 1 − 幅度/100，toAmp(滑杆值) = (1 − 滑杆值) × 100
 * ```
 * 存进 `RivenEntry.value` 的**永远是幅度**（与其它词条同一口径）。
 */
export function rivenSliderScale(def, kind) {
  if (rivenDisplayUnit(def) !== 'faction') {
    return { toSlider: function (amp) { return amp; }, toAmp: function (v) { return Math.abs(v); } };
  }
  const neg = kind === 'neg';
  return {
    toSlider: function (amp) { return neg ? 1 - amp / 100 : 1 + amp / 100; },
    toAmp: function (v) { return Math.abs(neg ? (1 - v) * 100 : (v - 1) * 100); },
  };
}



// ─────────────────────────────────────────────────────────────
// 状态维护
// ─────────────────────────────────────────────────────────────

/** 新建一张空裂罅（保持当前组合） */
export function resetRiven(combo) {
  const id = combo ?? (store.riven ? store.riven.combo : '2pos');
  store.riven = { combo: id, entries: [] };
  return store.riven;
}

/** 确保有一张裂罅（界面第一次交互时建） */
export function ensureRiven() {
  return store.riven || resetRiven();
}

/**
 * 换组合。
 *
 * ⚠ 组合变了，词条条数也变了：
 *   · 3+ → 2+：多出来的那条正面词条**暂时收起**（存在 `overflow` 里，切回 3+ 能拿回来），
 *     不会静默删掉用户已经挑好的词条；
 *   · 加负面：负面槽直接空着等用户选；
 *   · 数量变了但已有的词条保留（数值按新组合重算）。
 */
export function setRivenCombo(id) {
  const r = ensureRiven();
  const c = rivenComboOf(id);
  const max = c.pos + c.neg;
  // 收起超出当前组合条数的词条（正面优先保序）
  if (r.entries.length > max) {
    r.overflow = (r.overflow || []).concat(r.entries.slice(max));
    r.entries = r.entries.slice(0, max);
  }
  // 切回能放下的组合时，把之前收起的词条拿回来
  if (r.overflow && r.overflow.length) {
    while (r.entries.length < max && r.overflow.length) {
      r.entries.push(r.overflow.shift());
    }
  }
  r.combo = id;
  if (r.overflow && !r.overflow.length) delete r.overflow;
}

/** 换第 `index` 条词条；`key === ''` 清空 */
export function setRivenEntry(index, key) {
  const r = ensureRiven();
  const table = rivenTableNow();
  if (!table) return;
  if (!key) {
    // 清空：保留占位（后续填回同一条），不挪动其它条
    r.entries[index] = { key: '', value: 0 };
    return;
  }  const def = rivenDefOf(table, key);
  if (!def) return;
  const kind = rivenSlotKind(index);
  r.entries[index] = { key: def.key, value: rivenRawValueFor(def, kind) };
}

/** 改第 `index` 条词条的数值（百分比口径，负面按幅度存正数） */
export function setRivenEntryValue(index, value) {
  const r = ensureRiven();
  const e = r.entries[index];
  if (!e) return;
  e.value = Math.max(0, value);
}

/** 把已选词条按新的 min/平均/max 口径重新填值（统一设置时用） */
export function applyRivenValueMode() {
  const r = store.riven;
  const table = rivenTableNow();
  if (!r || !table) return;
  for (let i = 0; i < r.entries.length; i++) {
    const e = r.entries[i];
    if (!e || !e.key) continue;
    const def = rivenDefOf(table, e.key);
    if (!def) continue;
    e.value = rivenRawValueFor(def, rivenSlotKind(i));
  }
}

/**
 * 在一个槽位上放一条词条（拖拽用）。
 *
 * - `key` 为空 = 把该槽清空；
 * - 目标槽已有词条时**互换位置**（用户要求的「也能换位置」），
 *   原来那条挪到拖拽来源槽（来源是「从右侧待选区拖来」时，目标槽原来那条退回待选区 = 清空）；
 * - 拖拽会让「从下到上」的生效顺序跟着变，这是预期的（需求方明确说明顺序影响元素合成）。
 *
 * ⚠ 空位一律用 `{ key: '', value: 0 }` 表示，**不用 `null`**：
 *   `null` 会让待选修一类的遍历在 `.key` 上抛错，直接把待选区画没了。
 *
 * @param {number} index   目标槽位下标
 * @param {string} key     词条 key；空串表示清空
 * @param {number} [from]  拖拽来源槽位下标；不传表示从待选区拖来的新词条
 */
const EMPTY_ENTRY = () => ({ key: '', value: 0 });

export function placeRivenEntry(index, key, from) {
  const r = ensureRiven();
  const table = rivenTableNow();
  if (!table) return;
  const max = rivenSlotCount();
  if (index < 0 || index >= max) return;

  // 槽位数组补齐到 max，缺的都是空位
  while (r.entries.length < max) r.entries.push(EMPTY_ENTRY());

  if (!key) {
    r.entries[index] = EMPTY_ENTRY();
    return;
  }

  const def = rivenDefOf(table, key);
  if (!def) return;
  const kind = rivenSlotKind(index);
  // 正面槽只收正面词条、负面槽只收负面词条
  const pool = kind === 'pos' ? table.positive : table.negative;
  if (!pool.some((d) => d.key === key)) return;

  // 同一条词条已经在别的槽里 → 先把它从原槽摘掉（避免同一张裂罅出现两条一样的词条）
  for (let j = 0; j < max; j++) {
    if (j === index) continue;
    const e = r.entries[j];
    if (e && e.key === key) r.entries[j] = EMPTY_ENTRY();
  }

  const target = r.entries[index];
  if (from !== undefined && from >= 0 && from < max) {
    // 槽位之间互换：目标槽原来那条挪到来源槽
    r.entries[from] = target && target.key ? target : EMPTY_ENTRY();
  }
  r.entries[index] = { key: def.key, value: rivenRawValueFor(def, kind) };
  if (r.entries.length > max) r.entries.length = max;
}

// ─────────────────────────────────────────────────────────────
// 转成内核贡献
// ─────────────────────────────────────────────────────────────

/**
 * 这张裂罅 → 内核 `Contribution[]`。
 *
 * 每条词条一条贡献：
 *   · 正面 `form: 'pct'`、`amount` 为正；
 *   · 负面同样 `form: 'pct'`、`amount` 取负（内核按 Σpct 相加，负值自然扣减）；
 *   · 派系词条用 `faction:<派系>` 键，与普通派系 Mod 同一条乘区；
 *   · `source` 统一是 `'__riven__'`，整张裂罅共用一个来源（卡上显示整张裂罅的增幅）。
 *
 * **生效顺序：从下到上**（需求方 2026-11-12：「裂罅的词条生效顺序是从下到上。
 * 这个对元素组合顺序影响比较大」）。
 *
 * 内核合成复合元素时按 `slot` 升序两两配对（`elements.ts` 的 `order`），
 * 所以这里把裂罅内部的第 i 条（界面从上往下数）映射成**逆序**的槽位号：
 *
 * ```
 * 界面最下面那条 → 槽位基值 + 0   （最先配对）
 * ……
 * 界面最上面那条 → 槽位基值 + n-1 （最后配对）
 * ```
 *
 * @param {number} [slot] 裂罅所在的 Mod 槽序号；裂罅内部再按上面的规则细分
 */
export function rivenToContributions(slot) {
  const r = store.riven;
  const table = rivenTableNow();
  if (!r || !table) return [];
  // 换算在内核（core/src/input/riven.ts）；这里只把「界面状态」翻译成它要的形状：
  //   · 界面第 i 条（0 = 最上）对应槽位基位 + (total-1-i)，保持"从下到上"的槽号；
  //   · 词条值存的是**幅度**（正负由 kind 决定），派系是百分比口径；
  //   · 显示文本（×1.45 / −128.3%）仍由本文件的 formatRivenValue 决定，不搬进内核。
  const total = r.entries.length;
  const entries = [];
  for (let i = 0; i < total; i++) {
    const e = r.entries[i];
    if (!e || !e.key) { entries.push(null); continue; }
    const def = rivenDefOf(table, e.key);
    if (!def) { entries.push(null); continue; }
    entries.push({ key: def.label || e.key, stat: def.stat, value: e.value, kind: rivenSlotKind(i) });
  }
  if (!entries.length) return [];
  return coreRivenToContributions(entries, RIVEN_SLOT, slot);
}

/** 拿一件"候选词条"装进这张裂罅（不改变原状态），用于算单条增幅 */
export function previewWithEntry(index, key, slot) {
  const saved = store.riven;
  const clone = saved
    ? {
        combo: saved.combo,
        // ⚠ 槽位可能是空位（`null` / 没有 key），复制时必须容忍，否则这里抛错会让待选区整个画不出来
        entries: saved.entries.map((e) => (e ? { key: e.key, value: e.value } : null)),
        ...(saved.overflow ? { overflow: saved.overflow.map((e) => (e ? { key: e.key, value: e.value } : null)) } : {}),
      }
    : { combo: '2pos', entries: [] };
  store.riven = clone;
  setRivenEntry(index, key);
  const out = rivenToContributions(slot);
  store.riven = saved;
  return out;
}
