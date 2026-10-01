import { MIDIBuilder } from 'spessasynth_core';

export interface RecordedEvent {
  /** 録音開始からのミリ秒 */
  ms: number;
  data: number[];
}

/** 録音したリアルタイム MIDI を SMF (format 0 相当) に変換する */
export function recordingToSMF(events: RecordedEvent[], bpm = 120, name = 'Recording'): ArrayBuffer {
  const ppq = 480;
  const m = new MIDIBuilder({ timeDivision: ppq, initialTempo: bpm, format: 1, name });
  m.addTrack('Performance');
  const ticksPerMs = (ppq * bpm) / 60000;
  for (const e of events) {
    const tick = Math.max(0, Math.round(e.ms * ticksPerMs));
    const status = e.data[0];
    if (status < 0x80 || status >= 0xf0) continue;
    m.addEvent(tick, 1, status as any, e.data.slice(1));
  }
  m.flush();
  return m.writeMIDI();
}
