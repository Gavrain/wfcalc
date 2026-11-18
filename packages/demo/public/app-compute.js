/**
 * 计算层薄壳（D-105）：把界面状态翻译成 `core.compute()` 的参数。
 *
 * **真正的计算在 `packages/core`**，这里只有三件事：
 *   1. 组装选项（玄骸 / 派系 / 爆头 / 镀层层数）；
 *   2. 跑一次 `compute()`；
 *   3. 算「某件装备相对不上它时提升了多少」（备选卡与已装卡上的百分比）。
 *
 * 不碰 DOM。原来这些函数都在 `app.js` 里，与渲染混在一起。
 */
import {
  setBonusContributions as setBonusFromCore, compute } from '../../core/src/index.ts';
import {
  arcaneToContributions,
  isConditionOverloadMod,
  modToContributions,
  setBurstStacks,
  setComboMultiplier,
} from '../../data/src/adapter.ts';
import { modName } from './app-data.js';
import { EXILUS_INDEX, MAX_SLOTS, RIVEN_SLOT_ID, SLOT_COUNT, store } from './app-store.js';
import { previewWithEntry, rivenComboNow, rivenDefOf, rivenInstalledSlot, rivenRawValueFor, rivenTableNow, rivenToContributions } from './app-riven.js';

/**
 * 当前模式的**生效形态**：交给 core 的 `AttackMode`。
 *
 * D-148 / 需求方 2026-11-12：一个模式可以有多种「攻击方式」（弹头命中 / 爆炸 / 射线 / 蓄力），
 * 用户用复选框选哪些参与计算。所以这里**不能**再把变体摊平成单个模式
 * （以前取 `variants[variantIndex]`，等于永远只算一种），
 * 而是把整个模式连同 `variants` 交给 core，由 core 按 `selectedVariants` 挑。
 */
export function effectiveModeFor(weapon, ui) {
  if (!weapon) return null;
  const modes = weapon.modes;
  const m = modes[Math.min(ui.modeIndex, modes.length - 1)] ?? modes[0];
  return m ?? null;
}

export function currentContributions() {
  // 需求方 2026-11-13：连击倍率 / 爆发层数是「每层值 × 层数」类卡片的换算参数，
  // 必须先同步给适配层再生成贡献（急进猛突 / 创口溃烂 / 次要·爆发）。
  setComboMultiplier(store.ui.comboMultiplier);
  setBurstStacks(store.ui.burstStacks);
  const out = [];
  // 遍历到 `store.modSlots.length` 而不是 `SLOT_COUNT`：
  // 备选区算增幅时会**临时**在第 SLOT_COUNT 位放一张卡（D-169「临时占一个额外槽位」），
  // 那张卡的贡献要能被算进去，否则满槽时永远算不出增幅。
  for (let i = 0; i < store.modSlots.length; i++) {
    const id = store.modSlots[i];
    if (!id) continue;
    // 裂罅（D-162）：槽里存的是占位 id，真实数据在 store.riven，走自己的转换
    if (id === RIVEN_SLOT_ID) {
      const list = rivenToContributions(i);
      for (let j = 0; j < list.length; j++) out.push(list[j]);
      continue;
    }
    const mod = store.data.modById.get(id);
    if (!mod) continue;
    const list = modToContributions(mod, mod.maxRank, i);
    for (let j = 0; j < list.length; j++) out.push(list[j]);
  }
  if (store.exilusModId) {
    const mod = store.data.modById.get(store.exilusModId);
    if (mod) {
      const list = modToContributions(mod, mod.maxRank, EXILUS_INDEX);
      for (let j = 0; j < list.length; j++) out.push(list[j]);
    }
  }
  if (store.arcaneKey) {
    const arc = store.data.arcaneByKey.get(store.arcaneKey);
    if (arc) {
      const list = arcaneToContributions(arc);
      for (let j = 0; j < list.length; j++) out.push(list[j]);
    }
  }
  // 套装效果：按**已装件数**套用（需求方 2026-11-18 确认的四套）
  //   · 牺牲：×1.25 一次，放大本套 Mod 自身数值
  //   · 私法：每件 +5% 固定暴击率
  //   · 混沌：每件 +150% 震地伤害（只作用于震地模式）
  //   · 角斗士：每件 +10% × 连击倍率（与急进猛突同类）
  // 依据：核心事实 §11（数据结构化事实）+ §6（连击倍率加成）
  for (const c of setBonusContributions()) out.push(c);
  return out;
}

/**
 * 套装效果（实现只在 `core`，见 `core/src/set-bonus.ts`）。
 *
 * 这里只负责**数件数**：内核要的是「套名 → 张数」这个纯数据，
 * 它不认识 Mod 记录，也不碰界面状态。
 */
function setBonusContributions() {
  if (!store.data || !store.data.modById) return [];
  const installed = store.modSlots.filter(Boolean);
  if (store.exilusModId) installed.push(store.exilusModId);
  const counts = {};
  const installedIds = [];
  for (const id of installed) {
    if (id === RIVEN_SLOT_ID) continue;
    const mod = store.data.modById.get(id);
    const set = mod && mod.set;
    if (!set) continue;
    counts[set] = (counts[set] || 0) + 1;
    installedIds.push(id);
  }
  return setBonusFromCore({
    counts,
    comboMultiplier: store.ui.comboMultiplier,
    // 牺牲要放大**本套卡自己的数值**，所以把它们的贡献给内核
    contributionsOfSet: function (setId) {
      const out = [];
      for (const id of installedIds) {
        const mod = store.data.modById.get(id);
        if (!mod || mod.set !== setId) continue;
        out.push(...modToContributions(mod, mod.maxRank, modSlotIndexOf(id)));
      }
      return out;
    },
  });
}

/** 该 Mod 在配装里的槽位下标（找不到返回 undefined） */
function modSlotIndexOf(id) {
  const i = store.modSlots.indexOf(id);
  if (i >= 0) return i;
  if (store.exilusModId === id) return EXILUS_INDEX;
  return undefined;
}

/** 套装中文名（只用于界面显示的来源标签） */
/**
 * 镀层类的可用性。
 *
 * 需求方 2026-11-06：「未装备也允许修改叠加层数，且默认是最大值，
 * 否则未装备时看不到镀层mod收益」——所以这里**不再以"装没装 Mod"为前提**：
 *   · 有镀层类 Mod  → 用它的每层 % 与叠层上限；
 *   · 一张都没有    → 用「假设装备」的满级值（`preview`），让配装时能先看到潜在收益。
 *     这部分只出现在界面推演里，**不进当前配装的真实计算**（`computeOptions` 不读它）。
 */
export function coMaxStacksOf(mod) {
  const cond = (mod.conditions || []).find(function (c) { return c.group === 'condition_overload'; });
  if (cond && cond.maxStacks) return cond.maxStacks;
  return 1;
}

/**
 * 找一张「假设装备」的镀层类 Mod：取当前武器**能装**的第一张（按备选区顺序），
 * 拿它的每层 % 与叠层上限，供未装备时的推演用。找不到返回 null。
 */
export function coPreviewRef() {
  const data = store.data;
  if (!data) return null;
  const mods = data.availableMods || [];
  for (let i = 0; i < mods.length; i++) {
    const mod = mods[i];
    if (!isConditionOverloadMod(mod)) continue;
    const co = mod.stats.filter(function (s) { return s.key === 'co'; });
    if (!co.length) continue;
    const perStack = co.reduce(function (a, s) { return a + s.levelValues[s.levelValues.length - 1]; }, 0);
    return {
      mod: mod,
      perStack: perStack,
      maxStacks: Math.max(1, coMaxStacksOf(mod)),
    };
  }
  return null;
}

