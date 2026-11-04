// PoC: dump the fields of one weapon from a truncated export snapshot.
// Usage: node inspect/one.js <export-weapons.json> <export key>
const fs = require('fs');
const [file, key] = process.argv.slice(2);
const raw = fs.readFileSync(file, 'utf8');

function cutToValid(src) {
  let depth = 0, inStr = false, esc = false, lastClose = -1;
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
      if (depth === 1) lastClose = i;
      if (depth === 0) return src.slice(0, i + 1);
    }
  }
  return src.slice(0, lastClose + 1) + '}';
}

const o = JSON.parse(cutToValid(raw));
const w = o[key];
if (!w) {
  console.error('not found; available keys:', Object.keys(o).join('\n'));
  process.exit(1);
}
const brief = {
  name: w.name,
  totalDamage: w.totalDamage,
  damagePerShot: w.damagePerShot && w.damagePerShot.filter((n) => n > 0),
  multishot: w.multishot,
  procChance: w.procChance,
  tags: w.compatibilityTags,
  behaviours: (w.behaviours || []).map((b) => ({
    state: b.stateName,
    fireIterations: b.fireIterations,
    burst: b.burst,
    segments: Object.keys(b).filter((k) => k !== 'stateName' && k !== 'fireIterations' && k !== 'burst'),
    projectile: b.projectile,
  })),
};
console.log(JSON.stringify(brief, null, 1));
