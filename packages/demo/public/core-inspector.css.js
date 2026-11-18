/** 验证页的静态资源与样式（与页面逻辑分开，方便以后换皮）。 */
export const STYLE = `
  :root {
    --bg: #14161a; --panel: #1c1f26; --line: #2a2f38; --text: #d7dbe3;
    --muted: #7d8798; --accent: #4a9eff; --ok: #4ade80; --bad: #f87171; --co: #fbbf24;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  }
  header {
    display: flex; gap: 10px; align-items: center; padding: 8px 14px;
    border-bottom: 1px solid var(--line); background: var(--panel);
    position: sticky; top: 0; z-index: 5; flex-wrap: wrap;
  }
  header h1 { font-size: 13px; margin: 0 8px 0 0; font-weight: 600; }
  select, input {
    background: #0f1116; color: var(--text); border: 1px solid var(--line);
    border-radius: 4px; padding: 3px 6px; font: inherit;
  }
  input[type=number] { width: 58px; }
  label { color: var(--muted); display: inline-flex; align-items: center; gap: 4px; }
  main {
    display: grid; grid-template-columns: 260px 1fr 360px;
    gap: 10px; padding: 10px 14px; align-items: start;
  }
  section {
    background: var(--panel); border: 1px solid var(--line);
    border-radius: 6px; padding: 8px 10px;
  }
  h2 { font-size: 11px; margin: 0 0 6px; color: var(--muted); font-weight: 600; letter-spacing: .05em;
       display: flex; justify-content: space-between; align-items: center; }
  .mini {
    background: #0f1116; color: var(--muted); border: 1px solid var(--line);
    border-radius: 3px; padding: 1px 6px; font: inherit; font-size: 10px; cursor: pointer;
    letter-spacing: 0; font-weight: 400;
  }
  .mini:hover { color: var(--bad); border-color: #5a2024; }

  /* ── 槽位 ── */
  .slots { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin-bottom: 8px; }
  .slot {
    min-height: 46px; border: 1px dashed var(--line); border-radius: 4px;
    padding: 3px 5px; font-size: 11px; cursor: pointer; position: relative;
    display: flex; align-items: center; justify-content: center; text-align: center;
    color: var(--muted); background: #171a20;
  }
  .slot.filled { border-style: solid; border-color: #3a4250; color: var(--text); background: #1f242e; }
  .slot.dropover { border-color: var(--accent); background: #1d2733; }
  .slot .x {
    position: absolute; top: 1px; right: 3px; font-size: 11px; color: var(--muted);
  }
  .slot .x:hover { color: var(--bad); }
  .slot .lbl { line-height: 1.25; word-break: break-all; }
  .exilus-row { display: flex; gap: 5px; margin-bottom: 8px; }
  .exilus-row .slot { flex: 1; }
  .arcane-row { display: flex; gap: 5px; }
  .arcane-row .slot { flex: 1; }

  /* ── 备选区 ── */
  .stack { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .stack section { min-width: 0; }
  .filters { display: flex; flex-wrap: wrap; gap: 3px; margin-bottom: 6px; }
  .filters button {
    background: #0f1116; color: var(--muted); border: 1px solid var(--line);
    border-radius: 3px; padding: 2px 7px; font: inherit; font-size: 11px; cursor: pointer;
  }
  .filters button.active { color: #fff; border-color: var(--accent); background: #1d2733; }
  /* 多列网格：卡片是方正的块，不是又扁又长的条 */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(178px, 1fr));
    gap: 5px;
    max-height: 42vh;
    overflow: auto;
    align-content: start;
  }
  .card {
    border: 1px solid var(--line); border-radius: 4px; padding: 6px 8px;
    background: #171a20; cursor: pointer;
    display: flex; flex-direction: column; gap: 4px; font-size: 12px;
    min-width: 0;
  }
  .card:hover { background: #232833; border-color: #3a4250; }
  .card.on { opacity: .4; }
  .card .name { font-weight: 500; line-height: 1.3; word-break: break-word; }
  .card .val { color: var(--accent); font-size: 11px; font-variant-numeric: tabular-nums; }
  .card .sub { color: var(--muted); font-size: 10px; line-height: 1.3; margin-top: -2px; }
  .aria-line {
    display: flex; justify-content: space-between; align-items: baseline;
    gap: 8px; line-height: 1.35; min-width: 0;
  }
  .aria-line > span:first-child { min-width: 0; }
  .aria-line .amount { white-space: nowrap; flex: 0 0 auto; }
  .card .tag { color: var(--muted); font-size: 10px; margin-top: auto; }
  .card.arcane .name { color: #c4a6ff; }
  .grid-arcanes { max-height: 30vh; grid-template-columns: repeat(auto-fill, minmax(196px, 1fr)); }
  .empty { color: var(--muted); padding: 14px; text-align: center; font-size: 12px; grid-column: 1 / -1; }

  /* ── 素材池 ── */
  .check { padding: 5px 9px; border-radius: 4px; margin-bottom: 8px; font-size: 11px; }
  .check.ok { background: #14281c; color: var(--ok); border: 1px solid #1f4a30; }
  .check.bad { background: #2a1618; color: var(--bad); border: 1px solid #5a2024; }
  .meta { color: var(--muted); font-size: 11px; margin-bottom: 8px; }
  .buckets { display: flex; flex-direction: column; gap: 6px; max-height: 72vh; overflow: auto; }
  .bucket { border: 1px solid var(--line); border-radius: 5px; overflow: hidden; }
  .bucket-head {
    display: flex; justify-content: space-between; align-items: baseline;
    padding: 4px 9px; background: #191c22; border-bottom: 1px solid var(--line);
  }
  .bucket-key { font-family: ui-monospace, Consolas, monospace; font-size: 11px; }
  .sum { font-variant-numeric: tabular-nums; }
  .sum b { font-size: 14px; }
  .sum .co { color: var(--co); }
  .bucket-body { padding: 3px 9px 6px; }
  .entry { display: flex; justify-content: space-between; gap: 10px; padding: 1px 0; font-size: 11px; }
  .entry .src { color: var(--muted); font-family: ui-monospace, Consolas, monospace; }
  .entry.off { opacity: .4; text-decoration: line-through; }
  .muted { color: var(--muted); }
  .locked { color: var(--bad); font-weight: 600; margin-left: 2px; }
`;
