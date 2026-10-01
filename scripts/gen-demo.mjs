// デモ MIDI 生成スクリプト（すべてパブリックドメイン曲の自作打ち込み）
// 実行: npm run gen:demo
import { MIDIBuilder } from 'spessasynth_core';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = new URL('../public/demo/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const PPQ = 480;

/** Unicode ひらがな → Shift_JIS（ひらがなは両者で連続しているので単純な対応で済む） */
function sjis(str) {
  const out = [];
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c >= 0x3041 && c <= 0x3093) {
      const v = 0x829f + (c - 0x3041);
      out.push(v >> 8, v & 0xff);
    } else if (c === 0x3000) out.push(0x81, 0x40);
    else if (c === 0x30fc) out.push(0x81, 0x5b);
    else throw new Error('unsupported char ' + ch);
  }
  return out;
}
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

function newSong(name, bpm, num = 4, den = 4) {
  const m = new MIDIBuilder({ timeDivision: PPQ, initialTempo: bpm, format: 1, name });
  // 拍子
  m.addEvent(0, 0, 0x58, [num, Math.log2(den), 24, 8]);
  return m;
}

/** [note|null, beats][] を順に配置。戻り値は終了 tick */
function melody(m, track, ch, notes, startTick = 0, vel = 90, gate = 0.92, lyricFn) {
  let t = startTick;
  notes.forEach(([n, beats], i) => {
    const len = Math.round(beats * PPQ);
    if (n !== null) {
      const ns = Array.isArray(n) ? n : [n];
      if (lyricFn) lyricFn(t, i);
      for (const k of ns) m.noteOn(t, track, ch, k, vel + Math.round(Math.sin(i * 1.7) * 8));
      for (const k of ns) m.noteOff(t + Math.max(1, Math.round(len * gate)), track, ch, k);
    }
    t += len;
  });
  return t;
}

const NOTE = (name) => {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  return base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
};
const seq = (str) =>
  str
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const [n, b] = tok.split(':');
      return [n === 'r' ? null : n.includes('+') ? n.split('+').map(NOTE) : NOTE(n), Number(b ?? 1)];
    });

function save(name, m) {
  m.flush?.();
  const buf = m.writeMIDI();
  writeFileSync(new URL(name, OUT), Buffer.from(buf));
  console.log('wrote', name, buf.byteLength, 'bytes');
}

