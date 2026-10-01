import { batch, effect } from '@preact/signals';
import type { AudioEngine } from './engine';
import { DEFAULT_SOUNDFONT_ID, DEFAULT_SOUNDFONT_URL, fetchWithProgress } from './constants';
import { analyzeInWorker } from '../midi/analyzer-client';
import { barIndexAt } from '../midi/analyze';
import { decodeText, resolveEncoding } from '../midi/encoding';
import * as dbm from '../library/db';
import { isMidiFileName, isSoundFontName, nextIndex, shuffledOrder, stripExt } from '../library/playlist';
import {
  abLoop,
  analysis,
  channelPatches,
  currentSong,
  currentTime,
  duration,
  engineStatus,
  loadError,
  masterMuted,
  mixer,
  playlists,
  presets,
  queue,
  queueIndex,
  resetHistory,
  settings,
  sfLoadingName,
  sfProgress,
  shuffleOrder,
  songs,
  soundfonts,
  status,
  tempoNow,
  voiceCount,
} from '../state/store';
import { defaultMixer, type ChannelState } from '../state/mixer';
import { errorMessage, log, toast } from '../state/notify';
import { t } from '../ui/i18n';
import type { Settings } from '../state/settings';

let engine: AudioEngine | null = null;
let enginePromise: Promise<AudioEngine> | null = null;
let loadToken = 0;
let fadingOut = false;
let lastMixer: ChannelState[] | undefined;

export const getEngine = () => engine;

/** 再生位置（可視化用の高精度時刻） */
export function playhead(): number {
  if (!engine || !analysis.value) return currentTime.value;
  const s = status.value;
  if (s === 'playing') return engine.seq.currentHighResolutionTime;
  return engine.seq.currentTime;
}

// ------------------------------------------------------------------ エンジン
export function ensureEngine(): Promise<AudioEngine> {
  if (engine) return Promise.resolve(engine);
  if (enginePromise) return enginePromise;
  engineStatus.value = 'loading';
  enginePromise = (async () => {
    const s = settings.value;
    try {
      // iOS Safari で消音スイッチの影響を受けないようにする
      const nav = navigator as any;
      if (nav.audioSession) nav.audioSession.type = 'playback';
    } catch {}
    const lowSpec = (navigator.hardwareConcurrency ?? 8) <= 4 || ((navigator as any).deviceMemory ?? 8) <= 3;
    const { AudioEngine } = await import('./engine');
    const e = await AudioEngine.create({
      latencyHint: s.latencyHint,
      voiceCap: lowSpec ? Math.min(s.voiceCap, 128) : s.voiceCap,
    });
    engine = e;
    wireEngineEvents(e);
    await loadSoundFonts(e);
    applyAllSettings(e, settings.value);
    engineStatus.value = 'ready';
    startTicker();
    if (s.autoVoiceReduce) {
      e.monitorCapacity((load, underrun) => {
        if ((underrun > 0.02 || load > 0.97) && settings.value.autoVoiceReduce) {
          const cur = e.synth.systemParameters.voiceCap;
          const next = Math.max(48, Math.floor(cur * 0.75));
          if (next < cur) {
            e.setVoiceCap(next);
            log('warn', `voice cap reduced to ${next} (load ${load.toFixed(2)})`);
          }
        }
      });
    }
    return e;
  })().catch((err) => {
    engineStatus.value = 'error';
    enginePromise = null;
    toast(t('error.engine', { msg: errorMessage(err) }), 'error');
    throw err;
  });
  return enginePromise;
}

function wireEngineEvents(e: AudioEngine) {
  e.seq.eventHandler.addEvent('songEnded', 'player', () => onSongEnded());
  e.seq.eventHandler.addEvent('midiError', 'player', (err) => {
    toast(t('error.midi', { msg: errorMessage(err) }), 'error');
  });
  e.synth.eventHandler.addEvent('presetListChange', 'player', (list) => {
    presets.value = [...list];
  });
  let patchTimer: ReturnType<typeof setTimeout> | undefined;
  const pending: Record<number, { program: number; bankMSB: number; isDrum: boolean; name: string }> = {};
  e.synth.eventHandler.addEvent('programChange', 'player', (d) => {
    pending[d.channel] = { program: d.program, bankMSB: d.bankMSB, isDrum: d.isDrum, name: d.name };
    clearTimeout(patchTimer);
    patchTimer = setTimeout(() => {
      channelPatches.value = { ...channelPatches.value, ...pending };
    }, 120);
  });
  e.synth.eventHandler.addEvent('channelAdded', 'player', () => {
    e.applyMixer(mixer.value);
  });
  e.synth.eventHandler.addEvent('soundBankError', 'player', (err) => {
    toast(t('error.soundfont', { msg: errorMessage(err) }), 'error');
  });
}

