export interface ProgramOverride {
  program: number;
  bankMSB: number;
  bankLSB: number;
  isDrum: boolean;
  name: string;
}

export interface ChannelState {
  mute: boolean;
  solo: boolean;
  gain: number; // 0..2
  pan: number; // -1..1
  reverb: number; // -1 = 曲の指定どおり, 0..127
  chorus: number; // -1 = 曲の指定どおり, 0..127
  transpose: number; // -24..24
  program: ProgramOverride | null;
  drum: boolean | null; // null = 曲の指定どおり
}

export const MAX_CHANNELS = 64;

export const defaultChannel = (): ChannelState => ({
  mute: false,
  solo: false,
  gain: 1,
  pan: 0,
  reverb: -1,
  chorus: -1,
  transpose: 0,
  program: null,
  drum: null,
});

export const defaultMixer = (): ChannelState[] => Array.from({ length: MAX_CHANNELS }, defaultChannel);

/** ソロを考慮した実効ミュート */
export function effectiveMute(mixer: ChannelState[], ch: number): boolean {
  const anySolo = mixer.some((c) => c.solo);
  const c = mixer[ch];
  if (!c) return false;
  return c.mute || (anySolo && !c.solo);
}

export type MixerPreset = 'all' | 'melody' | 'noDrums' | 'drumsOnly' | 'bassOnly';

/** ワンタップのプリセット。drumChannels と melodyChannel は解析結果から渡す */
export function applyPreset(
  mixer: ChannelState[],
  preset: MixerPreset,
  info: { used: number[]; drums: number[]; melody: number | null; bass: number | null },
): ChannelState[] {
  const next = mixer.map((c) => ({ ...c, solo: false, mute: false }));
  const drums = new Set(info.drums);
  for (const ch of info.used) {
    const c = next[ch];
    switch (preset) {
      case 'melody':
        c.mute = ch !== info.melody;
        break;
      case 'noDrums':
        c.mute = drums.has(ch);
        break;
      case 'drumsOnly':
        c.mute = !drums.has(ch);
        break;
      case 'bassOnly':
        c.mute = ch !== info.bass;
        break;
    }
  }
  return next;
}
