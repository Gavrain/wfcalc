/**
 * 卡面 / 词条上的**文字**。
 *
 * 这里只做「属性键 → 中文标签」「词条值 → 显示文本」这类**纯展示**换算，
 * 不碰任何计算；数值口径与内核一致（内核算多少，这里就显示多少）。
 */
import { ELEMENT_LABEL, bucketLabel } from './app-store.js';
import { SET_BONUS_EFFECTS } from '../../data/src/manual/mods.ts';
const STAT_LABEL = {
  accuracy: '精准度',
  ammoEfficiency: '弹药效率',
  ammoMax: '弹药上限',
  baseDamage: '伤害',
  bladeShadow: '刃影追加攻击',
  critChance: '暴击几率',
  critMultiplier: '暴击伤害',
  explosionRadius: '爆炸范围',
  faction: '派系伤害',
  fireRate: '射速',
  impactToSlash: '冲击转切割',
  magazine: '弹匣容量',
  meleeRange: '攻击范围',
  movementSpeed: '移动速度',
  multishot: '多重射击',
  projectileSpeed: '弹速',
  punchThrough: '穿透',
  recoil: '后坐力',
  reloadSpeed: '装填速度',
  slashOnCrit: '暴击时触发切割',
  statusChance: '触发几率',
  statusDamage: '异常状态伤害',
  statusDuration: '异常状态持续时间',
  weakpointCritChance: '弱点暴击几率',
  weakpointDamage: '弱点伤害',
  zoom: '变焦',
  healthPerHit: '每次命中回复生命',
};

const SET_LABELS = { sacrifice: '牺牲', vigilante: '私法', nira: '混沌', gladiator: '角斗士' };

/** 词条名 → 中文；元素/物理类型走 ELEMENT_LABEL */
export function statLabel(stat) {
  if (stat.indexOf('elemental:') === 0) return ELEMENT_LABEL[stat.slice(10)] || stat.slice(10);
  if (stat.indexOf('physical:') === 0) return ELEMENT_LABEL[stat.slice(9)] || stat.slice(9);
  if (stat.indexOf('faction:') === 0) return '派系伤害';
  return STAT_LABEL[stat] || stat;
}

/**
 * 一条**普通 Mod** 词条在卡面上的文本（需求方 2026-11-14：**按卡面描述区分**）：
 *
 * ```
 * 描述里带 X%      → 百分比       膛线 +165%、重口径 −55% 精准度、过激真相 +X% 真言
 * 描述里是 +X 米   → 米           合金钻头 +2.1m、剑风 +1.5m
 * 描述里是 +Xs     → 秒           邪恶蓄力 −0.5s（原文 `-50% Combo Duration` 与 wiki 表一致，存的是 −0.5 秒）
 * 描述里是 +X 发   → 只写数       过激真相 +40 弹匣容量
 * 描述里是 +X 连击 → 次           邪恶蓄力 +30 Initial Combo
 * ```
 *
 * 判据是数据层给的 `unit` + 这张卡的 `descriptionEn`，**不是**按属性名一刀切
 * （弹匣容量在裂罅上是百分比、在过激真相上是固定 40 发，靠属性名分不出来）。
 *
 * ⚠ 只影响**显示**：内核读的是 `unit` 与数值本身，这一层不改任何计算。
 */
export function modStatText(s, value, descriptionEn) {
  const desc = String(descriptionEn || '');
  const sign = value > 0 ? '+' : value < 0 ? '−' : '+';
  const num = String(Math.round(Math.abs(value) * 100) / 100);
  const body = sign + num;
  const says = function (re) { return re.test(desc); };
  if (s.unit === 'flat') {
    if (says(/Xm\b|X\s*m\b/)) return body + 'm';
    if (says(/Xs\b/)) return body + 's';
    if (s.stat === 'comboInitial') return body + ' 连击';
    return body;
  }
  // 数据层标成 percent、但描述写的其实是「米」（目前没有此类，留个兜底）
  if (says(/\+Xm\b/)) return body + 'm';
  return body + '%';
}

/**
 * 卡面上的「限制」说明（需求方 2026-11-13：「多重无法修改\射速无法修改。这样才叫简洁！」）。
 *
 * | Mod | 卡面文字 |
 * |---|---|
 * | 半自动炮轰系列（Semi-*-Cannonade） | 射速无法修改 |
 * | 敏锐主武 / 敏锐手枪 | 多重无法修改 |
 */
export function modLockNotes(mod) {
  if (!mod) return [];
  if (mod.id === 'semi_pistol_cannonade' || mod.id === 'semi_rifle_cannonade' || mod.id === 'semi_shotgun_cannonade') return ['射速无法修改'];
  if (mod.id === 'primary_acuity' || mod.id === 'pistol_acuity') return ['多重无法修改'];
  return [];
}

export function setNoteOf(mod) {
  const set = mod && mod.set;
  if (!set) return null;
  const eff = SET_BONUS_EFFECTS[set];
  if (!eff) return null;
  const label = SET_LABELS[set] || set;
  if (eff.kind === 'scaleOwnMods') {
    return label + '套装：Mod 数值 ×' + eff.value;
  }
  if (eff.kind === 'critChanceFlat') {
    return label + '套装：+' + eff.value + '% 几率强化主武器暴击';
  }
  if (eff.kind === 'slamDamage') {
    return label + '套装：+' + eff.value + '% 震地攻击伤害';
  }
  if (eff.kind === 'critChancePerCombo') {
    return label + '套装：+' + eff.value + '% × 连击倍率';
  }
  return null;
}