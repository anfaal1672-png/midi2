/** スナップショット方式の Undo/Redo */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(private readonly limit = 100) {}

  push(snapshot: T) {
    const last = this.past[this.past.length - 1];
    if (last !== undefined && JSON.stringify(last) === JSON.stringify(snapshot)) return;
    this.past.push(snapshot);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /** current を future に積んで 1 つ前を返す */
  undo(current: T): T | undefined {
    if (this.past.length < 2) return undefined;
    const top = this.past.pop()!;
    this.future.push(current ?? top);
    return this.past[this.past.length - 1];
  }

  redo(): T | undefined {
    const next = this.future.pop();
    if (next !== undefined) this.past.push(next);
    return next;
  }

  get canUndo() {
    return this.past.length >= 2;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  clear() {
    this.past = [];
    this.future = [];
  }
}