// ---------------------------------------------------------------- 1. 歓喜の歌
{
  const m = newSong('Ode to Joy (Beethoven)', 112);
  m.addTrack('Melody');
  m.addTrack('Strings');
  m.addTrack('Bass');
  m.addTrack('Drums');
  m.programChange(0, 1, 0, 0); // Piano
  m.programChange(0, 2, 1, 48); // Strings
  m.programChange(0, 3, 2, 32); // Acoustic bass
  m.controllerChange(0, 1, 0, 91, 50);
  m.controllerChange(0, 2, 1, 7, 80);
  m.controllerChange(0, 2, 1, 91, 70);
  m.controllerChange(0, 1, 0, 10, 54);
  m.controllerChange(0, 2, 1, 10, 74);
  const A = 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4';
  const mel = [
    `${A} E4:1.5 D4:0.5 D4:2`,
    `${A} D4:1.5 C4:0.5 C4:2`,
    `D4 D4 E4 C4 D4 E4:0.5 F4:0.5 E4 C4 D4 E4:0.5 F4:0.5 E4 D4 C4 D4 G3:2`,
    `${A} D4:1.5 C4:0.5 C4:2`,
  ].join(' ');
  const melNotes = seq(mel).map(([n, b]) => [n === null ? null : Array.isArray(n) ? n : n + 12, b]);
  // 2 回繰り返し（2 回目は 1 オクターブ上の重ね）
  let t = melody(m, 1, 0, melNotes, 0, 92);
  melody(
    m,
    1,
    0,
    melNotes.map(([n, b]) => [n === null ? null : [n, n + 12], b]),
    t,
    84,
  );
  const chordsPerHalf = 'C C G G C C G G C C G G C C G C G C G C G G C G C C G G C C G C'.split(' ');
  const triad = { C: ['C4', 'E4', 'G4'], G: ['B3', 'D4', 'G4'] };
  const bassRoot = { C: 'C3', G: 'G2' };
  for (let rep = 0; rep < 2; rep++) {
    chordsPerHalf.forEach((c, i) => {
      const tick = rep * t + i * PPQ * 2;
      for (const n of triad[c]) {
        m.noteOn(tick, 2, 1, NOTE(n), 62);
        m.noteOff(tick + PPQ * 2 - 10, 2, 1, NOTE(n));
      }
      m.noteOn(tick, 3, 2, NOTE(bassRoot[c]), 96);
      m.noteOff(tick + PPQ - 20, 3, 2, NOTE(bassRoot[c]));
      m.noteOn(tick + PPQ, 3, 2, NOTE(bassRoot[c]) + 7, 84);
      m.noteOff(tick + PPQ * 2 - 20, 3, 2, NOTE(bassRoot[c]) + 7);
    });
  }
  // ドラム（2 周目のみ）
  for (let beat = 0; beat < 64; beat++) {
    const tick = t + beat * PPQ;
    const kick = beat % 2 === 0 ? 36 : 38;
    m.noteOn(tick, 4, 9, kick, beat % 2 === 0 ? 100 : 80);
    m.noteOff(tick + 60, 4, 9, kick);
    m.noteOn(tick, 4, 9, 42, 64);
    m.noteOff(tick + 60, 4, 9, 42);
    m.noteOn(tick + PPQ / 2, 4, 9, 42, 48);
    m.noteOff(tick + PPQ / 2 + 60, 4, 9, 42);
  }
  m.noteOn(t * 2, 4, 9, 49, 100);
  m.noteOff(t * 2 + PPQ * 2, 4, 9, 49);
  m.addEvent(t, 0, 0x06, ascii('Variation'));
  m.addEvent(0, 0, 0x02, ascii('Public Domain (L. v. Beethoven). Arranged for MIDI Studio Player demo.'));
  save('ode-to-joy.mid', m);
}

// ---------------------------------------------------------------- 2. メヌエット ト長調
{
  const m = newSong('Minuet in G (Petzold)', 118, 3, 4);
  m.addTrack('Right Hand');
  m.addTrack('Left Hand');
  m.programChange(0, 1, 0, 6);
  m.programChange(0, 2, 1, 6);
  m.controllerChange(0, 1, 0, 10, 50);
  m.controllerChange(0, 2, 1, 10, 78);
  m.addEvent(0, 0, 0x59, [1, 0]); // G major
  const rh = `
    D5 G4:0.5 A4:0.5 B4:0.5 C5:0.5  D5 G4 G4
    E5 C5:0.5 D5:0.5 E5:0.5 F#5:0.5  G5 G4 G4
    C5 D5:0.5 C5:0.5 B4:0.5 A4:0.5  B4 C5:0.5 B4:0.5 A4:0.5 G4:0.5
    F#4 G4:0.5 A4:0.5 B4:0.5 G4:0.5  A4:3
    D5 G4:0.5 A4:0.5 B4:0.5 C5:0.5  D5 G4 G4
    E5 C5:0.5 D5:0.5 E5:0.5 F#5:0.5  G5 G4 G4
    C5 D5:0.5 C5:0.5 B4:0.5 A4:0.5  B4 C5:0.5 B4:0.5 A4:0.5 G4:0.5
    A4 B4:0.5 A4:0.5 G4:0.5 F#4:0.5  G4:3`;
  const lh = `
    G3+B3+D4:2 A3  B3:3  C4:3  B3:3  A3:3  G3:3  D4 B3 G3  D4 D3:0.5 C4:0.5 B3:0.5 A3:0.5
    B3:2 A3  G3 B3 G3  C4:3  B3 C4:0.5 B3:0.5 A3:0.5 G3:0.5  A3:2 F#3  G3:2 B3  C4 D4 D3  G3:2 G2`;
  for (let rep = 0; rep < 2; rep++) {
    const start = rep * 48 * PPQ;
    melody(m, 1, 0, seq(rh), start, rep ? 80 : 88, 0.85);
    melody(m, 2, 1, seq(lh), start, rep ? 64 : 70, 0.9);
  }
  m.addEvent(0, 0, 0x02, ascii('Public Domain (C. Petzold, BWV Anh. 114)'));
  m.addEvent(48 * PPQ, 0, 0x06, ascii('Repeat'));
  save('minuet-in-g.mid', m);
}

