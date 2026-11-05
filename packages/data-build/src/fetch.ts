/**
 * 抓取全量导出。
 *
 * 失败处理约定（需求方指定）：
 *   - 网络类错误**立即停止并报告**，不自动重试、不静默降级。
 *   - 失败时抛出 FetchError，由 CLI 层格式化后交给用户决定如何继续。
 */
import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SOURCES, CACHE_DIR, type SourceName } from './sources.ts';

export class FetchError extends Error {
  readonly source: SourceName;
  readonly kind: 'network' | 'http' | 'parse';
  readonly hint: string;

  constructor(source: SourceName, kind: FetchError['kind'], message: string, hint: string) {
    super(message);
    this.name = 'FetchError';
    this.source = source;
    this.kind = kind;
    this.hint = hint;
  }
}

const repoRoot = resolve(import.meta.dirname, '../../..');

export function cachePath(source: SourceName): string {
  return join(repoRoot, CACHE_DIR, `${source}.json`);
}

/** 下载单个导出文件到本地缓存，返回解析后的对象 */
export async function fetchSource<T = unknown>(source: SourceName, opts: { force?: boolean } = {}): Promise<T> {
  const out = cachePath(source);

  if (!opts.force && existsSync(out) && statSync(out).size > 0) {
    const text = readFileSync(out, 'utf8');
    return parseJson(source, text);
  }

  let res: Response;
  try {
    res = await fetch(SOURCES[source], { headers: { 'accept-encoding': 'gzip' } });
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code ? `${cause.code}: ${cause.message}` : (err as Error).message;
    throw new FetchError(
      source,
      'network',
      `无法连接数据源（${SOURCES[source]}）：${detail}`,
      '检查网络或代理设置；本机 PowerShell 的 TLS 已知异常，请确认是走 Node 直连而非 curl。',
    );
  }

  if (!res.ok) {
    throw new FetchError(
      source,
      'http',
      `数据源返回 HTTP ${res.status}（${SOURCES[source]}）`,
      '可能是数据源暂时不可用或地址已变更，请确认后再决定是否继续。',
    );
  }

  const text = await res.text();
  const parsed = parseJson<T>(source, text);

  mkdirSync(join(repoRoot, CACHE_DIR), { recursive: true });
  writeFileSync(out, text);

  return parsed;
}

function readCache(path: string): string {
  return readFileSync(path, 'utf8');
}

function parseJson<T>(source: SourceName, text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new FetchError(
      source,
      'parse',
      `数据源返回的不是合法 JSON：${(err as Error).message}`,
      '可能是数据源返回了错误页或中途中断，请稍后重试或人工检查。',
    );
  }
}