export function coInfo() {
  let maxStacks = 0;
  let perStack = 0;
  const sources = [];
  for (let i = 0; i < MAX_SLOTS; i++) {
    const id = i === EXILUS_INDEX ? store.exilusModId : store.modSlots[i];
    if (!id) continue;
    const mod = store.data.modById.get(id);
    if (!mod) continue;
    const co = mod.stats.filter(function (s) { return s.key === 'co'; });
    if (!co.length) continue;
    for (let j = 0; j < co.length; j++) {
      perStack += co[j].levelValues[co[j].levelValues.length - 1];
    }
    maxStacks = Math.max(maxStacks, coMaxStacksOf(mod));
    sources.push(modName(mod));
  }
  const active = sources.length > 0;
  if (active) {
    return { active: true, preview: false, maxStacks: Math.max(1, maxStacks), perStack: perStack, sources: sources };
  }
  // 未装备：给出「假设装备」的推演值（界面用；真实计算不读）
  const ref = store.ui.coPreview ? coPreviewRef() : null;
  if (ref) {
    return {
      active: false,
      preview: true,
      maxStacks: ref.maxStacks,
      perStack: ref.perStack,
      sources: [modName(ref.mod)],
    };
  }
  return { active: false, preview: false, maxStacks: 1, perStack: 0, sources: [] };
}

/**
 * 类镀层（只认单一异常状态层数的加成，D-086）：次要·冷颤 `coFreeze`。
 * 与 `coInfo` 分开：它按**冰冻层数**算，不按异况种类数。
 */
export function freezeInfo() {
  let perStack = 0;
  const sources = [];
  for (let i = 0; i < MAX_SLOTS; i++) {
    const id = i === EXILUS_INDEX ? store.exilusModId : store.modSlots[i];
    if (!id) continue;
    const mod = store.data.modById.get(id);
    if (!mod) continue;
    const st = mod.stats.filter(function (s) { return s.key === 'coFreeze'; });
    if (!st.length) continue;
    for (let j = 0; j < st.length; j++) perStack += st[j].levelValues[st[j].levelValues.length - 1];
    sources.push(modName(mod));
  }
  return { active: sources.length > 0, perStack: perStack, sources: sources };
}

export function computeOptions() {
  const co = coInfo();
  const fc = freezeInfo();
  const opts = {
    // ⚠ 非玄骸武器必须**真的不传**元素加成：界面隐藏控件只是显示层，
    //   计算层仍会按 kuva 加一份伤害，导致"加成条没了但伤害分布里还有"。
    kuva: store.data && store.data.isKuva ? { type: store.ui.kuvaType, ratio: store.ui.kuvaRatio } : null,
    faction: store.ui.faction,
    headshot: { enabled: store.ui.headshot, multiplier: store.ui.headshotMult },
    // D-171（需求方 2026-11-13）：「N 秒异常总伤 / N 秒总伤」的窗口长度。
    // 左栏那两个口径名字后面的下拉框改的就是它，默认 6 秒。
    dotWindowSeconds: store.ui.dotWindowSeconds,
  };
  if (co.active) {
    // 敌人身上的**异常状态数量**（需求方 2026-11-06：配置里加一个框，默认 0）
    // 只服务镀层系列；冷颤固定 10 层，不读这里
    opts.coStatusTypes = store.ui.coStatusTypes;
  }
  if (co.active) {
    // D-117：叠加层数 0 就是 0 层（以前 `> 0 ? : maxStacks` 让 0 层选不中）；
    // 默认值在 `coDefaults()` 里按叠层上限填，见 `currentContributions` 的调用方（boot / 切枪）。
    opts.coStacks = Math.max(0, store.ui.coStacks);
  }
  return opts;
}

/**
 * 镀层控件的默认值（D-112 / D-117）：叠加层数默认取**叠层上限**。
 *
 * 以前靠「`coStacks === 0` 视为未指定 → 取上限」实现默认满层，副作用是 0 层永远选不中；
 * 现在 0 是合法值，默认值改在这里显式填，boot 与换枪时各填一次。
 */
export function coDefaults() {
  const co = coInfo();
  return { stacks: Math.max(1, co.maxStacks) };
}

export function runCompute(contribs, coOverride) {
  const opts = computeOptions();
  // 未装备时的推演（需求方 2026-11-06）：用「假设装备」的镀层贡献算一份收益，
  // **只用于界面展示**，绝不传给当前配装的真实计算（那个走 computeOptions）。
  // 判断条件是"当前配装里没有镀层卡"——不能看 `coStacks`，因为 0 层是合法值（D-117）。
  if (coOverride && coInfo().active === false) {
    opts.coStacks = coOverride.stacks;
    opts.coStatusTypes = coOverride.statusTypes;
    // ⚠ 内核 `compute()` 的第 3 个参数是 `readonly Contribution[]`。以前这里传的是
    //   "选项对象 + 已拼好的数组"——走 0 层时 `coStacks` 为 0，`!opts.coStacks` 判成真，
    //   于是 `contribs.concat(对象)` 把选项对象塞进了贡献列表，内核 `c.stat` 直接抛错。
    //   现在的形状：`coOverride` 只带数值，贡献由调用方自己拼好传进来。
    if (Array.isArray(coOverride.contribs)) contribs = contribs.concat(coOverride.contribs);
  }
  // D-120 / D-148 / 需求方 2026-11-12：只算**勾选了的攻击方式**。
  // 以前把「直接命中 + 爆炸」两个变体的段摊平一起算，界面的「基础」列把它们加在一起
  // （巴兹火枪多出爆炸 40）；现在每种攻击方式各带一个复选框，用户勾哪些就算哪些。
  // `store.ui.selectedVariants` 为 null 表示全选。
  return compute(
    store.data.weapon,
    effectiveModeFor(store.data.weapon, store.ui),
    contribs,
    opts,
    store.ui.selectedVariants ?? undefined,
  );
}

/**
 * **试算槽的槽号**（需求方 2026-11-15 最终确认）。
 *
 * ```
 * [0..7] 8 个真实 Mod 槽 → [8] 试算槽（备选卡 / 未安装裂罅） → [9..] 自带 + 玄骸元素
 * ```
 *
 * 真 Mod 与试算卡都在自带 / 玄骸元素之前；试算槽固定是 `SLOT_COUNT`（= 8）。
 */
export function trialSlotNow() {
  return SLOT_COUNT;
}

/**
 * 这张 Mod 装上后**吃掉哪些镀层层数**（D-117）。
 *
 * 镀层类 Mod 的收益取决于「敌人异况数 a × 叠加层数 y」，而这两项在配置区一起调；
 * 需求方要求把这个推演放到**镀层 Mod 自己身上**显示（配置区不再显示小字）。
 * 所以模拟"装上这张卡"时，也要把内核的 `coStacks` / `coStatusTypes` 换成这张卡自己的取值：
 *   · 已装镀层卡 → 用界面上的 y / a；
 *   · 还没装      → 用这张卡的叠层上限（默认满层，与 D-112 一致）。
 *
 * @returns 内核选项里的 `coStacks` / `coStatusTypes`
 */
function coStacksFor(_mod) {
  const co = coInfo();
  const y = co.active ? store.ui.coStacks : co.maxStacks;
  return { stacks: y, statusTypes: store.ui.coStatusTypes };
}

/**
 * 备选区的这张 Mod「装上后相对当前」的增幅（D-117）。
 *
 * 与 `simulateEquip` 的普通口径相同，唯一区别是镀层类卡要把层次数一起模拟——
 * 否则「没有可装镀层卡时」`coInfo().active` 为 false，推演会被 `runCompute` 直接忽略，
 * 卡上永远显示「无贡献」。
 */
export function coModGain(mod) {
  const ctx = store.gainCtx;
  if (!ctx) return null;
  if (!isConditionOverloadMod(mod)) return null;
  // 槽位排在末尾（试算槽，见 trialSlotNow），不影响其它 Mod 的元素合成顺序
  const extra = modToContributions(mod, mod.maxRank, trialSlotNow());
  if (!extra.length) return null;
  const current = ctx.current;
  if (!(current > 0)) return null;
  const after = metricValueOf(runCompute(ctx.contribs.concat(extra), coStacksFor(mod)));
  if (!(after > 0)) return null;
  return after / current - 1;
}

