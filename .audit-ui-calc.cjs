'use strict';
/**
 * 检查：界面层还在做哪些**计算**（本应放在内核）。
 *
 * 判据不是"有没有数字"，而是**它算的东西是不是伤害/口径相关的规则**：
 *   · 碰 Contribution / 元素 / 乘区 / 倍率 → 属于内核
 *   · 碰口径取行 / 分母构造 / DoT 加权   → 属于内核
 *   · 只是格式化、取 store 里的值        → 属于界面
 */
const fs = require('fs');
const DIR = 'packages/demo/public';

const RULES = [
  { name: '构造贡献', re: /modToContributions|arcaneToContributions|rivenToContributions|setBonusContributions|contribs\.(push|concat)/ },
  { name: '乘区/倍率运算', re: /1\s*\+\s*sumPct|\*\s*sumPct|sumPct\(|\*\s*\(1\s*\+/ },
  { name: '口径取行', re: /lineValueOf|lineValueForMetric|\.lines\.find/ },
  { name: '分母/权重构造', re: /Denominator|weighted|加权|dotRoleFor|dotFactorOf/ },
  { name: '元素合成', re: /combineElements|mergeElements|elementPair/ },
  { name: '异常/DoT 规则', re: /dotTick|dotStacks|statusDamage|durationOfDot/ },
];

const files = fs.readdirSync(DIR).filter((f) => /\.js$/.test(f) && f !== 'core-inspector.js');
const hits = new Map();
for (const f of files) {
  const src = fs.readFileSync(`${DIR}/${f}`, 'utf8');
  src.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(\*|\/\/|import )/.test(line)) return; // 注释与 import 不算
    for (const r of RULES) {
      if (r.re.test(line)) {
        const key = r.name;
        if (!hits.has(key)) hits.set(key, []);
        hits.get(key).push(`${f}:${i + 1}  ${line.trim().slice(0, 88)}`);
      }
    }
  });
}

for (const r of RULES) {
  const list = hits.get(r.name) || [];
  console.log(`\n=== ${r.name}（${list.length} 处）`);
  if (!list.length) { console.log('  ✔ 无'); continue; }
  // 按文件聚合
  const byFile = new Map();
  for (const h of list) {
    const f = h.split(':')[0];
    byFile.set(f, (byFile.get(f) || 0) + 1);
  }
  for (const [f, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)} 处  ${f}`);
  }
  // 只列主文件里的前几行
  const main = list.filter((h) => /app-compute|app-riven/.test(h));
  if (main.length) main.slice(0, 6).forEach((h) => console.log('       ' + h));
}
