/**
 * Demo 静态服务器（零依赖，只用 Node 内置模块）。
 *
 * 为什么要自己写：本机 npm 安装依赖受限，而 demo 只需要"把文件发出去"。
 * 浏览器侧直接用原生 ESM（`<script type="module">` 导入 `.ts` 没有意义，所以这里
 * 在**服务端把 `.ts` 转成 `.js`**——做法极其简单：只把 `import ... from './x.ts'` 的
 * 扩展名改成 `.js`，并把 `import type` / `export type` 行去掉，其余原样送出。
 *
 * 约束（故意保持简单）：
 *   · 源码只使用"类型注解可整体删除"的语法：`interface` / `type` 声明会被删掉，
 *     `: SomeType` 注解需要显式写成 `import type` 或 `export type`；
 *   · 不用 enum / namespace / 参数属性等需要真正编译的语法。
 *
 * 用法：`node packages/demo/src/server.mjs`  然后打开终端里打印的地址。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, sep, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));
const DEMO_DIR = join(ROOT, 'packages/demo');
const PORT = Number(process.env.PORT ?? 5178);

const { transpile, findUnrewrittenTs, rewriteRelativeTs } = await import(
  pathToFileURL(join(DEMO_DIR, 'src/transpile.mjs')).href
);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function safeJoin(base, rel) {
  const target = normalize(join(base, rel));
  if (!target.startsWith(base + sep) && target !== base) return null;
  return target;
}

/**
 * 把一个 URL 解析成「要读哪个文件」+「是否要剥类型」。
 *
 * 关键：浏览器侧收到的模块说明符是 `.js`，但仓库里只有 `.ts` 源文件，
 * 所以**同时接受 `.js` 与 `.ts` 两种请求**，两者都映射到同一个 `.ts` 源文件。
 * （之前只接受 `.ts`，于是 index.js 里的 `export * from './damage-types.ts'` 改写成 `.js`
 *  后浏览器去请求 `.js`，服务器 404，整页 JS 全挂。）
 */
function resolveRequest(pathname) {
  const candidates = [];
  // 1. 原样
  candidates.push({ path: safeJoin(ROOT, pathname), strip: pathname.endsWith('.ts') });
  candidates.push({ path: safeJoin(join(DEMO_DIR, 'public'), pathname), strip: pathname.endsWith('.ts') });
  // 2. `<x>.js` 请求 → 回落到仓库里的 `<x>.ts`（demo 自己不编译，由服务器剥类型）
  if (pathname.endsWith('.js')) {
    const tsPath = pathname.slice(0, -3) + '.ts';
    candidates.push({ path: safeJoin(ROOT, tsPath), strip: true });
    candidates.push({ path: safeJoin(join(DEMO_DIR, 'public'), tsPath), strip: true });
  }
  return candidates.find((c) => c.path && existsSync(c.path));
}

/** demo 自己的前端 JS（`packages/demo/public/*.js`）里写的是 `.ts` 源路径，发出前也要改成 `.js` */
const DEMO_PUBLIC = join(DEMO_DIR, 'public');
function isDemoPublicJs(p) {
  return p.startsWith(DEMO_PUBLIC) && p.endsWith('.js');
}

// ─────────────────────────────────────────────────────────────
// 开发态武器编辑器（D-044）
//
// 只有本地 `npm run demo` 起的这份服务才提供写文件能力；
// 部署成静态页时根本没有后端，前端靠 `/__dev` 探针判断是否显示编辑按钮。
// ─────────────────────────────────────────────────────────────

const OVERRIDES_PATH = join(ROOT, 'packages/data/src/manual/weapon-overrides.json');

/** 允许写入的武器级字段（白名单，其余一律拒绝） */
const EDITABLE_WEAPON_FIELDS = new Set([
  'critChance', 'critMultiplier', 'statusChance', 'fireRate', 'magazineSize', 'reloadTime',
]);
/** 允许写入的分段级字段（含 D-050 的模式级面板 override） */
const EDITABLE_SEGMENT_FIELDS = new Set(['trigger', 'role', 'procChance', 'damage', 'override']);
const OVERRIDE_PANEL_FIELDS = new Set([
  'critChance', 'critMultiplier', 'statusChance', 'fireRate', 'magazineSize', 'reloadTime',
]);

