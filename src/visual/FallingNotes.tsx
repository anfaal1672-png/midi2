import { useMemo, useRef } from 'preact/hooks';
import { analysis, mixer, settings } from '../state/store';
import { liveNoteOff, liveNoteOn, liveNotes, playhead } from '../audio/player';
import { createRectRenderer, type RectRenderer } from './rects';
import { useCanvasLoop } from './useCanvas';
import { channelView, getNoteIndex, keyRange } from './common';
import { noteRgb } from './colors';
import { isBlackKey, noteName } from '../midi/gm';
import { barIndexAt } from '../midi/analyze';
import { t } from '../ui/i18n';

interface KeyGeom {
  x: number;
  w: number;
  black: boolean;
}

export function keyboardLayout(lo: number, hi: number, width: number): Map<number, KeyGeom> {
  const whites: number[] = [];
  for (let k = lo; k <= hi; k++) if (!isBlackKey(k)) whites.push(k);
  const ww = width / Math.max(1, whites.length);
  const map = new Map<number, KeyGeom>();
  let wi = 0;
  for (let k = lo; k <= hi; k++) {
    if (!isBlackKey(k)) {
      map.set(k, { x: wi * ww, w: ww, black: false });
      wi++;
    } else {
      const bw = ww * 0.6;
      map.set(k, { x: wi * ww - bw / 2, w: bw, black: true });
    }
  }
  return map;
}

const reduceMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function FallingNotes() {
  const wrap = useRef<HTMLDivElement>(null);
  const glCanvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<RectRenderer | null>(null);
  const pressed = useRef(new Map<number, number>());
  const a = analysis.value;
  const m = mixer.value;
  const s = settings.value;
  const cv = useMemo(() => (a ? channelView(a, m, s.transpose) : null), [a, m, s.transpose]);
  const geomRef = useRef<{ lo: number; hi: number; keys: Map<number, KeyGeom>; kbTop: number; w: number }>(
    null,
  );

  const rangeFor = (w: number): [number, number] => {
    if (w >= 760 || !a || !cv) return [21, 108];
    const [lo, hi] = keyRange(a, cv, 36);
    return [Math.max(0, lo - (lo % 12)), Math.min(127, hi + (11 - (hi % 12)))];
  };

  useCanvasLoop(
    wrap,
    ({ w, h, dpr, theme }) => {
      const r = renderer.current;
      const ov = overlay.current?.getContext('2d');
      if (!r || !ov) return;
      const an = analysis.value;
      const [lo, hi] = rangeFor(w);
      let g = geomRef.current;
      if (!g || g.lo !== lo || g.hi !== hi || g.w !== w) {
        g = { lo, hi, keys: keyboardLayout(lo, hi, w), kbTop: 0, w };
        geomRef.current = g;
      }
      const whiteW = w / [...g.keys.values()].filter((k) => !k.black).length;
      const kbH = Math.min(h * 0.22, Math.max(48, whiteW * 5.2));
      const kbTop = h - kbH;
      g.kbTop = kbTop;
      const speed = settings.value.fallingSpeed;
      const now = playhead();
      const pxPerSec = kbTop / speed;
      const yOf = (sec: number) => kbTop - (sec - now) * pxPerSec;
      const bg = theme.bg;
      r.begin([bg[0] / 255, bg[1] / 255, bg[2] / 255, 1]);
      // オクターブ区切りの縦線
      for (const [k, kg] of g.keys) {
        if (k % 12 === 0) r.rect(kg.x, 0, 1, kbTop, theme.grid[0], theme.grid[1], theme.grid[2], 0.8);
      }
      const active = new Map<number, number>();
      if (an && cv) {
        // 小節線
        const bars = an.bars;
        const endT = now + speed;
        for (let i = Math.max(0, barIndexAt(bars, now)); i < bars.length && bars[i] <= endT; i++) {
          const y = yOf(bars[i]);
          r.rect(0, y, w, 1, theme.gridStrong[0], theme.gridStrong[1], theme.gridStrong[2], 0.6);
        }
        const n = an.notes;
        const mode = settings.value.colorBy;
        getNoteIndex(an).forEach(now - 0.05, endT, (i) => {
          const ch = n.ch[i];
          const k = n.key[i] + cv.shift[ch];
          const kg = g!.keys.get(k);
          if (!kg) return;
          const y0 = yOf(n.end[i]);
          const y1 = Math.min(kbTop, yOf(n.start[i]));
          if (y1 <= 0) return;
          const [cr, cg, cb] = noteRgb(mode, ch, n.track[i], n.vel[i]);
          const muted = cv.muted[ch];
          const dark = kg.black ? 0.78 : 1;
          const pad = kg.w * 0.08;
          r.rect(
            kg.x + pad,
            Math.max(0, y0),
            kg.w - pad * 2,
            Math.max(3, y1 - Math.max(0, y0) - 1),
            cr * dark,
            cg * dark,
            cb * dark,
            muted ? 0.2 : 0.95,
          );
          if (!muted && n.start[i] <= now && n.end[i] > now) active.set(k, ch);
        });
      }
      for (const key of liveNotes.keys()) active.set(key % 128, Math.floor(key / 128));
      // ヒット時の光
      if (!reduceMotion()) {
        for (const [k, ch] of active) {
          const kg = g.keys.get(k);
          if (!kg) continue;
          const [cr, cg, cb] = noteRgb('channel', ch, 0, 100);
          for (let i = 0; i < 6; i++) {
            const hh = 10 + i * 8;
            r.rect(kg.x - i, kbTop - hh, kg.w + i * 2, hh, cr, cg, cb, 0.05);
          }
        }
      }
      r.end();

      // ---- 鍵盤
      const ow = Math.round(w * dpr);
      const oh = Math.round(h * dpr);
      if (overlay.current!.width !== ow || overlay.current!.height !== oh) {
        overlay.current!.width = ow;
        overlay.current!.height = oh;
      }
      ov.setTransform(dpr, 0, 0, dpr, 0, 0);
      ov.clearRect(0, 0, w, h);
      ov.fillStyle = theme.accent;
      ov.fillRect(0, kbTop - 3, w, 3);
      const drawKey = (k: number, kg: KeyGeom) => {
        const ch = active.get(k) ?? pressed.current.get(k);
        const kh = kg.black ? kbH * 0.62 : kbH;
        if (ch !== undefined) {
          const [cr, cg, cb] = noteRgb('channel', ch, 0, 100);
          ov.fillStyle = `rgb(${cr},${cg},${cb})`;
        } else ov.fillStyle = kg.black ? theme.keyBlack : theme.keyWhite;
        ov.fillRect(kg.x + (kg.black ? 0 : 0.5), kbTop, kg.w - (kg.black ? 0 : 1), kh);
        if (!kg.black) {
          ov.fillStyle = 'rgba(0,0,0,0.25)';
          ov.fillRect(kg.x + kg.w - 0.5, kbTop, 0.5, kh);
          if (k % 12 === 0 && kg.w >= 9) {
            ov.fillStyle = '#7a8090';
            ov.font = `${Math.min(10, kg.w * 0.7)}px system-ui, sans-serif`;
            ov.textAlign = 'center';
            ov.fillText(noteName(k), kg.x + kg.w / 2, kbTop + kh - 5);
            ov.textAlign = 'left';
          }
        }
      };
      for (const [k, kg] of g.keys) if (!kg.black) drawKey(k, kg);
      for (const [k, kg] of g.keys) if (kg.black) drawKey(k, kg);
      if (!an) {
        ov.fillStyle = theme.muted;
        ov.font = '14px system-ui, sans-serif';
        ov.textAlign = 'center';
        ov.fillText(t('visual.emptyFalling'), w / 2, kbTop / 2);
        ov.textAlign = 'left';
      }
    },
    (w, h, dpr) => {
      if (!renderer.current && glCanvas.current) renderer.current = createRectRenderer(glCanvas.current);
      renderer.current?.resize(w, h, dpr);
    },
    () => [playhead(), settings.value, analysis.value, cv, liveNotes.size, pressed.current.size],
  );

  // 鍵盤をクリック / タッチで演奏
  const keyAt = (ev: PointerEvent): number | null => {
    const g = geomRef.current;
    if (!g) return null;
    const rect = wrap.current!.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    if (y < g.kbTop) return null;
    const kbH = rect.height - g.kbTop;
    if (y < g.kbTop + kbH * 0.62) {
      for (const [k, kg] of g.keys) if (kg.black && x >= kg.x && x < kg.x + kg.w) return k;
    }
    for (const [k, kg] of g.keys) if (!kg.black && x >= kg.x && x < kg.x + kg.w) return k;
    return null;
  };
  const down = (ev: PointerEvent) => {
    const k = keyAt(ev);
    if (k === null) return;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    pressed.current.set(k, 0);
    liveNoteOn(0, k, 100);
    (ev.currentTarget as any)._key = k;
  };
  const move = (ev: PointerEvent) => {
    const cur = (ev.currentTarget as any)._key;
    if (cur === undefined || cur === null) return;
    const k = keyAt(ev);
    if (k !== null && k !== cur) {
      liveNoteOff(0, cur);
      pressed.current.delete(cur);
      pressed.current.set(k, 0);
      liveNoteOn(0, k, 100);
      (ev.currentTarget as any)._key = k;
    }
  };
  const up = (ev: PointerEvent) => {
    const cur = (ev.currentTarget as any)._key;
    if (cur !== undefined && cur !== null) {
      liveNoteOff(0, cur);
      pressed.current.delete(cur);
    }
    (ev.currentTarget as any)._key = null;
  };

  return (
    <div
      class="viz-canvas-wrap"
      ref={wrap}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      role="img"
      aria-label={t('visual.falling')}
    >
      <canvas ref={glCanvas} class="layer" />
      <canvas ref={overlay} class="layer" />
    </div>
  );
}
