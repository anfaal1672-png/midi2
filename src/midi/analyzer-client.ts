import type { SongAnalysis } from './types';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (a: SongAnalysis) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/analyze.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, ok, analysis, error } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (ok) p.resolve(analysis);
      else p.reject(new Error(error));
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'Worker error'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/** MIDI を Worker で解析する（buffer はコピーして渡すので呼び出し側の buffer はそのまま使える） */
export function analyzeInWorker(buffer: ArrayBuffer, fileName: string): Promise<SongAnalysis> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    const copy = buffer.slice(0);
    getWorker().postMessage({ id, buffer: copy, fileName }, [copy]);
  });
}