// ---------------------------------------------------------------- 3. カノン
{
  const m = newSong('Canon in D (Pachelbel)', 66);
  m.addTrack('Violin I');
  m.addTrack('Violin II');
  m.addTrack('Strings Pad');
  m.addTrack('Cello');
  m.addTrack('Harpsichord');
  m.programChange(0, 1, 0, 40);
  m.programChange(0, 2, 1, 40);
  m.programChange(0, 3, 2, 49);
  m.programChange(0, 4, 3, 42);
  m.programChange(0, 5, 4, 6);
  [
    [0, 40],
    [1, 88],
    [2, 64],
    [3, 64],
    [4, 100],
  ].forEach(([ch, pan]) => m.controllerChange(0, ch + 1, ch, 10, pan));
  [0, 1, 2, 3].forEach((ch) => m.controllerChange(0, ch + 1, ch, 91, 80));
  m.controllerChange(0, 3, 2, 7, 70);
  m.addEvent(0, 0, 0x59, [2, 0]); // D major
  const bass = ['D3', 'A2', 'B2', 'F#2', 'G2', 'D2', 'G2', 'A2'];
  const chords = [
    ['D4', 'F#4', 'A4'],
    ['C#4', 'E4', 'A4'],
    ['B3', 'D4', 'F#4'],
    ['C#4', 'F#4', 'A4'],
    ['B3', 'D4', 'G4'],
    ['A3', 'D4', 'F#4'],
    ['B3', 'D4', 'G4'],
    ['C#4', 'E4', 'A4'],
  ];
  const REPS = 10;
  for (let r = 0; r < REPS; r++) {
    bass.forEach((b, i) => {
      const tick = (r * 8 + i) * PPQ * 2;
      m.noteOn(tick, 4, 3, NOTE(b), 90);
      m.noteOff(tick + PPQ * 2 - 15, 4, 3, NOTE(b));
      if (r >= 1) {
        for (const n of chords[i]) {
          m.noteOn(tick, 3, 2, NOTE(n), 50);
          m.noteOff(tick + PPQ * 2 - 5, 3, 2, NOTE(n));
        }
      }
      if (r >= 6) {
        // チェンバロのアルペジオ
        const arp = [...chords[i], NOTE(chords[i][0]) + 12].map((n) => (typeof n === 'number' ? n : NOTE(n)));
        for (let k = 0; k < 8; k++) {
          const nt = arp[k % 4] + (k >= 4 ? 12 : 0);
          m.noteOn(tick + k * (PPQ / 4), 5, 4, nt, 70);
          m.noteOff(tick + (k + 1) * (PPQ / 4) - 5, 5, 4, nt);
        }
      }
    });
  }
  const v1 = [
    'F#5:2 E5:2 D5:2 C#5:2 B4:2 A4:2 B4:2 C#5:2',
    'D5:2 C#5:2 B4:2 A4:2 G4:2 F#4:2 G4:2 E4:2',
    'D4 F#4 A4 G4 F#4 D4 F#4 E4 D4 B3 D4 A4 G4 B4 A4 G4',
    'F#4:0.5 D4:0.5 E4:0.5 C#5:0.5 D5:0.5 F#5:0.5 A5:0.5 A4:0.5 B4:0.5 G4:0.5 A4:0.5 F#4:0.5 D4:0.5 D5:0.5 D5:0.75 C#5:0.25 ' +
      'D5:0.5 C#5:0.5 D5:0.5 D4:0.5 C#4:0.5 A4:0.5 E4:0.5 F#4:0.5 D4:0.5 D5:0.5 C#5:0.5 B4:0.5 C#5:0.5 F#5:0.5 A5:0.5 B5:0.5',
    'G5:0.5 F#5:0.5 E5:0.5 G5:0.5 F#5:0.5 E5:0.5 D5:0.5 C#5:0.5 B4:0.5 A4:0.5 G4:0.5 F#4:0.5 E4:0.5 G4:0.5 F#4:0.5 E4:0.5 ' +
      'D4:0.5 E4:0.5 F#4:0.5 G4:0.5 A4:0.5 E4:0.5 A4:0.5 G4:0.5 F#4:0.5 B4:0.5 A4:0.5 G4:0.5 A4:0.5 G4:0.5 F#4:0.5 E4:0.5',
    'F#5:2 E5:2 D5:2 C#5:2 B4:2 A4:2 B4:2 C#5:2',
    'D5:2 C#5:2 B4:2 A4:2 G4:2 F#4:2 G4:2 E4:2',
    'D5:4 C#5:4 B4:4 A4:4',
  ];
  let t = 2 * 8 * PPQ;
  for (const part of v1) t = melody(m, 1, 0, seq(part), t, 84, 0.95);
  // Violin II はカノンとして 2 小節遅れで追いかける
  let t2 = 4 * 8 * PPQ;
  for (const part of v1.slice(0, 6)) t2 = melody(m, 2, 1, seq(part), t2, 70, 0.95);
  const last = REPS * 8 * PPQ * 2;
  for (const [ch, n] of [
    [0, 'D5'],
    [1, 'A4'],
    [2, 'F#4'],
    [3, 'D3'],
  ]) {
    m.noteOn(last, ch + 1, ch, NOTE(n), 80);
    m.noteOff(last + PPQ * 6, ch + 1, ch, NOTE(n));
  }
  m.addEvent(0, 0, 0x02, ascii('Public Domain (J. Pachelbel)'));
  m.addEvent(2 * 8 * PPQ, 0, 0x06, ascii('Violin I enters'));
  m.addEvent(4 * 8 * PPQ, 0, 0x06, ascii('Violin II enters'));
  m.addEvent(12 * 8 * PPQ, 0, 0x06, ascii('Harpsichord enters'));
  save('canon-in-d.mid', m);
}

