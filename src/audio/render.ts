import { WorkletSynthesizer } from 'spessasynth_lib';
import type { BasicMIDI, SynthesizerSnapshot } from 'spessasynth_core';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';

export interface RenderOptions {
  midi: BasicMIDI;
  soundBanks: { buffer: ArrayBuffer; bankOffset: number }[];
  sampleRate: number;
  duration: number; // 秒（テンポ倍率反映後）
  tail?: number;
  snapshot?: SynthesizerSnapshot;
  stems?: boolean;
  reverbGain?: number;
  chorusGain?: number;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}

export class RenderCancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

/**
 * OfflineAudioContext で曲を書き出す。
 * stems = true のときは 16 チャンネル分のドライ音声（エフェクトなし）を 32ch で返す。
 */
export async function renderOffline(opts: RenderOptions): Promise<Float32Array[][]> {
  const tail = opts.tail ?? 3;
  const length = Math.ceil((opts.duration + tail) * opts.sampleRate);
  const numCh = opts.stems ? 32 : 2;
  const ctx = new OfflineAudioContext({ numberOfChannels: numCh, length, sampleRate: opts.sampleRate });
  await ctx.audioWorklet.addModule(processorUrl);
  const synth = new WorkletSynthesizer(ctx, { eventsEnabled: false });

  if (opts.stems) {
    const merger = ctx.createChannelMerger(32);
    for (let ch = 0; ch < 16; ch++) {
      const g = ctx.createGain();
      const split = ctx.createChannelSplitter(2);
      synth.connectChannel(g, ch);
      g.connect(split);
      split.connect(merger, 0, ch * 2);
      split.connect(merger, 1, ch * 2 + 1);
    }
    merger.connect(ctx.destination);
  } else {
    synth.connect(ctx.destination);
  }

  await synth.startOfflineRender({
    midiSequence: opts.midi,
    soundBankList: opts.soundBanks.map((b) => ({ soundBankBuffer: b.buffer, bankOffset: b.bankOffset })),
    loopCount: 0,
    snapshot: opts.snapshot,
    sequencerOptions: { skipToFirstNoteOn: false, initialPlaybackRate: 1 },
  });
  await synth.isReady;
  if (opts.reverbGain !== undefined) synth.setSystemParameter('reverbGain', opts.reverbGain);
  if (opts.chorusGain !== undefined) synth.setSystemParameter('chorusGain', opts.chorusGain);

  // 進捗はサスペンドポイントで計測する
  const total = length / opts.sampleRate;
  const steps = Math.min(200, Math.max(10, Math.floor(total)));
  let cancelled = false;
  for (let i = 1; i < steps; i++) {
    const t = (total * i) / steps;
    const quantum = 128 / opts.sampleRate;
    const at = Math.floor(t / quantum) * quantum;
    if (at <= 0 || at >= total) continue;
    ctx.suspend(at).then(() => {
      opts.onProgress?.(at / total);
      if (opts.signal?.aborted) {
        cancelled = true;
        return;
      }
      ctx.resume();
    });
  }

  const result = await new Promise<AudioBuffer>((resolve, reject) => {
    opts.signal?.addEventListener('abort', () => reject(new RenderCancelled()));
    ctx.startRendering().then(resolve, reject);
  });
  if (cancelled) throw new RenderCancelled();
  opts.onProgress?.(1);

  const chans: Float32Array[] = [];
  for (let i = 0; i < result.numberOfChannels; i++) chans.push(result.getChannelData(i));
  if (!opts.stems) return [chans];
  const stems: Float32Array[][] = [];
  for (let ch = 0; ch < 16; ch++) stems.push([chans[ch * 2], chans[ch * 2 + 1]]);
  return stems;
}

/** 無音チャンネルか */
export function isSilent(channels: Float32Array[], threshold = 1e-4): boolean {
  for (const c of channels)
    for (let i = 0; i < c.length; i += 7) if (Math.abs(c[i]) > threshold) return false;
  return true;
}
