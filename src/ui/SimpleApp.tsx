import { lazy, Suspense } from 'preact/compat';
import { useState } from 'preact/hooks';
import {
  FolderOpen,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-preact';
import {
  analysis,
  currentSong,
  currentTime,
  duration,
  engineStatus,
  masterMuted,
  patchSettings,
  settings,
  sfProgress,
  songs,
  status,
} from '../state/store';
import { addFiles, loadDemos, next, prev, seek, setQueue, togglePlay } from '../audio/player';
import { formatTime } from '../visual/common';
import { pickFile } from './download';
import { DropOverlay, Toasts } from './App';
import { t } from './i18n';

const FallingNotes = lazy(() => import('../visual/FallingNotes').then((m) => ({ default: m.FallingNotes })));
const Lyrics = lazy(() => import('../visual/Lyrics').then((m) => ({ default: m.Lyrics })));

const ACCEPT = '.mid,.midi,.smf,.kar,.rmi,.zip';
const SPEEDS: { value: number; key: string }[] = [
  { value: 0.5, key: 'simple.speed.slowest' },
  { value: 0.75, key: 'simple.speed.slow' },
  { value: 1, key: 'simple.speed.normal' },
  { value: 1.25, key: 'simple.speed.fast' },
];

function Steps() {
  return (
    <ol class="simple-steps" aria-label={t('simple.howTo')}>
      <li>
        <span class="step-num">1</span>
        {t('simple.step1')}
      </li>
      <li>
        <span class="step-num">2</span>
        {t('simple.step2')}
      </li>
      <li>
        <span class="step-num">3</span>
        {t('simple.step3')}
      </li>
    </ol>
  );
}

/** 1 列表示（スマホ）では曲を選んだあとプレイヤーまでスクロールする */
function showPlayer() {
  if (window.innerWidth > 860) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document
    .querySelector('.simple-player')
    ?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

function SongPicker() {
  const list = songs.value;
  const cur = currentSong.value?.id;
  return (
    <section class="simple-card simple-songs" aria-labelledby="simple-songs-title">
      <h2 id="simple-songs-title">{t('simple.chooseSong')}</h2>
      <button
        type="button"
        class="simple-big-btn"
        onClick={async () => {
          const files = await pickFile(ACCEPT, true);
          if (files.length) {
            addFiles(files, { play: true });
            showPlayer();
          }
        }}
        data-testid="simple-open"
      >
        <FolderOpen size={22} aria-hidden="true" />
        {t('simple.openFile')}
      </button>
      <p class="simple-hint">{t('simple.dropHint')}</p>
      {list.length === 0 ? (
        <button type="button" class="simple-big-btn secondary" onClick={() => loadDemos()}>
          <Sparkles size={22} aria-hidden="true" />
          {t('lib.loadDemos')}
        </button>
      ) : (
        <ul class="simple-song-list" data-testid="simple-song-list">
          {list.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                class={`simple-song ${s.id === cur ? 'current' : ''}`}
                aria-current={s.id === cur ? 'true' : undefined}
                onClick={() => {
                  setQueue(
                    list.map((x) => x.id),
                    i,
                    true,
                  );
                  showPlayer();
                }}
              >
                <span class="simple-song-icon" aria-hidden="true">
                  {s.id === cur && status.value === 'playing' ? '♪' : '▶'}
                </span>
                <span class="simple-song-name">{s.name}</span>
                <span class="simple-song-time">{s.duration ? formatTime(s.duration) : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Player() {
  const s = settings.value;
  const st = status.value;
  const song = currentSong.value;
  const a = analysis.value;
  const dur = duration.value;
  const [view, setView] = useState<'keys' | 'lyrics'>('keys');
  const hasLyrics = !!a && a.lyrics.length > 0;
  const shownView = hasLyrics ? view : 'keys';
  const muted = masterMuted.value;
  const VolIcon = muted || s.volume === 0 ? VolumeX : s.volume < 0.5 ? Volume1 : Volume2;
  const loading = st === 'loading' || engineStatus.value === 'loading';

  return (
    <section class="simple-card simple-player" aria-labelledby="simple-now-title">
      <p class="simple-label">{t('simple.nowPlaying')}</p>
      <h2 id="simple-now-title" class="simple-title">
        {song?.name ?? t('simple.noSong')}
      </h2>
      {loading && (
        <p class="simple-status" role="status">
          {sfProgress.value !== null
            ? t('simple.preparing', { p: Math.round((sfProgress.value ?? 0) * 100) })
            : t('simple.loading')}
        </p>
      )}

      <div class="simple-viz">
        {hasLyrics && (
          <div class="simple-view-tabs" role="tablist" aria-label={t('simple.view')}>
            <button
              type="button"
              role="tab"
              aria-selected={shownView === 'keys'}
              class={shownView === 'keys' ? 'active' : ''}
              onClick={() => setView('keys')}
            >
              {t('simple.viewKeys')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={shownView === 'lyrics'}
              class={shownView === 'lyrics' ? 'active' : ''}
              onClick={() => setView('lyrics')}
            >
              {t('simple.viewLyrics')}
            </button>
          </div>
        )}
        <Suspense fallback={<div class="viz-empty">…</div>}>
          {shownView === 'lyrics' ? <Lyrics /> : <FallingNotes />}
        </Suspense>
      </div>

      <div class="simple-seek">
        <span class="mono">{formatTime(currentTime.value)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(1, dur)}
          step={0.1}
          value={currentTime.value}
          disabled={!a}
          aria-label={t('transport.seek')}
          aria-valuetext={`${formatTime(currentTime.value)} / ${formatTime(dur)}`}
          onChange={(e) => seek(Number((e.target as HTMLInputElement).value))}
          style={{ '--fill': `${(currentTime.value / Math.max(1, dur)) * 100}%` } as any}
        />
        <span class="mono">{formatTime(dur)}</span>
      </div>

      <div class="simple-transport">
        <button type="button" class="simple-round" aria-label={t('simple.prev')} onClick={() => prev()}>
          <SkipBack size={28} />
        </button>
        <button
          type="button"
          class={`simple-play ${loading ? 'loading' : ''}`}
          aria-label={st === 'playing' ? t('transport.pause') : t('transport.play')}
          onClick={() => togglePlay()}
          data-testid="simple-play"
        >
          {st === 'playing' ? <Pause size={44} /> : <Play size={44} />}
          <span>{st === 'playing' ? t('simple.pause') : t('simple.play')}</span>
        </button>
        <button type="button" class="simple-round" aria-label={t('simple.next')} onClick={() => next()}>
          <SkipForward size={28} />
        </button>
      </div>

      <div class="simple-controls">
        <div class="simple-control">
          <span class="simple-control-label">{t('simple.volume')}</span>
          <div class="simple-volume">
            <button
              type="button"
              class="simple-round small"
              aria-label={muted ? t('transport.unmute') : t('transport.mute')}
              aria-pressed={muted}
              onClick={() => (masterMuted.value = !muted)}
            >
              <VolIcon size={22} />
            </button>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.01}
              value={s.volume}
              aria-label={t('simple.volume')}
              aria-valuetext={`${Math.round(s.volume * 100)}%`}
              onInput={(e) => patchSettings({ volume: Number((e.target as HTMLInputElement).value) })}
              style={{ '--fill': `${(s.volume / 1.5) * 100}%` } as any}
            />
          </div>
        </div>

        <div class="simple-control">
          <span class="simple-control-label" id="simple-speed-label">
            {t('simple.speed')}
          </span>
          <div class="simple-choice" role="radiogroup" aria-labelledby="simple-speed-label">
            {SPEEDS.map((sp) => (
              <button
                key={sp.value}
                type="button"
                role="radio"
                aria-checked={Math.abs(s.tempo - sp.value) < 0.001}
                class={Math.abs(s.tempo - sp.value) < 0.001 ? 'active' : ''}
                onClick={() => patchSettings({ tempo: sp.value })}
                data-testid={`simple-speed-${sp.value}`}
              >
                {t(sp.key)}
              </button>
            ))}
          </div>
        </div>

        <div class="simple-control">
          <span class="simple-control-label">{t('simple.pitch')}</span>
          <div class="simple-choice">
            <button
              type="button"
              aria-label={t('simple.pitchDown')}
              onClick={() => patchSettings({ transpose: s.transpose - 1 })}
            >
              ♭ {t('simple.lower')}
            </button>
            <button
              type="button"
              class={s.transpose === 0 ? 'active' : ''}
              onClick={() => patchSettings({ transpose: 0 })}
            >
              {s.transpose === 0
                ? t('simple.original')
                : `${s.transpose > 0 ? '+' : ''}${s.transpose}（${t('simple.reset')}）`}
            </button>
            <button
              type="button"
              aria-label={t('simple.pitchUp')}
              onClick={() => patchSettings({ transpose: s.transpose + 1 })}
            >
              ♯ {t('simple.higher')}
            </button>
          </div>
        </div>

        <label class="simple-check">
          <input
            type="checkbox"
            checked={s.repeat === 'one'}
            onChange={(e) =>
              patchSettings({ repeat: (e.target as HTMLInputElement).checked ? 'one' : 'all' })
            }
          />
          {t('simple.repeatOne')}
        </label>
      </div>
    </section>
  );
}

/** 初心者向けの「かんたんモード」。大きなボタンと最小限の操作だけを表示する */
export function SimpleApp() {
  return (
    <div class="simple-app">
      <header class="simple-header">
        <div class="brand">
          <img src="/icons/icon.svg" alt="" width={32} height={32} />
          <span>
            <strong>MIDI Studio</strong>
            <small class="simple-mode-badge">{t('simple.badge')}</small>
          </span>
        </div>
        <button
          type="button"
          class="btn simple-to-full"
          onClick={() => patchSettings({ uiMode: 'full' })}
          data-testid="to-full"
        >
          {t('simple.switchToFull')}
        </button>
      </header>
      <main class="simple-main">
        {!currentSong.value && <Steps />}
        <div class="simple-grid">
          <Player />
          <SongPicker />
        </div>
        <p class="simple-footer-hint">{t('simple.fullHint')}</p>
      </main>
      <DropOverlay />
      <Toasts />
    </div>
  );
}
