import { useEffect, useRef } from 'preact/hooks';
import { cssVar, hexToRgb } from './colors';

export interface Theme {
  bg: [number, number, number];
  grid: [number, number, number];
  gridStrong: [number, number, number];
  keyWhite: string;
  keyBlack: string;
  text: string;
  muted: string;
  accent: string;
  accentRgb: [number, number, number];
  laneDark: [number, number, number];
}

function parseColor(c: string, fallback: [number, number, number]): [number, number, number] {
  if (c.startsWith('#')) return hexToRgb(c);
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (m) {
    const p = m[1].split(/[ ,/]+/).map(Number);
    return [p[0], p[1], p[2]];
  }
  return fallback;
}

export function readTheme(): Theme {
  const accent = cssVar('--accent') || '#4f8cff';
  return {
    bg: parseColor(cssVar('--canvas-bg'), [14, 17, 22]),
    grid: parseColor(cssVar('--canvas-grid'), [40, 46, 56]),
    gridStrong: parseColor(cssVar('--canvas-grid-strong'), [70, 78, 92]),
    laneDark: parseColor(cssVar('--canvas-lane'), [20, 24, 30]),
    keyWhite: cssVar('--key-white') || '#f4f5f7',
    keyBlack: cssVar('--key-black') || '#1b1e24',
    text: cssVar('--text') || '#e6e8eb',
    muted: cssVar('--text-muted') || '#8a93a3',
    accent,
    accentRgb: parseColor(accent, [79, 140, 255]),
  };
}

export type DrawFn = (ctx: { w: number; h: number; dpr: number; now: number; theme: Theme }) => void;

/**
 * キャンバスのサイズ追従と rAF ループ。
 * setup はサイズ変更時に呼ばれる（レンダラーの resize 用）。
 */
export function useCanvasLoop(
  ref: { current: HTMLElement | null },
  draw: DrawFn,
  setup?: (w: number, h: number, dpr: number) => void,
  /** 描画に影響する値の一覧。前フレームと同じなら描画を省略する（停止中の CPU/GPU 負荷を抑える） */
  signature?: () => unknown[],
) {
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const setupRef = useRef(setup);
  setupRef.current = setup;
  const sigRef = useRef(signature);
  sigRef.current = signature;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let w = 0;
    let h = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let theme = readTheme();
    let raf = 0;
    let visible = true;
    let lastSig: unknown[] | null = null;
    let lastKey = '';
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      w = Math.max(1, Math.floor(r.width));
      h = Math.max(1, Math.floor(r.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      setupRef.current?.(w, h, dpr);
      lastSig = null;
    });
    ro.observe(el);
    const io = new IntersectionObserver((entries) => (visible = entries.some((e) => e.isIntersecting)));
    io.observe(el);
    const mo = new MutationObserver(() => {
      theme = readTheme();
      lastSig = null;
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'style', 'class'],
    });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () =>
      setTimeout(() => {
        theme = readTheme();
        lastSig = null;
      }, 0);
    mq.addEventListener('change', onScheme);
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || w === 0 || document.hidden) return;
      const sig = sigRef.current?.();
      const key = `${w}x${h}@${dpr}`;
      if (
        sig &&
        lastSig &&
        key === lastKey &&
        sig.length === lastSig.length &&
        sig.every((v, i) => Object.is(v, lastSig![i]))
      ) {
        return;
      }
      lastSig = sig ?? null;
      lastKey = key;
      drawRef.current({ w, h, dpr, now, theme });
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      mq.removeEventListener('change', onScheme);
    };
  }, [ref]);
}
