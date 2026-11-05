// 列出 browse.wf 公开导出目录下的所有文件，确认还有哪些 Mod 相关的导出可用。
const res = await fetch('https://browse.wf/warframe-public-export-plus/');
const html = await res.text();
const links = [...html.matchAll(/href="([^"?]+\.json)"/g)].map((m) => m[1]).sort();
console.log('文件数:', links.length);
console.log(links.join('\n'));
