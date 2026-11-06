/**
 * 紫卡模拟器（单文件 HTML）里的内嵌数据表 — Mod 数值的来源。
 *
 * 官方导出 `ExportUpgrades.json` 只有极性/稀有度/耗点，**没有数值**；
 * 这个 HTML 是需求方维护的模拟器，里面的 `window.ZKMODS` 恰好带「满级数值 + 等级上限」。
 *
 * 本模块只负责"把 HTML 里的数组抠出来并做结构规整"，不含任何业务判断。
 */

/** ZKMODS 单条原始结构（字段含义见 research/03-Mod数据抓取.md） */
export interface ZkMod {
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
  bg?: ZkBg[];
  /** 只能装在这些武器上（ZK 内部武器 id） */
  ex?: string[];
  /** 不能装在这些武器/武器特性上（ZK 内部 id 或 `no_*` 特性标签） */
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

export interface ZkBg {
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

/** 从 HTML 源码里按 `window.NAME=` 定位，做括号配平后 JSON.parse */
export function extractEmbeddedArray(html: string, name: string): unknown {
  const marker = `window.${name}=`;
  const at = html.indexOf(marker);
  if (at < 0) throw new Error(`HTML 里找不到 ${marker}`);

  const start = at + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '[' || c === '{') {
      depth++;
      continue;
    }
    if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        const text = html.slice(start, i + 1);
        try {
          return JSON.parse(text);
        } catch (err) {
          throw new Error(`${name} 不是合法 JSON：${(err as Error).message}`);
        }
      }
    }
  }

  throw new Error(`${name} 的括号没有配平，HTML 可能被截断`);
}

/** 取出并做最小结构校验 */
export function extractZkMods(html: string): ZkMod[] {
  const raw = extractEmbeddedArray(html, 'ZKMODS');
  if (!Array.isArray(raw)) throw new Error('ZKMODS 不是数组');

  const mods: ZkMod[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item !== 'object' || item === null) throw new Error('ZKMODS 里有非对象条目');
    const m = item as Partial<ZkMod>;
    if (typeof m.i !== 'string' || typeof m.t !== 'string' || typeof m.s !== 'string') {
      throw new Error(`ZKMODS 条目缺少 i/t/s：${JSON.stringify(item).slice(0, 120)}`);
    }
    if (!Array.isArray(m.p)) throw new Error(`${m.i} 缺少属性表 p`);
    mods.push(m as ZkMod);
  }
  return mods;
}
