import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const errors: string[] = [];

async function open(page: Page) {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  // 初回はデモ曲がライブラリに入る
  await expect(page.locator('[data-testid=library-list] .song-row')).toHaveCount(5);
}

async function playSong(page: Page, name: string) {
  await page.locator('[data-testid=library-list] .song-main', { hasText: name }).click();
  await expect(page.locator('.song-title')).toContainText(name);
  await expect(page.locator('[data-testid=play]')).toHaveAttribute('aria-label', '一時停止', {
    timeout: 30_000,
  });
}

const positionSeconds = async (page: Page) => {
  const text = (await page.locator('.seek .time').first().textContent()) ?? '';
  const m = /(\d+):(\d+)/.exec(text);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

test.describe('MIDI Studio Player', () => {
  test('loads a demo, plays, seeks and pauses', async ({ page }) => {
    await open(page);
    await playSong(page, 'Canon');
    await expect.poll(() => positionSeconds(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    // シーク（シークバーの中央をクリック）
    const track = page.locator('.seek-track');
    const box = (await track.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
    await expect.poll(() => positionSeconds(page)).toBeGreaterThan(60);
    // 一時停止
    await page.locator('[data-testid=play]').click();
    await expect(page.locator('[data-testid=play]')).toHaveAttribute('aria-label', '再生');
    const t1 = await positionSeconds(page);
    await page.waitForTimeout(1500);
    expect(await positionSeconds(page)).toBe(t1);
    expect(errors).toEqual([]);
  });

  test('accepts dropped MIDI files', async ({ page }) => {
    await open(page);
    const bytes = readFileSync('public/demo/minuet-in-g.mid');
    // 中身が同じだと重複扱いになるので末尾を変える
    const data = [...bytes, 0];
    const dt = await page.evaluateHandle((arr) => {
      const t = new DataTransfer();
      t.items.add(new File([new Uint8Array(arr)], 'dropped-song.mid', { type: 'audio/midi' }));
      return t;
    }, data);
    await page.dispatchEvent('body', 'dragenter', { dataTransfer: dt });
    await expect(page.locator('.drop-overlay')).toBeVisible();
    await page.dispatchEvent('body', 'drop', { dataTransfer: dt });
    await expect(page.locator('[data-testid=library-list] .song-row')).toHaveCount(6);
    await expect(page.locator('.song-title')).toContainText('Minuet');
  });

  test('mixer mute, tempo and transpose controls', async ({ page }) => {
    await open(page);
    await playSong(page, 'Ode to Joy');
    const mute = page.locator('[data-testid=mute-0]');
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid=strip-0]')).toHaveClass(/muted/);
    // テンポ（] キー）と移調（= キー）
    await page.keyboard.press(']');
    await page.keyboard.press(']');
    await expect(page.locator('.mini-control').first()).toContainText('×1.10');
    await page.keyboard.press('Equal');
    await expect(page.locator('.mini-control').nth(1)).toContainText('+1');
    // 元に戻す
    await page.keyboard.press('Control+z');
    await expect(page.locator('.mini-control').nth(1)).toContainText('0');
    expect(errors).toEqual([]);
  });

  test('switches between all visualizers without errors', async ({ page }) => {
    await open(page);
    await playSong(page, 'さくら');
    for (const v of ['falling', 'keys', 'spectrum', 'lyrics', 'events', 'info', 'roll']) {
      await page.click(`[data-testid=viz-${v}]`);
      await page.waitForTimeout(700);
    }
    await page.click('[data-testid=viz-lyrics]');
    await expect(page.locator('.lyrics-stage')).toContainText('さくら', { timeout: 20_000 });
    await page.click('[data-testid=viz-info]');
    await expect(page.locator('.song-info')).toContainText('Koto');
    expect(errors).toEqual([]);
  });

  test('keyboard shortcuts: play/pause and help', async ({ page }) => {
    await open(page);
    await playSong(page, 'Twinkle');
    await page.keyboard.press('Space');
    await expect(page.locator('[data-testid=play]')).toHaveAttribute('aria-label', '再生');
    await page.keyboard.press('Space');
    await expect(page.locator('[data-testid=play]')).toHaveAttribute('aria-label', '一時停止');
    await page.keyboard.press('Shift+Slash');
    await expect(page.locator('dialog.modal')).toContainText('キーボードショートカット');
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog.modal')).toHaveCount(0);
    // A-B ループ
    await page.keyboard.press('KeyL');
    await expect(page.locator('.ab-group .chip.active')).toHaveCount(1);
  });

  test('exports WAV', async ({ page }) => {
    await open(page);
    await playSong(page, 'Twinkle');
    await page.locator('[data-testid=play]').click();
    await page.click('[data-testid=open-export]');
    await page.locator('dialog select').nth(0).selectOption('44100');
    await page.locator('dialog select').nth(1).selectOption('16');
    const download = page.waitForEvent('download', { timeout: 80_000 });
    await page.click('[data-testid=export-wav]');
    await expect(page.locator('dialog progress')).toBeVisible();
    const d = await download;
    expect(d.suggestedFilename()).toMatch(/\.wav$/);
    const path = await d.path();
    const buf = readFileSync(path);
    expect(buf.subarray(0, 4).toString()).toBe('RIFF');
    // 約 34 秒 × 44.1kHz × 2ch × 2byte
    expect(buf.length).toBeGreaterThan(44100 * 2 * 2 * 25);
    // 無音でないこと
    const pcm = new Int16Array(buf.buffer, buf.byteOffset + 44, Math.floor((buf.length - 44) / 2));
    let peak = 0;
    for (let i = 0; i < pcm.length; i += 3) peak = Math.max(peak, Math.abs(pcm[i]));
    expect(peak).toBeGreaterThan(1000);
  });

  test('works offline after the first visit', async ({ page, context }) => {
    await open(page);
    // Service Worker の有効化と SoundFont のキャッシュを待つ
    await page.waitForFunction(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return !!reg?.active;
    });
    await page.waitForFunction(async () => (await caches.keys()).includes('soundfonts'), undefined, {
      timeout: 30_000,
    });
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('[data-testid=library-list] .song-row')).toHaveCount(5);
    await playSong(page, 'Minuet');
    await context.setOffline(false);
  });
});
