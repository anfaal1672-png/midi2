/** 解析済みノート（構造体配列形式。Worker からの転送を軽くするため typed array を使う） */
export interface NoteTable {
  count: number;
  start: Float64Array; // 秒
  end: Float64Array; // 秒
  startTick: Uint32Array;
  endTick: Uint32Array;
  key: Uint8Array;
  vel: Uint8Array;
  ch: Uint16Array; // ポートオフセット込みのチャンネル
  track: Uint16Array;
}

export interface TempoPoint {
  tick: number;
  sec: number;
  bpm: number;
  /** マイクロ秒 / 四分音符 */
  usPerQuarter: number;
}

export interface TimeSigPoint {
  tick: number;
  sec: number;
  num: number;
  den: number;
}

export interface KeySigPoint {
  tick: number;
  sec: number;
  sf: number;
  minor: boolean;
}

/** 文字列系メタイベント（バイト列のまま保持し、表示時に文字コードを決めてデコードする） */
export interface TextMeta {
  sec: number;
  tick: number;
  track: number;
  type: number; // 0x01..0x09
  bytes: Uint8Array;
}

export interface EventTable {
  count: number;
  sec: Float64Array;
  tick: Uint32Array;
  track: Uint16Array;
  /** ステータスバイト（メタイベントは 0xFF、SysEx は 0xF0/0xF7） */
  status: Uint8Array;
  /** メタイベントの種類（メタ以外は 0） */
  metaType: Uint8Array;
  /** チャンネル（チャンネルメッセージ以外は 0xFFFF） */
  ch: Uint16Array;
  dataOffset: Uint32Array;
  dataLength: Uint32Array;
  data: Uint8Array;
}

export interface ChannelSummary {
  ch: number;
  noteCount: number;
  minKey: number;
  maxKey: number;
  firstProgram: number;
  bankMSB: number;
  bankLSB: number;
  isDrum: boolean;
  programs: number[];
  tracks: number[];
}

export interface TrackSummary {
  index: number;
  nameBytes: Uint8Array;
  port: number;
  channels: number[];
  noteCount: number;
  eventCount: number;
}

export interface SongAnalysis {
  fileName: string;
  format: number;
  ppq: number;
  duration: number;
  lastTick: number;
  firstNoteSec: number;
  noteCount: number;
  channelCount: number;
  nameBytes: Uint8Array | null;
  isKaraoke: boolean;
  isMultiPort: boolean;
  isRMIDI: boolean;
  hasEmbeddedSoundBank: boolean;
  detectedSystem: 'gm' | 'gm2' | 'gs' | 'xg';
  loopStartSec: number | null;
  loopEndSec: number | null;
  notes: NoteTable;
  events: EventTable;
  tempos: TempoPoint[];
  timeSigs: TimeSigPoint[];
  keySigs: KeySigPoint[];
  bars: Float64Array; // 小節頭の秒
  barTicks: Uint32Array;
  texts: TextMeta[];
  /** 歌詞（Lyric / KAR テキスト） */
  lyrics: TextMeta[];
  channels: ChannelSummary[];
  tracks: TrackSummary[];
}

export const META_NAMES: Record<number, string> = {
  0x00: 'Sequence Number',
  0x01: 'Text',
  0x02: 'Copyright',
  0x03: 'Track Name',
  0x04: 'Instrument',
  0x05: 'Lyric',
  0x06: 'Marker',
  0x07: 'Cue Point',
  0x08: 'Program Name',
  0x09: 'Device Name',
  0x20: 'Channel Prefix',
  0x21: 'MIDI Port',
  0x2f: 'End of Track',
  0x51: 'Set Tempo',
  0x54: 'SMPTE Offset',
  0x58: 'Time Signature',
  0x59: 'Key Signature',
  0x7f: 'Sequencer Specific',
};
