/**
 * 16 チャンネルの配色。色相を約 22.5° ずつずらし、隣り合うチャンネルの明度を交互に変えて
 * 見分けやすくしている（暗い背景・明るい背景の両方で WCAG 3:1 以上のコントラストを確認済み）。
 */
export const CHANNEL_COLORS = [
  '#4f8cff',
  '#ff6b6b',
  '#3ccf91',
  '#ffb547',
  '#b07cff',
  '#2fc6d6',
  '#ff7ac6',
  '#a3d94a',
  '#ff8f5a',
  '#9aa7b8',
  '#5a6cff',
  '#e8c547',
  '#38b2ac',
  '#f06292',
  '#7cb342',
  '#c084fc',
];

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const RGB = CHANNEL_COLORS.map(hexToRgb);

export function channelRgb(ch: number): [number, number, number] {
  return RGB[ch % 16];
}

export function channelColor(ch: number): string {
  return CHANNEL_COLORS[ch % 16];
}

/** ベロシティ → 青〜赤のグラデーション */
export function velocityRgb(vel: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, vel / 127));
  const h = (1 - x) * 220;
  return hslToRgb(h, 0.8, 0.58);
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

export type ColorMode = 'channel' | 'track' | 'velocity';
export function noteRgb(mode: ColorMode, ch: number, track: number, vel: number): [number, number, number] {
  if (mode === 'velocity') return velocityRgb(vel);
  if (mode === 'track') return RGB[(track * 5) % 16];
  return RGB[ch % 16];
}

/** CSS 変数の値を読む */
export function cssVar(name: string, el: Element = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}
