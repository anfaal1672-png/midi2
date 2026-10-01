import type { SongAnalysis } from '../midi/types';
import type { ChannelState } from '../state/mixer';
import { channelView, keyRange } from './common';
import { noteRgb, type ColorMode } from './colors';
import { isBlackKey } from '../midi/gm';

/** 曲全体のピアノロールを PNG にする */
export async function pianoRollPNG(
  a: SongAnalysis,
  mixer: ChannelState[],
  opts: { transpose: number; colorBy: ColorMode; pxPerSec?: number; rowH?: number; dark?: boolean },
): Promise<Blob> {
  const cv = channelView(a, mixer, opts.transpose);
  const [lo, hi] = keyRange(a, cv);
  const rowH = opts.rowH ?? 6;
  const maxW = 16000;
  const pxPerSec = Math.min(opts.pxPerSec ?? 60, maxW / Math.max(1, a.duration));
  const w = Math.ceil(a.duration * pxPerSec) + 20;
  const h = (hi - lo + 1) * rowH + 20;
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const dark = opts.dark ?? true;
  ctx.fillStyle = dark ? '#0e1116' : '#ffffff';
  ctx.fillRect(0, 0, w, h);
  for (let k = lo; k <= hi; k++) {
    if (isBlackKey(k)) {
      ctx.fillStyle = dark ? '#151a21' : '#f1f3f6';
      ctx.fillRect(0, 10 + (hi - k) * rowH, w, rowH);
    }
  }
  ctx.fillStyle = dark ? '#2a313c' : '#d5dae1';
  for (const b of a.bars) ctx.fillRect(10 + b * pxPerSec, 10, 1, h - 20);
  const n = a.notes;
  for (let i = 0; i < n.count; i++) {
    const ch = n.ch[i];
    if (cv.muted[ch]) continue;
    const k = n.key[i] + cv.shift[ch];
    if (k < lo || k > hi) continue;
    const [r, g, b] = noteRgb(opts.colorBy, ch, n.track[i], n.vel[i]);
    ctx.fillStyle = `rgba(${r},${g},${b},${0.5 + (n.vel[i] / 127) * 0.5})`;
    ctx.fillRect(
      10 + n.start[i] * pxPerSec,
      10 + (hi - k) * rowH,
      Math.max(1, (n.end[i] - n.start[i]) * pxPerSec - 0.5),
      rowH - 1,
    );
  }
  if ('convertToBlob' in canvas) return (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
  return new Promise((res, rej) =>
    (canvas as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'),
  );
}
