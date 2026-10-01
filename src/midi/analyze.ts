import type { BasicMIDI } from 'spessasynth_core';
import type {
  ChannelSummary,
  EventTable,
  KeySigPoint,
  NoteTable,
  SongAnalysis,
  TempoPoint,
  TextMeta,
  TimeSigPoint,
  TrackSummary,
} from './types';

class Grow<T extends Float64Array | Uint32Array | Uint16Array | Uint8Array> {
  arr: T;
  constructor(
    private readonly Ctor: { new (n: number): T },
    initial = 1024,
  ) {
    this.arr = new Ctor(initial);
  }
  ensure(n: number) {
    if (n <= this.arr.length) return;
    let len = this.arr.length;
    while (len < n) len *= 2;
    const next = new this.Ctor(len);
    next.set(this.arr as any);
    this.arr = next;
  }
  trimmed(n: number): T {
    return this.arr.slice(0, n) as T;
  }
}

/** テンポマップから tick → 秒 を引く（二分探索） */
export function tickToSec(tempos: TempoPoint[], ppq: number, tick: number): number {
  let lo = 0;
  let hi = tempos.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tempos[mid].tick <= tick) lo = mid;
    else hi = mid - 1;
  }
  const t = tempos[lo];
  return t.sec + ((tick - t.tick) * t.usPerQuarter) / 1e6 / ppq;
}

/** 秒 → tick */
export function secToTick(tempos: TempoPoint[], ppq: number, sec: number): number {
  let lo = 0;
  let hi = tempos.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tempos[mid].sec <= sec) lo = mid;
    else hi = mid - 1;
  }
  const t = tempos[lo];
  return t.tick + ((sec - t.sec) * 1e6 * ppq) / t.usPerQuarter;
}

/** 小節線（tick と秒）を拍子情報から生成する */
export function buildBars(
  timeSigs: { tick: number; num: number; den: number }[],
  ppq: number,
  lastTick: number,
): number[] {
  const sigs = timeSigs.length
    ? [...timeSigs].sort((a, b) => a.tick - b.tick)
    : [{ tick: 0, num: 4, den: 4 }];
  if (sigs[0].tick > 0) sigs.unshift({ tick: 0, num: 4, den: 4 });
  const bars: number[] = [];
  let tick = 0;
  let si = 0;
  const limit = Math.max(lastTick, 1);
  while (tick <= limit && bars.length < 100000) {
    while (si + 1 < sigs.length && sigs[si + 1].tick <= tick) si++;
    bars.push(tick);
    const s = sigs[si];
    const len = Math.max(1, Math.round((ppq * 4 * s.num) / s.den));
    let next = tick + len;
    // 小節の途中で拍子が変わる場合は変化点を小節頭とする
    if (si + 1 < sigs.length && sigs[si + 1].tick < next && sigs[si + 1].tick > tick)
      next = sigs[si + 1].tick;
    tick = next;
  }
  return bars;
}

export function detectSystem(sysexes: Uint8Array[]): 'gm' | 'gm2' | 'gs' | 'xg' {
  let result: 'gm' | 'gm2' | 'gs' | 'xg' = 'gm';
  for (const d of sysexes) {
    // spessasynth は先頭の F0 を除いたデータを保持する
    const b = d[0] === 0xf0 ? d.subarray(1) : d;
    if (b[0] === 0x41 && b[2] === 0x42 && b[3] === 0x12) return 'gs';
    if (b[0] === 0x43 && (b[1] & 0xf0) === 0x10 && b[2] === 0x4c) return 'xg';
    if (b[0] === 0x7e && b[2] === 0x09 && b[3] === 0x03) result = 'gm2';
  }
  return result;
}

const MAX_EVENTS_STORED = 2_000_000;

