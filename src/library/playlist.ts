import type { RepeatMode } from '../state/settings';

export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  const next = arr.slice();
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  const dest = Math.max(0, Math.min(next.length, to));
  next.splice(dest, 0, item);
  return next;
}

export function removeAt<T>(arr: readonly T[], index: number): T[] {
  return arr.filter((_, i) => i !== index);
}

/** Fisher-Yates。first を指定するとその要素を先頭に固定する */
export function shuffledOrder(n: number, first?: number, rand: () => number = Math.random): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (first !== undefined && first >= 0 && first < n) {
    const idx = order.indexOf(first);
    [order[0], order[idx]] = [order[idx], order[0]];
  }
  return order;
}

/**
 * 次に再生するキュー位置を求める。
 * order はシャッフル時の再生順（キュー位置の配列）。null を返したら停止。
 */
export function nextIndex(
  current: number,
  length: number,
  repeat: RepeatMode,
  order: number[] | null,
  direction: 1 | -1 = 1,
  auto = true,
): number | null {
  if (length === 0) return null;
  if (auto && repeat === 'one') return current;
  const seq = order && order.length === length ? order : Array.from({ length }, (_, i) => i);
  const pos = seq.indexOf(current);
  let nextPos = (pos < 0 ? 0 : pos) + direction;
  if (nextPos >= length) {
    if (repeat === 'all' || !auto) nextPos = 0;
    else return null;
  }
  if (nextPos < 0) nextPos = repeat === 'all' || !auto ? length - 1 : 0;
  return seq[nextPos];
}

export interface ExportedEntry {
  name: string;
  fileName: string;
  url?: string;
}

export function toM3U(entries: ExportedEntry[], title = 'Playlist'): string {
  const lines = ['#EXTM3U', `#PLAYLIST:${title}`];
  for (const e of entries) {
    lines.push(`#EXTINF:-1,${e.name}`);
    lines.push(e.url ?? e.fileName);
  }
  return lines.join('\n') + '\n';
}

export function parseM3U(text: string): ExportedEntry[] {
  const out: ExportedEntry[] = [];
  let pendingName: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const comma = line.indexOf(',');
      pendingName = comma >= 0 ? line.slice(comma + 1).trim() : null;
      continue;
    }
    if (line.startsWith('#')) continue;
    const isUrl = /^https?:\/\//i.test(line);
    const fileName = decodeURIComponent(line.split(/[\\/]/).pop() ?? line);
    out.push({ name: pendingName ?? fileName, fileName, url: isUrl ? line : undefined });
    pendingName = null;
  }
  return out;
}

export interface PlaylistJSON {
  format: 'midi-studio-playlist';
  version: 1;
  name: string;
  entries: ExportedEntry[];
}

export function toPlaylistJSON(name: string, entries: ExportedEntry[]): string {
  const doc: PlaylistJSON = { format: 'midi-studio-playlist', version: 1, name, entries };
  return JSON.stringify(doc, null, 2);
}

export function parsePlaylistJSON(text: string): { name: string; entries: ExportedEntry[] } {
  const doc = JSON.parse(text);
  if (!doc || doc.format !== 'midi-studio-playlist' || !Array.isArray(doc.entries)) {
    throw new Error('Invalid playlist file');
  }
  return {
    name: String(doc.name ?? 'Playlist'),
    entries: doc.entries
      .filter((e: any) => e && (typeof e.fileName === 'string' || typeof e.url === 'string'))
      .map((e: any) => ({
        name: String(e.name ?? e.fileName),
        fileName: String(e.fileName ?? ''),
        url: e.url,
      })),
  };
}

const MIDI_EXT = /\.(mid|midi|smf|kar|rmi|xmf|mxmf)$/i;
export const isMidiFileName = (n: string) => MIDI_EXT.test(n);
export const isSoundFontName = (n: string) => /\.(sf2|sf3|sfogg|dls)$/i.test(n);
export const stripExt = (n: string) => n.replace(/\.[^.]+$/, '');
