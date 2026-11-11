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
import { compute } from '../../core/src/index.ts';
import { arcaneToContributions, isConditionOverloadMod, modToContributions } from '../../data/src/adapter.ts';
import { modName } from './app-data.js';
import { EXILUS_INDEX, MAX_SLOTS, SLOT_COUNT, store } from './app-store.js';

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
  const out = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const id = store.modSlots[i];
    if (!id) continue;
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
  return out;
}
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
  // 槽位排在末尾，不影响其它 Mod 的元素合成顺序
  const extra = modToContributions(mod, mod.maxRank, SLOT_COUNT);
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
  // 槽位排在末尾，不影响其它 Mod 的元素合成顺序
  const preview = modToContributions(ref.mod, ref.mod.maxRank, SLOT_COUNT);
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
export function marginalGainOf(contribs, current, sourceId) {
  const rest = [];
  for (let i = 0; i < contribs.length; i++) if (contribs[i].source !== sourceId) rest.push(contribs[i]);
  if (rest.length === contribs.length) return null; // 该装备没有产出任何贡献
  const without = metricValueOf(runCompute(rest));
  if (!(without > 0)) return null; // 拿掉后为 0（或负数）→ 比例无意义
  return current / without - 1;
}

/** 某件装备相对「不上它」时当前指标的提升比例（复用 renderAll 算好的基准，避免重复计算） */
export function gainOf(sourceId) {
  const ctx = store.gainCtx;
  if (!ctx) return null;
  return marginalGainOf(ctx.contribs, ctx.current, sourceId);
}
