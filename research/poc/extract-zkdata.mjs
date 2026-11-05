// 从紫卡模拟器 HTML 里取出内嵌的 JS 数据表（ZKMODS / ZKSETS / ZKARCS ...），
// 落到 .cache/inspect/*.json，便于离线分析。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const HTML = '20261031紫卡模拟器V10.html';

/** 从 `window.NAME=` 处开始做括号配平，取出完整的 JSON 字面量 */
function grab(src, name) {
  const marker = `window.${name}=`;
  const i = src.indexOf(marker);
  if (i < 0) return null;
  const start = i + marker.length;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = start; k < src.length; k++) {
    const c = src[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(src.slice(start, k + 1));
    }
  }
  return null;
}

const t = readFileSync(HTML, 'utf8');
mkdirSync('.cache/inspect', { recursive: true });

for (const name of ['ZKMODS', 'ZKSETS', 'ZKARCS', 'ZKSTANCE', 'ZKNAMES']) {
  const v = grab(t, name);
  if (v == null) {
    console.log(name, 'NOT FOUND');
    continue;
  }
  writeFileSync(`.cache/inspect/${name.toLowerCase()}.json`, JSON.stringify(v, null, 0));
  console.log(name, Array.isArray(v) ? `array ${v.length}` : typeof v);
}