/**
 * 未装备镀层类 Mod 时的推演：用备选区第一张「假设装备」的镀层卡，
 * 按当前异况数与叠加层数算「装上后」的指标，返回相对**当前**的提升比例。
 * 装备了镀层卡、或武器没有可装的镀层卡时返回 null。
 */
export function coPreviewGain() {
  const co = coInfo();
  if (co.active || !co.preview) return null;
  const ref = coPreviewRef();
  if (!ref) return null;
  const contribs = currentContributions();
  const current = metricValueOf(runCompute(contribs));
  if (!(current > 0)) return null;
  // 槽位排在末尾（试算槽），不影响其它 Mod 的元素合成顺序
  const preview = modToContributions(ref.mod, ref.mod.maxRank, trialSlotNow());
  const after = metricValueOf(runCompute(contribs.concat(preview), {
    stacks: store.ui.coStacks, // D-117：0 = 真正的 0 层（默认值由 coDefaults() 填上限）
    statusTypes: store.ui.coStatusTypes,
  }));
  if (!(after > 0)) return null;
  return after / current - 1;
}

export function metricValueOf(res) {
  const lines = res.output.lines;
  for (let i = 0; i < lines.length; i++) if (lines[i].id === store.ui.metric) return lines[i].value;
  return 0;
}

// ─────────────────────────────────────────────────────────────
// DoT 相关口径里的「元素贡献」规则（D-171，需求方 2026-11-12）
//
// 需求方原话：
// > 「在计算 dot 相关口径的元素 mod 收益时，用这个规则」
// > 「毒冰元素乘区在 dot 相关的统计口径下就是 0 贡献，显示 0%」
// > 「在单层口径下触发率无贡献，所以白霜弹头显示 0，而对于 n 秒异常总伤来说，
// >   元素部分贡献 0，触发率有贡献」
//
// 两个 DoT 口径（`output.ts` 的 lines）：
//   · `dotPerSecond` 异常加权单层秒伤 = 每层伤害 × 触发占比
//   · `dot6s`        六秒异常总伤     = 每跳 × 层数（按秒累加）
//
// 每跳的链路（`dot.ts` 的 `dotTick`）：
//   dotBase(全类型之和) × 系数 × (1+该元素%) × (1+异常状态伤害%) × (1+派系%)
// 层数来自触发率 × 该类型占比 × 多重。
//
// 所以：
//   · 单层口径：元素 % 有贡献（每层伤害）；**触发率没有贡献**（它只影响层数，不影响每层）。
//   · 六秒总伤：元素 % 与触发率**都有**贡献。
// ─────────────────────────────────────────────────────────────

/** DoT 相关的口径 id */
const DOT_METRICS = ['dotPerSecond', 'dot6s'];

/**
 * 参与「N 秒总伤」权重拼法的两个口径 id（D-175）。
 *
 * N 秒总伤 = 续航秒伤 × N + N 秒异常总伤，所以卡在总伤下的增幅
 * 由这两部分的增幅按**当前数值占比**拼出来（见 {@link windowSplitOf}）。
 */
const SUSTAINED_METRIC = 'sustainedDps';
const DOT_WINDOW_METRIC = 'dot6s';
/** N 秒总伤口径的 id（D-177：它的增幅 = 当前总伤 ÷ "拿掉后"的总伤 − 1） */
const WINDOW_TOTAL_METRIC = 'totalInWindow';
/** 稳态秒伤口径（D-180） */
const STEADY_METRIC = 'steadyDps';

/** 当前指标是不是 DoT 相关口径 */
export function isDotMetric() {
  return DOT_METRICS.indexOf(store.ui.metric) >= 0;
}

/**
 * 当前指标是不是「N 秒总伤」（D-179：增幅 = 当前总伤 ÷ "拿掉后"总伤 − 1）。
 */
export function isWindowTotalMetric() {
  return store.ui.metric === 'totalInWindow';
}

/**
 * 当前指标是不是「稳态秒伤」（D-180）。
 *
 * 增幅用**同一套 D-177 分母构造**（直击拿掉整张卡；元素没形成 DoT 的元素卡在异常那侧只去掉触发率）。
 */
export function isSteadyMetric() {
  return store.ui.metric === 'steadyDps';
}

/** 是否为"总量类"口径（N 秒总伤 / 稳态秒伤）—— 两者共用 D-177 的分母构造 */
export function isTotalLikeMetric() {
  return isWindowTotalMetric() || isSteadyMetric();
}

/** 当前指标是不是「单层」口径（触发率对它没有贡献） */
export function isPerStackMetric() {
  return store.ui.metric === 'dotPerSecond';
}

/** 当前指标是不是「六秒总伤」口径 */
export function isDot6sMetric() {
  return store.ui.metric === 'dot6s';
}

/**
 * 这张卡在**当前 DoT 口径**下的收益要怎么算（D-171，需求方 2026-11-12）。
 *
 * 需求方原话：
 * > 「在计算 dot 相关口径的元素 mod 收益时，用这个规则」
 * > 「毒冰元素乘区在 dot 相关的统计口径下就是 0 贡献，显示 0%」
 * > 「在单层口径下触发率无贡献，所以白霜弹头显示 0，而对于 n 秒异常总伤来说，
 * >   元素部分贡献 0，触发率有贡献」
 * > 「参考 dot 的计算过程，dotbase × 元素 × 歧视 × 元素师。火 dot 只是缩小到没有火 mod。」
 *
 * 每跳的链路（`dot.ts` 的 `dotTick`）：
 * ```
 * dotBase(全类型之和) × 系数 × (1 + 该元素%) × (1 + 异常状态伤害%) × (1 + 派系%)
 * ```
 * 层数来自 `触发率 × 该类型占比 × 多重`（`stacksPerShot`）。
 *
 * | 卡的类型 | 在「单层秒伤」里 | 在「六秒总伤」里 |
 * |---|---|---|
 * | 形成伤害型 DoT 的元素（火/电/毒/毒气/切割） | 正常算；分母为 0 → **∞** | 正常算；分母为 0 → **∞** |
 * | 冰/毒这类**被合成掉、不形成 DoT** 的元素 | **0%** | **0%**（只对**元素那部分**；同一张卡上的触发率另算） |
 * | 触发几率 % | **0%**（不影响每跳） | 正常算（影响层数） |
 * | 异常状态伤害 % | 正常算 | 正常算 |
 *
 * ⚠ **D-176（需求方 2026-11-13）**：以前这里对"元素不形成 DoT"的卡**整卡**返回 0，
 *   把同一张卡上的 +触发率也一起抹掉了，和上面原话的后半句
 *   「元素部分贡献 0，**触发率有贡献**」矛盾。现在元素卡按
 *   `(1+元素增益) × (1+触发率增益)` 拆开，见 {@link elementCardDotFactor}。
 *
 * @param own 该卡产出的贡献
 * @param contribs 全部贡献（用来判断这张卡的元素最终有没有形成 DoT）
 * @returns `{ kind: 'normal', feedsDot: false }` 按普通算法（元素形成 DoT，或非元素卡）；
 *   `{ kind: 'zero' }` 显示 0%；
 *   `{ kind: 'split', feedsDot: false }` **元素卡、元素没形成 DoT、但带触发率**：
 *   元素那部分是 0，只算触发率那部分
 */
