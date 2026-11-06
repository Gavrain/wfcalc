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
import { cleanWeapons, EXCLUDED_CATEGORIES, type CleanedWeapon } from './clean.ts';
import { diffWeapons, formatDiffReport, type DiffReport } from './diff.ts';
import { applyOverrides, type AppliedOverride } from './overrides.ts';
import { toEmitWeapon, type EmitWeapon } from './emit.ts';
import { resolveName, nameCoverage, type LanguageDict } from './localize.ts';
import { WEAPON_OVERRIDES } from '../../data/src/manual/overrides.ts';
import type { ExportWeapons } from './types.ts';
import type { AttackMode, Weapon } from '../../core/src/weapon.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');
const GENERATED_DIR = join(repoRoot, 'packages/data/src/generated');
const SPLIT_DIR = join(GENERATED_DIR, 'weapons');
const INDEX_FILE = join(SPLIT_DIR, 'index.json');
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

/**
 * 读取上一版产出（按分类拆分的多个文件），合并回 Weapon[] 用于 diff。
 * 无上一版时返回 null（首次生成）。
 */
function loadPrevious(): Weapon[] | null {
  if (!existsSync(SPLIT_DIR)) return null;

  const merged: Weapon[] = [];
  for (const cat of ['primary', 'secondary', 'melee', 'archgun', 'archmelee', 'companion', 'unknown']) {
    const file = join(SPLIT_DIR, `${cat}.json`);
    if (!existsSync(file)) continue;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as { weapons?: EmitWeapon[] };
      for (const w of data.weapons ?? []) merged.push(emitToPanel(w));
    } catch {
      // 单个文件损坏时跳过，不阻断整体流程
    }
  }
  return merged.length > 0 ? merged : null;
}

/**
 * 产出格式 → Weapon（仅用于 diff 比较）。
 *
 * `EmitWeapon` 与 `Weapon` 逐字段同名（D-011），所以这里基本是原样透传；
 * 保留这一层是为了在 JSON 缺字段时给出确定的默认值，避免 diff 出现假变更。
 */
