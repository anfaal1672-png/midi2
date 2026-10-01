import { useMemo, useRef } from 'preact/hooks';
import { analysis, channelPatches, mixer, settings, presets, status, usedChannels } from '../state/store';
import { getEngine, playhead } from '../audio/player';
import { useCanvasLoop } from './useCanvas';
import { channelView, getNoteIndex } from './common';
import { channelRgb } from './colors';
import { isBlackKey, programName } from '../midi/gm';
import { t } from '../ui/i18n';

const LABEL_W = 150;

/** 16 チャンネル分の鍵盤を縦に並べた表示 */
export function ChannelKeys() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const a = analysis.value;
  const m = mixer.value;
  const s = settings.value;
  const cv = useMemo(() => (a ? channelView(a, m, s.transpose) : null), [a, m, s.transpose]);
  const levels = useRef(new Float32Array(64));

  useCanvasLoop(
    wrap,
    ({ w, h, dpr, theme }) => {
      const c = canvas.current;
      if (!c) return;
      const ctx = c.getContext('2d')!;
      const cw = Math.round(w * dpr);
      const chh = Math.round(h * dpr);
      if (c.width !== cw || c.height !== chh) {
        c.width = cw;
        c.height = chh;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `rgb(${theme.bg.join(',')})`;
      ctx.fillRect(0, 0, w, h);
      const an = analysis.value;
      // 使われているチャンネルだけを表示する
      const rows = an ? usedChannels.value : Array.from({ length: 16 }, (_, i) => i);
      const count = Math.max(64, an?.channelCount ?? 16);
      const rowH = Math.min(h / Math.max(1, rows.length), 64);
      const lo = 12;
      const hi = 119;
      const keysW = w - LABEL_W;
      const whites: number[] = [];
      for (let k = lo; k <= hi; k++) if (!isBlackKey(k)) whites.push(k);
      const ww = keysW / whites.length;
      const whiteIndex = new Map<number, number>();
      whites.forEach((k, i) => whiteIndex.set(k, i));
      const active: Map<number, number>[] = Array.from({ length: count }, () => new Map());
      if (an && cv) {
        const n = an.notes;
        getNoteIndex(an).activeAt(playhead(), (i) => {
          const ch = n.ch[i];
          if (ch < count) active[ch].set(n.key[i] + cv.shift[ch], n.vel[i]);
        });
      }
      const eng = getEngine();
      const pl = presets.value;
      rows.forEach((ch, rowIdx) => {
        const y = rowIdx * rowH;
        const [r, g, b] = channelRgb(ch);
        const muted = cv?.muted[ch];
        // ラベル
        ctx.fillStyle = muted ? theme.muted : `rgb(${r},${g},${b})`;
        ctx.font = `600 ${Math.min(12, rowH * 0.45)}px system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillText(`${ch + 1}`, 6, y + rowH / 2);
        const info = an?.channels.find((x) => x.ch === ch);
        const live = channelPatches.value[ch];
        const found = info && pl.find((p) => p.program === info.firstProgram && p.isDrum === info.isDrum);
        const name = live?.name ?? found?.name ?? (info ? programName(info.firstProgram, info.isDrum) : '');
        ctx.fillStyle = muted ? theme.muted : theme.text;
        ctx.font = `${Math.min(11, rowH * 0.4)}px system-ui, sans-serif`;
        ctx.fillText(name.slice(0, 18), 28, y + rowH / 2);
        // レベル
        const target = eng ? Math.min(1, eng.channelVoices(ch) / 8) : 0;
        levels.current[ch] = Math.max(target, levels.current[ch] * 0.9);
        ctx.fillStyle = `rgba(${r},${g},${b},0.6)`;
        ctx.fillRect(
          LABEL_W - 10,
          y + rowH * 0.15 + rowH * 0.7 * (1 - levels.current[ch]),
          4,
          rowH * 0.7 * levels.current[ch],
        );
        // 鍵盤
        const kh = rowH - 2;
        for (const k of whites) {
          const vel = active[ch].get(k);
          ctx.fillStyle = vel !== undefined ? `rgb(${r},${g},${b})` : theme.keyWhite;
          ctx.globalAlpha = muted ? 0.4 : 1;
          ctx.fillRect(LABEL_W + whiteIndex.get(k)! * ww, y + 1, Math.max(1, ww - 0.6), kh);
        }
        for (let k = lo; k <= hi; k++) {
          if (!isBlackKey(k)) continue;
          const wi = whiteIndex.get(k + 1) ?? 0;
          const vel = active[ch].get(k);
          ctx.fillStyle = vel !== undefined ? `rgb(${r},${g},${b})` : theme.keyBlack;
          ctx.fillRect(LABEL_W + wi * ww - ww * 0.3, y + 1, ww * 0.6, kh * 0.6);
        }
        ctx.globalAlpha = 1;
      });
      if (!an) {
        ctx.fillStyle = theme.muted;
        ctx.font = '14px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(t('visual.empty'), w / 2, h / 2);
        ctx.textAlign = 'left';
      }
    },
    undefined,
    () => [
      status.value === 'playing' ? performance.now() : playhead(),
      analysis.value,
      cv,
      channelPatches.value,
      presets.value,
    ],
  );

  return (
    <div class="viz-canvas-wrap" ref={wrap} role="img" aria-label={t('visual.keys')}>
      <canvas ref={canvas} class="layer" />
    </div>
  );
}
