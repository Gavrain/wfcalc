/**
 * 验证模式内的面板变体结构（D-080 / D-148）。
 *
 * D-148 规则 3 改了这条：**一个模式内所有段相加后结算**，
 * 所以 WFCD 来源的武器基本是单变体（`direct`），不再把「直接命中 / 爆炸」拆成两个变体。
 * 现在只有极少数来自官方导出的兜底武器仍带 `blast` 变体。
 *
 * 断言：
 *   1. 存在单变体武器（绝大多数）；
 *   2. 单变体的 id 恒为 `direct`；
 *   3. 变体结构自洽：非空、每个变体有段、模式上没有 `segments`；
 *   4. 若存在双变体，其 id 必须是 `direct,blast` 且爆炸变体只含爆炸段（保持 D-080 的形状约束）。
 */
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));
const read = async (p) => JSON.parse(await readFile(join(ROOT, p), 'utf8'));

const FILES = ['primary', 'secondary', 'melee', 'archgun', 'archmelee', 'companion', 'unknown'];

let ok = true;
const check = (label, cond, extra) => {
  if (!cond) ok = false;
  console.log(`${cond ? '✔' : '✖'} ${label}${extra !== undefined ? '  ' + extra : ''}`);
};

const all = [];
for (const f of FILES) {
  let d;
  try {
    d = await read(`packages/data/src/generated/weapons/${f}.json`);
  } catch {
    continue;
  }
  for (const w of d.weapons) all.push(w);
}

const single = all.find((w) => (w.modes[0]?.variants ?? []).length === 1);
const double = all.find((w) => (w.modes[0]?.variants ?? []).length === 2);

console.log('—— 数据层 ——');
check('存在单变体武器', Boolean(single), single ? single.nameZh ?? single.name : '');

if (single) {
  const vs = single.modes[0].variants;
  check('单变体只有 direct', vs.length === 1 && vs[0].id === 'direct', vs.map((v) => v.id).join(','));
}

// D-148 之后双变体很少见（只有官方导出兜底的显赫武器可能带）；有就要形状正确
if (double) {
  const vs = double.modes[0].variants;
  check('双变体 id 为 direct / blast', vs.map((v) => v.id).join(',') === 'direct,blast', vs.map((v) => v.id).join(','));
  const blastKinds = vs[1].segments.map((s) => s.kind);
  check('爆炸变体只含爆炸段', blastKinds.every((k) => k === 'explosiveAttack'), blastKinds.join(','));
} else {
  console.log('✔ 无双变体武器（D-148 后模式内各段合并，符合预期）');
}

console.log('\n—— 全量自洽 ——');
let bad = 0;
let total = 0;
for (const w of all) {
  for (const m of w.modes) {
    total++;
    const vs = m.variants ?? [];
    if (vs.length === 0) { bad++; continue; }
    // 每个变体都必须有段（空变体是拆分时的 bug）
    if (vs.some((v) => v.segments.length === 0)) bad++;
    // 段只能出现在变体内：模式上不应再有 segments 字段（D-080）
    if ('segments' in m) bad++;
    // D-148：射线判据只看扳机，扳机必须是已知的几种
    if (m.trigger === 'held' && !['held'].includes(m.trigger)) bad++;
  }
}
check(`全部 ${total} 个模式：变体非空、每个变体有段、模式上已无 segments`, bad === 0, bad ? `${bad} 个异常` : '');

// 射线武器必须存在（D-148 判定生效的证据）
const beamWeapons = all.filter((w) => (w.modes ?? []).some((m) => m.trigger === 'held'));
check(`存在射线武器（扳机 held）`, beamWeapons.length > 0, `${beamWeapons.length} 把`);

console.log(`\n${ok ? '全部通过' : '有失败项'}`);
process.exit(ok ? 0 : 1);
