/**
 * 灵化武器清单（人工层，D-100）。
 *
 * **来源**：灰机 wiki「灵化」页面 `index.php?title=灵化&action=raw`，抓取于 **2026-11-06**。
 * 官方 `ExportWeapons` **没有灵化标记**（`defaultUpgrades` 是玄骸元素/近战姿态，与灵化无关），
 * 灵化形态的触发方式又五花八门（全自动 / 半自动 / 蓄力 / 点射），
 * 靠 behaviour 结构推断会误判——所以用这份人工清单。
 *
 * 实测反例：
 * ```
 * Braton Prime   两个 behaviour 都叫 Loadout_TriggerAuto，第二个才是灵化（伤害 70 vs 35）
 * Burston Prime  TriggerBurst + TriggerAuto  ← 灵化把扳机从点射改成了全自动
 * Torid          TriggerSemiAuto + Continous
 * ```
 *
 * **用法**：清洗阶段若武器命中本表，且 behaviour 数 = 普通模式数 + 1，
 * 则把**最后一个** behaviour 标为 `role: 'incarnon'`。
 *
 * **数值**：灵化形态的暴击/触发面板暂未收录（需求方 2026-11-06：先不填数值，只做识别）。
 */
export interface IncarnonEntry {
  /** 灵化来源：原生灵化或对应的灵化之源名称 */
  source: string;
  /** innate = 原生灵化武器；genesis = 需要安装灵化之源 */
  kind: 'innate' | 'genesis';
}