async function loadSoundFonts(e: AudioEngine) {
  sfLoadingName.value = 'GeneralUser GS';
  sfProgress.value = 0;
  try {
    const buf = await fetchWithProgress(DEFAULT_SOUNDFONT_URL, (l, total) => {
      sfProgress.value = total ? l / total : null;
    });
    sfProgress.value = 1;
    await e.addSoundBank(buf, DEFAULT_SOUNDFONT_ID);
  } catch (err) {
    toast(t('error.defaultSf', { msg: errorMessage(err) }), 'error');
  }
  try {
    const list = await dbm.listSoundFonts();
    soundfonts.value = list;
    for (const sf of list.filter((s) => s.enabled)) {
      sfLoadingName.value = sf.name;
      const data = await dbm.getSoundFontData(sf.id);
      if (data) await e.addSoundBank(data, sf.id, sf.bankOffset);
    }
    applyBankPriority(e);
  } catch (err) {
    log('error', 'user soundfonts: ' + errorMessage(err));
  }
  sfProgress.value = null;
  sfLoadingName.value = '';
  presets.value = [...e.presets];
}

function applyBankPriority(e: AudioEngine) {
  const order = soundfonts.value.filter((s) => s.enabled).map((s) => s.id);
  e.setBankPriority([...order, DEFAULT_SOUNDFONT_ID]);
}

// ------------------------------------------------------------------ SoundFont 管理
export async function addSoundFontFile(file: File | { name: string; data: ArrayBuffer }) {
  const name = file.name;
  const data = 'data' in file ? file.data : await file.arrayBuffer();
  const meta = await dbm.addSoundFont(name, data);
  soundfonts.value = await dbm.listSoundFonts();
  const e = await ensureEngine();
  sfLoadingName.value = name;
  sfProgress.value = null;
  try {
    const copy = (await dbm.getSoundFontData(meta.id)) ?? data;
    await e.addSoundBank(copy, meta.id, meta.bankOffset);
    applyBankPriority(e);
    toast(t('sf.added', { name }), 'success');
  } catch (err) {
    toast(t('error.soundfont', { msg: errorMessage(err) }), 'error');
    await dbm.deleteSoundFont(meta.id);
    soundfonts.value = await dbm.listSoundFonts();
  } finally {
    sfLoadingName.value = '';
  }
}

export async function updateSoundFontMeta(meta: dbm.SoundFontMeta) {
  const prev = soundfonts.value.find((s) => s.id === meta.id);
  await dbm.updateSoundFont(meta);
  soundfonts.value = await dbm.listSoundFonts();
  const e = engine;
  if (!e) return;
  const needsReload = !prev || prev.enabled !== meta.enabled || prev.bankOffset !== meta.bankOffset;
  if (needsReload) {
    if (e.bankIds.includes(meta.id)) await e.removeSoundBank(meta.id);
    if (meta.enabled) {
      const data = await dbm.getSoundFontData(meta.id);
      if (data) await e.addSoundBank(data, meta.id, meta.bankOffset);
    }
  }
  applyBankPriority(e);
}

export async function moveSoundFont(id: string, dir: -1 | 1) {
  const list = soundfonts.value.slice();
  const i = list.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await Promise.all(list.map((s, idx) => dbm.updateSoundFont({ ...s, priority: idx })));
  soundfonts.value = await dbm.listSoundFonts();
  if (engine) applyBankPriority(engine);
}

export async function removeSoundFont(id: string) {
  await dbm.deleteSoundFont(id);
  soundfonts.value = await dbm.listSoundFonts();
  if (engine?.bankIds.includes(id)) await engine.removeSoundBank(id);
}