export function analyzeMIDI(mid: BasicMIDI, fileName = ''): SongAnalysis {
  const ppq = mid.timeDivision || 480;
  const tracks = mid.tracks;
  const offsets = mid.portChannelOffsetMap ?? [];

  const tempos: TempoPoint[] = [{ tick: 0, sec: 0, bpm: 120, usPerQuarter: 500000 }];
  const timeSigsRaw: { tick: number; num: number; den: number }[] = [];
  const keySigsRaw: { tick: number; sf: number; minor: boolean }[] = [];
  const texts: TextMeta[] = [];
  const sysexes: Uint8Array[] = [];

  // ノート
  const nStart = new Grow(Float64Array);
  const nEnd = new Grow(Float64Array);
  const nStartTick = new Grow(Uint32Array);
  const nEndTick = new Grow(Uint32Array);
  const nKey = new Grow(Uint8Array);
  const nVel = new Grow(Uint8Array);
  const nCh = new Grow(Uint16Array);
  const nTrack = new Grow(Uint16Array);
  let noteCount = 0;
  const open = new Map<number, number[]>();

  // イベント
  const eSec = new Grow(Float64Array);
  const eTick = new Grow(Uint32Array);
  const eTrack = new Grow(Uint16Array);
  const eStatus = new Grow(Uint8Array);
  const eMeta = new Grow(Uint8Array);
  const eCh = new Grow(Uint16Array);
  const eOff = new Grow(Uint32Array);
  const eLen = new Grow(Uint32Array);
  const eData = new Grow(Uint8Array, 4096);
  let eventCount = 0;
  let dataLen = 0;

  const chInfo = new Map<
    number,
    ChannelSummary & { _programsSet: Set<number>; _tracksSet: Set<number>; _seenProgram: boolean }
  >();
  const getCh = (ch: number) => {
    let c = chInfo.get(ch);
    if (!c) {
      c = {
        ch,
        noteCount: 0,
        minKey: 127,
        maxKey: 0,
        firstProgram: 0,
        bankMSB: 0,
        bankLSB: 0,
        isDrum: ch % 16 === 9,
        programs: [],
        tracks: [],
        _programsSet: new Set(),
        _tracksSet: new Set(),
        _seenProgram: false,
      };
      chInfo.set(ch, c);
    }
    return c;
  };
  const trackSummaries: TrackSummary[] = tracks.map((t, i) => ({
    index: i,
    nameBytes: new Uint8Array(0),
    port: t.port ?? 0,
    channels: [],
    noteCount: 0,
    eventCount: t.events.length,
  }));
  const trackChannels = tracks.map(() => new Set<number>());

  let curUs = 500000;
  let lastTempoTick = 0;
  let lastTempoSec = 0;
  const secOf = (tick: number) => lastTempoSec + ((tick - lastTempoTick) * curUs) / 1e6 / ppq;
  let lastTick = 0;

  const closeNote = (idx: number, tick: number, sec: number) => {
    nEnd.arr[idx] = sec;
    nEndTick.arr[idx] = tick;
  };

  for (const { tr, ev } of mid.timeline) {
    const track = tracks[tr];
    const e = track.events[ev];
    const tick = e.ticks;
    if (tick > lastTick) lastTick = tick;
    const sec = secOf(tick);
    const status = e.statusByte as number;
    const data = e.data;
    let ch = 0xffff;
    let metaType = 0;
    let storeStatus = status;

    if (status < 0x80) {
      // メタイベント
      metaType = status;
      storeStatus = 0xff;
      if (status === 0x51 && data.length >= 3) {
        const us = (data[0] << 16) | (data[1] << 8) | data[2];
        if (us > 0) {
          lastTempoSec = sec;
          lastTempoTick = tick;
          curUs = us;
          const point: TempoPoint = { tick, sec, bpm: 60e6 / us, usPerQuarter: us };
          if (tempos[tempos.length - 1].tick === tick) tempos[tempos.length - 1] = point;
          else tempos.push(point);
        }
      } else if (status === 0x58 && data.length >= 2) {
        timeSigsRaw.push({ tick, num: data[0] || 4, den: Math.pow(2, data[1]) || 4 });
      } else if (status === 0x59 && data.length >= 2) {
        keySigsRaw.push({ tick, sf: (data[0] << 24) >> 24, minor: data[1] === 1 });
      } else if (status >= 0x01 && status <= 0x09) {
        texts.push({ sec, tick, track: tr, type: status, bytes: data.slice() });
        if (status === 0x03 && trackSummaries[tr].nameBytes.length === 0)
          trackSummaries[tr].nameBytes = data.slice();
      }
    } else if (status === 0xf0 || status === 0xf7) {
      sysexes.push(data);
    } else {
      const offset = offsets[track.port ?? 0] ?? 0;
      ch = (status & 0x0f) + offset;
      const type = status & 0xf0;
      trackChannels[tr].add(ch);
      const info = getCh(ch);
      info._tracksSet.add(tr);
      if (type === 0x90 && data[1] > 0) {
        const idx = noteCount++;
        for (const g of [nStart, nEnd, nStartTick, nEndTick, nKey, nVel, nCh, nTrack]) g.ensure(noteCount);
        nStart.arr[idx] = sec;
        nEnd.arr[idx] = sec;
        nStartTick.arr[idx] = tick;
        nEndTick.arr[idx] = tick;
        nKey.arr[idx] = data[0];
        nVel.arr[idx] = data[1];
        nCh.arr[idx] = ch;
        nTrack.arr[idx] = tr;
        const k = ch * 128 + data[0];
        let q = open.get(k);
        if (!q) open.set(k, (q = []));
        q.push(idx);
        info.noteCount++;
        if (data[0] < info.minKey) info.minKey = data[0];
        if (data[0] > info.maxKey) info.maxKey = data[0];
        trackSummaries[tr].noteCount++;
      } else if (type === 0x80 || (type === 0x90 && data[1] === 0)) {
        const q = open.get(ch * 128 + data[0]);
        if (q && q.length) closeNote(q.shift()!, tick, sec);
      } else if (type === 0xc0) {
        info._programsSet.add(data[0]);
        if (!info._seenProgram) {
          info._seenProgram = true;
          info.firstProgram = data[0];
        }
      } else if (type === 0xb0) {
        if (!info._seenProgram) {
          if (data[0] === 0) info.bankMSB = data[1];
          else if (data[0] === 32) info.bankLSB = data[1];
        }
      }
    }

    if (eventCount < MAX_EVENTS_STORED) {
      const i = eventCount++;
      for (const g of [eSec, eTick, eTrack, eStatus, eMeta, eCh, eOff, eLen]) g.ensure(eventCount);
      eSec.arr[i] = sec;
      eTick.arr[i] = tick;
      eTrack.arr[i] = tr;
      eStatus.arr[i] = storeStatus;
      eMeta.arr[i] = metaType;
      eCh.arr[i] = ch;
      const len = Math.min(data.length, 256);
      eData.ensure(dataLen + len);
      eData.arr.set(data.subarray(0, len), dataLen);
      eOff.arr[i] = dataLen;
      eLen.arr[i] = len;
      dataLen += len;
    }
  }

  // 閉じていないノートは曲の最後で閉じる
  const endSec = secOf(lastTick);
  for (const q of open.values()) for (const idx of q) closeNote(idx, lastTick, endSec);

  // ドラムの極端に短い音は最低限の長さを持たせる（表示用）
  for (let i = 0; i < noteCount; i++) {
    if (nEnd.arr[i] - nStart.arr[i] < 0.03) nEnd.arr[i] = nStart.arr[i] + 0.03;
  }

  // 開始時刻でソート
  const order = new Uint32Array(noteCount);
  for (let i = 0; i < noteCount; i++) order[i] = i;
  const st = nStart.arr;
  order.sort((a, b) => st[a] - st[b] || a - b);
  const pick = <T extends Float64Array | Uint32Array | Uint16Array | Uint8Array>(src: T): T => {
    const out = new (src.constructor as { new (n: number): T })(noteCount);
    for (let i = 0; i < noteCount; i++) out[i] = src[order[i]];
    return out;
  };
  const notes: NoteTable = {
    count: noteCount,
    start: pick(nStart.arr),
    end: pick(nEnd.arr),
    startTick: pick(nStartTick.arr),
    endTick: pick(nEndTick.arr),
    key: pick(nKey.arr),
    vel: pick(nVel.arr),
    ch: pick(nCh.arr),
    track: pick(nTrack.arr),
  };

  const tickSec = (tick: number) => tickToSec(tempos, ppq, tick);
  const timeSigs: TimeSigPoint[] = timeSigsRaw.map((t) => ({ ...t, sec: tickSec(t.tick) }));
  const keySigs: KeySigPoint[] = keySigsRaw.map((k) => ({ ...k, sec: tickSec(k.tick) }));
  const barTickList = buildBars(timeSigsRaw, ppq, lastTick);
  const bars = new Float64Array(barTickList.length);
  barTickList.forEach((t, i) => (bars[i] = tickSec(t)));

  // 歌詞: Lyric(0x05) を優先、KAR では "@" で始まらない Text(0x01)
  const lyricMeta = texts.filter((t) => t.type === 0x05);
  const karText = texts.filter((t) => t.type === 0x01 && t.bytes.length > 0 && t.bytes[0] !== 0x40);
  const isKaraoke =
    mid.isKaraokeFile || (lyricMeta.length === 0 && karText.length > 8 && hasKarHeader(texts));
  const lyrics = isKaraoke && karText.length >= lyricMeta.length ? karText : lyricMeta;

  const events: EventTable = {
    count: eventCount,
    sec: eSec.trimmed(eventCount),
    tick: eTick.trimmed(eventCount),
    track: eTrack.trimmed(eventCount),
    status: eStatus.trimmed(eventCount),
    metaType: eMeta.trimmed(eventCount),
    ch: eCh.trimmed(eventCount),
    dataOffset: eOff.trimmed(eventCount),
    dataLength: eLen.trimmed(eventCount),
    data: eData.trimmed(dataLen),
  };

  const channels = [...chInfo.values()]
    .sort((a, b) => a.ch - b.ch)
    .map(({ _programsSet, _tracksSet, _seenProgram: _s, ...c }) => ({
      ...c,
      programs: [..._programsSet],
      tracks: [..._tracksSet],
      isDrum: c.isDrum || c.bankMSB === 127 || c.bankMSB === 120,
    }));
  trackSummaries.forEach((t, i) => (t.channels = [...trackChannels[i]].sort((a, b) => a - b)));

  const nameMeta =
    texts.find((t) => t.type === 0x03 && t.track === 0 && t.bytes.some((b) => b !== 0)) ?? null;
  const maxCh = channels.reduce((m, c) => Math.max(m, c.ch), 15);
  const loop = mid.loop;
  const hasLoop = loop && (loop.start > 0 || loop.end < (mid.lastVoiceEventTick ?? lastTick));

  return {
    fileName,
    format: mid.format,
    ppq,
    duration: Math.max(mid.duration || 0, endSec),
    lastTick,
    firstNoteSec: noteCount ? notes.start[0] : 0,
    noteCount,
    channelCount: Math.ceil((maxCh + 1) / 16) * 16,
    nameBytes: nameMeta ? nameMeta.bytes : null,
    isKaraoke,
    isMultiPort: !!mid.isMultiPort,
    isRMIDI: Object.keys(mid.rmidiInfo ?? {}).length > 0,
    hasEmbeddedSoundBank: !!mid.embeddedSoundBank,
    detectedSystem: detectSystem(sysexes),
    loopStartSec: hasLoop ? tickSec(loop.start) : null,
    loopEndSec: hasLoop ? tickSec(loop.end) : null,
    notes,
    events,
    tempos,
    timeSigs,
    keySigs,
    bars,
    barTicks: Uint32Array.from(barTickList),
    texts,
    lyrics,
    channels,
    tracks: trackSummaries,
  };
}

