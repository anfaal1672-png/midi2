import { BasicMIDI, MIDIMessage, type MIDIPatch } from 'spessasynth_core';

export interface ChannelEdit {
  mute?: boolean;
  transpose?: number;
  patch?: MIDIPatch;
}

export interface MidiEdits {
  /** 全体移調（ドラム以外） */
  transpose: number;
  /** テンポ倍率（2 = 2 倍速） */
  tempoRate: number;
  channels: Map<number, ChannelEdit>;
  drumChannels: Set<number>;
}

/** テンポ情報を倍率で書き換える（in-place） */
export function scaleTempo(mid: BasicMIDI, rate: number): void {
  if (!(rate > 0) || rate === 1) return;
  let hasTempoAtZero = false;
  for (const track of mid.tracks) {
    for (const e of track.events) {
      if ((e.statusByte as number) === 0x51 && e.data.length >= 3) {
        if (e.ticks === 0) hasTempoAtZero = true;
        const us = (e.data[0] << 16) | (e.data[1] << 8) | e.data[2];
        const scaled = Math.max(1, Math.min(0xffffff, Math.round(us / rate)));
        e.data[0] = (scaled >> 16) & 0xff;
        e.data[1] = (scaled >> 8) & 0xff;
        e.data[2] = scaled & 0xff;
      }
    }
  }
  if (!hasTempoAtZero && mid.tracks.length) {
    const us = Math.round(500000 / rate);
    const msg = new MIDIMessage(
      0,
      0x51 as any,
      new Uint8Array([(us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]),
    );
    mid.tracks[0].addEvents(0, msg);
  }
}

/** 編集を反映したコピーを作り、SMF のバイナリを返す */
export function exportEditedMIDI(source: BasicMIDI, edits: MidiEdits): ArrayBuffer {
  const mid = BasicMIDI.copyFrom(source);
  const channelMods = new Map<number, any>();
  const allChannels = new Set<number>([...edits.channels.keys()]);
  if (edits.transpose) {
    for (const t of mid.tracks) for (const c of t.channels) allChannels.add(c);
  }
  for (const ch of allChannels) {
    const e = edits.channels.get(ch) ?? {};
    if (e.mute) {
      channelMods.set(ch, 'clear');
      continue;
    }
    const mod: Record<string, unknown> = {};
    const shift = (e.transpose ?? 0) + (edits.drumChannels.has(ch) ? 0 : edits.transpose);
    if (shift) mod.keyShift = shift;
    if (e.patch) mod.patch = e.patch;
    if (Object.keys(mod).length) channelMods.set(ch, mod);
  }
  if (channelMods.size) mid.modify({ channels: channelMods });
  scaleTempo(mid, edits.tempoRate);
  mid.flush(true);
  return mid.writeMIDI();
}
