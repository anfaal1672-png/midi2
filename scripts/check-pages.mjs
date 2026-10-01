// Cloudflare Pages の制限を確認する: 1 ファイル 25 MiB 未満、ファイル数 20,000 未満
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';
const MAX_FILE = 25 * 1024 * 1024;
const MAX_FILES = 20000;

if (!existsSync(DIST)) {
  console.error('dist/ がありません。先に npm run build を実行してください。');
  process.exit(1);
}
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else files.push({ path: relative(DIST, p), size: st.size });
  }
};
walk(DIST);
const tooBig = files.filter((f) => f.size >= MAX_FILE);
const total = files.reduce((n, f) => n + f.size, 0);
const largest = [...files].sort((a, b) => b.size - a.size).slice(0, 5);
console.log(`[check:pages] ${files.length} files, ${(total / 1048576).toFixed(2)} MiB total`);
for (const f of largest) console.log(`  ${(f.size / 1048576).toFixed(2).padStart(7)} MiB  ${f.path}`);
let ok = true;
if (tooBig.length) {
  ok = false;
  console.error(
    `[check:pages] NG: 25 MiB 以上のファイルがあります:\n${tooBig.map((f) => '  ' + f.path).join('\n')}`,
  );
}
if (files.length >= MAX_FILES) {
  ok = false;
  console.error(`[check:pages] NG: ファイル数が ${MAX_FILES} 以上です (${files.length})`);
}
for (const req of ['index.html', '_headers', '_redirects', 'sw.js', 'manifest.webmanifest']) {
  if (!files.some((f) => f.path === req)) {
    ok = false;
    console.error(`[check:pages] NG: ${req} がありません`);
  }
}
if (!ok) process.exit(1);
console.log('[check:pages] OK');