// ------------------------------------------------------------------ 設定反映
function applyAllSettings(e: AudioEngine, s: Settings) {
  e.setVolume(masterMuted.peek() ? 0 : s.volume);
  e.setLimiter(s.limiter);
  e.setReverb(s.reverb);
  e.setChorus(s.chorus);
  e.setTranspose(s.transpose);
  e.setA4(s.a4);
  e.setVoiceCap(s.voiceCap);
  e.setPlaybackRate(s.tempo);
  e.setSystemMode(s.system);
  e.seq.skipToFirstNoteOn = s.skipToFirstNote;
}

let prevSettings: Settings | null = null;
effect(() => {
  const s = settings.value;
  const e = engine;
  if (!e) {
    prevSettings = s;
    return;
  }
  const p = prevSettings;
  prevSettings = s;
  if (!p || p.volume !== s.volume) e.setVolume(masterMuted.peek() ? 0 : s.volume);
  if (!p || p.limiter !== s.limiter) e.setLimiter(s.limiter);
  if (!p || p.reverb !== s.reverb) e.setReverb(s.reverb);
  if (!p || p.chorus !== s.chorus) e.setChorus(s.chorus);
  if (!p || p.transpose !== s.transpose) e.setTranspose(s.transpose);
  if (!p || p.a4 !== s.a4) e.setA4(s.a4);
  if (!p || p.voiceCap !== s.voiceCap) e.setVoiceCap(s.voiceCap);
  if (!p || p.tempo !== s.tempo) e.setPlaybackRate(s.tempo);
  if (!p || p.system !== s.system) e.setSystemMode(s.system);
  if (!p || p.skipToFirstNote !== s.skipToFirstNote) e.seq.skipToFirstNoteOn = s.skipToFirstNote;
  if (!p || p.shuffle !== s.shuffle) {
    shuffleOrder.value = s.shuffle ? shuffledOrder(queue.value.length, queueIndex.value) : null;
  }
  if (
    !p ||
    p.midiOutput !== s.midiOutput ||
    p.defaultOutputId !== s.defaultOutputId ||
    JSON.stringify(p.channelRoutes) !== JSON.stringify(s.channelRoutes)
  ) {
    e.setRouting(s.midiOutput === 'external', s.channelRoutes, s.defaultOutputId);
  }
});

effect(() => {
  const muted = masterMuted.value;
  engine?.setVolume(muted ? 0 : settings.peek().volume);
});

effect(() => {
  const m = mixer.value;
  const e = engine;
  if (!e) return;
  e.applyMixer(m, lastMixer);
  lastMixer = m;
});

// ------------------------------------------------------------------ ライブラリ
export async function refreshLibrary() {
  const [s, p] = await Promise.all([dbm.listSongs(), dbm.listPlaylists()]);
  batch(() => {
    songs.value = s.sort((a, b) => b.addedAt - a.addedAt);
    playlists.value = p;
  });
}

async function persistQueue() {
  await dbm.kvSet('queue', { ids: queue.value, index: queueIndex.value });
}

export async function restoreQueue() {
  const q = await dbm.kvGet<{ ids: string[]; index: number }>('queue');
  if (!q) return null;
  const known = new Set(songs.value.map((s) => s.id));
  const ids = q.ids.filter((id) => known.has(id));
  queue.value = ids;
  queueIndex.value = Math.min(q.index, ids.length - 1);
  return q;
}

export interface IncomingFile {
  name: string;
  data: ArrayBuffer;
  source?: dbm.SongMeta['source'];
  url?: string;
}

/** ZIP を展開して MIDI / SoundFont を取り出す */
async function expandZip(f: IncomingFile): Promise<IncomingFile[]> {
  const { unzip } = await import('fflate');
  const entries = await new Promise<Record<string, Uint8Array>>((res, rej) =>
    unzip(new Uint8Array(f.data), (err, data) => (err ? rej(err) : res(data))),
  );
  return Object.entries(entries)
    .filter(([name]) => !name.startsWith('__MACOSX') && (isMidiFileName(name) || isSoundFontName(name)))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([name, d]) => ({
      name: name.split('/').pop()!,
      data: d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer,
      source: f.source,
    }));
}

