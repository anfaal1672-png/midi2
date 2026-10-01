// アイコンと OGP 画像を SVG から生成する（Playwright の Chromium を使用）
// 実行: npm run gen:icons
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();

async function shot(html, w, h, out) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);
  writeFileSync(
    new URL(out, import.meta.url),
    await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } }),
  );
  console.log('wrote', out);
}
const icon = (size) => svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
await shot(icon(192), 192, 192, '../public/icons/icon-192.png');
await shot(icon(512), 512, 512, '../public/icons/icon-512.png');
await shot(icon(180), 180, 180, '../public/icons/apple-touch-icon.png');
await shot(icon(32), 32, 32, '../public/icons/favicon-32.png');
await shot(
  `<div style="width:512px;height:512px;background:#0e1116;display:grid;place-items:center">${icon(400)}</div>`,
  512,
  512,
  '../public/icons/icon-maskable-512.png',
);
await shot(
  `<div style="width:1200px;height:630px;background:linear-gradient(135deg,#0e1116,#1a1f2b);display:flex;align-items:center;gap:56px;padding:0 90px;box-sizing:border-box;font-family:system-ui,sans-serif;color:#e6e8eb">
    ${icon(300)}
    <div><div style="font-size:72px;font-weight:800;letter-spacing:-1px">MIDI Studio Player</div>
    <div style="font-size:34px;margin-top:18px;color:#a9b4c6">ブラウザで動く高機能 MIDI プレイヤー</div>
    <div style="font-size:24px;margin-top:28px;color:#7d8aa0">SoundFont · Piano Roll · Karaoke · Mixer · WAV Export · Web MIDI</div></div>
  </div>`,
  1200,
  630,
  '../public/og.png',
);
await browser.close();
