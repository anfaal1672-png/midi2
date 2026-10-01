import { useRef, useState } from 'preact/hooks';
import {
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
  Volume1,
} from 'lucide-preact';
import {
  abLoop,
  analysis,
  currentSong,
  currentTime,
  duration,
  engineStatus,
  masterMuted,
  patchSettings,
  settings,
  sfProgress,
  status,
  tempoNow,
} from '../state/store';
import {
  clearLoop,
  loopCurrentBars,
  next,
  prev,
  seek,
  setLoopA,
  setLoopB,
  stop,
  togglePlay,
  toggleLoop,
} from '../audio/player';
import { barIndexAt } from '../midi/analyze';
import { formatTime } from '../visual/common';
import { IconButton, Slider } from './primitives';
import { t } from './i18n';

function barBeat(sec: number): string {
  const a = analysis.value;
  if (!a || !a.bars.length) return '1:1';
  const i = barIndexAt(a.bars, sec);
  const start = a.bars[i];
  const end = a.bars[i + 1] ?? a.duration;
  const sig = a.timeSigs.filter((ts) => ts.sec <= start + 1e-6).pop();
  const beats = sig?.num ?? 4;
  const beat = Math.min(beats, Math.floor(((sec - start) / Math.max(1e-6, end - start)) * beats) + 1);
  return `${i + 1}:${beat}`;
}

function SeekBar() {
  const a = analysis.value;
  const dur = duration.value || 1;
  const time = currentTime.value;
  const loop = abLoop.value;
  const ref = useRef<HTMLDivElement>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const pct = (sec: number) => `${Math.max(0, Math.min(100, (sec / dur) * 100))}%`;
  const fromEvent = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur));
  };
  const shown = drag ?? time;
  const markers = a?.texts.filter((x) => x.type === 0x06) ?? [];
  const barStep = a ? Math.max(1, Math.ceil(a.bars.length / 64)) : 1;
  return (
    <div class="seek">
      <span class="time mono" aria-label={t('transport.position')}>
        {formatTime(shown)}
        <small>{barBeat(shown)}</small>
      </span>
      <div
        class="seek-track"
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={t('transport.seek')}
        aria-valuemin={0}
        aria-valuemax={Math.round(dur)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={`${formatTime(shown)} / ${formatTime(dur)}`}
        onPointerDown={(e) => {
          if (!a) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setDrag(fromEvent(e));
        }}
        onPointerMove={(e) => {
          const v = fromEvent(e);
          setHoverT(v);
          if (drag !== null) setDrag(v);
        }}
        onPointerUp={(e) => {
          if (drag !== null) seek(fromEvent(e));
          setDrag(null);
        }}
        onPointerLeave={() => setHoverT(null)}
        onKeyDown={(e) => {
          if (e.key === 'Home') seek(0);
          if (e.key === 'End') seek(dur - 0.5);
        }}
      >
        <div class="seek-rail">
          {a &&
            Array.from(a.bars)
              .filter((_, i) => i % barStep === 0)
              .map((b, i) => <span key={i} class="seek-bar-tick" style={{ left: pct(b) }} />)}
          {loop.a !== null && loop.b !== null && (
            <span
              class={`seek-loop ${loop.enabled ? 'on' : ''}`}
              style={{ left: pct(loop.a), width: `calc(${pct(loop.b)} - ${pct(loop.a)})` }}
            />
          )}
          <span class="seek-fill" style={{ width: pct(shown) }} />
          {markers.map((m, i) => (
            <span key={i} class="seek-marker" style={{ left: pct(m.sec) }} />
          ))}
          <span class="seek-thumb" style={{ left: pct(shown) }} />
        </div>
        {hoverT !== null && a && (
          <span class="seek-hover" style={{ left: pct(hoverT) }}>
            {formatTime(hoverT)} · {barBeat(hoverT)}
          </span>
        )}
      </div>
      <span class="time mono end">{formatTime(dur)}</span>
    </div>
  );
}