function looksLikeMidi(data: ArrayBuffer): boolean {
  const b = new Uint8Array(data, 0, Math.min(16, data.byteLength));
  const tag = String.fromCharCode(...b.subarray(0, 4));
  if (tag === 'MThd' || tag === 'RIFF') return true;
  // XMF
  return String.fromCharCode(...b.subarray(0, 4)) === 'XMF_';
}

/** ファイル群をライブラリとキューに追加。戻り値は追加された曲 */
export async function addIncoming(
  files: IncomingFile[],
  opts: { play?: boolean; replaceQueue?: boolean } = {},
): Promise<dbm.SongMeta[]> {
  const expanded: IncomingFile[] = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      try {
        expanded.push(...(await expandZip(f)));
      } catch (err) {
        toast(t('error.zip', { name: f.name, msg: errorMessage(err) }), 'error');
      }
    } else expanded.push(f);
  }
  const added: dbm.SongMeta[] = [];
  for (const f of expanded) {
    if (isSoundFontName(f.name)) {
      await addSoundFontFile(f);
      continue;
    }
    if (!isMidiFileName(f.name) && !looksLikeMidi(f.data)) {
      toast(t('error.unsupported', { name: f.name }), 'warn');
      continue;
    }
    try {
      // 解析できるか先に確認（壊れたファイルはライブラリに入れない）
      const a = await analyzeInWorker(f.data, f.name);
      const enc = resolveEncoding(settings.value.lyricEncoding, a.nameBytes ? [a.nameBytes] : []);
      const title = a.nameBytes ? decodeText(a.nameBytes, enc).trim() : '';
      const meta = await dbm.addSong(f.data, {
        name: title && title.length < 80 ? title : stripExt(f.name),
        fileName: f.name,
        source: f.source ?? 'file',
        url: f.url,
        duration: a.duration,
      });
      added.push(meta);
    } catch (err) {
      toast(t('error.parse', { name: f.name, msg: errorMessage(err) }), 'error');
    }
  }
  if (!added.length) return added;
  await refreshLibrary();
  const ids = added.map((s) => s.id);
  if (opts.replaceQueue) {
    setQueue(ids, 0, opts.play ?? true);
  } else {
    const startIdx = queue.value.length;
    queue.value = [...queue.value, ...ids];
    if (settings.value.shuffle) shuffleOrder.value = shuffledOrder(queue.value.length, queueIndex.value);
    persistQueue();
    if (opts.play ?? status.value === 'idle') playQueueIndex(startIdx, true);
  }
  if (added.length > 1) toast(t('lib.addedMany', { n: added.length }), 'success');
  return added;
}

export async function addFiles(files: File[] | FileList, opts: { play?: boolean } = {}) {
  const list: IncomingFile[] = [];
  for (const f of Array.from(files)) list.push({ name: f.name, data: await f.arrayBuffer() });
  return addIncoming(list, opts);
}

export async function addFromUrl(url: string, opts: { play?: boolean } = {}) {
  let res: Response;
  try {
    res = await fetch(url, { mode: 'cors' });
  } catch {
    toast(t('error.cors'), 'error', { timeout: 12000 });
    return [];
  }
  if (!res.ok) {
    toast(t('error.http', { status: res.status }), 'error');
    return [];
  }
  const data = await res.arrayBuffer();
  const name = decodeURIComponent(new URL(url, location.href).pathname.split('/').pop() || 'remote.mid');
  return addIncoming([{ name, data, source: 'url', url }], { play: opts.play ?? true });
}

export async function loadDemos() {
  try {
    const list: { file: string; title: string }[] = await (await fetch('/demo/index.json')).json();
    const files: IncomingFile[] = [];
    for (const d of list) {
      const data = await (await fetch('/demo/' + d.file)).arrayBuffer();
      files.push({ name: d.file, data, source: 'demo' });
    }
    const added = await addIncoming(files, { play: false });
    // 表示名をデモ一覧のタイトルに揃える
    for (const [i, s] of added.entries()) {
      if (s.source === 'demo' && list[i]) await dbm.updateSong(s.id, { name: list[i].title });
    }
    await refreshLibrary();
    return added;
  } catch (err) {
    toast(errorMessage(err), 'error');
    return [];
  }
}

