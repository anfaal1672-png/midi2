import { describe, expect, it } from 'vitest';
import { BasicMIDI } from 'spessasynth_core';
import { exportEditedMIDI, scaleTempo } from '../../src/midi/edit';
import { analyzeMIDI } from '../../src/midi/analyze';
import { buildMidi } from './helpers';

const song = () =>
  buildMidi((m) => {
    m.addTrack('Lead');
    m.programChange(0, 1, 0, 0);
    m.noteOn(0, 1, 0, 60, 100);
    m.noteOff(480, 1, 0, 60);
    m.noteOn(480, 1, 0, 67, 90);
    m.noteOff(960, 1, 0, 67);
    m.addTrack('Bass');
    m.noteOn(0, 2, 1, 36, 100);
    m.noteOff(960, 2, 1, 36);
    m.addTrack('Drums');
    m.noteOn(0, 3, 9, 38, 100);
    m.noteOff(60, 3, 9, 38);
  });

const reparse = (buf: ArrayBuffer) => analyzeMIDI(BasicMIDI.fromArrayBuffer(buf, 'out.mid'));

describe('SMF export', () => {
  it('round-trips notes exactly without edits', () => {
    const src = song();
    const a = analyzeMIDI(src);
    const b = reparse(
      exportEditedMIDI(src, { transpose: 0, tempoRate: 1, channels: new Map(), drumChannels: new Set([9]) }),
    );
    expect(b.noteCount).toBe(a.noteCount);
    expect(Array.from(b.notes.key)).toEqual(Array.from(a.notes.key));
    expect(Array.from(b.notes.startTick)).toEqual(Array.from(a.notes.startTick));
    expect(b.duration).toBeCloseTo(a.duration, 3);
  });

  it('applies transpose (but not to drums), mute and tempo', () => {
    const src = song();
    const out = exportEditedMIDI(src, {
      transpose: 2,
      tempoRate: 2,
      channels: new Map([[1, { mute: true }]]),
      drumChannels: new Set([9]),
    });
    const b = reparse(out);
    const keysByCh = (ch: number) => Array.from(b.notes.key).filter((_, i) => b.notes.ch[i] === ch);
    expect(keysByCh(0).sort()).toEqual([62, 69]);
    expect(keysByCh(1)).toEqual([]); // ミュートしたチャンネルは消える
    expect(keysByCh(9)).toEqual([38]); // ドラムは移調しない
    expect(Math.round(b.tempos[b.tempos.length - 1].bpm)).toBe(240);
  });

  it('scaleTempo inserts a tempo event when none exists at tick 0', () => {
    const src = song();
    // テンポイベントをすべて削除したコピー
    const copy = BasicMIDI.copyFrom(src);
    for (const t of copy.tracks) {
      for (let i = t.events.length - 1; i >= 0; i--)
        if ((t.events[i].statusByte as number) === 0x51) t.deleteEvent(i);
    }
    scaleTempo(copy, 0.5);
    copy.flush(true);
    const a = analyzeMIDI(BasicMIDI.fromArrayBuffer(copy.writeMIDI(), 'x.mid'));
    expect(Math.round(a.tempos[a.tempos.length - 1].bpm)).toBe(60);
  });
});
