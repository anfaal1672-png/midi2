/// <reference lib="webworker" />
import { BasicMIDI } from 'spessasynth_core';
import { analyzeMIDI, analysisTransferables } from '../midi/analyze';

interface Req {
  id: number;
  buffer: ArrayBuffer;
  fileName: string;
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, buffer, fileName } = e.data;
  try {
    const mid = BasicMIDI.fromArrayBuffer(buffer, fileName);
    const analysis = analyzeMIDI(mid, fileName);
    (self as unknown as Worker).postMessage({ id, ok: true, analysis }, analysisTransferables(analysis));
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
