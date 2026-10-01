// README 用スクリーンショットを撮る（npm run build 後、vite preview を起動した状態で実行）
// 実行: node scripts/screenshots.mjs [baseURL]
import { chromium } from '@playwright/test';

const BASE = process.argv[2] || 'http://localhost:4173/';
const OUT = new URL('../docs/screenshots/', import.meta.url);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required'],
});

async function shoot({ name, width, height, scheme, mobile, song, view, after, simple }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    locale: 'ja-JP',
    colorScheme: scheme,
    isMobile: !!mobile,
    hasTouch: !!mobile,
    deviceScaleFactor: mobile ? 2 : 1,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(simple ? new URL('simple', BASE).toString() : BASE);
  if (simple) {
    await page.locator('[data-testid=simple-song-list] .simple-song', { hasText: song }).click();
    await page.locator('[data-testid=simple-play][aria-label="一時停止"]').waitFor({ timeout: 30000 });
  } else {
    await page.locator('[data-testid=library-list] .song-row').nth(4).waitFor({ state: 'attached' });
    if (mobile) await page.click('.mobile-nav button:nth-child(1)');
    await page.locator('[data-testid=library-list] .song-main', { hasText: song }).click();
    await page.locator('[data-testid=play][aria-label="一時停止"]').waitFor({ timeout: 30000 });
    if (mobile) await page.click('.mobile-nav button:nth-child(2)');
  }
  if (view) await page.click(`[data-testid=viz-${view}]`);
  if (after) await after(page);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: new URL(`${name}.png`, OUT).pathname, fullPage: !!simple && !mobile });
  if (errors.length) console.error(name, errors);
  console.log('wrote', name);
  await ctx.close();
}

const seekTo = (ratio) => async (p) => {
  const box = await p.locator('.seek-track').boundingBox();
  await p.mouse.click(box.x + box.width * ratio, box.y + box.height / 2);
};
await shoot({
  name: 'desktop-dark',
  width: 1440,
  height: 900,
  scheme: 'dark',
  song: 'Canon',
  view: 'roll',
  after: seekTo(0.62),
});
await shoot({
  name: 'desktop-light',
  width: 1440,
  height: 900,
  scheme: 'light',
  song: 'Ode',
  view: 'falling',
  after: seekTo(0.6),
});
await shoot({
  name: 'desktop-split',
  width: 1440,
  height: 900,
  scheme: 'dark',
  song: 'Twinkle',
  view: 'lyrics',
  after: async (p) => {
    await p.click('button[aria-label="画面分割"]');
  },
});
await shoot({
  name: 'mobile-dark',
  width: 390,
  height: 844,
  scheme: 'dark',
  mobile: true,
  song: 'Minuet',
  view: 'falling',
});
await shoot({
  name: 'mobile-light',
  width: 390,
  height: 844,
  scheme: 'light',
  mobile: true,
  song: 'さくら',
  view: 'lyrics',
});
await shoot({ name: 'simple-desktop', width: 1280, height: 900, scheme: 'light', song: 'Ode', simple: true });
await shoot({
  name: 'simple-mobile',
  width: 390,
  height: 844,
  scheme: 'dark',
  mobile: true,
  song: 'さくら',
  simple: true,
});
await browser.close();
