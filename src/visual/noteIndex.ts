import type { NoteTable } from '../midi/types';

/** 可視範囲検索用の索引。runMaxEnd[i] = max(end[0..i]) は単調増加なので二分探索できる */
export class NoteIndex {
  readonly runMaxEnd: Float64Array;
  constructor(readonly notes: NoteTable) {
    const n = notes.count;
    this.runMaxEnd = new Float64Array(n);
    let m = -Infinity;
    for (let i = 0; i < n; i++) {
      if (notes.end[i] > m) m = notes.end[i];
      this.runMaxEnd[i] = m;
    }
  }

  /** end > t0 となりうる最初のインデックス */
  private firstCandidate(t0: number): number {
    let lo = 0;
    let hi = this.notes.count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.runMaxEnd[mid] > t0) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  /** [t0, t1) と重なるノートを列挙する */
  forEach(t0: number, t1: number, cb: (i: number) => void, limit = 200000) {
    const { start, end, count } = this.notes;
    let n = 0;
    for (let i = this.firstCandidate(t0); i < count; i++) {
      if (start[i] >= t1) break;
      if (end[i] > t0) {
        cb(i);
        if (++n >= limit) break;
      }
    }
  }

  /** 時刻 t に発音中のノート */
  activeAt(t: number, cb: (i: number) => void) {
    this.forEach(t, t + 1e-6, cb, 4096);
  }
}
