import { BasicMIDI } from 'spessasynth_core';
import { analysis, currentSong, mixer, settings, soundfonts } from '../state/store';
import { getEngine, ensureEngine } from './player';
import { DEFAULT_SOUNDFONT_URL } from './constants';
import * as dbm from '../library/db';
import { exportEditedMIDI, scaleTempo, type ChannelEdit } from '../midi/edit';
import { encodeWav, normalize, type BitDepth } from './wav';
import { isSilent, renderOffline } from './render';
import { pianoRollPNG } from '../visual/exportPng';
import { safeFileName, saveBlob } from '../ui/download';
import { stripExt } from '../library/playlist';

async function currentMidi(): Promise<BasicMIDI> {
  const song = currentSong.value;
  if (!song) throw new Error('No song');
  const data = await dbm.getSongData(song.id);
  if (!data) throw new Error('Song data missing');
  return BasicMIDI.fromArrayBuffer(data, song.fileName);
}

const baseName = () => safeFileName(stripExt(currentSong.value?.name ?? 'midi'));

export interface WavExportOptions {
  sampleRate: number;
  bitDepth: BitDepth;
  stems: boolean;
  normalize: boolean;
  onProgress: (p: number) => void;
  signal: AbortSignal;
}

export async function exportWav(o: WavExportOptions) {
  const a = analysis.value;
  if (!a) throw new Error('No song');
  await ensureEngine();
  const e = getEngine()!;
  const s = settings.value;
  const midi = await currentMidi();
  scaleTempo(midi, s.tempo);
  midi.flush(true);
  const snapshot = await e.getSnapshot();
  // グローバルの移調と調律はスナップショットに含まれるが、念のため明示的に反映する
  (snapshot as any).systemParameters = {
    ...(snapshot as any).systemParameters,
    keyShift: s.transpose,
    fineTune: 1200 * Math.log2(s.a4 / 440),
  };
  const banks: { buffer: ArrayBuffer; bankOffset: number }[] = [];
  for (const sf of soundfonts.value.filter((x) => x.enabled)) {
    const d = await dbm.getSoundFontData(sf.id);
    if (d) banks.push({ buffer: d, bankOffset: sf.bankOffset });
  }
  banks.push({ buffer: await (await fetch(DEFAULT_SOUNDFONT_URL)).arrayBuffer(), bankOffset: 0 });
  const result = await renderOffline({
    midi,
    soundBanks: banks,
    sampleRate: o.sampleRate,
    duration: a.duration / s.tempo,
    snapshot,
    stems: o.stems,
    reverbGain: s.reverb,
    chorusGain: s.chorus,
    onProgress: o.onProgress,
    signal: o.signal,
  });
  const name = baseName();
  if (!o.stems) {
    const chans = result[0];
    for (const c of chans) for (let i = 0; i < c.length; i++) c[i] *= s.volume;
    if (o.normalize) normalize(chans);
    saveBlob(new Blob([encodeWav(chans, o.sampleRate, o.bitDepth)], { type: 'audio/wav' }), `${name}.wav`);
    return;
  }
  const { zipSync } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  result.forEach((chans, ch) => {
    if (isSilent(chans)) return;
    if (o.normalize) normalize(chans);
    files[`${name}_ch${String(ch + 1).padStart(2, '0')}.wav`] = new Uint8Array(
      encodeWav(chans, o.sampleRate, o.bitDepth),
    );
  });
  const zip = zipSync(files, { level: 0 });
  saveBlob(new Blob([zip as BlobPart], { type: 'application/zip' }), `${name}_stems.zip`);
}

export async function exportMidi(applyEdits: boolean) {
  const song = currentSong.value;
  const a = analysis.value;
  if (!song || !a) throw new Error('No song');
  const data = await dbm.getSongData(song.id);
  if (!data) throw new Error('missing');
  if (!applyEdits) {
    saveBlob(new Blob([data], { type: 'audio/midi' }), song.fileName);
    return;
  }
  const mid = BasicMIDI.fromArrayBuffer(data, song.fileName);
  const s = settings.value;
  const channels = new Map<number, ChannelEdit>();
  mixer.value.forEach((c, ch) => {
    const edit: ChannelEdit = {};
    const anySolo = mixer.value.some((x) => x.solo);
    if (c.mute || (anySolo && !c.solo)) edit.mute = true;
    if (c.transpose) edit.transpose = c.transpose;
    if (c.program)
      edit.patch = {
        program: c.program.program,
        bankMSB: c.program.bankMSB,
        bankLSB: c.program.bankLSB,
        isGMGSDrum: c.program.isDrum,
      };
    if (Object.keys(edit).length) channels.set(ch, edit);
  });
  const out = exportEditedMIDI(mid, {
    transpose: s.transpose,
    tempoRate: s.tempo,
    channels,
    drumChannels: new Set(a.channels.filter((c) => c.isDrum).map((c) => c.ch)),
  });
  saveBlob(new Blob([out], { type: 'audio/midi' }), `${baseName()}_edited.mid`);
}

export async function exportPng() {
  const a = analysis.value;
  if (!a) throw new Error('No song');
  const s = settings.value;
  const dark = document.documentElement.dataset.resolvedTheme !== 'light';
  const blob = await pianoRollPNG(a, mixer.value, { transpose: s.transpose, colorBy: s.colorBy, dark });
  saveBlob(blob, `${baseName()}_pianoroll.png`);
}