function hasKarHeader(texts: TextMeta[]): boolean {
  return texts.some(
    (t) => t.type === 0x01 && t.bytes[0] === 0x40 && (t.bytes[1] === 0x4b || t.bytes[1] === 0x4c),
  );
}

/** Worker から転送する際の Transferable 一覧 */
export function analysisTransferables(a: SongAnalysis): Transferable[] {
  const n = a.notes;
  const e = a.events;
  return [
    n.start.buffer,
    n.end.buffer,
    n.startTick.buffer,
    n.endTick.buffer,
    n.key.buffer,
    n.vel.buffer,
    n.ch.buffer,
    n.track.buffer,
    e.sec.buffer,
    e.tick.buffer,
    e.track.buffer,
    e.status.buffer,
    e.metaType.buffer,
    e.ch.buffer,
    e.dataOffset.buffer,
    e.dataLength.buffer,
    e.data.buffer,
    a.bars.buffer,
    a.barTicks.buffer,
  ];
}

/** 指定時刻に最も近い小節インデックス（その時刻を含む小節） */
export function barIndexAt(bars: Float64Array, sec: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid] <= sec + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 開始時刻ソート済みノート表から、ある時刻より前に始まる最後のノート位置を求める */
export function upperBoundStart(notes: NoteTable, sec: number): number {
  let lo = 0;
  let hi = notes.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes.start[mid] <= sec) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
