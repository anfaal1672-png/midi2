import { describe, expect, it } from 'vitest';
import { encodeWav, normalize } from '../../src/audio/wav';
import { recordingToSMF } from '../../src/audio/recorder';
import { analyzeMIDI } from '../../src/midi/analyze';
import { formatEvent, eventCategory } from '../../src/midi/format';
import { BasicMIDI } from 'spessasynth_core';

const str = (v: DataView, o: number, n: number) => String.fromCharCode(...new Uint8Array(v.buffer, o, n));

describe('encodeWav', () => {
  const l = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const r = new Float32Array([0, -0.25, 0.25, 2, -2]);
  it('writes a valid 16-bit header and clips samples', () => {
    const v = new DataView(encodeWav([l, r], 48000, 16));
    expect(str(v, 0, 4)).toBe('RIFF');
    expect(str(v, 8, 4)).toBe('WAVE');
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(5 * 2 * 2);
    expect(v.getInt16(44 + 4 * 3 + 2, true)).toBe(32767); // R サンプル 2.0 → クリップ
    expect(v.getInt16(44 + 4 * 4 + 2, true)).toBe(-32768);
  });
  it('writes 24-bit PCM', () => {
    const v = new DataView(encodeWav([l], 44100, 24));
    expect(v.getUint16(34, true)).toBe(24);
    expect(v.byteLength).toBe(44 + 5 * 3);
    const s = v.getUint8(44 + 3) | (v.getUint8(45 + 3) << 8) | (v.getUint8(46 + 3) << 16);
    expect(s).toBe(Math.round(0.5 * 0x7fffff));
  });
  it('writes 32-bit float', () => {
    const v = new DataView(encodeWav([l], 44100, 32));
    expect(v.getUint16(20, true)).toBe(3);
    expect(v.getFloat32(44 + 4, true)).toBeCloseTo(0.5);
  });
  it('normalizes peaks', () => {
    const c = [new Float32Array([0.2, -2])];
    normalize(c, 1);
    expect(c[0][1]).toBeCloseTo(-1);
    expect(c[0][0]).toBeCloseTo(0.1);
  });
});

describe('recordingToSMF', () => {
  it('converts realtime events to a playable SMF', () => {
    const buf = recordingToSMF([
      { ms: 0, data: [0x90, 60, 100] },
      { ms: 500, data: [0x80, 60, 0] },
      { ms: 500, data: [0x90, 64, 90] },
      { ms: 1000, data: [0x80, 64, 0] },
    ]);
    const a = analyzeMIDI(BasicMIDI.fromArrayBuffer(buf, 'rec.mid'));
    expect(a.noteCount).toBe(2);
    expect(a.notes.start[1]).toBeCloseTo(0.5, 2);
  });
});

describe('formatEvent', () => {
  it('formats channel and meta events', () => {
    const data = new Uint8Array([60, 100, 0x07, 0xa1, 0x20, 64, 32]);
    const table = {
      count: 3,
      sec: new Float64Array(3),
      tick: new Uint32Array(3),
      track: new Uint16Array(3),
      status: new Uint8Array([0x90, 0xff, 0xb0]),
      metaType: new Uint8Array([0, 0x51, 0]),
      ch: new Uint16Array([0, 0xffff, 0]),
      dataOffset: new Uint32Array([0, 2, 5]),
      dataLength: new Uint32Array([2, 3, 2]),
      data,
    };
    expect(formatEvent(table, 0)).toEqual({ type: 'Note On', detail: 'C4 (60) vel 100' });
    expect(formatEvent(table, 1).detail).toMatch(/^120\.00 BPM/);
    expect(formatEvent(table, 2).detail).toContain('Sustain');
    expect(eventCategory(0xc3)).toBe('program');
    expect(eventCategory(0xf0)).toBe('sysex');
  });
});