function readOverrides() {
  try {
    return JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * 校验并落地一次编辑。
 * 规则（D-044）：只改现有字段的**值**；伤害分布可增删**类型**；
 * **面板总伤不可写**（它恒等于 Σ damage，由分布自动得出）。
 */
function validateEdit(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') return { errors: ['请求体不是对象'] };
  const { weaponId, modes } = payload;
  if (typeof weaponId !== 'string' || !weaponId) errors.push('缺少 weaponId');
  if (!Array.isArray(modes)) errors.push('modes 必须是数组');

  if (!errors.length) {
    for (const [k] of Object.entries(payload)) {
      if (k === 'weaponId' || k === 'modes' || k === 'note') continue;
      if (!EDITABLE_WEAPON_FIELDS.has(k)) errors.push(`武器字段「${k}」不可编辑`);
    }
    for (const m of modes) {
      if (!m || typeof m.id !== 'string') { errors.push('模式缺少 id'); continue; }
      for (const [k] of Object.entries(m)) {
        if (k === 'id' || k === 'variants') continue;
        if (!EDITABLE_SEGMENT_FIELDS.has(k)) errors.push(`模式字段「${k}」不可编辑`);
      }
      // D-050：模式级面板 override 校验（只允许六项面板字段，值必须有限且非负）
      if (m.override !== undefined) {
        if (!m.override || typeof m.override !== 'object') {
          errors.push('override 必须是对象');
        } else {
          for (const [k, v] of Object.entries(m.override)) {
            if (!OVERRIDE_PANEL_FIELDS.has(k)) {
              errors.push(`模式面板字段「${k}」不可编辑`);
              continue;
            }
            if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
              errors.push(`模式面板字段「${k}」必须是非负数字`);
            }
          }
        }
      }

      // D-080：段只属于变体，模式上没有 segments
      //
      // D-103 修复：`variants` 是 D-083 之后的**唯一**段容器，原来这里漏了它，
      // 导致编辑器保存（以及 verify-editor / override-e2e 等测试）全被
      // 「模式字段「variants」不可编辑」拒掉。它必须与 `id` 一样放行。
      if (!Array.isArray(m.variants) || m.variants.length === 0) {
        errors.push('variants 必须是至少含 1 项的数组');
        continue;
      }
      for (const v of m.variants) {
        if (typeof v.id !== 'string' || typeof v.label !== 'string') {
          errors.push('变体必须含字符串 id 与 label');
          continue;
        }
        if (!Array.isArray(v.segments)) { errors.push(`变体「${v.id}」的 segments 必须是数组`); continue; }
        for (const seg of v.segments) {
          for (const [k] of Object.entries(seg)) {
            if (k === 'kind' || k === 'aoe' || k === 'damage' || k === 'procChance') continue;
            errors.push(`分段字段「${k}」不可编辑`);
          }
          if (!seg.damage || typeof seg.damage !== 'object') { errors.push('分段缺少 damage'); continue; }
          for (const [t, val] of Object.entries(seg.damage)) {
            if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
              errors.push(`伤害类型「${t}」的值必须是非负数字`);
            }
          }
        }
      }
    }
  }
  return { errors };
}

function handleSaveWeapon(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (err) {
      return send(400, { ok: false, errors: [`JSON 解析失败：${String(err)}`] });
    }
    const { errors } = validateEdit(payload);
    if (errors.length) return send(400, { ok: false, errors });

    const all = readOverrides();
    all[payload.weaponId] = {
      ...payload,
      _manual: true,
      _updatedAt: new Date().toISOString(),
      note: payload.note || '通过 demo 编辑器修改',
    };
    mkdirSync(dirname(OVERRIDES_PATH), { recursive: true });
    writeFileSync(OVERRIDES_PATH, JSON.stringify(all, null, 2) + '\n', 'utf8');
    send(200, { ok: true, path: 'packages/data/src/manual/weapon-overrides.json' });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  // 开发态探针：前端据此决定是否渲染「编辑」按钮
  if (pathname === '/__dev') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ dev: true, canEdit: true }));
    return;
  }

  // 保存武器编辑（仅本服务可用；静态部署没有这个接口）
  if (pathname === '/__save-weapon' && req.method === 'POST') {
    handleSaveWeapon(req, res);
    return;
  }

  // 读取当前的 overrides（用于"已修改"提示与编辑页初值）
  if (pathname === '/__weapon-overrides') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(readOverrides()));
    return;
  }

  const hit = resolveRequest(pathname);

  if (hit) {
    let body;
    let type = MIME[extname(hit.path)] ?? 'application/octet-stream';
    try {
      if (hit.strip) {
        const src = await readFile(hit.path, 'utf8');
        body = transpile(src);
        // 自检：不许再残留指向 .ts 的相对导入（那就是这次 404 的成因）
        const leftover = findUnrewrittenTs(body);
        if (leftover.length) {
          console.warn(`⚠ ${hit.path} 仍有未改写的 .ts 导入：${leftover.join(', ')}`);
        }
        type = MIME['.js'];
      } else if (isDemoPublicJs(hit.path)) {
        // demo 自己的 JS 不剥类型（没有类型可剥），但要把 `.ts` 源路径改写成 `.js`
        body = rewriteRelativeTs(await readFile(hit.path, 'utf8'));
        type = MIME['.js'];
      } else {
        body = await readFile(hit.path);
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(String(err));
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`404 ${pathname}`);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  计算内核 demo 已启动：http://127.0.0.1:${PORT}\n`);
});
