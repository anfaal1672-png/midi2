import { describe, expect, it } from 'vitest';
import { buildLyricLines, currentLineIndex, syllableProgress } from '../../src/midi/lyrics';
import type { TextMeta } from '../../src/midi/types';

const enc = new TextEncoder();
const meta = (sec: number, text: string): TextMeta => ({
  sec,
  tick: 0,
  track: 0,
  type: 0x05,
  bytes: enc.encode(text),
});

describe('buildLyricLines', () => {
  it('splits KAR lines on "/" and paragraphs on "\\"', () => {
    const lines = buildLyricLines(
      [meta(0, '\\Twin'), meta(0.5, 'kle '), meta(1, '/How '), meta(1.5, 'I'), meta(2, '\\Up')],
      'utf-8',
      10,
    );
    expect(lines.map((l) => l.syllables.map((s) => s.text).join(''))).toEqual(['Twinkle ', 'How I', 'Up']);
    expect(lines[2].paragraphStart).toBe(true);
    expect(lines[0].syllables[0].end).toBeCloseTo(0.5);
  });
  it('splits SMF lyric lines on CR/LF', () => {
    const lines = buildLyricLines([meta(0, 'さ'), meta(1, 'く'), meta(2, 'ら\r'), meta(3, 'や')], 'utf-8', 5);
    expect(lines.map((l) => l.syllables.map((s) => s.text).join(''))).toEqual(['さくら', 'や']);
  });
  it('finds the current line and syllable progress', () => {
    const lines = buildLyricLines([meta(0, 'a'), meta(1, 'b\n'), meta(2, 'c')], 'utf-8', 4);
    expect(currentLineIndex(lines, -1)).toBe(-1);
    expect(currentLineIndex(lines, 1.5)).toBe(0);
    expect(currentLineIndex(lines, 2.5)).toBe(1);
    expect(syllableProgress(lines[0].syllables[0], 0.5)).toBeCloseTo(0.5);
  });
});
