/**
 * WFCD 武器抓取（D-148：全面转向 WFCD 数据源）。
 *
 * 与官方导出的差别：
 *   · 官方是一次请求一个大 JSON（`ExportWeapons.json`），且带本地缓存；
 *   · WFCD 按武器大类分成 6 个文件，需要逐个抓。
 *
 * 缓存与 `fetchSource` 同一套约定：写到 `.cache/export/`，`--force` 时忽略缓存。
 * GitHub 在本机 TLS 会被拦，调用方可设 `WFCD_INSECURE_TLS=1`。
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CACHE_DIR, WFCD_WEAPON_SOURCES, type WfcdWeaponSourceName } from './sources.ts';
import type { WfcdWeapon } from './wfcd-clean.ts';

export class WfcdFetchError extends Error {}

interface Options {
  /** 忽略本地缓存 */
  force?: boolean;
  /** 跳过 TLS 证书校验（本机 GitHub 被中间人的兜底，需显式开启） */
  insecureTls?: boolean;
}

/** 抓一个 WFCD 大类文件 */
async function fetchOne(name: WfcdWeaponSourceName, opts: Options): Promise<WfcdWeapon[]> {
  const url = WFCD_WEAPON_SOURCES[name];
  mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = join(CACHE_DIR, `wfcd-${name}.json`);

  if (!opts.force && existsSync(cacheFile)) {
    try {
      return JSON.parse(readFileSync(cacheFile, 'utf8')) as WfcdWeapon[];
    } catch {
      // 缓存损坏 → 当作没有，重新抓
    }
  }

  // 本机对 GitHub 的 TLS 证书链会被拦截；只对 WFCD 这一个源放宽，且必须显式开启
  if (opts.insecureTls) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  let res: Response;
  try {
    res = await fetch(url, { headers: { 'user-agent': 'wfcalc-databuild' } });
  } catch (err) {
    throw new WfcdFetchError(
      `抓取失败 ${url}：${(err as Error).message}\n` +
        `（GitHub 在本机常被 TLS 拦截，可设 WFCD_INSECURE_TLS=1 重试）`,
    );
  }
  if (!res.ok) throw new WfcdFetchError(`抓取失败 ${url}：HTTP ${res.status}`);

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new WfcdFetchError(`解析失败 ${url}：${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) throw new WfcdFetchError(`格式不对 ${url}：顶层不是数组`);

  writeFileSync(cacheFile, text);
  return parsed as WfcdWeapon[];
}

/**
 * 抓取全部 WFCD 武器。
 *
 * @returns 合并后的武器数组（已去重：同名保留第一次出现的）。
 *          每条带 `__source` = 来源文件（`Primary` / `Melee` …），供 D-152 的槽位判定纠错用
 *          （WFCD 有 10 把近战的 `type` 错标成 `Rifle`，所在文件是对的）。
 */
export async function fetchAllWfcdWeapons(opts: Options = {}): Promise<WfcdWeapon[]> {
  const names = Object.keys(WFCD_WEAPON_SOURCES) as WfcdWeaponSourceName[];
  const seen = new Set<string>();
  const out: WfcdWeapon[] = [];

  for (const n of names) {
    const list = await fetchOne(n, opts);
    for (const w of list) {
      const key = w.uniqueName ?? w.name;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...w, __source: n });
    }
  }
  return out;
}
