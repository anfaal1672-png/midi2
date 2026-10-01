import { describe, expect, it } from 'vitest';
import { History } from '../../src/state/history';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../src/state/settings';
import { applyPreset, defaultMixer, effectiveMute } from '../../src/state/mixer';

describe('History', () => {
  it('undoes and redoes snapshots', () => {
    const h = new History<number>();
    h.push(1);
    h.push(2);
    h.push(3);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBe(1);
    expect(h.undo(1)).toBeUndefined();
    expect(h.redo()).toBe(2);
    expect(h.redo()).toBe(3);
    h.push(4);
    expect(h.canRedo).toBe(false);
  });
  it('ignores duplicate snapshots', () => {
    const h = new History<{ a: number }>();
    h.push({ a: 1 });
    h.push({ a: 1 });
    expect(h.canUndo).toBe(false);
  });
});

describe('settings', () => {
  it('fills defaults and clamps values', () => {
    const s = sanitizeSettings({ tempo: 10, transpose: -99, volume: 'loud', a4: 400, unknown: 1 });
    expect(s.tempo).toBe(4);
    expect(s.transpose).toBe(-24);
    expect(s.volume).toBe(DEFAULT_SETTINGS.volume);
    expect(s.a4).toBe(415);
    expect((s as any).unknown).toBeUndefined();
  });
  it('returns defaults for garbage', () => expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS));
});

describe('mixer', () => {
  it('computes effective mute with solo', () => {
    const m = defaultMixer();
    m[2].solo = true;
    expect(effectiveMute(m, 0)).toBe(true);
    expect(effectiveMute(m, 2)).toBe(false);
    m[2].solo = false;
    m[0].mute = true;
    expect(effectiveMute(m, 0)).toBe(true);
    expect(effectiveMute(m, 1)).toBe(false);
  });
  it('applies quick presets', () => {
    const info = { used: [0, 1, 9], drums: [9], melody: 0, bass: 1 };
    const noDrums = applyPreset(defaultMixer(), 'noDrums', info);
    expect([noDrums[0].mute, noDrums[1].mute, noDrums[9].mute]).toEqual([false, false, true]);
    const melody = applyPreset(defaultMixer(), 'melody', info);
    expect([melody[0].mute, melody[1].mute, melody[9].mute]).toEqual([false, true, true]);
    const drumsOnly = applyPreset(defaultMixer(), 'drumsOnly', info);
    expect([drumsOnly[0].mute, drumsOnly[9].mute]).toEqual([true, false]);
  });
});
