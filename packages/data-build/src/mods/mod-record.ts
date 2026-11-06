/**
 * Mod 结构化数值基线 — 类型与读取。
 *
 * 官方导出 `ExportUpgrades.json` 只有极性/稀有度/耗点，**没有数值**。Mod 的数值、等级上限、
 * 互斥关系、条件效果全部来自仓库内入库的 `packages/data/src/mods/baseline.json`。
 *
 * 本模块只负责"读文件 + 做结构校验"，不含任何业务判断。
 * 基线是**入库数据**，所以流水线在没有网络、没有额外本地文件时也能产出完整数值。
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MOD_BASELINE_DIR } from '../sources.ts';

const repoRoot = resolve(import.meta.dirname, '../../../..');

/** 单条原始结构（字段含义即 baseline.json 的 `fields` 说明） */
export interface ModRecord {
  /** 稳定 id，如 `serration` */
  i: string;
  /** 英文名 */
  n: string;
  /** 中文名 */
  z: string;
  /** 武器类：rifle / shotgun / pistol / melee / bow / sniper / glaive / archgun ... */
  t: string;
  /** 分类：g=枪械 m=近战 a=赋能 p=架势 */
  s: string;
  /** 0 级耗点（负数代表特殊容量修正） */
  d: number;
  /** 等级上限（5 = 0~5 共 6 级） */
  f: number;
  /** 稀有度：c 普通 / r 罕见 / n 稀有 / l 传说 */
  r: string;
  /** 极性：r madurai / - naramon / d vazarin / = zenurik / w unairu / o 全能 */
  y: string;
  /**
   * 属性表：[属性键, 满级值] 或 [属性键, 满级值, 每级加量]。
   * 不带第三项时，每级加量 = 满级值 / 等级上限（0 级为 0，满级为给定值）。
   */
  p: Array<[string, number, number?]>;
  /** 英文描述 */
  de: string;
  /** 同族模组（互斥，只能装一个） */
  fam?: string;
  /** 与本体互斥的其它模组 id */
  inc?: string[];
  /** 有则代表效果带触发条件 / 需要叠层，数值需看 bg */
  bg?: ModBuff[];
  /** 只能装在这些武器上（基线内的武器 id） */
  ex?: string[];
  /** 不能装在这些武器或武器特性上（武器 id 或 `no_*` 特性标签） */
  ew?: string[];
  /** 套装 id */
  st?: string;
  /** 集团（正义/真相 等） */
  sg?: string;
  /** 受技能强度/持续时间影响的标记 */
  x?: number;
  xl?: number;
  nc?: number;
  /** 仅拥有者可用 */
  rw?: string;
  /** 人工备注（中文） */
  dz?: string;
}

export interface ModBuff {
  /** buff=触发叠层，cond=条件生效，mech=特殊机制 */
  k: string;
  /** 触发方式，如 kill / headshot_kill / toxin_status */
  tr?: string;
  /** 条件，如 aiming / invisible */
  cd?: string;
  /** 计数的属性组 */
  g?: string;
  /** 叠层上限 */
  st?: number;
  /** 持续秒数 */
  du?: number;
  /** 条件生效时的属性键与数值 */
  gk?: string;
  gv?: number;
  /** 特殊机制 id */
  mk?: string;
}

interface BaselineFile {
  count: number;
  mods: ModRecord[];
}

/** 基线文件绝对路径 */
export function baselinePath(): string {
  return join(repoRoot, MOD_BASELINE_DIR, 'baseline.json');
}

/** 读取并做最小结构校验 */
export function loadModBaseline(): ModRecord[] {
  const path = baselinePath();
  let parsed: BaselineFile;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as BaselineFile;
  } catch (err) {
    throw new Error(
      `读不到 Mod 基线 ${MOD_BASELINE_DIR}/baseline.json：${(err as Error).message}` +
        '（这是入库文件，正常情况下不会缺；若刚改过目录结构请确认路径）',
    );
  }
  if (!Array.isArray(parsed.mods)) throw new Error('baseline.json 的 mods 不是数组');
  if (parsed.count !== parsed.mods.length) {
    throw new Error(`baseline.json 的 count=${parsed.count} 与 mods.length=${parsed.mods.length} 不一致`);
  }

  for (const item of parsed.mods as unknown[]) {
    if (typeof item !== 'object' || item === null) throw new Error('baseline.json 里有非对象条目');
    const m = item as Partial<ModRecord>;
    if (typeof m.i !== 'string' || typeof m.t !== 'string' || typeof m.s !== 'string') {
      throw new Error(`baseline.json 条目缺少 i/t/s：${JSON.stringify(item).slice(0, 120)}`);
    }
    if (!Array.isArray(m.p)) throw new Error(`${m.i} 缺少属性表 p`);
  }
  return parsed.mods;
}
