import fs from 'node:fs';
const all = [];
for (const f of ['primary', 'secondary', 'melee', 'archgun', 'archmelee']) {
  for (const w of JSON.parse(fs.readFileSync(`packages/data/src/generated/weapons/${f}.json`, 'utf8')).weapons) all.push({ ...w, file: f });
}

// 灵化缺失：清单内但无 incarnon role
// 清单直接从 manual/incarnon.ts 解析（原来的 .cache/incarnon-map.json 已不再维护）
const incSrc = fs.readFileSync('packages/data/manual/incarnon.ts', 'utf8');
const list = {};
for (const m of incSrc.matchAll(/^  "([^"]+)": \{ source:/gm)) list[m[1]] = true;
const norm = (s) => s.toLowerCase().replace(/[\s'\-&]/g, '');
const listN = new Set(Object.keys(list).map(norm));
const PRE = ['mk1', 'prisma', 'prime', 'vandal', 'wraith', 'telos', 'sancti', 'rakta', 'synoid', 'dex', 'kuva', 'coda'];
function hit(id) {
  const n = norm(id);
  if (listN.has(n)) return true;
  for (const p of PRE) if (n.startsWith(p) && listN.has(n.slice(p.length))) return true;
  return false;
}
const incMissing = all.filter((w) => hit(w.id) && !w.modes.some((m) => m.role === 'incarnon')).map((w) => w.id).sort();

// trigger unknown：仅枪械
const triggerUnknown = all
  .filter((w) => ['primary', 'secondary', 'archgun'].includes(w.category))
  .filter((w) => w.modes.some((m) => m.trigger === 'unknown'))
  .map((w) => w.id)
  .sort();

// 灵化面板复用基础面板（D-110 / D-111）：模式是生成的，但面板数值是占位值
const panelReused = all
  .filter((w) => w.modes.some((m) => m.role === 'incarnon' && m._manual === 'panel-reused'))
  .map((w) => w.id)
  .sort();

const idOf = new Map(all.map((w) => [w.id, w]));
const fmt = (ids) => ids.map((id) => `  ${JSON.stringify(id)}: [${'PLACEHOLDER'}],`).join('\n');

const body = `/**
 * 武器数据的「已知问题」清单（人工层，D-101）。
 *
 * **用途**：需求方在武器切换下拉栏里能一眼看到哪些武器的数据不完整，
 * 选中后去「编辑面板」（开发者编辑模式）修正，避免拿着错数据算半天。
 *
 * **原则**：只登记**已确认有问题**的武器，宁可少登记也不要误标——
 * 误标会让用户以为没问题的武器也有问题。
 *
 * 生成方式：\`node packages/data/manual/find-issues.mjs\`（重新产出数据后可复核）。
 * 抓取/生成日期：2026-11-06。
 */
export type WeaponIssueCode =
  /** 灵化武器清单里有，但导出数据没有灵化 behaviour，灵化形态缺失 */
  | 'incarnonMissing'
  /** 灵化模式已生成，但面板数值是"复用基础面板"的占位值（D-110 / D-111） */
  | 'incarnonPanelReused'
  /** 枪械的射击模式 trigger 无法从 stateName 识别（多为射线/持续类） */
  | 'triggerUnknown';

export interface WeaponIssue {
  code: WeaponIssueCode;
  /** 给用户看的一行说明 */
  note: string;
  /** 判定依据的来源 */
  _source: string;
}

const INCARNON_MISSING: WeaponIssue = {
  code: 'incarnonMissing',
  note: '灵化形态缺失',
  _source: 'manual/incarnon.ts 清单内有此武器，但 ExportWeapons 只有 1 个 behaviour，灵化形态没有导出',
};

const INCARNON_PANEL_REUSED: WeaponIssue = {
  code: 'incarnonPanelReused',
  note: '灵化面板未收录（复用基础面板）',
  _source: 'manual/incarnon-stats.ts 里还没有这把武器的灵化数值，面板暂按基础面板占位',
};

const TRIGGER_UNKNOWN: WeaponIssue = {
  code: 'triggerUnknown',
  note: '射击模式未识别',
  _source: 'ExportWeapons 的 stateName 无法映射到 auto/semi/burst/charge/held（多为射线/持续类）',
};

/**
 * 武器 id（generated 里的 id）→ 问题列表。
 */
export const WEAPON_ISSUES: Readonly<Record<string, WeaponIssue[]>> = {
\${INC_IDS}
\${PANEL_IDS}
\${TRIGGER_IDS}
};

/** 查某把武器的问题列表（空数组表示没问题） */
export function issuesOf(weaponId: string | undefined): WeaponIssue[] {
  if (!weaponId) return [];
  return WEAPON_ISSUES[weaponId] ?? [];
}

/** 是否有任何已知问题 */
export function hasIssues(weaponId: string | undefined): boolean {
  return issuesOf(weaponId).length > 0;
}
`;

const incIds = incMissing.map((id) => `  ${JSON.stringify(id)}: [INCARNON_MISSING],`).join('\n');
const panelIds = panelReused.map((id) => `  ${JSON.stringify(id)}: [INCARNON_PANEL_REUSED],`).join('\n');
const trigIds = triggerUnknown.map((id) => `  ${JSON.stringify(id)}: [TRIGGER_UNKNOWN],`).join('\n');

// 注释分组
const out = body
  .replace('${INC_IDS}', `  // ── 灵化形态缺失（${incMissing.length} 把，D-100 已知限制）──\n${incIds}\n`)
  .replace('${PANEL_IDS}', `  // ── 灵化面板复用基础面板（${panelReused.length} 把，D-111）──\n${panelIds}\n`)
  .replace('${TRIGGER_IDS}', `  // ── 射击模式未识别（${triggerUnknown.length} 把枪械，多为射线/持续类）──\n${trigIds}\n`);

fs.writeFileSync('packages/data/manual/weapon-issues.ts', out, 'utf8');
console.log('灵化缺失:', incMissing.length, '把');
console.log('灵化面板复用:', panelReused.length, '把');
console.log('trigger 未知:', triggerUnknown.length, '把');
console.log('合计:', incMissing.length + panelReused.length + triggerUnknown.length);