export const INCARNON_WEAPONS: Readonly<Record<string, IncarnonEntry>> = {
  "Ack & Brunt": { source: "Ack & Brunt Incarnon Genesis", kind: 'genesis' },
  "Angstrum": { source: "Angstrum Incarnon Genesis", kind: 'genesis' },
  "Anku": { source: "Anku Incarnon Genesis", kind: 'genesis' },
  "Atomos": { source: "Atomos Incarnon Genesis", kind: 'genesis' },
  "Ballistica": { source: "Ballistica Incarnon Genesis", kind: 'genesis' },
  "Ballistica Prime": { source: "Ballistica Incarnon Genesis", kind: 'genesis' },
  "Bo": { source: "Bo Incarnon Genesis", kind: 'genesis' },
  "Bo Prime": { source: "Bo Incarnon Genesis", kind: 'genesis' },
  "Boar": { source: "Boar Incarnon Genesis", kind: 'genesis' },
  "Boar Prime": { source: "Boar Incarnon Genesis", kind: 'genesis' },
  "Boltor": { source: "Boltor Incarnon Genesis", kind: 'genesis' },
  "Boltor Prime": { source: "Boltor Incarnon Genesis", kind: 'genesis' },
  "Braton": { source: "Braton Incarnon Genesis", kind: 'genesis' },
  "Braton Prime": { source: "Braton Incarnon Genesis", kind: 'genesis' },
  "Braton Vandal": { source: "Braton Incarnon Genesis", kind: 'genesis' },
  "Bronco": { source: "Bronco Incarnon Genesis", kind: 'genesis' },
  "Bronco Prime": { source: "Bronco Incarnon Genesis", kind: 'genesis' },
  "Burston": { source: "Burston Incarnon Genesis", kind: 'genesis' },
  "Burston Prime": { source: "Burston Incarnon Genesis", kind: 'genesis' },
  "Ceramic Dagger": { source: "Ceramic Dagger Incarnon Genesis", kind: 'genesis' },
  "Cestra": { source: "Cestra Incarnon Genesis", kind: 'genesis' },
  "Dera": { source: "Dera Incarnon Genesis", kind: 'genesis' },
  "Dera Vandal": { source: "Dera Incarnon Genesis", kind: 'genesis' },
  "Despair": { source: "Despair Incarnon Genesis", kind: 'genesis' },
  "Destreza": { source: "Destreza Incarnon Genesis", kind: 'genesis' },
  "Destreza Prime": { source: "Destreza Incarnon Genesis", kind: 'genesis' },
  "Dex Sybaris": { source: "Sybaris Incarnon Genesis", kind: 'genesis' },
  "Dread": { source: "Dread Incarnon Genesis", kind: 'genesis' },
  "Dual Ichor": { source: "Dual Ichor Incarnon Genesis", kind: 'genesis' },
  "Dual Toxocyst": { source: "Dual Toxocyst Incarnon Genesis", kind: 'genesis' },
  "Felarx": { source: "原生灵化（扎里曼号）", kind: 'innate' },
  "Furax": { source: "Furax Incarnon Genesis", kind: 'genesis' },
  "Furax Wraith": { source: "Furax Incarnon Genesis", kind: 'genesis' },
  "Furis": { source: "Furis Incarnon Genesis", kind: 'genesis' },
  "Gammacor": { source: "Gammacor Incarnon Genesis", kind: 'genesis' },
  "Gorgon": { source: "Gorgon Incarnon Genesis", kind: 'genesis' },
  "Gorgon Wraith": { source: "Gorgon Incarnon Genesis", kind: 'genesis' },
  "Hate": { source: "Hate Incarnon Genesis", kind: 'genesis' },
  "Innodem": { source: "原生灵化（扎里曼号）", kind: 'innate' },
  "Kunai": { source: "Kunai Incarnon Genesis", kind: 'genesis' },
  "Laetum": { source: "原生灵化（扎里曼号）", kind: 'innate' },
  "Lato": { source: "Lato Incarnon Genesis", kind: 'genesis' },
  "Lato Prime": { source: "Lato Incarnon Genesis", kind: 'genesis' },
  "Lato Vandal": { source: "Lato Incarnon Genesis", kind: 'genesis' },
  "Latron": { source: "Latron Incarnon Genesis", kind: 'genesis' },
  "Latron Prime": { source: "Latron Incarnon Genesis", kind: 'genesis' },
  "Latron Wraith": { source: "Latron Incarnon Genesis", kind: 'genesis' },
  "Lex": { source: "Lex Incarnon Genesis", kind: 'genesis' },
  "Lex Prime": { source: "Lex Incarnon Genesis", kind: 'genesis' },
  "Magistar": { source: "Magistar Incarnon Genesis", kind: 'genesis' },
  "Miter": { source: "Miter Incarnon Genesis", kind: 'genesis' },
  "MK1-Bo": { source: "Bo Incarnon Genesis", kind: 'genesis' },
  "MK1-Braton": { source: "Braton Incarnon Genesis", kind: 'genesis' },
  "MK1-Furis": { source: "Furis Incarnon Genesis", kind: 'genesis' },
  "MK1-Kunai": { source: "Kunai Incarnon Genesis", kind: 'genesis' },
  "MK1-Paris": { source: "Paris Incarnon Genesis", kind: 'genesis' },
  "Nami Solo": { source: "Nami Solo Incarnon Genesis", kind: 'genesis' },
  "Obex": { source: "Obex Incarnon Genesis", kind: 'genesis' },
  "Okina": { source: "Okina Incarnon Genesis", kind: 'genesis' },
  "Okina Prime": { source: "Okina Incarnon Genesis", kind: 'genesis' },
  "Onos": { source: "原生灵化（解剖圣所）", kind: 'innate' },
  "Paris": { source: "Paris Incarnon Genesis", kind: 'genesis' },
  "Paris Prime": { source: "Paris Incarnon Genesis", kind: 'genesis' },
  "Phenmor": { source: "原生灵化（扎里曼号）", kind: 'innate' },
  "Praedos": { source: "原生灵化（扎里曼号）", kind: 'innate' },
  "Prisma Angstrum": { source: "Angstrum Incarnon Genesis", kind: 'genesis' },
  "Prisma Gorgon": { source: "Gorgon Incarnon Genesis", kind: 'genesis' },
  "Prisma Obex": { source: "Obex Incarnon Genesis", kind: 'genesis' },
  "Prisma Skana": { source: "Skana Incarnon Genesis", kind: 'genesis' },
  "Rakta Ballistica": { source: "Ballistica Incarnon Genesis", kind: 'genesis' },
  "Ruvox": { source: "原生灵化（解剖圣所）", kind: 'innate' },
  "Sancti Magistar": { source: "Magistar Incarnon Genesis", kind: 'genesis' },
  "Sibear": { source: "Sibear Incarnon Genesis", kind: 'genesis' },
  "Sicarus": { source: "Sicarus Incarnon Genesis", kind: 'genesis' },
  "Sicarus Prime": { source: "Sicarus Incarnon Genesis", kind: 'genesis' },
  "Skana": { source: "Skana Incarnon Genesis", kind: 'genesis' },
  "Skana Prime": { source: "Skana Incarnon Genesis", kind: 'genesis' },
  "Soma": { source: "Soma Incarnon Genesis", kind: 'genesis' },
  "Soma Prime": { source: "Soma Incarnon Genesis", kind: 'genesis' },
  "Strun": { source: "Strun Incarnon Genesis", kind: 'genesis' },
  "Strun Prime": { source: "Strun Incarnon Genesis", kind: 'genesis' },
  "Strun Wraith": { source: "Strun Incarnon Genesis", kind: 'genesis' },
  "Stug": { source: "Stug Incarnon Genesis", kind: 'genesis' },
  "Sybaris": { source: "Sybaris Incarnon Genesis", kind: 'genesis' },
  "Sybaris Prime": { source: "Sybaris Incarnon Genesis", kind: 'genesis' },
  "Synoid Gammacor": { source: "Gammacor Incarnon Genesis", kind: 'genesis' },
  "Telos Boltor": { source: "Boltor Incarnon Genesis", kind: 'genesis' },
  "Thalys": { source: "原生灵化（织屿人）", kind: 'innate' },
  "Torid": { source: "Torid Incarnon Genesis", kind: 'genesis' },
  "Vasto": { source: "Vasto Incarnon Genesis", kind: 'genesis' },
  "Vasto Prime": { source: "Vasto Incarnon Genesis", kind: 'genesis' },
  "Vectis": { source: "Vectis Incarnon Genesis", kind: 'genesis' },
  "Vectis Prime": { source: "Vectis Incarnon Genesis", kind: 'genesis' },
  "Zylok": { source: "Zylok Incarnon Genesis", kind: 'genesis' },
  "Zylok Prime": { source: "Zylok Incarnon Genesis", kind: 'genesis' },
};

