/**
 * 套装效果（需求方 2026-11-18 确认：实现只在内核这一份）。
 *
 * 主界面与验证页都调这里，避免两份实现算得不一样。
 *
 * **内核只认「套名 → 张数」这个纯数据**，不认识数据层的 Mod 记录，也不碰界面状态：
 * 调用方各自数好件数传进来（它本来就知道自己装了哪些卡）。
 *
 * 四套的规则（数据见 `data/src/manual/mods.ts` 的 `SET_BONUS_EFFECTS`）：
 *   · 牺牲  sacrifice  ×1.25 一次，放大**本套 Mod 自身**的数值（所以要拿到本套的贡献）
 *   · 私法  vigilante  每件 +5% **固定**暴击率
 *   · 混沌  nira       每件 +150% 震地伤害
 *   · 角斗士 gladiator 每件 +10% × （连击倍率 − 1）
 *
 * 依据：核心事实 §11（数据结构化事实）+ §6（连击倍率加成）。
 */
import type { Contribution } from './contributions.ts';

/** 四套的数值定义（与数据层 `SET_BONUS_EFFECTS` 同构，这里复制一份以免内核依赖数据层） */
export interface SetBonusEffect {
  /** 武器上最多算几件（战甲卡不计入） */
  weaponMods: number;
  kind: 'scaleOwnMods' | 'critChanceFlat' | 'slamDamage' | 'critChancePerCombo';
  value: number;
}

export const SET_BONUS_EFFECTS: Readonly<Record<string, SetBonusEffect>> = {
  sacrifice: { weaponMods: 2, kind: 'scaleOwnMods', value: 1.25 },
  vigilante: { weaponMods: 4, kind: 'critChanceFlat', value: 5 },
  nira: { weaponMods: 1, kind: 'slamDamage', value: 150 },
  gladiator: { weaponMods: 3, kind: 'critChancePerCombo', value: 10 },
};

const SET_LABELS: Readonly<Record<string, string>> = {
  sacrifice: '牺牲',
  vigilante: '私法',
  nira: '混沌',
  gladiator: '角斗士',
};

export interface SetBonusInput {
  /** 套装 id → 武器上装了几件 */
  counts: Readonly<Record<string, number>>;
  /**
   * 连击倍率（**原值**，如 12）。角斗士用 `倍率 − 1`，与急进猛突同类。
   * 缺省按 1（不加成）。
   */
  comboMultiplier?: number;
  /**
   * 取某套 Mod 的**自身贡献**——只有「牺牲」需要（它要放大本套卡）。
   *
   * 不传时牺牲的 ×1.25 不会被算出来（调用方没提供本套数值，无从放大）。
   * 返回的贡献里带 `slot` 就原样带走，元素配对要用。
   */
  contributionsOfSet?: (setId: string) => readonly Contribution[];
}

/**
 * 套装效果产生的贡献。
 *
 * @returns 新增的贡献数组（调用方追加到自己那份之后即可）
 */
export function setBonusContributions(input: SetBonusInput): Contribution[] {
  const out: Contribution[] = [];
  const counts = input.counts || {};
  const combo = Math.max(0, Number(input.comboMultiplier ?? 1) - 1);

  // 固定顺序遍历，保证输出可复现
  for (const setId of Object.keys(SET_BONUS_EFFECTS)) {
    const n = Number(counts[setId] || 0);
    if (!(n > 0)) continue;
    const eff = SET_BONUS_EFFECTS[setId];
    if (!eff) continue;
    const usable = Math.min(n, eff.weaponMods);
    if (usable <= 0) continue;
    const zh = SET_LABELS[setId] || setId;

    if (eff.kind === 'scaleOwnMods') {
      // ×1.25 一次：只放大本套 Mod 自己的数值，等价于给它们补一份增量
      if (usable < 2) continue; // 1 件时没有套装加成
      const own = input.contributionsOfSet ? input.contributionsOfSet(setId) : [];
      if (!own.length) continue;
      const extra = eff.value - 1;
      for (const c of own) {
        const scaled: Contribution = {
          stat: c.stat,
          form: c.form,
          amount: c.amount * extra,
          source: setId,
          label: `${zh}套装 ×${eff.value}`,
        };
        if (c.slot !== undefined) scaled.slot = c.slot;
        out.push(scaled);
      }
    } else if (eff.kind === 'critChanceFlat') {
      out.push({
        stat: 'critChance',
        form: 'flat',
        // 每件 +5% 固定暴击率。⚠ 暴击率的面板是小数口径（0.22），
        // 所以 +5 个百分点必须写成 0.05 才能让 `面板×(1+pct) + flat` 加对。
        amount: (eff.value / 100) * usable,
        source: setId,
        label: `${zh}套装 ${usable} 件：+${eff.value * usable}% 固定暴击率`,
      });
    } else if (eff.kind === 'slamDamage') {
      out.push({
        stat: 'slamDamage',
        form: 'pct',
        amount: eff.value * usable,
        source: setId,
        label: `${zh}套装 ${usable} 件：+${eff.value * usable}% 震地伤害`,
      });
    } else if (eff.kind === 'critChancePerCombo') {
      if (combo <= 0) continue; // 1x 不加
      out.push({
        stat: 'critChance',
        form: 'pct',
        amount: eff.value * usable * combo,
        source: setId,
        label: `${zh}套装 ${usable} 件：+${eff.value * usable}% × 连击倍率系数 ${combo}`,
      });
    }
  }
  return out;
}

/** 供界面显示：套装的数值定义与中文名 */
export function setBonusInfo(): Readonly<Record<string, { effect: SetBonusEffect; label: string }>> {
  const out: Record<string, { effect: SetBonusEffect; label: string }> = {};
  for (const [id, effect] of Object.entries(SET_BONUS_EFFECTS)) {
    out[id] = { effect, label: SET_LABELS[id] || id };
  }
  return out;
}