export function dotMetricRoleOf(own, contribs) {
  if (!isDotMetric()) return { kind: 'normal' };
  if (!own.length) return { kind: 'normal' };

  const hasElement = own.some(function (c) { return /^elemental:/.test(c.stat) || c.stat === 'physical:slash'; });
  const hasRate = own.some(function (c) { return c.stat === 'statusChance'; });

  // ── ① 单层口径：触发几率不影响"每层伤害" ──
  // （需求方：「在单层口径下，触发率无贡献，所以白霜弹头显示 0」）
  if (isPerStackMetric() && !hasElement && hasRate) return { kind: 'zero' };

  // ── ② 非元素卡（触发率 / 异常状态伤害 / 基伤…）→ 照常算 ──
  if (!hasElement) return { kind: 'normal', feedsDot: false };

  // ── ③ 元素卡：它给某个伤害型 DoT 提供了**该 DoT 自己的元素**吗 ──
  //
  // 需求方 2026-11-18 的模型：每个 DoT 只吃自己的元素 %（切割 DoT 谁都不吃），
  // 所以「火 + 毒 → 毒气」时火和毒都不给毒气提供元素。判据在 `feedsDamageDot`。
  //
  //   有 → 正常重算；**拿掉后为 0 时由调用方显示 ∞**（这张卡让该异常从无到有）
  //   没有 → 元素部分 0；带触发率时只算触发率那部分（D-176），否则 0
  if (feedsDamageDot(own, contribs)) return { kind: 'normal', feedsDot: true };
  if (isPerStackMetric()) return { kind: 'zero', feedsDot: false };
  return hasRate ? { kind: 'split', feedsDot: false } : { kind: 'zero', feedsDot: false };
}

/**
 * 一张卡在「N 秒异常总伤」里的增幅（D-176，需求方 2026-11-13）。
 *
 * 需求方原话：
 * > 「触发率就按触发率mod的收益来算。其他不管，这个事情只涉及到元素对dot收益问题」
 * > 「我指的是 (1+0)*(1+x)」（元素增益 × 触发率增益，参考裂罅：三条词条收益相乘 = 整卡）
 * > 「按内核链算，不应该有特殊的处理逻辑」
 *
 * ```
 * 异常增幅 = (1 + 元素增益) × (1 + 触发率增益) − 1
 * ```
 *
 * | 部分 | 取法（都走内核链，不做特殊判断） |
 * |---|---|
 * | 元素增益 | 只保留这张卡的**元素词条**重算：`装上 ÷ 当前 − 1`；元素不形成 DoT 时它自然是 0（和 D-171 一致，不是另写一条判断） |
 * | 触发率增益 | 只保留这张卡的**触发率词条**重算：`装上 ÷ 当前 − 1`（= 内核层数链里 `(1+Σ触发率)` 的比值，实测与解析式逐位相等） |
 *
 * 为什么这样拆是**精确**的（不是近似）：内核里触发率只出现在层数的 `(1+Σ触发率%)` 乘子，
 * 以及射线武器触发率里的多重项；这两项与元素的合成结果互相独立，所以
 * 「元素词条带来的因子 × 触发率词条带来的因子」正好等于整卡因子（实测残差 0）。
 *
 * @param own        这张卡的全部贡献
 * @param beforeRes  当前配置的计算结果
 * @param withCard   装上这张卡之后的全部贡献
 * @param afterRes   装上这张卡之后的结果（用于没有元素/触发词条时直接取整卡）
 */
/**
 * 一张卡在「N 秒异常总伤」里的增幅（D-176，需求方 2026-11-13）。
 *
 * 需求方定的式子：
 * ```
 * 异常增幅 = (1 + 元素增益) × (1 + 触发率增益) − 1
 * ```
 *
 * | 部分 | 取法 |
 * |---|---|
 * | 元素增益 | 只保留这张卡的**元素词条**：`装上 ÷ 当前 − 1`；元素没形成 DoT → **0**（D-171） |
 * | 触发率增益 | 只保留这张卡的**触发率词条**：`装上 ÷ 当前 − 1`（= 内核层数链里 `(1+Σ触发率)` 的比值） |
 *
 * 两者方向必须一致，都是「装上之后 ÷ 当前」，所以：
 *   · 冰/毒被合成掉 → 元素增益 0 → 结果就是触发率增益（正的就是正的）；
 *   · 元素形成 DoT → 两者相乘。
 *
 * @param own        这张卡的全部贡献
 * @param beforeRes  这张卡之前的配装结果（当前值）
 * @param withCard   装上这张卡之后的全部贡献
 */
export function dotFactorOfCard(own, beforeRes, withCard) {
  const el = own.filter(function (c) { return /^elemental:/.test(c.stat) || c.stat === 'physical:slash'; });
  const rate = own.filter(function (c) { return c.stat === 'statusChance'; });
  // 只保留 keep 那几条贡献（其余原样，位置不变 → 元素合成顺序不变）
  const withoutOthers = function (keep) {
    const out = [];
    for (let i = 0; i < withCard.length; i++) {
      const c = withCard[i];
      const at = own.indexOf(c);
      if (at < 0) out.push(c);
      else if (keep.indexOf(own[at]) >= 0) out.push(c);
    }
    return out;
  };
  // ⚠ 基准 = 「只保留元素词条」（去掉触发率词条）：它代表**元素本身**带来的异常，
  //   永远不会因为去掉触发率而变成 0，两个增益都以它为分母才量得准。
  //   （拿"当前配装"或"只留触发率"当分母会撞上 0 或元素结构变化的坑：
  //    病毒火里只有毒时异常是 0 → 触发率增益被算成 100% / 无穷大。）
  const elementOnly = runCompute(withoutOthers(el));
  const baseV = metricValueOf(elementOnly);
  // 元素增益：元素没形成伤害型 DoT → 0（D-171），否则整卡相对「只留元素」的增益
  let elementGain = 0;
  if (el.length && feedsDamageDot(el, withCard)) {
    elementGain = ratioGainOf(baseV, metricValueOf(runCompute(withCard)));
    if (elementGain === null) return null;
  }
  // 触发率增益：整卡相对「只留元素」的增益 —— 内核层数链里 (1+Σ触发率) 的比值
  //（只留元素去掉了触发率词条，所以这个比值正好是这张卡触发率词条的作用）
  let rateGain = 0;
  if (rate.length) {
    rateGain = ratioGainOf(baseV, metricValueOf(runCompute(withCard)));
    if (rateGain === null) return null;
  }
  if (!el.length && !rate.length) return ratioGainOf(metricValueOf(beforeRes), metricValueOf(runCompute(withCard)));
  // 元素没形成 DoT → 元素增益 0，结果就是触发率增益；形成了 → 两者相乘（需求方定的式子）
  return (1 + elementGain) * (1 + rateGain) - 1;
}

/**
 * 会产生伤害型 DoT 的类型（`dot.ts` 的 DOT_TYPES）
 */
const DOT_DAMAGE_TYPES = ['heat', 'toxin', 'electric', 'gas', 'slash'];

/**
 * 这张卡贡献的元素，是否给某个伤害型 DoT **提供了它自己的元素加成**。
 *
 * 需求方 2026-11-18 的规则（按 DoT 算，不按命中分布猜）：
 * ```
 * 每个 DoT 只吃自己的元素 %：火 DoT 吃火、毒气 DoT 吃毒气、**切割 DoT 恒不吃切割**。
 * ```
 * 所以「火 + 毒 → 毒气」时，火和毒都不给毒气提供元素加成；
 * 而裂罅的毒气词条直接命中毒气，算提供。
 *
 * 判据落在**命中分布**上：这张卡的元素，在最终分布里还剩没剩；
 * 且该元素必须是**伤害型 DoT 类型**（切割除外，它不吃元素 %）。
 */
