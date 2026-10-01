import type { TextEncodingName } from '../midi/encoding';

export type VisualKind = 'roll' | 'falling' | 'keys' | 'spectrum' | 'lyrics' | 'events' | 'info';
export type RepeatMode = 'none' | 'one' | 'all';
export type ThemeMode = 'system' | 'dark' | 'light';
export type LangSetting = 'auto' | 'ja' | 'en';
export type SystemMode = 'auto' | 'gm' | 'gm2' | 'gs' | 'xg';
export type SpectrumMode = 'bars' | 'scope' | 'spectrogram';
export type ColorBy = 'channel' | 'track' | 'velocity';

export interface Settings {
  lang: LangSetting;
  theme: ThemeMode;
  accent: string;
  volume: number; // 0..1.5
  reverb: number; // 0..2
  chorus: number; // 0..2
  limiter: boolean;
  latencyHint: 'interactive' | 'balanced' | 'playback';
  voiceCap: number;
  autoVoiceReduce: boolean;
  tempo: number; // 0.25..4
  transpose: number; // -24..24
  a4: number; // 415..466
  system: SystemMode;
  repeat: RepeatMode;
  shuffle: boolean;
  fade: number; // 0..10 秒
  skipToFirstNote: boolean;
  lyricEncoding: TextEncodingName;
  visual: VisualKind;
  visual2: VisualKind | 'none';
  rollZoom: number; // px / 秒
  rollFollow: boolean;
  colorBy: ColorBy;
  showNoteNames: boolean;
  spectrumMode: SpectrumMode;
  fallingSpeed: number; // 秒（画面上端から鍵盤までの時間）
  keepMixer: boolean;
  resumeLast: boolean;
  showLeft: boolean;
  showRight: boolean;
  leftWidth: number;
  rightWidth: number;
  showDebug: boolean;
  midiOutput: 'internal' | 'external';
  /** チャンネル → 出力ポート ID（"internal" は内蔵シンセ） */
  channelRoutes: Record<number, string>;
  defaultOutputId: string;
  midiInputId: string;
  loopCount: number; // A-B ループ回数（0 = 無限）
}

export const DEFAULT_SETTINGS: Settings = {
  lang: 'auto',
  theme: 'system',
  accent: '#4f8cff',
  volume: 0.8,
  reverb: 1,
  chorus: 1,
  limiter: true,
  latencyHint: 'playback',
  voiceCap: 256,
  autoVoiceReduce: true,
  tempo: 1,
  transpose: 0,
  a4: 440,
  system: 'auto',
  repeat: 'all',
  shuffle: false,
  fade: 0,
  skipToFirstNote: false,
  lyricEncoding: 'auto',
  visual: 'roll',
  visual2: 'none',
  rollZoom: 140,
  rollFollow: true,
  colorBy: 'channel',
  showNoteNames: false,
  spectrumMode: 'bars',
  fallingSpeed: 2.5,
  keepMixer: false,
  resumeLast: true,
  showLeft: true,
  showRight: true,
  leftWidth: 300,
  rightWidth: 340,
  showDebug: false,
  midiOutput: 'internal',
  channelRoutes: {},
  defaultOutputId: '',
  midiInputId: '',
  loopCount: 0,
};

export const ACCENTS = [
  '#4f8cff',
  '#8b5cf6',
  '#ec4899',
  '#f97316',
  '#22c55e',
  '#14b8a6',
  '#eab308',
  '#ef4444',
];

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** 保存データを検証して既定値で補う */
export function sanitizeSettings(raw: unknown): Settings {
  const s = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const def = DEFAULT_SETTINGS[key];
    const v = r[key];
    if (v === undefined || v === null) continue;
    if (typeof def === typeof v) (s as any)[key] = v;
  }
  s.volume = clamp(s.volume, 0, 1.5);
  s.reverb = clamp(s.reverb, 0, 2);
  s.chorus = clamp(s.chorus, 0, 2);
  s.tempo = clamp(s.tempo, 0.25, 4);
  s.transpose = clamp(Math.round(s.transpose), -24, 24);
  s.a4 = clamp(s.a4, 415, 466);
  s.voiceCap = clamp(Math.round(s.voiceCap), 32, 2048);
  s.fade = clamp(s.fade, 0, 10);
  s.rollZoom = clamp(s.rollZoom, 10, 2000);
  s.fallingSpeed = clamp(s.fallingSpeed, 0.5, 10);
  s.leftWidth = clamp(s.leftWidth, 200, 600);
  s.rightWidth = clamp(s.rightWidth, 240, 700);
  s.loopCount = clamp(Math.round(s.loopCount), 0, 999);
  return s;
}
