/**
 * data-build 入口。
 *
 * 用法：
 *   node --experimental-strip-types packages/data-build/src/index.ts           # dry-run：只抓取+统计，不写产出
 *   node --experimental-strip-types packages/data-build/src/index.ts --emit    # 抓取+统计+写入产出（需人工确认后用）
 *   ... --force                                                                # 忽略本地缓存，强制重新下载
 *
 * 设计约定（需求方指定）：
 *   - 抓取失败立即停止并报告，不自动重试。
 *   - dry-run 默认不写任何产出，先把全量统计与变更报告给人看。
 *   - 只有显式 --emit 才写入 packages/data/src/generated/，并且会附带变更报告文件。
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FetchError, fetchSource } from './fetch.ts';
import { cleanWeapons, EXCLUDED_CATEGORIES } from './clean.ts';
import { diffWeapons, formatDiffReport, type DiffReport } from './diff.ts';
import type { ExportWeapons } from './types.ts';
import type { WeaponPanel } from '../../core/src/weapon.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');
const GENERATED_DIR = join(repoRoot, 'packages/data/src/generated');
const GENERATED_FILE = join(GENERATED_DIR, 'weapons.json');
const REPORT_DIR = join(repoRoot, 'packages/data/src/generated/reports');

interface Args {
  emit: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  return {
    emit: argv.includes('--emit'),
    force: argv.includes('--force'),
  };
}

function loadPrevious(): WeaponPanel[] | null {
  if (!existsSync(GENERATED_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(GENERATED_FILE, 'utf8')) as { weapons?: WeaponPanel[] };
    return data.weapons ?? null;
  } catch {
    return null;
  }
}

function formatStats(stats: ReturnType<typeof cleanWeapons>['stats']): string {
  const droppedRatio =
    stats.keptBehaviours + stats.droppedPlaceholderBehaviours > 0
      ? (stats.droppedPlaceholderBehaviours / (stats.keptBehaviours + stats.droppedPlaceholderBehaviours)) * 100
      : 0;

  return [
    '抓取统计',
    '='.repeat(60),
    `导出武器条目总数：${stats.totalWeapons}`,
    `分类过滤排除：${stats.excludedByCategory}（${EXCLUDED_CATEGORIES.join(' / ')}）`,
    `无有效模式丢弃：${stats.droppedNoValidMode}`,
    `清洗后保留：${stats.keptWeapons}`,
    `丢弃占位 behaviour：${stats.droppedPlaceholderBehaviours}（占 ${droppedRatio.toFixed(1)}%）`,
    `保留 behaviour：${stats.keptBehaviours}`,
    `多攻击模式武器：${stats.weaponsWithMultipleModes}`,
    `含 AoE 段武器：${stats.weaponsWithAoe}`,
    `含未知伤害类型：${stats.weaponsWithUnknownDamageType}`,
  ].join('\n');
}

/** 清洗结果是否"看起来不对"，用来触发人工确认 */
function sanityProblems(clean: ReturnType<typeof cleanWeapons>, expected?: number): string[] {
  const problems: string[] = [];
  const { stats } = clean;

  if (stats.keptWeapons === 0) problems.push('清洗后武器数为 0，清洗规则可能全部失配。');

  if (stats.totalWeapons > 0) {
    const keepRatio = stats.keptWeapons / stats.totalWeapons;
    if (keepRatio < 0.5) {
      problems.push(
        `保留率仅 ${(keepRatio * 100).toFixed(1)}%（${stats.keptWeapons}/${stats.totalWeapons}），低于 50%，清洗规则可能过严。`,
      );
    }
  }

  if (expected != null && Math.abs(stats.keptWeapons - expected) > Math.max(10, expected * 0.1)) {
    problems.push(`武器数与上一版差异过大：上一版 ${expected}，本次 ${stats.keptWeapons}。`);
  }

  if (stats.weaponsWithUnknownDamageType > 0) {
    problems.push(`有 ${stats.weaponsWithUnknownDamageType} 把武器出现未知伤害类型，可能上游新增了伤害类型。`);
  }

  return problems;
}

function writeReports(statsLine: string, warnings: string[], diff: DiffReport): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const body = [
    `# 数据更新报告 ${stamp}`,
    '',
    '## ' + statsLine.split('\n')[0],
    '```',
    statsLine,
    '```',
    '',
    '## 变更',
    '```',
    formatDiffReport(diff),
    '```',
  ];

  if (warnings.length > 0) {
    body.push('', `## 警告（${warnings.length} 条）`, '```', warnings.slice(0, 200).join('\n'), '```');
    if (warnings.length > 200) body.push(`（共 ${warnings.length} 条，仅显示前 200 条）`);
  }

  writeFileSync(join(REPORT_DIR, `${stamp}.md`), body.join('\n'));
  writeFileSync(join(REPORT_DIR, 'latest.md'), body.join('\n'));
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  console.log(`[1/4] 抓取数据源${args.force ? '（忽略缓存）' : ''}...`);
  const raw = await fetchSource<ExportWeapons>('weapons', { force: args.force });
  console.log(`      导出条目：${Object.keys(raw).length}`);

  console.log('[2/4] 清洗...');
  const clean = cleanWeapons(raw);
  const statsLine = formatStats(clean.stats);
  console.log(statsLine);

  console.log('[3/4] 对比上一版...');
  const previous = loadPrevious();
  const diff = previous
    ? diffWeapons(previous, clean.weapons)
    : { added: [], removed: [], changed: [], unchanged: 0, needsAttention: true };
  console.log(previous ? formatDiffReport(diff) : '（无上一版，首次生成）');

  console.log('[4/4] 合理性检查...');
  const problems = sanityProblems(clean, previous?.length);
  if (problems.length > 0) {
    console.log('⚠️  发现以下问题，需要你确认：');
    for (const p of problems) console.log(`   - ${p}`);
  } else {
    console.log('      通过。');
  }

  if (!args.emit) {
    console.log('\n【dry-run】未写入任何产出。');
    console.log('确认统计与变更无误后，加 --emit 参数重新运行以写入。');
    return 0;
  }

  console.log('\n写入产出...');
  mkdirSync(GENERATED_DIR, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'https://browse.wf/warframe-public-export-plus/ExportWeapons.json',
    stats: clean.stats,
    weapons: clean.weapons,
  };
  writeFileSync(GENERATED_FILE, JSON.stringify(payload, null, 2) + '\n');
  writeReports(statsLine, clean.warnings, diff);
  console.log(`已写入 ${GENERATED_FILE}`);
  console.log(`报告已写入 ${REPORT_DIR}`);

  return 0;
}

try {
  process.exitCode = await main();
} catch (err) {
  if (err instanceof FetchError) {
    console.error('\n❌ 抓取失败，已停止（未做任何写入）。');
    console.error(`   类型：${err.kind}`);
    console.error(`   详情：${err.message}`);
    console.error(`   建议：${err.hint}`);
    console.error('\n请决定如何继续（例如：检查网络后重跑 / 使用 --force / 放弃本次更新）。');
    process.exitCode = 1;
  } else {
    console.error('\n❌ 未预期的错误：');
    console.error(err);
    process.exitCode = 2;
  }
}
