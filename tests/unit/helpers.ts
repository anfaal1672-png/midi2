import { BasicMIDI, MIDIBuilder } from 'spessasynth_core';

export const PPQ = 480;

/** テスト用の MIDI を組み立てて、SMF に書き出してから再パースする（実際の読み込み経路と同じにする） */
export function buildMidi(
  fn: (m: MIDIBuilder) => void,
  opts: { bpm?: number; name?: string } = {},
): BasicMIDI {
  const m = new MIDIBuilder({
    timeDivision: PPQ,
    initialTempo: opts.bpm ?? 120,
    format: 1,
    name: opts.name ?? 'Test',
  });
  fn(m);
  m.flush();
  return BasicMIDI.fromArrayBuffer(m.writeMIDI(), 'test.mid');
}

export function bytesToBuffer(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

const vlq = (n: number) => {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
};

/** 生の SMF を手で組み立てる（ランニングステータスなど異常系のテスト用） */
export function rawSMF(tracks: number[][], ppq = PPQ, format = 1, fixLength = true): ArrayBuffer {
  const out: number[] = [
    0x4d,
    0x54,
    0x68,
    0x64,
    0,
    0,
    0,
    6,
    0,
    format,
    0,
    tracks.length,
    (ppq >> 8) & 0xff,
    ppq & 0xff,
  ];
  for (const t of tracks) {
    const len = fixLength ? t.length : t.length + 100;
    out.push(
      0x4d,
      0x54,
      0x72,
      0x6b,
      (len >>> 24) & 0xff,
      (len >>> 16) & 0xff,
      (len >>> 8) & 0xff,
      len & 0xff,
      ...t,
    );
  }
  return new Uint8Array(out).buffer;
}

export const ev = (delta: number, ...bytes: number[]) => [...vlq(delta), ...bytes];
