// PoC: repair a truncated JSON snapshot and profile the Warframe weapon export schema.
// Usage: node inspect.js <export-weapons.json>
const fs = require('fs');
const file = process.argv[2];
const raw = fs.readFileSync(file, 'utf8');

// Strategy: walk the source and cut it at the last byte offset where the object is
// syntactically closed at depth 1 (end of a complete weapon entry). Then re-close.
function cutToValid(src) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  let lastCloseAtDepth1 = -1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 1) lastCloseAtDepth1 = i;
      if (depth === 0) return src.slice(0, i + 1);
    }
  }
  return src.slice(0, lastCloseAtDepth1 + 1) + '}';
}

let o;
try {
  o = JSON.parse(raw);
  console.log('[parse] full JSON OK');
} catch (e) {
  console.log('[parse] truncated/invalid (' + e.message + ') -> repairing');
  o = JSON.parse(cutToValid(raw));
  console.log('[parse] repaired JSON OK');
}

const keys = Object.keys(o);
const cats = {};
for (const k of keys) {
  const c = (o[k] && o[k].productCategory) || '?';
  cats[c] = (cats[c] || 0) + 1;
}
const behKeys = new Set();
const projKeys = new Set();
const attackKeys = new Set();
const topKeys = new Set();
let nBeh = 0, withIncarnon = 0, withMultiBehaviour = 0, withEmbed = 0, withExplosive = 0, withBurst = 0;
for (const k of keys) {
  const w = o[k] || {};
  for (const p of Object.keys(w)) topKeys.add(p);
  if (/incarnon/i.test(JSON.stringify(w))) withIncarnon++;
  if ((w.behaviours || []).length > 1) withMultiBehaviour++;
  for (const b of w.behaviours || []) {
    nBeh++;
    for (const p of Object.keys(b)) behKeys.add(p);
    if (b.burst) withBurst++;
    const pr = b.projectile;
    if (pr) {
      for (const p of Object.keys(pr)) projKeys.add(p);
      for (const at of Object.values(pr)) {
        if (at && typeof at === 'object') for (const p of Object.keys(at)) attackKeys.add(p);
      }
      if (pr.embedDeathAttack) withEmbed++;
      if (pr.explosiveAttack) withExplosive++;
    }
  }
}
console.log('weapons:', keys.length);
console.log('categories:', JSON.stringify(cats));
console.log('behaviours total:', nBeh, '| weapons with >1 behaviour:', withMultiBehaviour, '| with burst:', withBurst);
console.log('behaviour keys:', [...behKeys].sort().join(', '));
console.log('projectile keys:', [...projKeys].sort().join(', '));
console.log('attack keys:', [...attackKeys].sort().join(', '));
console.log('top-level keys:', [...topKeys].sort().join(', '));
console.log('weapons mentioning incarnon:', withIncarnon);
console.log('weapons with embedDeathAttack:', withEmbed, '| with explosiveAttack:', withExplosive);
