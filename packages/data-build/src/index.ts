/**
 * 数据抓取与清洗流水线（骨架）。
 *
 * 输入：https://browse.wf/warframe-public-export-plus/ExportWeapons.json
 * 输出：packages/data/src/generated/weapons.json
 *
 * 清洗规则见 research/01-数据源可行性验证.md 第 6 节，核心 4 条：
 *   1. 丢弃无 stateName 的占位 behaviour
 *   2. behaviour → AttackMode；impact/attack/explosiveAttack/embedDeathAttack → DamageSegment
 *   3. 保留 multishot / fireRate / trigger / magazine / reload 等 DPS 字段
 *   4. 输出前做 JSON Schema 校验，并记录与上一版快照的 diff
 *
 * 注意：抓取走 Node 原生 fetch，不依赖系统 TLS/代理（本机 TLS 曾出现凭据异常）。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const EXPORT_WEAPONS_URL = 'https://browse.wf/warframe-public-export-plus/ExportWeapons.json';

export async function fetchWeapons(): Promise<Record<string, unknown>> {
  const res = await fetch(EXPORT_WEAPONS_URL, {
    headers: { 'accept-encoding': 'gzip' },
  });
  if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function build(): Promise<void> {
  const raw = await fetchWeapons();
  const count = Object.keys(raw).length;
  const out = resolve(import.meta.dirname, '../../data/src/generated/weapons.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ version: new Date().toISOString(), count, weapons: {} }, null, 2));
  console.log(`fetched ${count} weapons -> ${out}`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  await build();
}
