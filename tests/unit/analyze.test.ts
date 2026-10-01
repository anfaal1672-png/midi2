import { describe, expect, it } from 'vitest';
import { BasicMIDI } from 'spessasynth_core';
import {
  analyzeMIDI,
  barIndexAt,
  buildBars,
  detectSystem,
  secToTick,
  tickToSec,
  upperBoundStart,
} from '../../src/midi/analyze';
import { buildMidi, ev, PPQ, rawSMF } from './helpers';

describe('tempo map', () => {
  const tempos = [
    { tick: 0, sec: 0, bpm: 120, usPerQuarter: 500000 },
    { tick: 960, sec: 1, bpm: 60, usPerQuarter: 1000000 },
  ];
  it('converts ticks to seconds across tempo changes', () => {
    expect(tickToSec(tempos, PPQ, 0)).toBe(0);
    expect(tickToSec(tempos, PPQ, 480)).toBeCloseTo(0.5);
    expect(tickToSec(tempos, PPQ, 960)).toBeCloseTo(1);
    expect(tickToSec(tempos, PPQ, 1440)).toBeCloseTo(2);
  });
  it('round-trips seconds and ticks', () => {
    for (const tick of [0, 100, 960, 1500, 5000]) {
      expect(secToTick(tempos, PPQ, tickToSec(tempos, PPQ, tick))).toBeCloseTo(tick, 6);
    }
  });
});

describe('analyzeMIDI', () => {
  it('extracts notes with correct timing, channels and tempo changes', () => {
    const mid = buildMidi((m) => {
      m.addTrack('Piano');
      m.programChange(0, 1, 0, 5);
      m.noteOn(0, 1, 0, 60, 100);
      m.noteOff(480, 1, 0, 60);
      m.setTempo(960, 60);
      m.noteOn(960, 1, 0, 64, 80);
      m.noteOff(1440, 1, 0, 64);
      m.addTrack('Drums');
      m.noteOn(480, 2, 9, 36, 110);
      m.noteOff(490, 2, 9, 36);
    });
    const a = analyzeMIDI(mid, 'test.mid');
    expect(a.noteCount).toBe(3);
    expect(a.ppq).toBe(PPQ);
    // 開始時刻でソートされている
    expect(Array.from(a.notes.start)).toEqual([0, 0.5, 1]);
    expect(a.notes.key[0]).toBe(60);
    expect(a.notes.end[0]).toBeCloseTo(0.5);
    expect(a.notes.key[2]).toBe(64);
    expect(a.notes.end[2]).toBeCloseTo(2); // 60 BPM で 1 拍 = 1 秒
    expect(a.tempos.map((t) => Math.round(t.bpm))).toEqual([120, 60]);
    const piano = a.channels.find((c) => c.ch === 0)!;
    expect(piano.firstProgram).toBe(5);
    expect(piano.noteCount).toBe(2);
    const drums = a.channels.find((c) => c.ch === 9)!;
    expect(drums.isDrum).toBe(true);
    // ドラムの短いノートは表示用に最低長が与えられる
    expect(a.notes.end[1] - a.notes.start[1]).toBeGreaterThanOrEqual(0.03);
  });

  it('computes bars from time signatures', () => {
    const mid = buildMidi((m) => {
      m.addEvent(0, 0, 0x58 as any, [3, 2, 24, 8]);
      m.addTrack('a');
      m.noteOn(0, 1, 0, 60, 100);
      m.noteOff(PPQ * 12, 1, 0, 60);
    });
    const a = analyzeMIDI(mid);
    expect(a.timeSigs[0]).toMatchObject({ num: 3, den: 4 });
    expect(a.bars[1]).toBeCloseTo(1.5); // 3/4 @120BPM
    expect(barIndexAt(a.bars, 1.6)).toBe(1);
  });

  it('handles running status, missing end-of-track and wrong chunk length', () => {
    // ランニングステータス（2 つ目以降の 0x90 を省略）と End of Track の欠落
    const track = [
      ...ev(0, 0xc0, 0x00),
      ...ev(0, 0x90, 60, 100),
      ...ev(240, 62, 100), // running status
      ...ev(240, 60, 0), // note off via vel 0
      ...ev(240, 62, 0),
    ];
    const buf = rawSMF([track], PPQ, 0, false);
    const mid = BasicMIDI.fromArrayBuffer(buf, 'broken.mid');
    const a = analyzeMIDI(mid);
    expect(a.noteCount).toBe(2);
    expect(Array.from(a.notes.key).sort()).toEqual([60, 62]);
    expect(a.notes.end[0]).toBeCloseTo(0.5);
  });

  it('closes dangling notes at the end of the song', () => {
    const track = [...ev(0, 0x90, 60, 100), ...ev(960, 0x90, 64, 100), ...ev(480, 0xff, 0x2f, 0)];
    const a = analyzeMIDI(BasicMIDI.fromArrayBuffer(rawSMF([track], PPQ, 0), 'x.mid'));
    expect(a.noteCount).toBe(2);
    expect(a.notes.end[0]).toBeCloseTo(1.5);
  });

  it('collects text meta and karaoke lyrics', () => {
    const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
    const mid = buildMidi((m) => {
      m.addTrack('Words');
      m.addEvent(0, 1, 0x01 as any, ascii('@KMIDI KARAOKE FILE'));
      for (let i = 0; i < 10; i++) m.addEvent(i * 240, 1, 0x01 as any, ascii(i === 0 ? '\\Hel' : 'lo '));
      m.addEvent(0, 0, 0x06 as any, ascii('Intro'));
      m.addTrack('Melody');
      m.noteOn(0, 2, 0, 60, 100);
      m.noteOff(2400, 2, 0, 60);
    });
    const a = analyzeMIDI(mid);
    expect(a.isKaraoke).toBe(true);
    expect(a.lyrics.length).toBe(10);
    expect(a.texts.some((t) => t.type === 0x06)).toBe(true);
  });

  it('finds note positions with binary search', () => {
    const mid = buildMidi((m) => {
      m.addTrack('a');
      for (let i = 0; i < 10; i++) {
        m.noteOn(i * 480, 1, 0, 60 + i, 100);
        m.noteOff(i * 480 + 240, 1, 0, 60 + i);
      }
    });
    const a = analyzeMIDI(mid);
    expect(upperBoundStart(a.notes, 2.25)).toBe(5);
  });
});

describe('detectSystem', () => {
  it('detects GS, XG and GM2 resets', () => {
    expect(detectSystem([new Uint8Array([0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7])])).toBe(
      'gs',
    );
    expect(detectSystem([new Uint8Array([0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7])])).toBe('xg');
    expect(detectSystem([new Uint8Array([0x7e, 0x7f, 0x09, 0x03, 0xf7])])).toBe('gm2');
    expect(detectSystem([])).toBe('gm');
  });
});

describe('buildBars', () => {
  it('starts a new bar at a mid-bar time signature change', () => {
    const bars = buildBars(
      [
        { tick: 0, num: 4, den: 4 },
        { tick: 480 * 6, num: 3, den: 4 },
      ],
      480,
      480 * 12,
    );
    expect(bars.slice(0, 4)).toEqual([0, 1920, 2880, 4320]);
  });
});