function emitToPanel(w: EmitWeapon): Weapon {
  return {
    id: w.id,
    name: w.name,
    ...(w.nameZh ? { nameZh: w.nameZh } : {}),
    category: w.category as Weapon['category'],
    critChance: w.critChance,
    critMultiplier: w.critMultiplier,
    statusChance: w.statusChance,
    fireRate: w.fireRate,
    ...(w.magazineSize != null ? { magazineSize: w.magazineSize } : {}),
    ...(w.reloadTime != null ? { reloadTime: w.reloadTime } : {}),
    modes: w.modes.map((m) => {
      return {
        id: m.id,
        role: m.role as 'normal' | 'charged' | 'incarnon',
        trigger: m.trigger as AttackMode['trigger'],
        bullets: m.bullets,
        multishot: m.multishot,
        ...(m.burst ? { burst: m.burst } : {}),
        // D-080：段只属于变体，模式上不再有 `segments`
        variants: m.variants,
        ...(m.override ? { override: m.override } : {}),
      };
    }),
  };
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
    `无有效模式丢弃：${stats.droppedNoValidMode}（其中已写明原因 ${stats.droppedReported}，其余为无 behaviours 的组件）`,
    `按需求方整条移除：${stats.removedWeapons}`,
    `清洗后保留：${stats.keptWeapons}`,
    `人工订正：${stats.patchedWeapons} 把；人工构造版本：${stats.manualWeapons} 把`,
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

  console.log('[2/5] 清洗...');
  const clean = cleanWeapons(raw);
  // 清洗产出的武器带 `languageKey`（只在本阶段用），`Weapon` 本身没有这个字段
  const cleaned: CleanedWeapon[] = clean.weapons;
  const statsLine = formatStats(clean.stats);
  console.log(statsLine);

  // 语言包：把导出的语言键解析成中英文显示名
  console.log('[3/5] 解析名称（语言包）...');
  let zhDict: LanguageDict = {};
  let enDict: LanguageDict = {};
  try {
    zhDict = await fetchSource<LanguageDict>('langZh', { force: args.force });
    enDict = await fetchSource<LanguageDict>('langEn', { force: args.force });
    const keys = cleaned.map((w) => w.languageKey ?? '').filter(Boolean);
    const coverage = nameCoverage(keys, zhDict);
    console.log(`      中文包 ${Object.keys(zhDict).length} 条，武器名命中 ${coverage.hit}/${coverage.total}（${(coverage.ratio * 100).toFixed(1)}%）`);
    if (coverage.missingSamples.length > 0) {
      console.log(`      未命中样例：${coverage.missingSamples.slice(0, 5).join(', ')}`);
    }
  } catch (err) {
    console.log(`      ⚠️ 语言包获取失败，名称将回退到内部名：${(err as Error).message}`);
  }

  for (const w of cleaned) {
    const resolved = resolveName(w.languageKey, zhDict, enDict);
    w.name = resolved.en;
    if (resolved.zh) w.nameZh = resolved.zh;
    delete w.languageKey;
  }

  // 应用人工覆盖层（蓄力时间反推射速等）
  const applied: AppliedOverride[] = applyOverrides(clean.weapons, WEAPON_OVERRIDES);
  if (applied.length > 0) {
    console.log(`\n人工覆盖已应用 ${applied.length} 处：`);
    for (const a of applied) console.log(`  ${a.weaponId}.${a.field}: ${a.from ?? '(无)'} → ${a.to}  （${a.reason}）`);
  }

  console.log('[4/5] 对比上一版...');
  const previous = loadPrevious();
  const diff = previous
    ? diffWeapons(previous, clean.weapons)
    : { added: [], removed: [], changed: [], unchanged: 0, needsAttention: true };
  console.log(previous ? formatDiffReport(diff) : '（无上一版，首次生成）');

  console.log('[5/5] 合理性检查...');
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

  // 按分类拆分输出，便于人工按武器类型查找与修改
  const files: Record<string, EmitWeapon[]> = { primary: [], secondary: [], melee: [], archgun: [], archmelee: [], companion: [], unknown: [] };
  for (const w of clean.weapons) {
    const exportKey = findExportKey(raw, w.id);
    const variantType = exportKey ? raw[exportKey]?.variantType : undefined;
    files[w.category]!.push(toEmitWeapon(w, applied, { variantType }));
  }

  mkdirSync(SPLIT_DIR, { recursive: true });
  const counts: Record<string, number> = {};
  for (const [cat, list] of Object.entries(files)) {
    counts[cat] = list.length;
    const body = {
      generatedAt: new Date().toISOString(),
      category: cat,
      count: list.length,
      note: '暴率/触发为 0~1 小数；伤害分布为绝对值；procChance 同为 0~1；kuva 表示需用户在计算器里选元素与加成（25%~60%）',
      weapons: list,
    };
    writeFileSync(join(SPLIT_DIR, `${cat}.json`), JSON.stringify(body, null, 2) + '\n');
  }

  // 索引文件：汇总各分类与统计
  writeFileSync(
    join(SPLIT_DIR, 'index.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: 'https://browse.wf/warframe-public-export-plus/ExportWeapons.json',
        stats: clean.stats,
        categories: counts,
        manualOverrides: applied.length,
      },
      null,
      2,
    ) + '\n',
  );

  writeReports(statsLine, clean.warnings, diff);
  console.log('分类产出：');
  for (const [cat, list] of Object.entries(files)) console.log(`  ${cat.padEnd(12)} ${list.length} 把  → ${cat}.json`);
  console.log('索引：index.json');
  console.log(`报告已写入 ${REPORT_DIR}`);

  return 0;
}

/** 由武器 id 反查导出键（用于取 variantType 等元数据） */
function findExportKey(raw: ExportWeapons, id: string): string {
  for (const key of Object.keys(raw)) {
    if ((key.split('/').pop() ?? '') === id) return key;
  }
  return '';
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
