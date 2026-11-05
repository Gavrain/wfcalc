/**
 * 给 `main.ts` / `analysis.ts` 里"推导不出类型"的 `const` 加显式标注。
 * 原因：demo 服务器用"剥类型"的方式在浏览器里运行同一份源码，
 * 剥掉 `: T` 后，像 `new Map()` / `.map(...)` 的结果会变成 `any`，浏览器里跑起来就不稳。
 * 让所有导出函数的局部变量都带显式类型，剥类型后语义不变。
 *
 * 用法：node packages/demo/src/annotate.mjs  （一次性，已执行）
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));

const patches = [
  // main.ts
  ['packages/core/src/main.ts', '  const co = contributionsFor(contribs, \'co\').filter((c) => c.form === \'pct\');', '  const co: Contribution[] = contributionsFor(contribs, \'co\').filter((c) => c.form === \'pct\');'],
  ['packages/core/src/main.ts', '  const byType = new Map<DamageType, Contribution[]>();', '  const byType: Map<DamageType, Contribution[]> = new Map();'],
  ['packages/core/src/main.ts', '  const queue = grouped.sort((a, b) => a.order - b.order);', '  const queue: ElementSlot[] = grouped.sort((a, b) => a.order - b.order);'],
  ['packages/core/src/main.ts', '  const panel = { ...seg.damage };', '  const panel: DamageSpread = { ...seg.damage };'],
  ['packages/core/src/main.ts', '  const panelWithKuva = applyKuvaBonus(panel, ctx.options.kuva);', '  const panelWithKuva: DamageSpread = applyKuvaBonus(panel, ctx.options.kuva);'],
  ['packages/core/src/main.ts', '  const baseAfterBaseDamage = applyBaseDamage(panelWithKuva, seg, contribs, ctx.coStacks);', '  const baseAfterBaseDamage: DamageSpread = applyBaseDamage(panelWithKuva, seg, contribs, ctx.coStacks);'],
  ['packages/core/src/main.ts', '  const elementDetail = applyElements(baseAfterBaseDamage, contribs, \'hit\');', '  const elementDetail: ApplyElementsResult = applyElements(baseAfterBaseDamage, contribs, \'hit\');'],
  ['packages/core/src/main.ts', '  const finalHit = elementDetail.v;', '  const finalHit: DamageSpread = elementDetail.v;'],
  ['packages/core/src/main.ts', '  const dotBase = applyElements(baseAfterBaseDamage, contribs, \'dotBase\').v;', '  const dotBase: DamageSpread = applyElements(baseAfterBaseDamage, contribs, \'dotBase\').v;'],
  ['packages/core/src/main.ts', '  const line = damageLine(vTotal, cc, cd, ctx.headshot.enabled, hsMul);', '  const line: DamageLine = damageLine(vTotal, cc, cd, ctx.headshot.enabled, hsMul);'],
  ['packages/core/src/main.ts', '  const singlePelletSpread = finalHit;', '  const singlePelletSpread: DamageSpread = finalHit;'],
  ['packages/core/src/main.ts', '  const dotTicks = DOT_TYPES.map((t) =>', '  const dotTicks: DotTickDetail[] = DOT_TYPES.map((t) =>'],
  ['packages/core/src/main.ts', '  const ctx = buildContext(weapon, mode, contribs, options, beam);', '  const ctx: Ctx = buildContext(weapon, mode, contribs, options, beam);'],
  ['packages/core/src/main.ts', '  const segments = mode.segments.map((seg) => resolveSegment(ctx, seg));', '  const segments: SegmentResult[] = mode.segments.map((seg) => resolveSegment(ctx, seg));'],
  ['packages/core/src/main.ts', '  const output = buildOutput(weapon, mode, contribs, segments[0]!, ctx);', '  const output: OutputBreakdown = buildOutput(weapon, mode, contribs, segments[0]!, ctx);'],
  ['packages/core/src/main.ts', '  const ps = panelStats(weapon, mode);', '  const ps: ReturnType<typeof panelStats> = panelStats(weapon, mode);'],
  ['packages/core/src/main.ts', '  const seg = mode.segments[0]!;', '  const seg: DamageSegment = mode.segments[0]!;'],
  ['packages/core/src/main.ts', '  const headshot = options.headshot ?? { enabled: false, multiplier: 3.0 };', '  const headshot: HeadshotOptions = options.headshot ?? { enabled: false, multiplier: 3.0 };'],
  // analysis.ts
  ['packages/core/src/analysis.ts', '  const currentValue = metricValue(simulateWith(weapon, mode, base, options, beam), metric);', '  const currentValue: number = metricValue(simulateWith(weapon, mode, base, options, beam), metric);'],
  ['packages/core/src/analysis.ts', '  const next = base.filter((c) => !replaced.includes(c)).concat(candidate);', '  const next: Contribution[] = base.filter((c) => !replaced.includes(c)).concat(candidate);'],
  ['packages/core/src/analysis.ts', '  const nextValue = metricValue(simulateWith(weapon, mode, next, options, beam), metric);', '  const nextValue: number = metricValue(simulateWith(weapon, mode, next, options, beam), metric);'],
  ['packages/core/src/analysis.ts', '  const currentValue = metricValue(simulateWith(weapon, mode, base, options, beam), metric);', '  const currentValue: number = metricValue(simulateWith(weapon, mode, base, options, beam), metric);'],
  ['packages/core/src/analysis.ts', '  const baseWithout = base.filter((c) => !replaced.includes(c));', '  const baseWithout: Contribution[] = base.filter((c) => !replaced.includes(c));'],
  ['packages/core/src/analysis.ts', '    const value = metricValue(simulateWith(weapon, mode, baseWithout.concat(cand), options, beam), metric);', '    const value: number = metricValue(simulateWith(weapon, mode, baseWithout.concat(cand), options, beam), metric);'],
  ['packages/core/src/analysis.ts', '  const line = res.output.lines.find((l) => l.id === metric);', '  const line: OutputLine | undefined = res.output.lines.find((l) => l.id === metric);'],
];

let applied = 0;
for (const [rel, from, to] of patches) {
  const path = join(ROOT, rel);
  const src = await readFile(path, 'utf8');
  if (src.includes(to)) continue; // 已打过
  if (!src.includes(from)) {
    console.warn(`未找到：${rel} :: ${from}`);
    continue;
  }
  await writeFile(path, src.replace(from, to), 'utf8');
  applied++;
}
console.log(`已加标注 ${applied} 处`);
