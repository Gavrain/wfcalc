// 列出选定范围（主要/次要/近战/神威/和平/残差/弓箭/霰弹/双枪/瀑流/联结/凝集/分形）的全部赋能，
// 并标注数值语义，供人工核对。
import { readFileSync } from 'node:fs';

const arcs = JSON.parse(readFileSync('.cache/export/ExportArcanes.json', 'utf8'));
const zh = JSON.parse(readFileSync('.cache/export/langZh.json', 'utf8'));
const en = JSON.parse(readFileSync('.cache/export/langEn.json', 'utf8'));

const PREFIXES = ['主要·', '次要·', '近战·', '神威·', '和平·', '残差·', '弓箭·', '霰弹·', '双枪·', '瀑流·', '联结·', '凝集·', '分形·'];

function render(node, dict) {
  if (node == null) return '';
  if (typeof node === 'string') return dict[node] ?? node;
  if (Array.isArray(node)) return node.map((n) => render(n, dict)).join('');
  if (typeof node === 'object') {
    const tpl = node.tag ? (dict[node.tag] ?? `⟨${node.tag.split('/').pop()}⟩`) : '';
    const sub = {};
    for (const [k, v] of Object.entries(node.sub ?? {})) {
      sub[k] = typeof v === 'object' && v !== null ? render(v, dict) : typeof v === 'string' && dict[v] ? dict[v] : v;
    }
    let out = tpl;
    for (const [k, v] of Object.entries(sub)) {
      for (const form of [k, k.toLowerCase(), k.toUpperCase()]) out = out.split(`|${form}|`).join(String(v));
    }
    return out;
  }
  return String(node);
}

const rows = [];
for (const [k, a] of Object.entries(arcs)) {
  const n = zh[a.name] ?? a.name;
  const p = PREFIXES.find((x) => n.startsWith(x));
  if (!p) continue;
  const ls = a.levelStats ?? [];
  rows.push({
    prefix: p,
    id: k.split('/').pop(),
    en: en[a.name] ?? a.name,
    zh: n.trim(),
    maxRank: Math.max(0, ls.length - 1),
    rarity: a.rarity,
    rank0: ls[0] ? render(ls[0], zh).replace(/\s+/g, ' ').trim() : '',
    rankMax: ls.at(-1) ? render(ls.at(-1), zh).replace(/\s+/g, ' ').trim() : '',
    subs: ls.at(-1) ? JSON.stringify(ls.at(-1)).match(/"sub":\{([^}]*)\}/)?.[1] ?? '' : '',
  });
}

rows.sort((a, b) => PREFIXES.indexOf(a.prefix) - PREFIXES.indexOf(b.prefix) || a.zh.localeCompare(b.zh));
console.log('总计:', rows.length);
for (const p of PREFIXES) {
  const g = rows.filter((r) => r.prefix === p);
  console.log(`\n===== ${p} (${g.length}) =====`);
  for (const r of g) {
    console.log(`${r.zh} / ${r.en}  [maxRank=${r.maxRank}]  id=${r.id}`);
    console.log(`  满级: ${r.rankMax}`);
  }
}
