import type { SongAnalysis } from '../midi/types';
import type { ChannelState } from '../state/mixer';
import { effectiveMute } from '../state/mixer';
import { NoteIndex } from './noteIndex';

const indexCache = new WeakMap<SongAnalysis, NoteIndex>();
export function getNoteIndex(a: SongAnalysis): NoteIndex {
  let idx = indexCache.get(a);
  if (!idx) {
    idx = new NoteIndex(a.notes);
    indexCache.set(a, idx);
  }
  return idx;
}

/** 表示用のチャンネル情報（移調量・ドラム・ミュート）を前計算する */
export interface ChannelView {
  shift: Int8Array;
  muted: Uint8Array;
  drum: Uint8Array;
}

export function channelView(a: SongAnalysis, mixer: ChannelState[], globalTranspose: number): ChannelView {
  const n = Math.max(64, a.channelCount);
  const shift = new Int8Array(n);
  const muted = new Uint8Array(n);
  const drum = new Uint8Array(n);
  for (const c of a.channels) drum[c.ch] = c.isDrum ? 1 : 0;
  for (let ch = 0; ch < n; ch++) {
    const m = mixer[ch];
    if (m?.drum !== null && m?.drum !== undefined) drum[ch] = m.drum ? 1 : 0;
    shift[ch] = (drum[ch] ? 0 : globalTranspose) + (m?.transpose ?? 0);
    muted[ch] = effectiveMute(mixer, ch) ? 1 : 0;
  }
  return { shift, muted, drum };
}

export function keyRange(a: SongAnalysis, view: ChannelView, minSpan = 24): [number, number] {
  let lo = 127;
  let hi = 0;
  for (const c of a.channels) {
    if (!c.noteCount) continue;
    lo = Math.min(lo, c.minKey + view.shift[c.ch]);
    hi = Math.max(hi, c.maxKey + view.shift[c.ch]);
  }
  if (lo > hi) {
    lo = 48;
    hi = 84;
  }
  lo = Math.max(0, lo - 2);
  hi = Math.min(127, hi + 2);
  while (hi - lo + 1 < minSpan) {
    if (lo > 0) lo--;
    if (hi - lo + 1 < minSpan && hi < 127) hi++;
    if (lo === 0 && hi === 127) break;
  }
  return [lo, hi];
}

export function formatTime(sec: number, showMs = false): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const base = `${m}:${s.toString().padStart(2, '0')}`;
  if (!showMs) return base;
  return `${base}.${Math.floor((sec % 1) * 1000)
    .toString()
    .padStart(3, '0')}`;
}
