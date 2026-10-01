import { signal } from '@preact/signals';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';
export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  action?: { label: string; run: () => void };
  timeout: number;
}
export interface LogEntry {
  time: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  text: string;
}

export const toasts = signal<Toast[]>([]);
export const logs = signal<LogEntry[]>([]);
let tid = 0;

export function toast(
  text: string,
  kind: ToastKind = 'info',
  opts: { timeout?: number; action?: Toast['action'] } = {},
) {
  const id = ++tid;
  const timeout = opts.timeout ?? (kind === 'error' ? 8000 : 4000);
  toasts.value = [...toasts.value.slice(-4), { id, kind, text, action: opts.action, timeout }];
  if (timeout > 0) setTimeout(() => dismissToast(id), timeout);
  log(kind === 'success' ? 'info' : kind === 'warn' ? 'warn' : kind === 'error' ? 'error' : 'info', text);
  return id;
}

export function dismissToast(id: number) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

export function log(level: LogEntry['level'], text: string) {
  const next = logs.value.length > 500 ? logs.value.slice(-400) : logs.value.slice();
  next.push({ time: Date.now(), level, text });
  logs.value = next;
  if (level === 'error') console.error('[midi]', text);
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
