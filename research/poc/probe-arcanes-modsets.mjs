// 检查 ExportArcanes / ExportModSet 是否带数值，能否补 ZK 表里没覆盖的层。
import { writeFileSync } from 'node:fs';

const BASE = 'https://browse.wf/warframe-public-export-plus/';

async function get(name) {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name} HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(`.cache/export/${name}`, text);
  return JSON.parse(text);
}

const arcanes = await get('ExportArcanes.json');
const arcKeys = Object.keys(arcanes);
console.log('=== ExportArcanes ===', arcKeys.length);
const a0 = arcanes[arcKeys[0]];
console.log('样例字段:', JSON.stringify(a0, null, 1).slice(0, 1200));

// 是否有等级数值
const withLevels = arcKeys.filter((k) => arcanes[k].levelStats || arcanes[k].stats || arcanes[k].levels);
console.log('带等级数值的:', withLevels.length);
if (withLevels.length) console.log(JSON.stringify(arcanes[withLevels[0]], null, 1).slice(0, 1200));

const modset = await get('ExportModSet.json');
const msKeys = Object.keys(modset);
console.log('\n=== ExportModSet ===', msKeys.length);
console.log(JSON.stringify(modset[msKeys[0]], null, 1).slice(0, 1200));