function feedsDamageDot(own, contribs) {
  const res = runCompute(contribs);
  for (const c of own) {
    const m = /^elemental:(.+)$/.exec(c.stat);
    if (!m) continue;
    const t = m[1];
    // 切割不吃元素 %，其它非 DoT 元素（病毒 / 腐蚀 …）也不贡献 DoT
    if (DOT_DAMAGE_TYPES.indexOf(t) < 0) continue;
    if (t === 'slash') continue;
    for (const seg of res.segments) {
      const ed = seg.elementDetail;
      if (ed && ed.v && (ed.v[t] || 0) > 0) return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────

/**
 * 某次计算结果里某一口径的值（找不到返回 0） */
function lineValueOf(res, id) {
  const lines = res.output.lines;
  for (let i = 0; i < lines.length; i++) if (lines[i].id === id) return lines[i].value;
  return 0;
}

/**
 * 普通边际增幅（`当前 ÷ 拿掉后 − 1`）；拿掉后为 0 而当前 > 0 → `∞`。
 */
export function ratioGainOf(before, after) {
  // 「当前 ÷ 拿掉后 − 1」：第一个参数是**拿掉后**（分母），第二个是**当前**
  if (!(before > 0)) return after > 0 ? INFINITE_GAIN : null;
  return after / before - 1;
}

/**
 * 「N 秒总伤」下某件**已装**装备的增幅（D-175 / D-177）。
 *
 * ```
 * 当前总伤 ÷ 分母 − 1
 * 分母 = 拿掉整张卡后的续航秒伤 × N + DoT 部分
 * ```
 *
 * 需求方 2026-11-15（C3）：以前这里旁边还有一套「续航增幅 × 占比 + 异常增幅 × 占比」的拼法
 *（`windowGainFromParts` / `splitPairOf` / `sustainGainOf` / `dotGainOfPair`），
 * 没有任何调用点，已整段删除——实际在跑的就是下面这一套。
 *
 * @param contribs  全部贡献（当前配装）
 * @param sourceId  要剔除的装备来源 id
 */
export function windowGainForSource(contribs, sourceId) {
  const own = contribs.filter(function (c) { return c.source === sourceId; });
  if (!own.length) return null;
  const cur = runCompute(contribs);
  // D-177 / D-180：总量类口径共用"当前 ÷ 分母 − 1"，分母构造只看"元素没形成 DoT"这一条
  const metric = isSteadyMetric() ? STEADY_METRIC : WINDOW_TOTAL_METRIC;
  const withoutCard = contribs.filter(function (c) { return own.indexOf(c) < 0; });
  let denom;
  if (isSteadyMetric()) {
    // 稳态：直击用续航秒伤；异常用"只去触发率"那份的稳态值
    const withoutRes = runCompute(withoutCard);
    const basePart = lineValueOf(withoutRes, SUSTAINED_METRIC);
    let steadyPart = lineValueOf(withoutRes, STEADY_METRIC) - basePart;
    if (dotRoleForWindow(own, contribs).kind === 'split') {
      const keepRate = withoutCard.concat(own.filter(function (c) { return c.stat !== 'statusChance'; }));
      steadyPart = lineValueOf(runCompute(keepRate), STEADY_METRIC) - basePart;
    }
    denom = basePart + steadyPart;
  } else {
    denom = windowDenominator(contribs, own, cur);
  }
  if (!denom) return null;
  return ratioGainOf(denom, lineValueOf(cur, metric));
}

/**
 * **统一的增幅入口**（需求方 2026-11-18：「分母是一样的」）。
 *
 * 已装卡、备选卡、裂罅词条三处原来各写一套，结果同一张卡
 * 「装上 ÷ 不装」和「装着 ÷ 拿掉」给出两个不同的数。现在只有这一套：
 * 调用方只负责**给出对照配装**与**方向**，增幅怎么算全在这里。
 *
 * | 调用方 | `variant`（对照配装） | `direction` |
 * |---|---|---|
 * | 已装卡 / 赋能 | **拿掉**该来源之后的贡献 | `'installed'` |
 * | 备选卡 | **装上**这张卡之后的贡献 | `'candidate'` |
 * | 裂罅词条 | **换掉**该词条之后的贡献 | `'installed'` |
 *
 * 分母一律取**内核算好的那一行**（`totalInWindow` / `steadyDps` / 当前口径），
 * 不自己拼 `sustainedDps × N + dot6s`——自己拼的值与内核那一行不相等，
 * 正是两个数打架的根源。
 *
 * @param current   当前配装的全部贡献
 * @param variant   对照配装的全部贡献
 * @param direction `'installed'` = 当前是"有它"、variant 是"没它"；
 *                  `'candidate'` = 当前是"没它"、variant 是"有它"
 */
export function gainOfPair(current, variant, direction) {
  const cur = lineValueForMetric(runCompute(current));
  const alt = lineValueForMetric(runCompute(variant));
  const denom = direction === 'installed' ? alt : cur;
  const numer = direction === 'installed' ? cur : alt;
  return ratioGainOf(denom, numer);
}

/** 当前口径在这一份结果里的值（自总伤口径起都用内核算好的那一行） */
function lineValueForMetric(res) {
  return lineValueOf(res, store.ui.metric);
}

/**
 * 「N 秒总伤」的**分母**（= "拿掉这张卡之后"的总伤，D-177）。
 *
 * ```
 * 分母 = 拿掉整张卡后的续航秒伤 × N + DoT 部分
 * DoT 部分：
 *   元素形成了 DoT / 非元素卡        → 拿掉整张卡后的 N 秒异常总伤
 *   元素没形成 DoT 的元素卡（冰/毒） → **只去掉触发率词条**后的 N 秒异常总伤
 *                                     （= 用"…60 冰冻"作分母，见需求方的 (…冰+触发)/(…冰)）
 * ```
 *
 * 需求方原话：「元素没形成 DoT 的元素卡这个计算逻辑在计算 n 秒总伤时，只对 dot 部分生效，
 * 直伤部分还是正常视为拿掉了 mod」。
 *
 * @param contribs 当前配装的全部贡献
 * @param own      这张卡自己的贡献
 * @param curRes   当前配装的计算结果
 */
function windowDenominator(contribs, own, curRes) {
  const window = store.ui.dotWindowSeconds ?? 0;
  const withoutCard = contribs.filter(function (c) { return own.indexOf(c) < 0; });
  const woRes = runCompute(withoutCard);
  let dot = lineValueOf(woRes, DOT_WINDOW_METRIC);
  // 元素没形成 DoT 的元素卡：DoT 那部分只去掉触发率词条
  // ⚠ 必须按「N 秒异常总伤」口径判断（不能看当前指标 —— 总伤口径下 `dotMetricRoleOf` 直接返回 normal）
  if (dotRoleForWindow(own, contribs).kind === 'split') {
    const keepRate = withoutCard.concat(own.filter(function (c) { return c.stat !== 'statusChance'; }));
    dot = lineValueOf(runCompute(keepRate), DOT_WINDOW_METRIC);
  }
  const sustained = lineValueOf(woRes, SUSTAINED_METRIC);
  // 需求方 2026-11-18：分母直接取**内核算好的 `totalInWindow`**，不要自己拼
  // `sustainedDps × N + dot6s`——那样拼出来的值和内核那一行不一定相等，
  // 于是「装上 ÷ 不装」与「装着 ÷ 拿掉」会给出两个不同的增幅。
  const total = lineValueOf(woRes, WINDOW_TOTAL_METRIC) || sustained * window + dot;
  return total > 0 ? total : null;
}

/**
 * 与 {@link dotMetricRoleOf} 同一套规则，但**固定按「N 秒异常总伤」**判断
 * （总伤口径用它判断"这张卡是不是元素没形成 DoT 的元素卡"，不受当前指标影响）。
 */
function dotRoleForWindow(own, contribs) {
  const saved = store.ui.metric;
  store.ui.metric = DOT_WINDOW_METRIC;
  try {
    return dotMetricRoleOf(own, contribs);
  } finally {
    store.ui.metric = saved;
  }
}

/**
 * 「N 秒总伤」下**一条贡献**的增幅（D-177）：
 *
 * ```
 * 当前总伤 ÷ 分母 − 1
 * 分母 = 去掉这条后的「续航秒伤」× N
 *      + DoT 部分（这条是"元素没形成 DoT 的元素词条"→ 保留元素、只去掉触发率；否则同样去掉）
 * ```
 *
 * 已装卡、裂罅已选词条、裂罅待选词条共用这一个函数，保证三处算法一致。
 *
 * @param withoutContribs 「去掉这一条」的贡献列表（直伤用）
 * @param withContribs    「有这一条」的贡献列表（当前）
 * @param own             这一条自己的贡献（判断它是不是"元素没形成 DoT 的元素词条"）
 */
function windowRatioOf(withoutContribs, withContribs, own, metric) {
  const target = metric ?? store.ui.metric;
  const curRes = runCompute(withContribs);
  const withoutRes = runCompute(withoutContribs);
  // DoT 部分：元素没形成 DoT 的元素卡 → 只去掉触发率词条（D-177）
  const elementOnly = own.filter(function (c) { return c.stat !== 'statusChance'; });
  const hasRate = own.some(function (c) { return c.stat === 'statusChance'; });
  const keepRate = hasRate && elementOnly.length && dotRoleForWindow(own, withContribs).kind === 'split'
    ? withoutContribs.concat(elementOnly)
    : null;
  if (target === STEADY_METRIC) {
    // 稳态秒伤（D-180）：直击用续航秒伤，异常也用稳态值，分母照 D-177 换成"只去触发率"的那份
    const dotOf = keepRate ? lineValueOf(runCompute(keepRate), STEADY_METRIC) - lineValueOf(runCompute(keepRate), SUSTAINED_METRIC) : NaN;
    const withoutDot = lineValueOf(withoutRes, STEADY_METRIC) - lineValueOf(withoutRes, SUSTAINED_METRIC);
    const denom = lineValueOf(withoutRes, SUSTAINED_METRIC) + (keepRate ? dotOf : withoutDot);
    const cur = lineValueOf(curRes, STEADY_METRIC);
    if (!(denom > 0)) return cur > 0 ? INFINITE_GAIN : null;
    return cur / denom - 1;
  }
  const window = store.ui.dotWindowSeconds ?? 0;
  let dot = lineValueOf(withoutRes, DOT_WINDOW_METRIC);
  if (keepRate) dot = lineValueOf(runCompute(keepRate), DOT_WINDOW_METRIC);
  const denom = lineValueOf(withoutRes, SUSTAINED_METRIC) * window + dot;
  const cur = lineValueOf(curRes, WINDOW_TOTAL_METRIC);
  if (!(denom > 0)) return cur > 0 ? INFINITE_GAIN : null;
  return cur / denom - 1;
}

/**
 * 「N 秒异常总伤」下某件**已装**装备的增幅（D-176）。
 *
 * 只有**元素卡**走特殊拆法；其它卡一律回到原来的「拿掉重算」（D-171 的规则里，
 * 它们没有需要特殊处理的元素部分）。
 *
 * ```
 * 元素形成 DoT（如病毒火里的火、裂罅上的毒气）→ 正常拿掉重算，分母为 0 → ∞
 * 元素不形成 DoT（病毒火里的冰 / 毒）→ (1 + 元素增益 0) × (1 + 触发率增益) − 1
 *                                    没触发率词条 → 0
 * 非元素卡                              → 正常拿掉重算
 * ```
 */
export function dotGainForSource(contribs, sourceId) {
  const own = contribs.filter(function (c) { return c.source === sourceId; });
  if (!own.length) return null;
  const role = dotMetricRoleOf(own, contribs);
  if (role.kind === 'normal') {
    return marginalGainOf(contribs, metricValueOf(runCompute(contribs)), sourceId);
  }
  if (role.kind === 'zero') return 0;
  const rest = contribs.filter(function (c) { return c.source !== sourceId; });
  return dotFactorOfCard(own, runCompute(rest), contribs);
}

/**
 * 「N 秒异常总伤」下**一张即将装上的卡**的增幅（D-176）。
 *
 * 与 {@link dotGainForSource} 同一套规则，只是"装上"而不是"拿掉"：
 * 摊平到额外槽位 8 上再按该口径重算（需求方：「元素mod在待选区时，走原来的计算逻辑，
 * 即假设他安装到8号位」），再判断它是不是元素卡、元素有没有形成 DoT。
 *
 * @param own     这张卡自己的贡献（槽位已排在末尾，与 `simulateEquip` 一致）
 * @param next    装上这张卡之后的全部贡献
 * @param baseRes 当前配装的结果（原点是「当前」）
 */
export function dotGainForCandidate(own, next, baseRes) {
  if (!own.length) return null;
  const role = dotMetricRoleOf(own, next);
  const withoutIt = next.filter(function (c) { return own.indexOf(c) < 0; });
  if (role.kind === 'normal') {
    const after = metricValueOf(runCompute(next));
    const before = baseRes ? metricValueOf(baseRes) : metricValueOf(runCompute(withoutIt));
    return ratioGainOf(before, after);
  }
  if (role.kind === 'zero') return 0;
  return dotFactorOfCard(own, runCompute(withoutIt), next);
}

/**
 * 某件已装装备（Mod / 赋能）对**当前指标**的贡献幅度。
 *
 * 定义（需求方 2026-11-06）：「已安装的 mod 也展示自身提供的贡献百分比，
 * 即为相对于不上这张 mod 的提升数值」。
 *
 * ```
 * 提升 = (当前指标 - 拿掉该装备后的指标) / 拿掉该装备后的指标
 * ```
 *
 * 实现：把该装备从贡献列表里剔除后重算一次，与当前值相比。
 * ⚠ 这是**边际贡献**，不是可加和的份额：两张同乘区的卡各算各的，加起来不等于总值，
 *    这正是需求方要的"相对于不上这张"的口径。
 *
 * @param contribs 当前全部贡献
 * @param current  当前指标值（已算好，避免重复调用）
 * @param sourceId 要剔除的装备来源 id（`Contribution.source`）
 * @returns 提升比例（0.25 = +25%）；无法计算时返回 null
 */
/**
 * **两遍计算法**的统一入口（设计见 `docs/specs/架构设计/core-v2-架构设计.md` §8）。
 *
 * 界面上的"这张卡值多少"都是同一个问法：**去掉它之后会怎样**。
 * 这里把"去掉 → 重算 → 交给你比"收成一条，各调用点只管比较口径。
 *
 * @param contribs 当前全部贡献
 * @param sourceId 要去掉的来源（mod id / arcane key / 套装 id）
 * @param fn 拿到"去掉该来源之后"的贡献数组，返回任意值（通常是算出来的指标）
 * @returns `fn(去掉后的贡献)`；该来源压根没产出贡献时返回 `null`（调用方据此显示"—"）
 */
export function withSourceRemoved(contribs, sourceId, fn) {
  const rest = [];
  let removed = false;
  for (let i = 0; i < contribs.length; i++) {
    if (contribs[i].source === sourceId) { removed = true; continue; }
    rest.push(contribs[i]);
  }
  if (!removed) return null;
  return fn(rest);
}

export function marginalGainOf(contribs, current, sourceId) {
  const without = withSourceRemoved(contribs, sourceId, function (rest) {
    return metricValueOf(runCompute(rest));
  });
  if (without === null) return null; // 该装备没有产出任何贡献
  // 拿掉后为 0 而当前 > 0 → 这张卡让该指标「从无到有」，增幅是 +∞
  // （需求方 2026-11-12：「在单火 mod 下，它对异常的贡献就是 +∞」）
  if (!(without > 0)) return current > 0 ? INFINITE_GAIN : null;
  return current / without - 1;
}

/**
 * 「从无到有」的增幅标记（D-171）。
 *
 * 拿掉某张卡后指标归 0、而当前 > 0，说明这张卡让该异常从不存在变成存在，
 * 增幅是数学上的 +∞。界面显示为 `∞`（旁边带 `to dot` 小字）。
 *
 * 用 `Number.POSITIVE_INFINITY` 而不是 `null`：`null` 在界面上表示「—」（无贡献），
 * 会把「让异常从无到有」误显示成「没贡献」。
 */
export const INFINITE_GAIN = Number.POSITIVE_INFINITY;

/** 某件装备相对「不上它」时当前指标的提升比例（复用 renderAll 算好的基准，避免重复计算） */
export function gainOf(sourceId) {
  const ctx = store.gainCtx;
  if (!ctx) return null;
  const own = ctx.contribs.filter(function (c) { return c.source === sourceId; });
  if (!own.length) return marginalGainOf(ctx.contribs, ctx.current, sourceId);

  // D-177 / D-180：总量类口径（N 秒总伤 / 稳态秒伤）= 当前 ÷ "拿掉后" − 1
  if (isTotalLikeMetric()) return windowGainForSource(ctx.contribs, sourceId);

  const role = dotMetricRoleOf(own, ctx.contribs);
  // DoT 口径下，这张卡的元素被合成掉、最终不形成任何伤害型 DoT → 0 贡献
  // （单层口径：元素那部分 0；D-176：触发率那部分也仍是 0，因为单层不吃层数）
  if (role.kind === 'zero') return 0;
  // D-176：元素没形成 DoT、但卡上带触发率 → 只算触发率那部分（按内核链）
  if (role.kind === 'split') {
    const rest = ctx.contribs.filter(function (c) { return own.indexOf(c) < 0; });
    return dotFactorOfCard(own, runCompute(rest), ctx.contribs);
  }
  // 其余情况一律「拿掉这张卡重算」（不再有 ε 技巧）。
  // 拿掉后指标归 0 → 返回 INFINITE_GAIN（界面显示 ∞），
  // 表示这张卡让该异常「从无到有」（需求方：「在单火 mod 下，它对异常的贡献就是 +∞」）。
  return marginalGainOf(ctx.contribs, ctx.current, sourceId);
}

// ─────────────────────────────────────────────────────────────
// 裂罅 Mod 的收益（D-162，需求方 2026-11-12）
//
// 三种口径：
//   · 整卡收益   —— 这张裂罅装上之后相对「不上它」的提升（卡上显示这个）
//   · 单条收益   —— 某一条词条单独带来的提升（左栏每条词条上显示）
//   · 候选收益   —— 待选区某条词条填进这张裂罅之后的提升
//
// 一律用"贡献列表上加 / 减这一部分再重算"的方式，和备选 Mod 的算法同一套。
// ─────────────────────────────────────────────────────────────

/**
 * 裂罅的**整卡收益**（相对不上这张裂罅）。
 *
 * 裂罅装没装都成立：没装时把它的贡献"临时加上"再比，装着时从贡献列表里剔掉再比。
 */
export function rivenGain() {
  const ctx = store.gainCtx;
  if (!ctx) return null;
  const installed = rivenInstalledSlot() >= 0;
  const rivenContribs = rivenToContributions(installed ? rivenInstalledSlot() : undefined);
  if (!rivenContribs.length) return null;
  // D-177：总量类口径下整张裂罅按一个来源算
  if (isTotalLikeMetric() && installed) return windowGainForSource(ctx.contribs, RIVEN_SLOT_ID);
  if (installed) {
    // 已装：拿掉裂罅后的指标（走统一入口 withSourceRemoved）
    const without = withSourceRemoved(ctx.contribs, RIVEN_SLOT_ID, function (rest) {
      return metricValueOf(runCompute(rest));
    });
    if (without === null || !(without > 0)) return null;
    return ctx.current / without - 1;
  }
  // 没装：临时算"装上之后"
  const after = metricValueOf(runCompute(ctx.contribs.concat(rivenContribs)));
  if (!(after > 0) || ctx.current <= 0) return null;
  return after / ctx.current - 1;
}

/**
 * 左栏里**第 index 条词条**的增幅（D-169，需求方 2026-11-12 定 1A）。
 *
 * ```
 * 增幅 = (当前配装里已有这条) / (当前配装里没有这条) − 1
 * ```
 *
 * ⚠ 以前是「只保留这一条 vs 什么都不上」，**算错了**：
 *   元素是成组生效的（冰+毒=病毒、火+冰=爆炸），单独一条火往往只是把面板冰顶掉，
 *   于是显示成负的；但装进实际配装后它顶掉的是别的火，实际是正的。
 *
 * 现在：其它词条全部保留，**只把这一条加进去 / 拿掉**，如实反映
 * 「多这一条会怎样」——如果这条火会把现有病毒打散，那就**如实显示负数**（需求方选 1A）。
 *
 * 裂罅真装进 Mod 槽时，槽位号按「槽位基值 + 内部序号」走，不会挤占别的 Mod 槽（需求方选 2A：
 * 临时占一个额外位置，不改动用户的配装）。
 */
/**
 * 裂罅里**第 index 条词条**的增幅（D-173，需求方 2026-11-13）。
 *
 * ```
 * 增幅 = (配装 + 当前裂罅) / (配装 + 当前裂罅去掉这一条) − 1
 * ```
 *
 * ⚠ 这里必须与 {@link rivenCandidateGain} 用**同一套结构**：
 *   待选区算的是「把这条加进当前裂罅」，裂罅里算的是「把这条从当前裂罅拿掉」，
 *   两者是同一个增量的正反两面，所以**必须都以上下文的完整裂罅为基准**。
 *
 *   之前两者不一致（待选区用「配装+裂罅」当分母、裂罅里用「去掉这一条」当分母），
 *   一旦裂罅里有负面词条或其它词条改变结构，两个数就会分叉——
 *   需求方看到的就是「待选区是正的、进了裂罅变成负的」。
 *
 * DoT 口径仍按 D-171 的规则：不形成伤害 DoT 的元素 / 单层口径下的触发率词条 → 0。
 */
export function rivenEntryGain(index) {
  const ctx = store.gainCtx;
  const r = store.riven;
  if (!ctx || !r || !r.entries[index] || !r.entries[index].key) return null;
  const slot = rivenInstalledSlot();
  // 装了就用它的真实槽位（D-174）；没装就用虚位槽 9，**绝不传 undefined**
  //（undefined 会退化成 0、1、2，跟真实 Mod 槽撞号并改写元素合成顺序）
  const slotBase = slot >= 0 ? slot : trialSlotNow();
  // 先拿"去掉裂罅"的贡献（统一入口），再把词条组重新拼上去试算
  const rest = withSourceRemoved(ctx.contribs, RIVEN_SLOT_ID, function (r) { return r; }) || ctx.contribs;

  // ── 当前：这张裂罅的全部词条都在 ──
  const withAll = rivenToContributions(slotBase);
  if (!withAll.length) return null;

  // ── 这一条自己产出的贡献（D-176 拆法要用）──
  const table = rivenTableNow();
  const def = table ? rivenDefOf(table, r.entries[index].key) : null;
  const own = withAll.filter(function (c) {
    return def && c.stat === def.stat;
  });

  // ── 去掉第 index 条后的整张裂罅（= 待选区口径里的「当前裂罅」）──
  const saved = store.riven;
  const makeWithout = function () {
    store.riven = {
      combo: saved.combo,
      entries: saved.entries.map(function (e, i) {
        if (i !== index) return e ? { key: e.key, value: e.value } : null;
        return { key: '', value: 0 };
      }),
    };
    const list = rivenToContributions(slotBase);
    store.riven = saved;
    return list;
  };
  const withoutEntry = makeWithout();

  // D-177：N 秒总伤下 = 当前总伤 ÷ "去掉这一条"后的总伤 − 1
  // 与已装卡同一套分母构造：直伤拿掉这一条；DoT 部分若这一条是"元素没形成 DoT"的元素词条，
  // 则只去掉它的触发率（= 用"…60 冰冻"作分母），否则同样拿掉。
  if (isTotalLikeMetric()) {
    return windowRatioOf(rest.concat(withoutEntry), rest.concat(withAll), own);
  }

  // 「N 秒异常总伤」口径：**与已装 Mod 同一套分发**（D-182）
  //   元素形成了 DoT（例如病毒火里的火焰词条）→ 正常拿掉这一条重算
  //   元素没形成 DoT、但带触发率 → 元素部分 0，只算触发率（D-176 的拆法）
  if (store.ui.metric === DOT_WINDOW_METRIC) {
    const role = dotRoleForWindow(own, rest.concat(withAll));
    if (role.kind === 'normal') {
      const afterV = metricValueOf(runCompute(rest.concat(withAll)));
      const beforeV = metricValueOf(runCompute(rest.concat(withoutEntry)));
      return ratioGainOf(beforeV, afterV);
    }
    if (role.kind === 'split') {
      return dotFactorOfCard(own, runCompute(rest.concat(withoutEntry)), rest.concat(withAll));
    }
    return 0;
  }
  // 单层口径：没形成 DoT 的元素词条仍然是 0
  if (isPerStackMetric() && dotMetricRoleOf(own, ctx.contribs).kind === 'zero') return 0;

  const after = metricValueOf(runCompute(rest.concat(withAll)));
  const before = metricValueOf(runCompute(rest.concat(withoutEntry)));
  if (!(before > 0)) return after > 0 ? INFINITE_GAIN : null;
  return after / before - 1;
}

/**
 * 裂罅的「试算槽位号」（D-174，需求方 2026-11-13）。
 *
 * 算增幅时如果裂罅**还没装进 Mod 槽**，就假装它装在这个槽位上。取 **8** 的原因：
 *
 * | 槽位号 | 用途 |
 * |---|---|
 * | 0 ~ 7 | 8 个真实的 Mod 槽 |
 * | **8** | **"假装装进去"的试算槽**——备选 Mod 与未安装的裂罅**共用**这一号 |
 * | 9 ~ 12 | 武器自带元素 / 玄骸元素 |
 *
 * 为什么 8 可以给两边共用（需求方 2026-11-13）：
 * > 「备选mod跟裂罅未安装的时候是一个逻辑，他们不会冲突的。」
 *
 * 两者都是"临时假装装上某个东西再算一次"，**同一时刻只会试算一样**，
 * 所以不会同时占用 8 号槽。
 *
 * ⚠ 以前传的是 `undefined`，`rivenToContributions` 会退化成 **0、1、2**，
 *   跟真实的 Mod 槽撞号 → 元素两两合成的顺序被改写。
 *   实测：Mod 火@0 + 电@1 + 裂罅冰 时，撞号算出「爆炸」，用 8 是「辐射」，结果完全不同。
 */
export const RIVEN_TRIAL_SLOT = SLOT_COUNT; // 8：试算槽（与备选 Mod 的临时槽同号，两者互斥）
/** 实际使用的试算槽号：优先读内核算好的 `res.trialSlot`（见 `trialSlotNow`） */
export function rivenTrialSlot() {
  return trialSlotNow();
}

/** 某个词条 key 在裂罅组合区里的槽位下标；没有返回 -1 */
function rivenEntryIndexOfKey(key) {
  const r = store.riven;
  if (!r) return -1;
  for (let i = 0; i < r.entries.length; i++) {
    const e = r.entries[i];
    if (e && e.key === key) return i;
  }
  return -1;
}

/**
 * 待选区某条词条的增幅（D-172，需求方 2026-11-13）。
 *
 * 需求方原话：
 * > 「我发现往裂罅里面加词条会提升待选区词条的收益，这不符合设计。如果裂罅未安装，那么应该没影响。
 * > 因为始终算的是当前词条对伤害口径的增量。如果裂罅已安装，那么同类词条之间应该会互相降低贡献。
 * > 当然为了防止跳变，我觉得始终视为裂罅安装上去了的情况下计算更合理。」
 *
 * ```
 * 增幅 = (配装 + 这张裂罅 + 待选词条) / (配装 + 这张裂罅) − 1
 * ```
 *
 * 口径要点：
 *   · 裂罅**一律视为已装**（虚位槽 `RIVEN_TRIAL_SLOT`）：装没装都不变，不跳变；
 *   · 分子/分母共用同一张"装好的裂罅"，所以它是**增量**——加一条只影响自己那一项；
 *   · 分母里有组合区已填的同类词条 → 同类乘区相加，同类词条互相稀释，
 *     「组合区已有一条暴击伤害，再选暴击伤害」的增幅会明显降低（需求方要的效果）。
 */
export function rivenCandidateGain(def, kind) {
  const ctx = store.gainCtx;
  if (!ctx) return null;

  // ── 已经在裂罅里的词条：直接返回左栏那一条的增幅（D-173）──
  //   需求方 2026-11-13：「左边的不就是其他的加上这一条火焰吗，右边不就是去掉这一条火焰吗」
  //   —— 两个数本来就**必须相等**。这里直接复用同一个函数，从源头保证一致，
  //   而不是让两条路径各算一遍（槽位号 / 虚位槽不同都会让元素合成顺序分叉）。
  const existing = rivenEntryIndexOfKey(def.key);
  if (existing >= 0) return rivenEntryGain(existing);

  // 1) 配装里除裂罅以外的所有贡献
  // 同 rivenEntryGain：统一入口取"去掉裂罅"的贡献
  const base = withSourceRemoved(ctx.contribs, RIVEN_SLOT_ID, function (r) { return r; }) || ctx.contribs;

  // 2) 分母：配装 + 组合区已填的裂罅
  const trialSlot = trialSlotNow();
  const rivenContribs = rivenToContributions(trialSlot);
  const before = metricValueOf(runCompute(base.concat(rivenContribs)));
  if (!(before > 0)) return null;

  // 3) 分子：同一张裂罅 + 这一个待选词条
  //   只追加这一条，不改动用户状态；同名词条已在组合区时，按替换算（不会重复）
  const saved = store.riven;
  let value = rivenRawValueFor(def, kind);
  if (saved) {
    for (let i = 0; i < saved.entries.length; i++) {
      const e = saved.entries[i];
      if (e && e.key === def.key) { value = e.value; break; }
    }
  }
  const extra = [buildOneContribution(def, kind, value, trialSlot)];
  if (!(before >= 0)) return null;

  // D-177：N 秒总伤下 = "加这一条之后的总伤" ÷ "当前（配装 + 当前裂罅）的总伤" − 1
  //（分母与 D-172 一致是「配装 + 当前裂罅」；分母构造与已装卡同一套）
  if (isTotalLikeMetric()) {
    return windowRatioOf(base.concat(rivenContribs), base.concat(rivenContribs, extra), extra);
  }

  // 「N 秒异常总伤」口径：**与已装 Mod / 左栏词条同一套分发**（D-182）
  if (store.ui.metric === DOT_WINDOW_METRIC) {
    const withExtra = base.concat(rivenContribs, extra);
    const role = dotRoleForWindow(extra, withExtra);
    if (role.kind === 'normal') {
      const afterV = metricValueOf(runCompute(withExtra));
      return ratioGainOf(before, afterV);
    }
    if (role.kind === 'split') {
      return dotFactorOfCard(extra, runCompute(base.concat(rivenContribs)), withExtra);
    }
    return 0;
  }

  const after = metricValueOf(runCompute(base.concat(rivenContribs).concat(extra)));
  if (!(after >= 0)) return null;
  return after / before - 1;
}

/** 用一条词条的值，直接构造它的内核贡献（不经过全局状态，避免污染） */
function buildOneContribution(def, kind, value, slot) {
  const sign = kind === 'neg' ? -1 : 1;
  return {
    stat: def.stat,
    form: 'pct',
    amount: sign * value,
    source: RIVEN_SLOT_ID,
    slot: slot,
    label: '裂罅 ' + def.label,
  };
}