/**
 * 归一化：去掉空格/连字符/撇号并转小写。
 *
 * 官方导出里武器的 `uniqueName` 末段是**紧凑写法**（`BratonPrime`、`DualToxocyst`），
 * 而 wiki 上是**带空格的显示名**（`Braton Prime`、`Dual Toxocyst`）。
 * 两侧都归一化后再比对，才能匹配上。
 */
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[\s'\-&]/g, '');
}

/** 归一化索引（模块加载时建一次） */
const NORMALIZED: ReadonlyMap<string, IncarnonEntry> = new Map(
  Object.entries(INCARNON_WEAPONS).map(([k, v]) => [normalizeName(k), v]),
);

/** 按武器英文名（或 uniqueName 末段）查灵化信息 */
export function incarnonInfoOf(englishName: string | undefined): IncarnonEntry | undefined {
  if (!englishName) return undefined;
  const direct = INCARNON_WEAPONS[englishName] ?? NORMALIZED.get(normalizeName(englishName));
  if (direct) return direct;

  // 兜底：uniqueName 的变体前缀写法和显示名的词序不同。
  //   `PrimeBurston`（prefix）  ↔ `Burston Prime`（suffix）
  //   `MK1Braton`     （prefix）  ↔ `MK1-Braton`   （已由归一化覆盖）
  //   `VandalBraton`  （prefix）  ↔ `Braton Vandal`
  const PREFIXES = ['MK1', 'Prisma', 'Prime', 'Vandal', 'Wraith', 'Telos', 'Sancti', 'Rakta', 'Synoid', 'Dex', 'Kuva', 'Coda'];
  for (const p of PREFIXES) {
    if (englishName.startsWith(p) && englishName.length > p.length) {
      const rest = englishName.slice(p.length);
      // 拼成 "<Base> <Prefix>" 再试
      const alt = NORMALIZED.get(normalizeName(rest + p));
      if (alt) return alt;
    }
  }
  return undefined;
}
