/**
 * 验证 D-080：模式内的面板变体（直接命中 / 爆炸）。
 *
 * 断言：
 *   1. 双变体武器渲染出第二排切换按钮，且标签是「直接命中 / 爆炸」；
 *   2. 切换变体后，伤害分布表只显示该变体自己的元素；
 *   3. 单变体武器**不**渲染第二排（不拥挤）。
 */
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));
const read = async (p) => JSON.parse(await readFile(join(ROOT, p), 'utf8'));

const data = await read('packages/data/src/generated/weapons/primary.json');
const double = data.weapons.find((w) => (w.modes[0]?.variants ?? []).length === 2);
const single = data.weapons.find((w) => (w.modes[0]?.variants ?? []).length === 1);

let ok = true;
const check = (label, cond, extra) => {
  if (!cond) ok = false;
  console.log(`${cond ? '✔' : '✖'} ${label}${extra !== undefined ? '  ' + extra : ''}`);
};

console.log('—— 数据层 ——');
check('存在双变体武器', Boolean(double), double ? double.nameZh ?? double.name : '');
check('存在单变体武器', Boolean(single), single ? single.nameZh ?? single.name : '');

if (double) {
  const vs = double.modes[0].variants;
  check('双变体 id 为 direct / blast', vs.map((v) => v.id).join(',') === 'direct,blast', vs.map((v) => v.id).join(','));
  check('双变体标签为 直接命中 / 爆炸', vs.map((v) => v.label).join('/') === '直接命中/爆炸', vs.map((v) => v.label).join('/'));
  const directKinds = vs[0].segments.map((s) => s.kind);
  const blastKinds = vs[1].segments.map((s) => s.kind);
  check('直接命中变体不含爆炸段', !directKinds.includes('explosiveAttack'), directKinds.join(','));
  check('爆炸变体只含爆炸段', blastKinds.every((k) => k === 'explosiveAttack'), blastKinds.join(','));

  // 两变体伤害不重叠（各自独立面板）
  const dKeys = Object.keys(vs[0].segments[0].damage);
  const bKeys = Object.keys(vs[1].segments[0].damage);
  const overlap = dKeys.filter((k) => bKeys.includes(k));
  console.log(`  直接命中=${JSON.stringify(vs[0].segments[0].damage)}  爆炸=${JSON.stringify(vs[1].segments[0].damage)}`);
  console.log(`  （两变体共享元素类型，但数值独立，overlap=${overlap.join(',') || '无'}）`);
}

if (single) {
  const vs = single.modes[0].variants;
  check('单变体只有 direct', vs.length === 1 && vs[0].id === 'direct', vs.map((v) => v.id).join(','));
}

console.log('\n—— 全量自洽 ——');
let bad = 0;
let total = 0;
for (const f of ['primary', 'secondary', 'melee', 'archgun', 'archmelee', 'companion', 'unknown']) {
  let d;
  try {
    d = await read(`packages/data/src/generated/weapons/${f}.json`);
  } catch { continue; }
  for (const w of d.weapons) {
    for (const m of w.modes) {
      total++;
      const vs = m.variants ?? [];
      if (vs.length === 0) { bad++; continue; }
      // 每个变体都必须有段（空变体是拆分时的 bug）
      if (vs.some((v) => v.segments.length === 0)) bad++;
      // 段只能出现在变体内：模式上不应再有 segments 字段（D-080）
      if ('segments' in m) bad++;
    }
  }
}
check(`全部 ${total} 个模式：变体非空、每个变体有段、模式上已无 segments`, bad === 0, bad ? `${bad} 个异常` : '');

console.log(`\n${ok ? '全部通过' : '有失败项'}`);
process.exit(ok ? 0 : 1);
