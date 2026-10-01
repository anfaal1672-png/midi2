import { useRef } from 'preact/hooks';
import { patchSettings, settings, status } from '../state/store';
import { getEngine, liveNotes } from '../audio/player';
import { useCanvasLoop } from './useCanvas';
import { hslToRgb } from './colors';
import { t } from '../ui/i18n';
import type { SpectrumMode } from '../state/settings';

export function Spectrum() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const freq = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const time = useRef<Float32Array<ArrayBuffer> | null>(null);
  const peaks = useRef<Float32Array>(new Float32Array(256));
  const specImg = useRef<{ img: ImageData | null; col: number }>({ img: null, col: 0 });
  const mode = settings.value.spectrumMode;
  const lastActive = useRef(0);

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
        specImg.current.img = null;
      }
      const an = getEngine()?.analyser;
      const m = settings.value.spectrumMode;
      if (m !== 'spectrogram') {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = `rgb(${theme.bg.join(',')})`;
        ctx.fillRect(0, 0, w, h);
      }
      if (!an) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = theme.muted;
        ctx.font = '14px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(t('visual.emptyAudio'), w / 2, h / 2);
        ctx.textAlign = 'left';
        return;
      }
      if (!freq.current || freq.current.length !== an.frequencyBinCount) {
        freq.current = new Uint8Array(an.frequencyBinCount);
        time.current = new Float32Array(an.fftSize);
      }
      const sr = an.context.sampleRate;
      if (m === 'bars') {
        an.getByteFrequencyData(freq.current);
        const bars = Math.min(160, Math.floor(w / 6));
        if (peaks.current.length < bars) peaks.current = new Float32Array(bars);
        const fMin = 30;
        const fMax = Math.min(18000, sr / 2);
        const bw = w / bars;
        for (let i = 0; i < bars; i++) {
          const f0 = fMin * Math.pow(fMax / fMin, i / bars);
          const f1 = fMin * Math.pow(fMax / fMin, (i + 1) / bars);
          const b0 = Math.floor((f0 / (sr / 2)) * freq.current.length);
          const b1 = Math.max(b0 + 1, Math.floor((f1 / (sr / 2)) * freq.current.length));
          let v = 0;
          for (let b = b0; b < b1; b++) v = Math.max(v, freq.current[b]);
          const val = v / 255;
          const bh = val * (h - 20);
          const [r, g, bb] = hslToRgb(200 + (i / bars) * 140, 0.75, 0.55);
          ctx.fillStyle = `rgb(${r},${g},${bb})`;
          ctx.fillRect(i * bw + 1, h - bh, Math.max(1, bw - 2), bh);
          peaks.current[i] = Math.max(val, peaks.current[i] - 0.008);
          ctx.fillStyle = theme.text;
          ctx.fillRect(i * bw + 1, h - peaks.current[i] * (h - 20) - 2, Math.max(1, bw - 2), 2);
        }
        ctx.fillStyle = theme.muted;
        ctx.font = '10px system-ui';
        for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
          const x = (Math.log(f / fMin) / Math.log(fMax / fMin)) * w;
          ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 2, 12);
        }
      } else if (m === 'scope') {
        an.getFloatTimeDomainData(time.current!);
        const d = time.current!;
        // ゼロクロスで位相を揃える
        let start = 0;
        for (let i = 1; i < d.length / 2; i++) {
          if (d[i - 1] < 0 && d[i] >= 0) {
            start = i;
            break;
          }
        }
        const len = Math.min(d.length - start, 2048);
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < len; i++) {
          const x = (i / len) * w;
          const y = h / 2 - d[start + i] * (h / 2) * 0.9;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.strokeStyle = theme.muted;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        // スペクトログラム（右から左へ流れる）
        an.getByteFrequencyData(freq.current);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const W = c.width;
        const H = c.height;
        if (!specImg.current.img) {
          ctx.fillStyle = `rgb(${theme.bg.join(',')})`;
          ctx.fillRect(0, 0, W, H);
          specImg.current.img = ctx.createImageData(1, H);
        }
        ctx.drawImage(c, -2, 0);
        const col = specImg.current.img;
        const fMin = 30;
        const fMax = Math.min(16000, sr / 2);
        for (let y = 0; y < H; y++) {
          const f = fMin * Math.pow(fMax / fMin, 1 - y / H);
          const v =
            freq.current[
              Math.min(freq.current.length - 1, Math.floor((f / (sr / 2)) * freq.current.length))
            ] / 255;
          const [r, g, b] = v < 0.02 ? theme.bg : hslToRgb(260 - v * 220, 0.85, 0.12 + v * 0.5);
          const o = y * 4;
          col.data[o] = r;
          col.data[o + 1] = g;
          col.data[o + 2] = b;
          col.data[o + 3] = 255;
        }
        ctx.putImageData(col, W - 2, 0);
        ctx.putImageData(col, W - 1, 0);
      }
    },
    undefined,
    () => {
      // 再生中・演奏中と、その直後の数秒だけ描画する
      const now = performance.now();
      if (status.value === 'playing' || liveNotes.size > 0) lastActive.current = now;
      const active = now - lastActive.current < 3000;
      return [active ? now : 0, settings.value.spectrumMode, !!getEngine()];
    },
  );

  const modes: SpectrumMode[] = ['bars', 'scope', 'spectrogram'];
  return (
    <div class="viz-canvas-wrap" ref={wrap}>
      <canvas ref={canvas} class="layer" role="img" aria-label={t('visual.spectrum')} />
      <div class="viz-floating-tabs" role="tablist">
        {modes.map((md) => (
          <button
            key={md}
            role="tab"
            aria-selected={mode === md}
            class={mode === md ? 'chip active' : 'chip'}
            onClick={() => patchSettings({ spectrumMode: md })}
          >
            {t('spectrum.' + md)}
          </button>
        ))}
      </div>
    </div>
  );
}