export async function removeSongs(ids: string[]) {
  for (const id of ids) await dbm.deleteSong(id);
  const remove = new Set(ids);
  const curId = queue.value[queueIndex.value];
  const nextQueue = queue.value.filter((id) => !remove.has(id));
  queue.value = nextQueue;
  queueIndex.value = curId && !remove.has(curId) ? nextQueue.indexOf(curId) : -1;
  for (const p of playlists.value) {
    if (p.songIds.some((id) => remove.has(id)))
      await dbm.savePlaylist({ ...p, songIds: p.songIds.filter((i) => !remove.has(i)) });
  }
  await refreshLibrary();
  persistQueue();
}

export async function toggleFavorite(id: string) {
  const s = songs.value.find((x) => x.id === id);
  if (!s) return;
  await dbm.updateSong(id, { favorite: !s.favorite });
  await refreshLibrary();
}

export async function renameSong(id: string, name: string) {
  await dbm.updateSong(id, { name });
  await refreshLibrary();
  if (currentSong.value?.id === id) currentSong.value = { ...currentSong.value, name };
}

// ------------------------------------------------------------------ キュー
export function setQueue(ids: string[], index = 0, play = true) {
  queue.value = ids.slice();
  shuffleOrder.value = settings.value.shuffle ? shuffledOrder(ids.length, index) : null;
  persistQueue();
  if (ids.length) playQueueIndex(index, play);
}

export function moveInQueue(from: number, to: number) {
  const q = queue.value.slice();
  const [id] = q.splice(from, 1);
  q.splice(to, 0, id);
  const cur = queue.value[queueIndex.value];
  queue.value = q;
  queueIndex.value = q.indexOf(cur);
  if (settings.value.shuffle) shuffleOrder.value = shuffledOrder(q.length, queueIndex.value);
  persistQueue();
}

export function removeFromQueue(index: number) {
  const q = queue.value.slice();
  q.splice(index, 1);
  const cur = queueIndex.value;
  queue.value = q;
  if (index < cur) queueIndex.value = cur - 1;
  else if (index === cur) queueIndex.value = Math.min(cur, q.length - 1);
  if (settings.value.shuffle) shuffleOrder.value = shuffledOrder(q.length, queueIndex.value);
  persistQueue();
}

export function clearQueue() {
  queue.value = [];
  queueIndex.value = -1;
  shuffleOrder.value = null;
  persistQueue();
}

export async function playQueueIndex(index: number, autoplay = true, startAt = 0) {
  const id = queue.value[index];
  if (!id) return;
  queueIndex.value = index;
  persistQueue();
  await loadSong(id, { autoplay, startAt });
}

export async function next(auto = false) {
  const s = settings.value;
  const idx = nextIndex(queueIndex.value, queue.value.length, s.repeat, shuffleOrder.value, 1, auto);
  if (idx === null) {
    stop();
    return;
  }
  if (auto && idx === queueIndex.value && s.repeat === 'one') {
    seek(0);
    play();
    return;
  }
  await playQueueIndex(idx, auto || status.value === 'playing');
}

export async function prev() {
  if (playhead() > 3) {
    seek(0);
    return;
  }
  const s = settings.value;
  const idx = nextIndex(queueIndex.value, queue.value.length, s.repeat, shuffleOrder.value, -1, false);
  if (idx !== null) await playQueueIndex(idx, status.value === 'playing');
}

// ------------------------------------------------------------------ 曲の読み込み
function waitSongChange(e: AudioEngine, timeout = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      e.seq.eventHandler.removeEvent('songChange', 'loader');
      reject(new Error('timeout'));
    }, timeout);
    e.seq.eventHandler.addEvent('songChange', 'loader', () => {
      clearTimeout(timer);
      e.seq.eventHandler.removeEvent('songChange', 'loader');
      resolve();
    });
  });
}

