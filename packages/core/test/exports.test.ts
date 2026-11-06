/**
 * 导出面快照（D-102 安全网）。
 *
 * 内核拆分（`main.ts` 1521 行 → 多个阶段文件）是**行为不变的重构**：
 * 除了「所有输出值与拆前逐位相等」，还必须保证**公开导出名一个不少**——
 * 下游（demo / data / 报告脚本）大量用 `import { x } from 'core/src/index.ts'`，
 * 漏掉一个名字就会在浏览器里变成 undefined（Node 侧的测试不一定能发现）。
 *
 * ── 两个清单 ──
 * · `INDEX_EXPORTS`：拆前 `core/src/index.ts` 的导出集合（= 全部模块 `export *` 的结果）；
 * · `MAIN_EXPORTS`：拆前 `main.ts` 自己的导出集合（少数文件是从 `main.ts` 直接导入的）。
 *
 * 以后**有意**新增/删除导出时，同步改这里，并在 `docs/decisions.md` 记一笔。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';
import * as main from '../src/main.ts';

/** 拆前 `core/src/index.ts` 的全部导出名（字母序） */
const INDEX_EXPORTS: readonly string[] = [
  'AOE_SEGMENT_KINDS', 'BASE_ELEMENTAL_TYPES', 'BLAST', 'COMPOUND_TYPES', 'DAMAGE_TYPES', 'DEFAULT_METRIC',
  'DOT_COEF', 'DOT_DURATION', 'DOT_MAX_STACKS', 'DOT_TYPES', 'DT_KEY_MAP', 'FROZEN_FULL_STACKS',
  'IMMEDIATE_TICK', 'KUVA_BONUS_MAX', 'KUVA_BONUS_MIN', 'KUVA_ELEMENT_TYPES', 'METRIC_OPTIONS',
  'NO_DAMAGE_MULTIPLIER_TYPES', 'OUTPUT_IDS', 'PAIRS', 'PHYSICAL_TYPES', 'STATUS_CHANCE_HARD_CAP',
  'TAU_MAX_STACKS', 'TAU_STACK_BONUS_PER_STACK', 'TAU_STACK_DURATION_SECONDS', 'activeVariant',
  'allSegments', 'ammoEfficiencyMultiplier', 'applyBaseDamage', 'applyElements', 'applyKuvaBonus',
  'applyTauToStatusChance', 'blastDetail', 'bucket', 'bucketBreakdown', 'bucketDetail', 'buildContext',
  'buildFiringTimeline', 'buildOutput', 'buildVectors', 'buildWeaponState', 'compute', 'contributionsFor',
  'critAverage', 'critChanceTotal', 'critDamageTotal', 'critTiers', 'damageLine', 'displayMagazine',
  'dotSixSecondCurve', 'dotTick', 'expectedHitMultiplier', 'factionFor', 'fireRateFinal', 'firingFraction',
  'firstSegment', 'gainOf', 'gainsFor', 'getMode', 'hasAoeSegment', 'hasDotElement', 'headshotMultiplier',
  'isCompound', 'isContribActive', 'isFiringAt', 'isKuvaFamily', 'isPhysical', 'mergePairwise',
  'metricValue', 'multishot', 'overForElement', 'overForStacks', 'pairOf', 'panelPairs', 'panelStats',
  'productMul', 'resolveSegment', 'scaleSpread', 'segmentCount', 'share', 'simulateWith', 'sixSecondTotal',
  'spreadTotal', 'spreadTotalAfterMods', 'stacksPerShot', 'statValue', 'sumFlat', 'sumFlatOf', 'sumPct',
  'tauBonusPercent', 'tauStatusChanceMultiplier', 'totalProcChance',
  // D-102 新增（拆文件带来的便捷别名，原有名字不受影响）
  'addSpread', 'dotBaseSpread', 'hitSpread', 'scale',
];

/** 拆前 `main.ts` 自己导出的名字（含上面 4 个新别名） */
const MAIN_ONLY_EXPORTS: readonly string[] = [
  'DOT_COEF', 'DOT_DURATION', 'DOT_MAX_STACKS', 'DOT_TYPES', 'IMMEDIATE_TICK', 'OUTPUT_IDS', 'PAIRS',
  'BLAST', 'applyBaseDamage', 'applyElements', 'applyKuvaBonus', 'blastDetail', 'buildContext',
  'buildFiringTimeline', 'buildOutput', 'buildVectors', 'bucketBreakdown', 'compute', 'critAverage',
  'critChanceTotal', 'critDamageTotal', 'critTiers', 'damageLine', 'dotSixSecondCurve', 'dotTick',
  'expectedHitMultiplier', 'factionFor', 'fireRateFinal', 'firingFraction', 'hasDotElement',
  'headshotMultiplier', 'isFiringAt', 'mergePairwise', 'multishot', 'overForStacks', 'pairOf',
  'resolveSegment', 'share', 'sixSecondTotal', 'stacksPerShot', 'totalProcChance',
  'addSpread', 'dotBaseSpread', 'hitSpread', 'scale',
];

describe('导出面：拆分后不得丢名字（D-102）', () => {
  it('拆前的每个导出名都还在 core/index.ts 上', () => {
    const missing = INDEX_EXPORTS.filter((k) => !(k in core));
    assert.deepEqual(missing, [], `index.ts 缺少：${missing.join(', ')}`);
  });

  it('旧的 `from main.ts` 导入路径仍可取到每一个名字', () => {
    const missing = MAIN_ONLY_EXPORTS.filter((k) => !(k in main));
    assert.deepEqual(missing, [], `main.ts 缺少：${missing.join(', ')}`);
  });

  it('核心结算函数仍在（防止误删/改名）', () => {
    const fn = [
      'compute', 'resolveSegment', 'buildOutput', 'applyElements', 'mergePairwise',
      'dotTick', 'dotSixSecondCurve', 'applyBaseDamage', 'applyKuvaBonus', 'blastDetail',
    ];
    for (const k of fn) {
      assert.equal(typeof (core as Record<string, unknown>)[k], 'function', `${k} 不是函数`);
    }
    assert.equal(typeof (main as Record<string, unknown>).compute, 'function');
  });
});