// ---------------------------------------------------------------- 4. さくらさくら（Shift_JIS 歌詞）
{
  const m = newSong('', 76);
  m.addEvent(0, 0, 0x03, sjis('さくらさくら'));
  m.addTrack('Melody');
  m.addTrack('Koto');
  m.programChange(0, 1, 0, 77); // 尺八
  m.programChange(0, 2, 1, 107); // 琴
  m.controllerChange(0, 1, 0, 91, 90);
  m.controllerChange(0, 2, 1, 91, 70);
  const mel = `
    A4 A4 B4:2  A4 A4 B4:2
    A4 B4 C5 B4  A4 B4:0.5 A4:0.5 F4:2
    E4 C4 E4 F4  E4 E4:0.5 C4:0.5 B3:2
    A4 B4 C5 B4  A4 B4:0.5 A4:0.5 F4:2
    E4 C4 E4 F4  E4 E4:0.5 C4:0.5 B3:2
    A4 A4 B4:2  A4 A4 B4:2
    E4 F4 B4:0.5 A4:0.5 F4  E4:4`;
  const syll = [
    'さ',
    'く',
    'ら',
    'さ',
    'く',
    'ら',
    'や',
    'よ',
    'い',
    'の',
    'そ',
    'ら',
    '',
    'は',
    'み',
    'わ',
    'た',
    'す',
    'か',
    'ぎ',
    '',
    'り',
    'か',
    'す',
    'み',
    'か',
    'く',
    'も',
    '',
    'か',
    'に',
    'お',
    'い',
    'ぞ',
    'い',
    'ず',
    '',
    'る',
    'い',
    'ざ',
    'や',
    'い',
    'ざ',
    'や',
    'み',
    'に',
    'ゆ',
    '',
    'か',
    'ん',
  ];
  const lineStarts = new Set([0, 6, 14, 22, 30, 38, 44]);
  const notes = seq(mel);
  const lyric = (tick, i) => {
    const s = syll[i];
    if (!s) return;
    const prefix = lineStarts.has(i) && i > 0 ? '\r' : '';
    // 行頭に CR を付けると前の行が改行される（SMF Lyric 慣例）
    m.addEvent(tick, 1, 0x05, [...(prefix ? [0x0d] : []), ...sjis(s)]);
  };
  const end = melody(m, 1, 0, notes, PPQ * 4, 84, 0.95, lyric);
  // 琴の伴奏（都節音階のアルペジオ）
  const koto = [NOTE('A3'), NOTE('E4'), NOTE('F4'), NOTE('A4'), NOTE('B4')];
  for (let tick = 0; tick < end; tick += PPQ / 2) {
    const i = Math.floor(tick / (PPQ / 2));
    const n = koto[(i * 3) % koto.length] - (i % 8 === 0 ? 12 : 0);
    m.noteOn(tick, 2, 1, n, i % 2 === 0 ? 72 : 56);
    m.noteOff(tick + PPQ / 2 - 10, 2, 1, n);
  }
  m.addEvent(0, 0, 0x02, ascii('Traditional Japanese song (Public Domain)'));
  save('sakura-sakura.mid', m);
}

