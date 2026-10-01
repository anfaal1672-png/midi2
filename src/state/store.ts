import { batch, computed, effect, signal } from '@preact/signals';
import type { MIDIPatchFull } from 'spessasynth_core';
import type { SongAnalysis } from '../midi/types';
import type { PlaylistRec, SongMeta, SoundFontMeta } from '../library/db';
import { History } from './history';
import { defaultMixer, type ChannelState } from './mixer';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from './settings';
import { browserLang, lang } from '../ui/i18n';

const SETTINGS_KEY = 'midi-studio:settings';

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return sanitizeSettings(JSON.parse(raw));
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

export const settings = signal<Settings>(loadSettings());
export const mixer = signal<ChannelState[]>(defaultMixer());

export type EngineStatus = 'none' | 'loading' | 'ready' | 'error';
export type PlayStatus = 'idle' | 'loading' | 'playing' | 'paused';

export const engineStatus = signal<EngineStatus>('none');
export const sfProgress = signal<number | null>(null);
export const sfLoadingName = signal<string>('');
export const status = signal<PlayStatus>('idle');
export const currentTime = signal(0);
export const duration = signal(0);
export const tempoNow = signal(120);
export const voiceCount = signal(0);
export const analysis = signal<SongAnalysis | null>(null);
export const currentSong = signal<SongMeta | null>(null);
export const songs = signal<SongMeta[]>([]);
export const queue = signal<string[]>([]);
export const queueIndex = signal(-1);
export const shuffleOrder = signal<number[] | null>(null);
export const playlists = signal<PlaylistRec[]>([]);
export const soundfonts = signal<SoundFontMeta[]>([]);
export const presets = signal<MIDIPatchFull[]>([]);
export const loadError = signal<string | null>(null);
export const masterMuted = signal(false);
/** シンセ側の現在の音色（プログラムチェンジのたびに更新） */
export const channelPatches = signal<
  Record<number, { program: number; bankMSB: number; isDrum: boolean; name: string }>
>({});
export const pcKeyboard = signal(false);
export const fullscreenViz = signal(false);
export const updateReady = signal<null | (() => void)>(null);
export const installPrompt = signal<null | { prompt: () => void }>(null);

export interface ABLoop {
  a: number | null;
  b: number | null;
  enabled: boolean;
  done: number;
}
export const abLoop = signal<ABLoop>({ a: null, b: null, enabled: false, done: 0 });

export type ModalKind = null | 'settings' | 'export' | 'url' | 'help' | 'about' | 'soundfonts' | 'devices';
export const modal = signal<ModalKind>(null);
export const settingsTab = signal<string>('general');
export const mobileTab = signal<'visual' | 'library' | 'mixer'>('visual');

export interface MidiDeviceInfo {
  id: string;
  name: string;
}
export const midiAccess = signal<{
  supported: boolean;
  enabled: boolean;
  inputs: MidiDeviceInfo[];
  outputs: MidiDeviceInfo[];
  error?: string;
}>({
  supported: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator,
  enabled: false,
  inputs: [],
  outputs: [],
});
export const recording = signal<{ active: boolean; startedAt: number; count: number }>({
  active: false,
  startedAt: 0,
  count: 0,
});

/** 現在の曲で使われているチャンネル */
export const usedChannels = computed(() => {
  const a = analysis.value;
  if (!a) return Array.from({ length: 16 }, (_, i) => i);
  const used = a.channels.filter((c) => c.noteCount > 0 || c.programs.length > 0).map((c) => c.ch);
  return used.length ? used : Array.from({ length: 16 }, (_, i) => i);
});

export const songTitle = computed(() => currentSong.value?.name ?? '');

export function patchSettings(patch: Partial<Settings>) {
  settings.value = sanitizeSettings({ ...settings.value, ...patch });
}

export function patchChannel(ch: number, patch: Partial<ChannelState>) {
  const next = mixer.value.slice();
  next[ch] = { ...next[ch], ...patch };
  mixer.value = next;
}

// ---- 保存（設定）
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const saveSettingsNow = () => {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.peek()));
  } catch {}
};
effect(() => {
  void settings.value;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettingsNow, 200);
});
// ページを離れる直前の変更も失わないよう、未保存なら即座に書き込む
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => saveTimer !== undefined && saveSettingsNow());
}

// 言語
effect(() => {
  const l = settings.value.lang;
  lang.value = l === 'auto' ? browserLang() : l;
  if (typeof document !== 'undefined') document.documentElement.lang = lang.value;
});

// ---- Undo / Redo（ミキサーと設定）
interface Snapshot {
  settings: Settings;
  mixer: ChannelState[];
}
const history = new History<Snapshot>(150);
export const canUndo = signal(false);
export const canRedo = signal(false);
let applyingHistory = false;
let histTimer: ReturnType<typeof setTimeout> | undefined;

/** UI 状態（パネル表示や表示モード）は履歴に含めない */
const UNDO_IGNORED: (keyof Settings)[] = [
  'visual',
  'visual2',
  'showLeft',
  'showRight',
  'leftWidth',
  'rightWidth',
  'showDebug',
  'rollZoom',
  'lang',
];
const snap = (): Snapshot => {
  const s = { ...settings.value };
  for (const k of UNDO_IGNORED) delete (s as any)[k];
  return { settings: s as Settings, mixer: mixer.value };
};

effect(() => {
  // 依存登録
  void settings.value;
  void mixer.value;
  if (applyingHistory) return;
  clearTimeout(histTimer);
  histTimer = setTimeout(() => {
    history.push(structuredClone(snap()));
    canUndo.value = history.canUndo;
    canRedo.value = history.canRedo;
  }, 350);
});

function applySnapshot(s: Snapshot) {
  applyingHistory = true;
  batch(() => {
    const keep: Partial<Settings> = {};
    for (const k of UNDO_IGNORED) (keep as any)[k] = settings.value[k];
    settings.value = sanitizeSettings({ ...s.settings, ...keep });
    mixer.value = s.mixer;
  });
  canUndo.value = history.canUndo;
  canRedo.value = history.canRedo;
  setTimeout(() => (applyingHistory = false), 0);
}

export function undo() {
  // 確定前（デバウンス中）の変更も 1 ステップとして扱う
  clearTimeout(histTimer);
  history.push(structuredClone(snap()));
  const s = history.undo(structuredClone(snap()));
  if (s) applySnapshot(structuredClone(s));
}
export function redo() {
  const s = history.redo();
  if (s) applySnapshot(structuredClone(s));
}
export function resetHistory() {
  history.clear();
  history.push(structuredClone(snap()));
  canUndo.value = false;
  canRedo.value = false;
}

// ---- 設定の書き出し / 読み込み
export function exportSettingsJSON(): string {
  return JSON.stringify({ format: 'midi-studio-settings', version: 1, settings: settings.value }, null, 2);
}
export function importSettingsJSON(text: string) {
  const doc = JSON.parse(text);
  if (!doc || doc.format !== 'midi-studio-settings' || typeof doc.settings !== 'object') {
    throw new Error('Invalid settings file');
  }
  settings.value = sanitizeSettings({ ...DEFAULT_SETTINGS, ...doc.settings });
}
