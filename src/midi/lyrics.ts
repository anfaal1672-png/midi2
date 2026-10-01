import { decodeText, type TextEncodingName } from './encoding';
import type { TextMeta } from './types';

export interface Syllable {
  text: string;
  start: number;
  end: number;
}

export interface LyricLine {
  start: number;
  end: number;
  syllables: Syllable[];
  paragraphStart: boolean;
}

/**
 * 歌詞イベントを行単位にまとめる。
 * - KAR: 先頭 "\" は段落区切り、"/" は改行
 * - SMF Lyric: 末尾 CR/LF は改行
 */
export function buildLyricLines(
  lyrics: TextMeta[],
  encoding: Exclude<TextEncodingName, 'auto'>,
  songEnd: number,
): LyricLine[] {
  const lines: LyricLine[] = [];
  let cur: LyricLine | null = null;
  let pendingBreak = true;
  let pendingParagraph = true;

  const startLine = (sec: number, paragraph: boolean) => {
    cur = { start: sec, end: sec, syllables: [], paragraphStart: paragraph };
    lines.push(cur);
  };

  for (const ev of lyrics) {
    let text = decodeText(ev.bytes, encoding);
    if (!text) continue;
    let breakBefore = false;
    let paragraph = false;
    if (text.startsWith('\\')) {
      breakBefore = true;
      paragraph = true;
      text = text.slice(1);
    } else if (text.startsWith('/')) {
      breakBefore = true;
      text = text.slice(1);
    }
    let breakAfter = false;
    if (/[\r\n]+$/.test(text)) {
      breakAfter = true;
      text = text.replace(/[\r\n]+$/, '');
    }
    // 行内の改行
    const parts = text.split(/\r\n|\r|\n/);
    parts.forEach((part, idx) => {
      if (breakBefore || pendingBreak || idx > 0 || !cur) {
        startLine(ev.sec, paragraph || pendingParagraph);
        breakBefore = false;
        pendingBreak = false;
        pendingParagraph = false;
        paragraph = false;
      }
      if (part.length) cur!.syllables.push({ text: part, start: ev.sec, end: ev.sec });
    });
    if (breakAfter) pendingBreak = true;
  }

  const filtered = lines.filter((l) => l.syllables.length > 0);
  // 各音節の終了時刻 = 次の音節の開始（行末は次の行の開始または+2秒）
  const flat: Syllable[] = filtered.flatMap((l) => l.syllables);
  for (let i = 0; i < flat.length; i++) {
    const next = flat[i + 1];
    const maxEnd = flat[i].start + 3;
    flat[i].end = Math.min(next ? next.start : songEnd, maxEnd);
    if (flat[i].end <= flat[i].start) flat[i].end = flat[i].start + 0.05;
  }
  for (const l of filtered) {
    l.start = l.syllables[0].start;
    l.end = l.syllables[l.syllables.length - 1].end;
  }
  return filtered;
}

/** 現在時刻の行インデックス（まだ始まっていなければ -1） */
export function currentLineIndex(lines: LyricLine[], t: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].start <= t) idx = i;
    else break;
  }
  return idx;
}

/** 音節の進捗（0..1） */
export function syllableProgress(s: Syllable, t: number): number {
  if (t <= s.start) return 0;
  if (t >= s.end) return 1;
  return (t - s.start) / (s.end - s.start);
}