// ---------------------------------------------------------------- 5. きらきら星（KAR 形式）
{
  const m = newSong('Twinkle Twinkle Little Star', 100);
  m.addTrack('Words');
  m.addTrack('Melody');
  m.addTrack('Accompaniment');
  m.addEvent(0, 1, 0x01, ascii('@KMIDI KARAOKE FILE'));
  m.addEvent(0, 1, 0x01, ascii('@V0100'));
  m.addEvent(0, 1, 0x01, ascii('@LENGL'));
  m.addEvent(0, 1, 0x01, ascii('@TTwinkle Twinkle Little Star'));
  m.addEvent(0, 1, 0x01, ascii('@TTraditional'));
  m.programChange(0, 2, 0, 10); // Music box
  m.programChange(0, 3, 1, 0);
  m.controllerChange(0, 2, 0, 91, 60);
  const mel = `
    C5 C5 G5 G5 A5 A5 G5:2  F5 F5 E5 E5 D5 D5 C5:2
    G5 G5 F5 F5 E5 E5 D5:2  G5 G5 F5 F5 E5 E5 D5:2
    C5 C5 G5 G5 A5 A5 G5:2  F5 F5 E5 E5 D5 D5 C5:2`;
  const words = [
    '\\Twin',
    'kle ',
    'twin',
    'kle ',
    'lit',
    'tle ',
    'star,',
    '/How ',
    'I ',
    'won',
    'der ',
    'what ',
    'you ',
    'are!',
    '\\Up ',
    'a',
    'bove ',
    'the ',
    'world ',
    'so ',
    'high,',
    '/Like ',
    'a ',
    'dia',
    'mond ',
    'in ',
    'the ',
    'sky.',
    '\\Twin',
    'kle ',
    'twin',
    'kle ',
    'lit',
    'tle ',
    'star,',
    '/How ',
    'I ',
    'won',
    'der ',
    'what ',
    'you ',
    'are!',
  ];
  const start = PPQ * 4;
  const end = melody(m, 2, 0, seq(mel), start, 90, 0.9, (tick, i) =>
    m.addEvent(tick, 1, 0x01, ascii(words[i])),
  );
  const chordSeq = 'C C F C F C G C C F C G C F C G C F C G C C F C G C G C F C G C'.split(' ');
  const tri = { C: ['C4', 'E4', 'G4'], F: ['C4', 'F4', 'A4'], G: ['B3', 'D4', 'G4'] };
  let t = start;
  for (const c of chordSeq) {
    if (t >= end) break;
    for (const n of tri[c]) {
      m.noteOn(t, 3, 1, NOTE(n), 56);
      m.noteOff(t + PPQ * 2 - 20, 3, 1, NOTE(n));
    }
    m.noteOn(t, 3, 1, NOTE(tri[c][0]) - 12, 70);
    m.noteOff(t + PPQ * 2 - 20, 3, 1, NOTE(tri[c][0]) - 12);
    t += PPQ * 2;
  }
  save('twinkle-twinkle.kar', m);
}

writeFileSync(
  new URL('index.json', OUT),
  JSON.stringify(
    [
      { file: 'canon-in-d.mid', title: 'Canon in D — Pachelbel' },
      { file: 'ode-to-joy.mid', title: 'Ode to Joy — Beethoven' },
      { file: 'minuet-in-g.mid', title: 'Minuet in G — Petzold' },
      { file: 'sakura-sakura.mid', title: 'さくらさくら — 日本古謡（歌詞付き）' },
      { file: 'twinkle-twinkle.kar', title: 'Twinkle Twinkle Little Star (Karaoke)' },
    ],
    null,
    2,
  ) + '\n',
);
console.log('done');
