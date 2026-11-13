/**
 * 灵化里的**射线**攻击（人工层，D-160）。
 *
 * **为什么需要这张表**：射线判据只看扳机（`held`），普通模式够用——
 * 全库 38 把扳机 `Held` 的武器，每一把至少有一条 `Hit-Scan` 攻击，判得准。
 * 但**灵化攻击 WFCD 一律不写 `Held`**，只给一个 `shot_type`：
 *
 * ```
 * Torid         Incarnon Form              Hit-Scan     ← 灵化是射线
 * Boar          Incarnon Form              Hit-Scan     ← 灵化是射线
 * Braton        Incarnon Form              Hit-Scan     ← 灵化**不是**射线（实弹）
 * Onos          Incarnon Form Held Damage  Projectile   ← 名字带 Held 的才是射线
 * ```
 *
 * 托里德 / 野猪 / 布莱顿三者在 `shot_type` 上是同一个值，**WFCD 字段分不出来**。
 * 能分出来的只有"知不知道它是射线"这件事，而灵化武器更新极少，
 * 所以需求方 2026-11-12 定：**灵化单独记表**。
 *
 * **判据**（需求方 2026-11-12 原话）：
 * > 「那就所有普通模式，包括主要模式和次要射击都用 held 来判断，
 * >   灵化武器则单独记表，因为灵化武器更新很少。」
 * > 「盗贼 赘骨 野猪 托里德的灵化是射线，注意赘骨的两个 charge 不是射线。」
 *
 * 表里没列到的灵化武器一律按实弹算（布莱顿、锡卡鲁斯、索玛、德拉…）。
 *
 * ⚠ 人工推断（CLAUDE.md 规则 3）：每条都带 `reason`，能回答"哪来的"。
 * 这里的依据是需求方的游戏内判断，不是数据源字段。
 */
export interface IncarnonBeamEntry {
  /** 武器英文名（WFCD `name`） */
  weapon: string;
  /**
   * 灵化模式里**哪几条攻击**是射线：按 WFCD 攻击名**整名匹配**（不区分大小写）。
   *
   * 不匹配的攻击照常按非射线处理——赘骨的 `Incarnon Form Charge Attack` /
   * `Incarnon Form Charge Radial Attack` 就是靠这一点留在蓄力 / 爆炸那边。
   */
  attacks: readonly string[];
  /** 依据 */
  reason: string;
}

export const INCARNON_BEAM_ATTACKS: readonly IncarnonBeamEntry[] = [
  {
    weapon: 'Torid',
    attacks: ['Incarnon Form'],
    reason: '需求方 2026-11-12：托里德的灵化形态是射线（WFCD 只记 shot_type=Hit-Scan，与布莱顿无法区分）',
  },
  {
    weapon: 'Boar',
    attacks: ['Incarnon Form'],
    reason: '需求方 2026-11-12：野猪的灵化形态是射线',
  },
  {
    weapon: 'Boar Prime',
    attacks: ['Incarnon Form'],
    reason: '需求方 2026-11-12：野猪的灵化形态是射线（Prime 同款）',
  },
  {
    weapon: 'Onos',
    attacks: ['Incarnon Form Held Damage'],
    reason: '需求方 2026-11-12：赘骨只有名字带 Held 那条是射线；两个 Charge（蓄力本体 / 蓄力范围）不是射线',
  },
  {
    weapon: 'Furis',
    attacks: ['Incarnon Form'],
    reason: '需求方 2026-11-12：盗贼（Furis）的灵化形态是射线',
  },
];

/** 归一化武器名：去掉空格/连字符/撇号并转小写（与 `incarnon.ts` 同一套约定） */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s'\-&]/g, '');
}

/**
 * 灵化攻击是否在射线表里。
 *
 * @param weaponName WFCD 武器名（`Torid` / `Boar Prime` …）
 * @param attackName WFCD 攻击名（`Incarnon Form` / `Incarnon Form Held Damage` …）
 */
export function isIncarnonBeamAttack(weaponName: string, attackName: string): boolean {
  const w = normalize(weaponName);
  const a = normalize(attackName);
  const entry = INCARNON_BEAM_ATTACKS.find((e) => normalize(e.weapon) === w);
  if (!entry) return false;
  return entry.attacks.some((n) => normalize(n) === a);
}
