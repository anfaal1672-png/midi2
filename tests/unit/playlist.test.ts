import { describe, expect, it } from 'vitest';
import {
  isMidiFileName,
  isSoundFontName,
  moveItem,
  nextIndex,
  parseM3U,
  parsePlaylistJSON,
  removeAt,
  shuffledOrder,
  toM3U,
  toPlaylistJSON,
} from '../../src/library/playlist';

describe('queue helpers', () => {
  it('moves and removes items', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(removeAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });

  it('computes next index for repeat modes', () => {
    expect(nextIndex(0, 3, 'none', null)).toBe(1);
    expect(nextIndex(2, 3, 'none', null)).toBeNull();
    expect(nextIndex(2, 3, 'all', null)).toBe(0);
    expect(nextIndex(1, 3, 'one', null)).toBe(1);
    // 手動の「次へ」は 1 曲リピートでも次へ進む
    expect(nextIndex(1, 3, 'one', null, 1, false)).toBe(2);
    expect(nextIndex(0, 3, 'all', null, -1, false)).toBe(2);
    expect(nextIndex(0, 0, 'all', null)).toBeNull();
  });

  it('follows shuffle order', () => {
    const order = [2, 0, 1];
    expect(nextIndex(2, 3, 'all', order)).toBe(0);
    expect(nextIndex(1, 3, 'none', order)).toBeNull();
  });

  it('creates a shuffled permutation with a fixed first element', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const o = shuffledOrder(10, 4, rand);
    expect(o[0]).toBe(4);
    expect([...o].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('playlist files', () => {
  const entries = [
    { name: 'Song A', fileName: 'a.mid' },
    { name: 'Song B', fileName: 'b.mid', url: 'https://example.com/b.mid' },
  ];
  it('round-trips M3U', () => {
    const text = toM3U(entries, 'Test');
    expect(text.startsWith('#EXTM3U')).toBe(true);
    const parsed = parseM3U(text);
    expect(parsed).toEqual([
      { name: 'Song A', fileName: 'a.mid', url: undefined },
      { name: 'Song B', fileName: 'b.mid', url: 'https://example.com/b.mid' },
    ]);
  });
  it('parses plain M3U paths without EXTINF', () => {
    expect(parseM3U('C:\\music\\x%20y.mid\n')).toEqual([
      { name: 'x y.mid', fileName: 'x y.mid', url: undefined },
    ]);
  });
  it('round-trips JSON playlists and rejects foreign JSON', () => {
    expect(parsePlaylistJSON(toPlaylistJSON('Mine', entries))).toEqual({ name: 'Mine', entries });
    expect(() => parsePlaylistJSON('{"hello":1}')).toThrow();
  });
  it('recognises file types', () => {
    expect(isMidiFileName('a.MID')).toBe(true);
    expect(isMidiFileName('a.kar')).toBe(true);
    expect(isMidiFileName('a.mp3')).toBe(false);
    expect(isSoundFontName('x.sf3')).toBe(true);
  });
});