export async function loadSong(id: string, opts: { autoplay?: boolean; startAt?: number } = {}) {
  const token = ++loadToken;
  const meta = songs.value.find((s) => s.id === id) ?? null;
  status.value = 'loading';
  loadError.value = null;
  try {
    const data = await dbm.getSongData(id);
    if (!data) throw new Error(t('error.missing'));
    const [a, e] = await Promise.all([analyzeInWorker(data, meta?.fileName ?? 'song.mid'), ensureEngine()]);
    if (token !== loadToken) return;
    fadingOut = false;
    e.fadeTo(1, 0);
    const changed = waitSongChange(e);
    e.seq.loadNewSongList([{ binary: data.slice(0), fileName: meta?.fileName ?? 'song.mid' }]);
    await changed;
    if (token !== loadToken) return;
    e.seq.loopCount = 0;
    e.setPlaybackRate(settings.value.tempo);
    e.setBlackMIDIMode(a.noteCount > 400_000);
    batch(() => {
      analysis.value = a;
      duration.value = a.duration;
      currentSong.value = meta;
      abLoop.value = { a: null, b: null, enabled: false, done: 0 };
      channelPatches.value = {};
      if (!settings.value.keepMixer) {
        lastMixer = undefined;
        mixer.value = defaultMixer();
      }
    });
    e.applyMixer(mixer.value);
    lastMixer = mixer.value;
    if (settings.value.system !== 'auto') e.setSystemMode(settings.value.system);
    resetHistory();
    const start = Math.max(0, Math.min(opts.startAt ?? 0, a.duration - 0.1));
    if (start > 0) e.seq.currentTime = start;
    if (opts.autoplay) {
      await e.resume();
      if (settings.value.fade > 0) {
        e.fadeTo(0, 0);
        e.fadeTo(1, Math.min(2, settings.value.fade));
      }
      e.seq.play();
      status.value = 'playing';
    } else {
      e.seq.pause();
      status.value = 'paused';
    }
    currentTime.value = start;
    if (meta) {
      dbm
        .updateSong(id, { playCount: meta.playCount + 1, lastPlayedAt: Date.now(), duration: a.duration })
        .then(() => {
          const s = songs.value.find((x) => x.id === id);
          if (s) {
            s.playCount++;
            s.duration = a.duration;
          }
        });
    }
    updateMediaSession();
    log(
      'info',
      `loaded ${meta?.fileName}: ${a.noteCount} notes, ${a.duration.toFixed(1)}s, ${a.detectedSystem}`,
    );
  } catch (err) {
    if (token !== loadToken) return;
    status.value = analysis.value ? 'paused' : 'idle';
    loadError.value = errorMessage(err);
    toast(t('error.load', { msg: errorMessage(err) }), 'error');
  }
}

// ------------------------------------------------------------------ トランスポート
export async function play() {
  const e = await ensureEngine();
  await e.resume();
  if (!analysis.value) {
    if (queue.value.length) return playQueueIndex(Math.max(0, queueIndex.value), true);
    if (songs.value.length)
      return setQueue(
        songs.value.map((s) => s.id),
        0,
        true,
      );
    return;
  }
  if (e.seq.isFinished || e.seq.currentTime >= duration.value - 0.05) e.seq.currentTime = 0;
  e.fadeTo(1, 0.01);
  e.seq.play();
  status.value = 'playing';
  updateMediaSession();
}

export function pause() {
  if (!engine) return;
  engine.seq.pause();
  if (status.value === 'playing') status.value = 'paused';
  saveResume();
  updateMediaSession();
}

export function togglePlay() {
  if (status.value === 'playing') pause();
  else play();
}

export function stop() {
  if (!engine) return;
  engine.seq.pause();
  engine.seq.currentTime = 0;
  if (engine.isExternal) engine.panicExternal();
  currentTime.value = 0;
  if (analysis.value) status.value = 'paused';
  updateMediaSession();
}

export function seek(sec: number) {
  if (!engine || !analysis.value) return;
  const t = Math.max(0, Math.min(sec, duration.value));
  engine.seq.currentTime = t;
  currentTime.value = t;
  if (fadingOut) {
    fadingOut = false;
    engine.fadeTo(1, 0.05);
  }
  abLoop.value = { ...abLoop.value, done: 0 };
}

export const seekBy = (delta: number) => seek(playhead() + delta);

