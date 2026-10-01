import { useMemo, useRef, useState } from 'preact/hooks';
import { abLoop, analysis, mixer, patchSettings, settings } from '../state/store';
import { liveNotes, playhead, seek } from '../audio/player';
import { createRectRenderer, type RectRenderer } from './rects';
import { useCanvasLoop } from './useCanvas';
import { channelView, formatTime, getNoteIndex, keyRange } from './common';
import { noteRgb } from './colors';
import { isBlackKey, noteName } from '../midi/gm';
import { barIndexAt } from '../midi/analyze';
import { t } from '../ui/i18n';

const KEY_W = 46;
const RULER = 22;

interface Hover {
  x: number;
  y: number;
  text: string;
}

export function PianoRoll() {
  const wrap = useRef<HTMLDivElement>(null);
  const glCanvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<RectRenderer | null>(null);
  const view = useRef({ start: 0, dragging: false, dragX: 0, dragStart: 0, moved: false });
  const [hover, setHover] = useState<Hover | null>(null);
  const a = analysis.value;
  const s = settings.value;
  const m = mixer.value;
  const cv = useMemo(() => (a ? channelView(a, m, s.transpose) : null), [a, m, s.transpose]);
  const range = useMemo(() => (a && cv ? keyRange(a, cv) : ([36, 96] as [number, number])), [a, cv]);

  const layout = (w: number, h: number) => {
    const rows = range[1] - range[0] + 1;
    const rowH = (h - RULER) / rows;
    const zoom = settings.value.rollZoom;
    let start = view.current.start;
    if (settings.value.rollFollow && !view.current.dragging) {
      start = playhead() - ((w - KEY_W) * 0.25) / zoom;
      view.current.start = start;
    }
    return { rows, rowH, zoom, start, end: start + (w - KEY_W) / zoom };
  };

  useCanvasLoop(
    wrap,
    ({ w, h, dpr, theme }) => {
      const r = renderer.current;
      const ov = overlay.current?.getContext('2d');
      if (!r || !ov) return;
      const an = analysis.value;
      const { rowH, zoom, start, end } = layout(w, h);
      const [lo, hi] = range;
      const keyY = (k: number) => RULER + (hi - k) * rowH;
      const x = (sec: number) => KEY_W + (sec - start) * zoom;
      const bg = theme.bg;
      r.begin([bg[0] / 255, bg[1] / 255, bg[2] / 255, 1]);
      // 黒鍵レーン
      const ld = theme.laneDark;
      for (let k = lo; k <= hi; k++) {
        if (isBlackKey(k)) r.rect(KEY_W, keyY(k), w - KEY_W, rowH, ld[0], ld[1], ld[2], 1);
        if (k % 12 === 0)
          r.rect(KEY_W, keyY(k) + rowH - 1, w - KEY_W, 1, theme.grid[0], theme.grid[1], theme.grid[2], 1);
      }
      const now = playhead();
      if (an && cv) {
        // A-B ループ範囲
        const l = abLoop.value;
        if (l.a !== null && l.b !== null) {
          const ar = theme.accentRgb;
          r.rect(x(l.a), RULER, (l.b - l.a) * zoom, h - RULER, ar[0], ar[1], ar[2], l.enabled ? 0.12 : 0.05);
        }
        // 小節線・拍線
        const bars = an.bars;
        const g = theme.grid;
        const gs = theme.gridStrong;
        const firstBar = Math.max(0, barIndexAt(bars, start) - 1);
        for (let i = firstBar; i < bars.length && bars[i] < end; i++) {
          const bx = x(bars[i]);
          r.rect(bx, RULER, 1, h - RULER, gs[0], gs[1], gs[2], 1);
          const nextBar = bars[i + 1] ?? an.duration;
          const sig = an.timeSigs.filter((ts) => ts.sec <= bars[i] + 1e-6).pop();
          const beats = sig?.num ?? 4;
          const beatW = (nextBar - bars[i]) / beats;
          if (beatW * zoom > 12) {
            for (let b = 1; b < beats; b++)
              r.rect(x(bars[i] + b * beatW), RULER, 1, h - RULER, g[0], g[1], g[2], 1);
          }
        }
        // ノート
        const idx = getNoteIndex(an);
        const n = an.notes;
        const mode = settings.value.colorBy;
        idx.forEach(start, end, (i) => {
          const ch = n.ch[i];
          const k = n.key[i] + cv.shift[ch];
          if (k < lo || k > hi) return;
          const x0 = x(n.start[i]);
          const wN = Math.max(2, (n.end[i] - n.start[i]) * zoom - 1);
          const [cr, cg, cb] = noteRgb(mode, ch, n.track[i], n.vel[i]);
          const playing = n.start[i] <= now && n.end[i] > now;
          const alpha = cv.muted[ch] ? 0.18 : mode === 'velocity' ? 0.95 : 0.45 + (n.vel[i] / 127) * 0.55;
          const boost = playing ? 1.35 : 1;
          r.rect(
            x0,
            keyY(k) + 1,
            wN,
            Math.max(1, rowH - 2),
            Math.min(255, cr * boost),
            Math.min(255, cg * boost),
            Math.min(255, cb * boost),
            alpha,
          );
        });
      }
      // 再生位置
      const px = x(now);
      const ar = theme.accentRgb;
      r.rect(px - 1, RULER, 2, h - RULER, ar[0], ar[1], ar[2], 1);
      r.end();

      // ---- 2D オーバーレイ（鍵盤・ルーラー・文字）
      const ow = Math.round(w * dpr);
      const oh = Math.round(h * dpr);
      if (overlay.current!.width !== ow || overlay.current!.height !== oh) {
        overlay.current!.width = ow;
        overlay.current!.height = oh;
      }
      ov.setTransform(dpr, 0, 0, dpr, 0, 0);
      ov.clearRect(0, 0, w, h);
      // 発音中のキー
      const active = new Map<number, number>();
      if (an && cv) {
        const n = an.notes;
        getNoteIndex(an).activeAt(now, (i) => {
          if (!cv.muted[n.ch[i]]) active.set(n.key[i] + cv.shift[n.ch[i]], n.ch[i]);
        });
      }
      for (const key of liveNotes.keys()) active.set(key % 128, Math.floor(key / 128));
      // 白鍵の地を先に塗り、その上に黒鍵を重ねる
      ov.fillStyle = theme.keyWhite;
      ov.fillRect(0, RULER, KEY_W, h - RULER);
      for (let k = lo; k <= hi; k++) {
        const y = keyY(k);
        const black = isBlackKey(k);
        const ch = active.get(k);
        if (ch !== undefined) {
          const [cr, cg, cb] = noteRgb('channel', ch, 0, 100);
          ov.fillStyle = `rgb(${cr},${cg},${cb})`;
          ov.fillRect(0, y, black ? KEY_W * 0.62 : KEY_W, Math.max(1, rowH));
        } else if (black) {
          ov.fillStyle = theme.keyBlack;
          ov.fillRect(0, y, KEY_W * 0.62, Math.max(1, rowH));
        }
        // 白鍵の境目（B-C と E-F）
        if (k % 12 === 0 || k % 12 === 5) {
          ov.fillStyle = 'rgba(0,0,0,0.25)';
          ov.fillRect(0, y + rowH - 0.5, KEY_W, 0.5);
        }
        if (k % 12 === 0 && rowH >= 6) {
          ov.fillStyle = '#556';
          ov.font = `${Math.min(10, rowH)}px system-ui, sans-serif`;
          ov.textBaseline = 'middle';
          ov.fillText(noteName(k), KEY_W - 24, y + rowH / 2);
        }
      }
      // ルーラー
      ov.fillStyle = theme.text;
      ov.globalAlpha = 0.06;
      ov.fillRect(KEY_W, 0, w - KEY_W, RULER);
      ov.globalAlpha = 1;
      ov.font = '11px system-ui, sans-serif';
      ov.textBaseline = 'middle';
      if (an) {
        const bars = an.bars;
        const step = Math.max(1, Math.ceil(48 / Math.max(1, ((bars[1] ?? 2) - (bars[0] ?? 0)) * zoom)));
        for (let i = Math.max(0, barIndexAt(bars, start)); i < bars.length && bars[i] < end; i++) {
          if (i % step) continue;
          const bx = x(bars[i]);
          if (bx < KEY_W) continue;
          ov.fillStyle = theme.muted;
          ov.fillText(String(i + 1), bx + 3, RULER / 2);
        }
        // マーカー
        ov.fillStyle = theme.accent;
        for (const tm of an.texts) {
          if (tm.type !== 0x06 || tm.sec < start || tm.sec > end) continue;
          ov.beginPath();
          const mx = x(tm.sec);
          ov.moveTo(mx, RULER - 8);
          ov.lineTo(mx + 5, RULER - 3);
          ov.lineTo(mx, RULER);
          ov.fill();
        }
        // ノート名
        if (settings.value.showNoteNames && rowH >= 10 && cv) {
          const n = an.notes;
          ov.fillStyle = 'rgba(0,0,0,0.75)';
          ov.font = `${Math.min(10, rowH - 2)}px system-ui, sans-serif`;
          getNoteIndex(an).forEach(start, end, (i) => {
            const wN = (n.end[i] - n.start[i]) * zoom;
            if (wN < 22) return;
            const k = n.key[i] + cv.shift[n.ch[i]];
            if (k < lo || k > hi) return;
            ov.fillText(noteName(k), Math.max(KEY_W + 2, x(n.start[i]) + 2), keyY(k) + rowH / 2);
          });
        }
      } else {
        ov.fillStyle = theme.muted;
        ov.font = '14px system-ui, sans-serif';
        ov.textAlign = 'center';
        ov.fillText(t('visual.empty'), KEY_W + (w - KEY_W) / 2, h / 2);
        ov.textAlign = 'left';
      }
    },
    (w, h, dpr) => {
      if (!renderer.current && glCanvas.current) renderer.current = createRectRenderer(glCanvas.current);
      renderer.current?.resize(w, h, dpr);
    },
    () => [
      playhead(),
      view.current.start,
      settings.value,
      analysis.value,
      abLoop.value,
      cv,
      range[0],
      range[1],
      liveNotes.size,
    ],
  );

  const toTimeKey = (ev: PointerEvent | MouseEvent) => {
    const rect = wrap.current!.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const { rowH, zoom, start } = layout(rect.width, rect.height);
    const time = start + (px - KEY_W) / zoom;
    const key = range[1] - Math.floor((py - RULER) / rowH);
    return { px, py, time, key };
  };

  const onPointerDown = (ev: PointerEvent) => {
    const { px, py, time } = toTimeKey(ev);
    if (py < RULER && px > KEY_W) {
      seek(time);
      return;
    }
    view.current.dragging = true;
    view.current.moved = false;
    view.current.dragX = ev.clientX;
    view.current.dragStart = view.current.start;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
  };
  const onPointerMove = (ev: PointerEvent) => {
    if (view.current.dragging) {
      const dx = ev.clientX - view.current.dragX;
      if (Math.abs(dx) > 3) {
        view.current.moved = true;
        if (settings.value.rollFollow) patchSettings({ rollFollow: false });
      }
      view.current.start = view.current.dragStart - dx / settings.value.rollZoom;
      return;
    }
    const a2 = analysis.value;
    if (!a2 || !cv) return setHover(null);
    const { px, py, time, key } = toTimeKey(ev);
    if (px < KEY_W || py < RULER) return setHover(null);
    let found = -1;
    const n = a2.notes;
    getNoteIndex(a2).forEach(time, time + 1e-6, (i) => {
      if (n.key[i] + cv.shift[n.ch[i]] === key) found = i;
    });
    if (found < 0) return setHover({ x: px, y: py, text: `${noteName(key)} · ${formatTime(time, true)}` });
    setHover({
      x: px,
      y: py,
      text: `${noteName(key)} (${key}) · ch ${n.ch[found] + 1} · tr ${n.track[found] + 1} · vel ${n.vel[found]} · ${formatTime(n.start[found], true)} · ${(n.end[found] - n.start[found]).toFixed(2)}s`,
    });
  };
  const onPointerUp = (ev: PointerEvent) => {
    const wasMoved = view.current.moved;
    view.current.dragging = false;
    if (!wasMoved && ev.detail >= 2) seek(toTimeKey(ev).time);
  };
  const onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    if (ev.ctrlKey || ev.metaKey) {
      const factor = Math.exp(-ev.deltaY * 0.0015);
      patchSettings({ rollZoom: settings.value.rollZoom * factor });
      return;
    }
    if (settings.value.rollFollow) patchSettings({ rollFollow: false });
    const d = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
    view.current.start += d / settings.value.rollZoom;
  };

  return (
    <div
      class="viz-canvas-wrap"
      ref={wrap}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onWheel={onWheel}
      role="img"
      aria-label={t('visual.roll')}
    >
      <canvas ref={glCanvas} class="layer" />
      <canvas ref={overlay} class="layer" />
      {hover && (
        <div class="tooltip" style={{ left: `${hover.x + 12}px`, top: `${hover.y + 12}px` }}>
          {hover.text}
        </div>
      )}
    </div>
  );
}