export function Transport() {
  const s = settings.value;
  const st = status.value;
  const song = currentSong.value;
  const loop = abLoop.value;
  const muted = masterMuted.value;
  const VolIcon = muted || s.volume === 0 ? VolumeX : s.volume < 0.5 ? Volume1 : Volume2;
  const RepIcon = s.repeat === 'one' ? Repeat1 : Repeat;
  const cycleRepeat = () =>
    patchSettings({ repeat: s.repeat === 'none' ? 'all' : s.repeat === 'all' ? 'one' : 'none' });
  const loading = st === 'loading' || engineStatus.value === 'loading';

  return (
    <footer class="transport" aria-label={t('transport.label')}>
      <div class="transport-song">
        <div class="song-title ellipsis" title={song?.name}>
          {song?.name ?? t('transport.noSong')}
        </div>
        <div class="song-sub muted small">
          {sfProgress.value !== null
            ? t('sf.loading', { p: Math.round((sfProgress.value ?? 0) * 100) })
            : analysis.value
              ? `${tempoNow.value.toFixed(1)} BPM${s.tempo !== 1 ? ` ×${s.tempo.toFixed(2)}` : ''}${s.transpose ? ` · ${s.transpose > 0 ? '+' : ''}${s.transpose}` : ''}`
              : t('transport.dropHint')}
        </div>
      </div>
      <div class="transport-main">
        <div class="transport-buttons">
          <IconButton
            label={t('transport.shuffle')}
            active={s.shuffle}
            onClick={() => patchSettings({ shuffle: !s.shuffle })}
          >
            <Shuffle size={18} />
          </IconButton>
          <IconButton label={t('transport.prev')} onClick={() => prev()}>
            <SkipBack size={20} />
          </IconButton>
          <button
            type="button"
            class={`play-btn ${loading ? 'loading' : ''}`}
            aria-label={st === 'playing' ? t('transport.pause') : t('transport.play')}
            title={`${st === 'playing' ? t('transport.pause') : t('transport.play')} (Space)`}
            onClick={() => togglePlay()}
            data-testid="play"
          >
            {st === 'playing' ? <Pause size={24} /> : <Play size={24} />}
          </button>
          <IconButton label={t('transport.next')} onClick={() => next()}>
            <SkipForward size={20} />
          </IconButton>
          <IconButton label={t('transport.stop')} onClick={() => stop()}>
            <Square size={16} />
          </IconButton>
          <IconButton
            label={`${t('transport.repeat')}: ${t('repeat.' + s.repeat)}`}
            active={s.repeat !== 'none'}
            onClick={cycleRepeat}
          >
            <RepIcon size={18} />
          </IconButton>
        </div>
        <SeekBar />
      </div>
      <div class="transport-side">
        <div class="ab-group" role="group" aria-label={t('loop.label')}>
          <button
            type="button"
            class={`chip ${loop.a !== null ? 'set' : ''}`}
            onClick={() => setLoopA()}
            title={t('loop.setA')}
          >
            A
          </button>
          <button
            type="button"
            class={`chip ${loop.b !== null ? 'set' : ''}`}
            onClick={() => setLoopB()}
            title={t('loop.setB')}
          >
            B
          </button>
          <button
            type="button"
            class={`chip ${loop.enabled ? 'active' : ''}`}
            onClick={() => toggleLoop()}
            onContextMenu={(e) => {
              e.preventDefault();
              clearLoop();
            }}
            title={t('loop.toggle')}
            aria-pressed={loop.enabled}
          >
            {t('loop.short')}
            {loop.enabled && s.loopCount > 0 ? ` ${loop.done + 1}/${s.loopCount}` : ''}
          </button>
          <select
            class="bars-select"
            aria-label={t('loop.bars')}
            title={t('loop.bars')}
            value=""
            disabled={!analysis.value}
            onChange={(e) => {
              const n = Number((e.target as HTMLSelectElement).value);
              if (n === -1) clearLoop();
              else if (n > 0) loopCurrentBars(n);
              (e.target as HTMLSelectElement).value = '';
            }}
          >
            <option value="">{t('loop.barsShort')}</option>
            {[1, 2, 4, 8, 16].map((n) => (
              <option key={n} value={n}>
                {t('loop.barsN', { n })}
              </option>
            ))}
            <option value={-1}>{t('loop.clear')}</option>
          </select>
        </div>
        <div class="mini-control">
          <span class="mini-label">{t('transport.tempo')}</span>
          <button
            type="button"
            class="step"
            aria-label={t('transport.tempoDown')}
            onClick={() => patchSettings({ tempo: Math.round((s.tempo - 0.05) * 100) / 100 })}
          >
            −
          </button>
          <button
            type="button"
            class="mini-value mono"
            title={t('common.reset')}
            onClick={() => patchSettings({ tempo: 1 })}
          >
            ×{s.tempo.toFixed(2)}
          </button>
          <button
            type="button"
            class="step"
            aria-label={t('transport.tempoUp')}
            onClick={() => patchSettings({ tempo: Math.round((s.tempo + 0.05) * 100) / 100 })}
          >
            +
          </button>
        </div>
        <div class="mini-control">
          <span class="mini-label">{t('transport.transpose')}</span>
          <button
            type="button"
            class="step"
            aria-label={t('transport.transposeDown')}
            onClick={() => patchSettings({ transpose: s.transpose - 1 })}
          >
            −
          </button>
          <button
            type="button"
            class="mini-value mono"
            title={t('common.reset')}
            onClick={() => patchSettings({ transpose: 0 })}
          >
            {s.transpose > 0 ? '+' : ''}
            {s.transpose}
          </button>
          <button
            type="button"
            class="step"
            aria-label={t('transport.transposeUp')}
            onClick={() => patchSettings({ transpose: s.transpose + 1 })}
          >
            +
          </button>
        </div>
        <div class="volume">
          <IconButton
            label={muted ? t('transport.unmute') : t('transport.mute')}
            active={muted}
            onClick={() => (masterMuted.value = !muted)}
          >
            <VolIcon size={18} />
          </IconButton>
          <Slider
            label={t('transport.volume')}
            hideLabel
            value={s.volume}
            min={0}
            max={1.5}
            step={0.01}
            resetTo={0.8}
            onInput={(v) => patchSettings({ volume: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </div>
      </div>
    </footer>
  );
}