export function seekBars(delta: number) {
  const a = analysis.value;
  if (!a || !a.bars.length) return seekBy(delta * 2);
  const t = playhead();
  const i = barIndexAt(a.bars, t);
  // 小節頭から少し進んでいれば「前へ」で現在の小節頭へ
  const target = delta < 0 && t - a.bars[i] > 0.4 ? i : i + delta;
  seek(a.bars[Math.max(0, Math.min(a.bars.length - 1, target))]);
}

// ------------------------------------------------------------------ A-B ループ
export function setLoopA(sec = playhead()) {
  const l = abLoop.value;
  const b = l.b !== null && l.b <= sec ? null : l.b;
  abLoop.value = { a: sec, b, enabled: b !== null, done: 0 };
}
export function setLoopB(sec = playhead()) {
  const l = abLoop.value;
  const a = l.a !== null && l.a < sec ? l.a : 0;
  abLoop.value = { a, b: sec, enabled: true, done: 0 };
}
export function toggleLoop() {
  const l = abLoop.value;
  if (l.a === null || l.b === null) {
    loopCurrentBars(1);
    return;
  }
  abLoop.value = { ...l, enabled: !l.enabled, done: 0 };
}
export function clearLoop() {
  abLoop.value = { a: null, b: null, enabled: false, done: 0 };
}
export function loopCurrentBars(count: number) {
  const a = analysis.value;
  if (!a || !a.bars.length) return;
  const i = barIndexAt(a.bars, playhead());
  const start = a.bars[i];
  const end = a.bars[Math.min(a.bars.length - 1, i + count)] ?? a.duration;
  abLoop.value = { a: start, b: end > start ? end : a.duration, enabled: true, done: 0 };
}

// ------------------------------------------------------------------ 曲の終了 / ティッカー
function onSongEnded() {
  if (status.value !== 'playing') return;
  const l = abLoop.value;
  if (l.enabled && l.a !== null && l.b !== null && l.b >= duration.value - 0.05) {
    // ループ終点が曲末の場合
    seek(l.a);
    engine?.seq.play();
    return;
  }
  status.value = 'paused';
  fadingOut = false;
  next(true);
}

let tickerStarted = false;
let lastUiUpdate = 0;
let lastResumeSave = 0;
function startTicker() {
  if (tickerStarted) return;
  tickerStarted = true;
  const tick = (now: number) => {
    requestAnimationFrame(tick);
    const e = engine;
    if (!e || !analysis.value) return;
    const time = e.seq.currentTime;
    if (status.value === 'playing') {
      // A-B ループ
      const l = abLoop.value;
      if (l.enabled && l.a !== null && l.b !== null && time >= l.b) {
        const max = settings.value.loopCount;
        if (max === 0 || l.done + 1 < max) {
          e.seq.currentTime = l.a;
          abLoop.value = { ...l, done: l.done + 1 };
        } else abLoop.value = { ...l, enabled: false, done: 0 };
      }
      // フェードアウト（曲間フェード）
      const fade = settings.value.fade;
      const remain = duration.value - time;
      const hasNext = settings.value.repeat !== 'none' || queueIndex.value < queue.value.length - 1;
      if (fade > 0 && hasNext && !fadingOut && remain < fade && remain > 0 && !(l.enabled && l.b !== null)) {
        fadingOut = true;
        e.fadeTo(0, remain / settings.value.tempo);
      }
      if (e.seq.isFinished && status.value === 'playing' && time >= duration.value - 0.01) onSongEnded();
    }
    if (now - lastUiUpdate > 66) {
      lastUiUpdate = now;
      currentTime.value = time;
      tempoNow.value = e.seq.currentTempo;
      voiceCount.value = e.synth.voiceCount;
      if (now - lastResumeSave > 5000) {
        lastResumeSave = now;
        saveResume();
        if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && duration.value > 0) {
          try {
            navigator.mediaSession.setPositionState({
              duration: duration.value,
              position: Math.min(time, duration.value),
              playbackRate: settings.value.tempo,
            });
          } catch {}
        }
      }
    }
  };
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ 再開
export function saveResume() {
  const s = currentSong.value;
  if (!s) return;
  dbm.kvSet('resume', { songId: s.id, time: engine?.seq.currentTime ?? currentTime.value }).catch(() => {});
}

