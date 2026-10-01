import { Sequencer, WorkletSynthesizer } from 'spessasynth_lib';
import type { MIDIPatchFull } from 'spessasynth_core';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import type { ChannelState } from '../state/mixer';
import { effectiveMute } from '../state/mixer';
import type { SystemMode } from '../state/settings';
export { DEFAULT_SOUNDFONT_ID, DEFAULT_SOUNDFONT_URL, fetchWithProgress } from './constants';

export interface EngineOptions {
  latencyHint: AudioContextLatencyCategory;
  voiceCap: number;
}

export interface MidiOutLike {
  id: string;
  send(data: number[] | Uint8Array): void;
}

const SYSEX_RESETS: Record<Exclude<SystemMode, 'auto'>, number[]> = {
  gm: [0x7e, 0x7f, 0x09, 0x01, 0xf7],
  gm2: [0x7e, 0x7f, 0x09, 0x03, 0xf7],
  gs: [0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7],
  xg: [0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7],
};

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly synth: WorkletSynthesizer;
  readonly seq: Sequencer;
  readonly fadeGain: GainNode;
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly analyser: AnalyserNode;
  readonly channelAnalysers: AnalyserNode[] = [];
  private readonly meterBuf = new Float32Array(512);
  private routes: Record<number, string> = {};
  private outputs = new Map<string, MidiOutLike>();
  private externalMode = false;
  private mixer: ChannelState[] = [];

  private constructor(ctx: AudioContext, opts: EngineOptions) {
    this.ctx = ctx;
    this.synth = new WorkletSynthesizer(ctx, { eventsEnabled: true });
    this.fadeGain = ctx.createGain();
    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.75;
    this.synth.connect(this.fadeGain);
    this.fadeGain.connect(this.master);
    this.master.connect(this.limiter);
    this.limiter.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    this.setLimiter(true);
    for (let i = 0; i < 16; i++) {
      const a = ctx.createAnalyser();
      a.fftSize = 512;
      this.channelAnalysers.push(a);
    }
    this.synth.connectIndividualOutputs(this.channelAnalysers);
    this.synth.setSystemParameter('voiceCap', opts.voiceCap);
    this.seq = new Sequencer(this.synth, { skipToFirstNoteOn: false });
    this.seq.loopCount = 0;
  }

  static async create(opts: EngineOptions): Promise<AudioEngine> {
    const ctx = new AudioContext({ latencyHint: opts.latencyHint });
    await ctx.audioWorklet.addModule(processorUrl);
    return new AudioEngine(ctx, opts);
  }

  async addSoundBank(buffer: ArrayBuffer, id: string, bankOffset = 0) {
    await this.synth.soundBankManager.addSoundBank(buffer, id, bankOffset);
    await this.synth.isReady;
  }

  async removeSoundBank(id: string) {
    await this.synth.soundBankManager.deleteSoundBank(id);
  }

  setBankPriority(ids: string[]) {
    const present = new Set(this.synth.soundBankManager.priorityOrder);
    const order = ids.filter((i) => present.has(i));
    for (const id of present) if (!order.includes(id)) order.push(id);
    this.synth.soundBankManager.priorityOrder = order;
  }

  get bankIds(): string[] {
    return this.synth.soundBankManager.priorityOrder;
  }

  get presets(): MIDIPatchFull[] {
    return this.synth.presetList;
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  // ---- 全体設定
  setVolume(v: number) {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }
  setLimiter(on: boolean) {
    const l = this.limiter;
    if (on) {
      l.threshold.value = -3;
      l.knee.value = 0;
      l.ratio.value = 20;
      l.attack.value = 0.002;
      l.release.value = 0.12;
    } else {
      l.threshold.value = 0;
      l.knee.value = 0;
      l.ratio.value = 1;
    }
  }
  setReverb(v: number) {
    this.synth.setSystemParameter('reverbGain', v);
  }
  setChorus(v: number) {
    this.synth.setSystemParameter('chorusGain', v);
  }
  setTranspose(semitones: number) {
    this.synth.setSystemParameter('keyShift', semitones);
  }
  setA4(hz: number) {
    this.synth.setSystemParameter('fineTune', 1200 * Math.log2(hz / 440));
  }
  setVoiceCap(n: number) {
    this.synth.setSystemParameter('voiceCap', n);
  }
  setBlackMIDIMode(on: boolean) {
    this.synth.setSystemParameter('blackMIDIMode', on);
  }
  setSystemMode(mode: SystemMode) {
    this.synth.lockMIDIParameter('system', false);
    if (mode !== 'auto') {
      this.synth.systemExclusive(SYSEX_RESETS[mode]);
      this.synth.lockMIDIParameter('system', true);
    }
  }
  setPlaybackRate(r: number) {
    this.seq.playbackRate = r;
  }
  fadeTo(value: number, seconds: number) {
    const g = this.fadeGain.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    if (seconds <= 0) g.setValueAtTime(value, now);
    else g.linearRampToValueAtTime(value, now + seconds);
  }

  // ---- チャンネル
  get channelCount() {
    return this.synth.channelCount;
  }

  applyMixer(mixer: ChannelState[], prev?: ChannelState[]) {
    this.mixer = mixer;
    const n = Math.min(this.synth.channelCount, mixer.length);
    const anySoloChanged = !prev || prev.some((c, i) => c.solo !== mixer[i]?.solo);
    for (let ch = 0; ch < n; ch++) {
      const c = mixer[ch];
      const p = prev?.[ch];
      const chan = this.synth.midiChannels[ch];
      if (!chan) continue;
      if (!p || anySoloChanged || p.mute !== c.mute)
        chan.setSystemParameter('isMuted', effectiveMute(mixer, ch));
      if (!p || p.gain !== c.gain) chan.setSystemParameter('gain', c.gain);
      if (!p || p.pan !== c.pan) chan.setSystemParameter('pan', c.pan);
      if (!p || p.transpose !== c.transpose) chan.setSystemParameter('keyShift', c.transpose);
      if (!p || p.reverb !== c.reverb) this.lockedCC(ch, 91, c.reverb);
      if (!p || p.chorus !== c.chorus) this.lockedCC(ch, 93, c.chorus);
      if (!p || p.drum !== c.drum) {
        if (c.drum !== null) chan.setDrums(c.drum);
        else if (p && p.drum !== null) chan.setDrums(ch % 16 === 9);
      }
      if (!p || JSON.stringify(p.program) !== JSON.stringify(c.program)) this.applyProgram(ch, c);
    }
  }

  private lockedCC(ch: number, cc: number, value: number) {
    const chan = this.synth.midiChannels[ch];
    chan.lockController(cc as any, false);
    if (value >= 0) {
      this.synth.controllerChange(ch, cc as any, value);
      chan.lockController(cc as any, true);
    }
  }

  private applyProgram(ch: number, c: ChannelState) {
    const chan = this.synth.midiChannels[ch];
    chan.setSystemParameter('presetLock', false);
    if (!c.program) return;
    const p = c.program;
    if (p.isDrum) chan.setDrums(true);
    else if (c.drum === null && ch % 16 === 9) chan.setDrums(false);
    this.synth.controllerChange(ch, 0 as any, p.bankMSB);
    this.synth.controllerChange(ch, 32 as any, p.bankLSB);
    this.synth.programChange(ch, p.program);
    chan.setSystemParameter('presetLock', true);
  }

  /** チャンネルのピークレベル（0..1+）。16 チャンネルを超える場合は折り返し */
  channelLevel(ch: number): number {
    const a = this.channelAnalysers[ch % 16];
    a.getFloatTimeDomainData(this.meterBuf);
    let peak = 0;
    for (let i = 0; i < this.meterBuf.length; i++) {
      const v = Math.abs(this.meterBuf[i]);
      if (v > peak) peak = v;
    }
    return peak;
  }

  channelVoices(ch: number): number {
    return this.synth.midiChannels[ch]?.voiceCount ?? 0;
  }

  // ---- 外部 MIDI 出力ルーティング
  setOutputs(outputs: MidiOutLike[]) {
    this.outputs = new Map(outputs.map((o) => [o.id, o]));
  }

  setRouting(external: boolean, routes: Record<number, string>, defaultOutputId: string) {
    this.routes = { ...routes };
    const usesExternal =
      external &&
      (Object.values(routes).some((r) => r && r !== 'internal' && this.outputs.has(r)) ||
        this.outputs.has(defaultOutputId));
    if (usesExternal) {
      const def = this.outputs.has(defaultOutputId) ? defaultOutputId : 'internal';
      for (let ch = 0; ch < 16; ch++) if (!this.routes[ch]) this.routes[ch] = def;
    }
    if (usesExternal !== this.externalMode) {
      this.externalMode = usesExternal;
      this.synth.stopAll(true);
      if (usesExternal) this.seq.connectMIDIOutput({ send: (d) => this.route(d) });
      else this.seq.connectMIDIOutput(undefined);
    }
  }

  get isExternal() {
    return this.externalMode;
  }

  private route(data: number[]) {
    const status = data[0];
    if (status >= 0xf0) {
      // システムメッセージは使用中の全出力へ
      const used = new Set(Object.values(this.routes));
      for (const id of used) {
        if (id === 'internal') this.synth.sendMessage(data);
        else this.outputs.get(id)?.send(data);
      }
      return;
    }
    const ch = status & 0x0f;
    const type = status & 0xf0;
    if (type === 0x90 && data[2] > 0 && this.mixer.length && effectiveMute(this.mixer, ch)) return;
    let out = data;
    const c = this.mixer[ch];
    if (c && (type === 0x90 || type === 0x80 || type === 0xa0) && (c.transpose || 0) !== 0 && ch !== 9) {
      const k = data[1] + c.transpose;
      if (k < 0 || k > 127) return;
      out = [data[0], k, data[2]];
    }
    const id = this.routes[ch] ?? 'internal';
    if (id === 'internal') this.synth.sendMessage(out);
    else this.outputs.get(id)?.send(out);
  }

  /** 外部出力へ GM/GS/XG リセットを送る */
  sendResetToExternal(mode: Exclude<SystemMode, 'auto'>) {
    for (const o of this.outputs.values()) o.send([0xf0, ...SYSEX_RESETS[mode]]);
  }

  /** 全外部出力へ All Notes Off */
  panicExternal() {
    for (const o of this.outputs.values()) {
      for (let ch = 0; ch < 16; ch++) {
        o.send([0xb0 | ch, 123, 0]);
        o.send([0xb0 | ch, 120, 0]);
      }
    }
  }

  // ---- 負荷監視（対応ブラウザのみ）
  monitorCapacity(cb: (load: number, underrun: number) => void) {
    const rc = (this.ctx as any).renderCapacity;
    if (!rc || typeof rc.start !== 'function') return false;
    try {
      rc.addEventListener('update', (e: any) => cb(e.peakLoad ?? e.averageLoad ?? 0, e.underrunRatio ?? 0));
      rc.start({ updateInterval: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async getSnapshot() {
    return this.synth.getSnapshot();
  }

  async close() {
    try {
      this.synth.destroy();
    } catch {}
    await this.ctx.close();
  }
}
