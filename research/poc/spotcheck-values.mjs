// 数值抽查：用几条已知模组核对"满级值 / 逐级值 / 乘区归属"是否与游戏内一致。
import { readFileSync } from 'node:fs';
import { extractZkMods } from '../../packages/data-build/src/mods/zk-source.ts';
import { cleanMod } from '../../packages/data-build/src/mods/clean-mods.ts';

const html = readFileSync('20261031紫卡模拟器V10.html', 'utf8');
const zk = extractZkMods(html);
const byId = new Map(zk.map((m) => [m.i, m]));

// 抽查项：id → 期望（来自游戏内已知数值）
const EXPECT = {
  serration: { note: '膛线：满级 +165% 基伤', stat: 'baseDamage', maxRank: 10, last: 165 },
  hornet_strike: { note: '黄蜂螫刺：满级 +220% 基伤', stat: 'baseDamage', maxRank: 10, last: 220 },
  split_chamber: { note: '分裂膛室：满级 +90% 多重', stat: 'multishot', maxRank: 5, last: 90 },
  point_strike: { note: '致命一击：满级 +150% 暴率', stat: 'critChance', maxRank: 5, last: 150 },
  vital_sense: { note: '致命伤害：满级 +120% 暴伤', stat: 'critMultiplier', maxRank: 5, last: 120 },
  hellfire: { note: '地狱火：满级 +90% 火焰', stat: 'elemental:heat', maxRank: 5, last: 90 },
  primed_combustion_rounds: { note: '燃烧弹头 Prime：满级 +187% 火焰', stat: 'elemental:heat', maxRank: 10, last: 187 },
  high_voltage: { note: '高压（步枪 电击+触发）：+60%/+60%', stat: 'elemental:electric', maxRank: 3, last: 60 },
  hunter_munitions: { note: '猎人的战备：暴击几率附加切割', stat: 'slashOnCrit', maxRank: 5, last: 30 },
};

let pass = 0;
let fail = 0;
for (const [id, exp] of Object.entries(EXPECT)) {
  const raw = byId.get(id);
  if (!raw) {
    console.log(`✗ ${id} 不在表里（${exp.note}）`);
    fail++;
    continue;
  }
  const { mod } = cleanMod(raw);
  const st = mod.stats.find((s) => s.stat === exp.stat);
  const ok = st && mod.maxRank === exp.maxRank && st.levelValues.at(-1) === exp.last;
  console.log(
    `${ok ? '✓' : '✗'} ${exp.note.padEnd(28)} ${mod.name.zh.padEnd(10)} maxRank=${mod.maxRank}/${exp.maxRank} ` +
      `${exp.stat}=${st ? st.levelValues.at(-1) : '(缺)'}/${exp.last} 逐级=${st ? JSON.stringify(st.levelValues) : '-'}`,
  );
  if (ok) pass++;
  else fail++;
}

console.log(`\n抽查 ${pass + fail} 条：通过 ${pass}，失败 ${fail}`);

// 每个乘区有多少模组可用
const all = zk.filter((m) => m.s === 'g' || m.s === 'm');
const byBucket = new Map();
for (const raw of all) {
  const { mod } = cleanMod(raw);
  for (const s of mod.stats) if (s.bucket) byBucket.set(s.bucket, (byBucket.get(s.bucket) ?? 0) + 1);
}
console.log('\n各乘区可用属性条数（含条件类）:');
for (const [k, v] of [...byBucket.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