export async function resumeLast(): Promise<boolean> {
  const r = await dbm.kvGet<{ songId: string; time: number }>('resume');
  if (!r || !songs.value.some((s) => s.id === r.songId)) return false;
  let idx = queue.value.indexOf(r.songId);
  if (idx < 0) {
    queue.value = [...queue.value, r.songId];
    idx = queue.value.length - 1;
  }
  queueIndex.value = idx;
  await loadSong(r.songId, { autoplay: false, startAt: r.time });
  return true;
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', saveResume);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveResume();
  });
}

// ------------------------------------------------------------------ Media Session
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const s = currentSong.value;
  try {
    ms.metadata = new MediaMetadata({
      title: s?.name ?? 'MIDI Studio Player',
      artist: 'MIDI',
      album: 'MIDI Studio Player',
      artwork: [{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
    ms.playbackState = status.value === 'playing' ? 'playing' : 'paused';
  } catch {}
}

export function setupMediaSessionHandlers() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const set = (a: MediaSessionAction, h: MediaSessionActionHandler) => {
    try {
      ms.setActionHandler(a, h);
    } catch {}
  };
  set('play', () => play());
  set('pause', () => pause());
  set('stop', () => stop());
  set('previoustrack', () => prev());
  set('nexttrack', () => next());
  set('seekbackward', (d) => seekBy(-(d.seekOffset ?? 5)));
  set('seekforward', (d) => seekBy(d.seekOffset ?? 5));
  set('seekto', (d) => d.seekTime !== undefined && seek(d.seekTime));
}

// ------------------------------------------------------------------ 共有 URL
export function shareUrl(): string | null {
  const s = currentSong.value;
  const u = new URL(location.origin + location.pathname);
  if (!s?.url) return null;
  u.searchParams.set('url', s.url);
  const time = Math.floor(playhead());
  if (time > 0) u.searchParams.set('t', String(time));
  const st = settings.value;
  if (st.tempo !== 1) u.searchParams.set('tempo', String(st.tempo));
  if (st.transpose !== 0) u.searchParams.set('transpose', String(st.transpose));
  return u.toString();
}

export async function handleLaunchParams(params: URLSearchParams): Promise<boolean> {
  const url = params.get('url');
  const tempo = Number(params.get('tempo'));
  const transpose = Number(params.get('transpose'));
  const patch: Partial<Settings> = {};
  if (tempo >= 0.25 && tempo <= 4) patch.tempo = tempo;
  if (Number.isFinite(transpose) && params.has('transpose')) patch.transpose = Math.round(transpose);
  if (Object.keys(patch).length) settings.value = { ...settings.value, ...patch };
  if (!url) return false;
  const added = await addFromUrl(url, { play: false });
  if (!added.length) return false;
  const idx = queue.value.indexOf(added[0].id);
  const time = Number(params.get('t')) || 0;
  await playQueueIndex(idx, false, time);
  return true;
}

// ------------------------------------------------------------------ ライブ演奏（画面鍵盤・MIDI 入力）
export const liveNotes = new Map<number, number>(); // ch*128+key -> velocity
/** 画面鍵盤などの演奏を録音に渡すためのフック */
export const liveHooks: { record: null | ((data: number[]) => void) } = { record: null };

export async function liveNoteOn(ch: number, key: number, vel = 100) {
  const e = await ensureEngine();
  await e.resume();
  e.synth.noteOn(ch, key, vel);
  liveNotes.set(ch * 128 + key, vel);
  liveHooks.record?.([0x90 | ch, key, vel]);
}
export function liveNoteOff(ch: number, key: number) {
  engine?.synth.noteOff(ch, key);
  liveNotes.delete(ch * 128 + key);
  liveHooks.record?.([0x80 | ch, key, 0]);
}
export function liveMessage(data: Uint8Array | number[]) {
  const e = engine;
  if (!e) return;
  const status = data[0] & 0xf0;
  const ch = data[0] & 0x0f;
  if (status === 0x90 && data[2] > 0) liveNotes.set(ch * 128 + data[1], data[2]);
  else if (status === 0x80 || (status === 0x90 && data[2] === 0)) liveNotes.delete(ch * 128 + data[1]);
  e.synth.sendMessage(Array.from(data));
}
export function livePanic() {
  liveNotes.clear();
  engine?.synth.stopAll(true);
}
