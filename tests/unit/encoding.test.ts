import { describe, expect, it } from 'vitest';
import {
  decodeText,
  detectEncoding,
  eucJpScore,
  resolveEncoding,
  shiftJisScore,
} from '../../src/midi/encoding';

// 「さくら」
const SJIS = new Uint8Array([0x82, 0xb3, 0x82, 0xad, 0x82, 0xe7]);
const EUC = new Uint8Array([0xa4, 0xb5, 0xa4, 0xaf, 0xa4, 0xe9]);
const UTF8 = new TextEncoder().encode('さくら');
const LATIN1 = new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x20, 0x64, 0xe9, 0x6a, 0xe0]); // "Café déjà"

describe('encoding detection', () => {
  it('detects UTF-8', () => expect(detectEncoding([UTF8])).toBe('utf-8'));
  it('detects Shift_JIS', () => expect(detectEncoding([SJIS])).toBe('shift_jis'));
  it('detects EUC-JP', () => expect(eucJpScore(EUC)).toBe(1));
  it('falls back to windows-1252 for Latin text', () =>
    expect(detectEncoding([LATIN1])).toBe('windows-1252'));
  it('treats pure ASCII as UTF-8', () =>
    expect(detectEncoding([new Uint8Array([0x41, 0x42])])).toBe('utf-8'));
  it('scores broken Shift_JIS low', () =>
    expect(shiftJisScore(new Uint8Array([0x82, 0x20, 0x82, 0x20]))).toBe(0));
  it('detects across many fragments', () => {
    const parts = [SJIS.subarray(0, 2), SJIS.subarray(2, 4), SJIS.subarray(4)];
    expect(detectEncoding(parts)).toBe('shift_jis');
  });
  it('honours a manual override', () => expect(resolveEncoding('euc-jp', [SJIS])).toBe('euc-jp'));
});

describe('decodeText', () => {
  it('decodes Shift_JIS and strips trailing NULs', () => {
    expect(decodeText(new Uint8Array([...SJIS, 0, 0]), 'shift_jis')).toBe('さくら');
  });
  it('decodes EUC-JP', () => expect(decodeText(EUC, 'euc-jp')).toBe('さくら'));
});
