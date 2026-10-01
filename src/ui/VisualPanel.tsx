import { lazy, Suspense } from 'preact/compat';
import { Columns2, Crosshair, Expand, ImageDown, Keyboard, Minimize, ZoomIn, ZoomOut } from 'lucide-preact';
import { fullscreenViz, patchSettings, pcKeyboard, settings, analysis } from '../state/store';
import type { VisualKind } from '../state/settings';
import { PianoRoll } from '../visual/PianoRoll';
import { IconButton } from './primitives';
import { toggleFullscreen } from './shortcuts';
import { t } from './i18n';
import { errorMessage, toast } from '../state/notify';

const FallingNotes = lazy(() => import('../visual/FallingNotes').then((m) => ({ default: m.FallingNotes })));
const ChannelKeys = lazy(() => import('../visual/ChannelKeys').then((m) => ({ default: m.ChannelKeys })));
const Spectrum = lazy(() => import('../visual/Spectrum').then((m) => ({ default: m.Spectrum })));
const Lyrics = lazy(() => import('../visual/Lyrics').then((m) => ({ default: m.Lyrics })));
const EventList = lazy(() => import('../visual/EventList').then((m) => ({ default: m.EventList })));
const SongInfo = lazy(() => import('../visual/SongInfo').then((m) => ({ default: m.SongInfo })));

export const VISUALS: VisualKind[] = ['roll', 'falling', 'keys', 'spectrum', 'lyrics', 'events', 'info'];

function View({ kind }: { kind: VisualKind }) {
  switch (kind) {
    case 'roll':
      return <PianoRoll />;
    case 'falling':
      return <FallingNotes />;
    case 'keys':
      return <ChannelKeys />;
    case 'spectrum':
      return <Spectrum />;
    case 'lyrics':
      return <Lyrics />;
    case 'events':
      return <EventList />;
    case 'info':
      return <SongInfo />;
  }
}

export function VisualPanel() {
  const s = settings.value;
  const split = s.visual2 !== 'none';
  const isFs = fullscreenViz.value;
  return (
    <section class={`viz-panel ${isFs ? 'pseudo-fullscreen' : ''}`} aria-label={t('visual.label')}>
      <div class="viz-toolbar">
        <div class="tabs scroll" role="tablist" aria-label={t('visual.label')}>
          {VISUALS.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={s.visual === v}
              class={s.visual === v ? 'tab active' : 'tab'}
              onClick={() => patchSettings({ visual: v })}
              data-testid={`viz-${v}`}
            >
              {t('visual.' + v)}
            </button>
          ))}
        </div>
        <div class="viz-tools">
          {(s.visual === 'roll' || s.visual2 === 'roll') && (
            <>
              <IconButton
                label={t('visual.follow')}
                active={s.rollFollow}
                onClick={() => patchSettings({ rollFollow: !s.rollFollow })}
              >
                <Crosshair size={16} />
              </IconButton>
              <IconButton
                label={t('visual.zoomOut')}
                onClick={() => patchSettings({ rollZoom: s.rollZoom / 1.25 })}
              >
                <ZoomOut size={16} />
              </IconButton>
              <IconButton
                label={t('visual.zoomIn')}
                onClick={() => patchSettings({ rollZoom: s.rollZoom * 1.25 })}
              >
                <ZoomIn size={16} />
              </IconButton>
            </>
          )}
          {(s.visual === 'roll' || s.visual === 'falling') && (
            <select
              aria-label={t('visual.colorBy')}
              value={s.colorBy}
              onChange={(e) => patchSettings({ colorBy: (e.target as HTMLSelectElement).value as any })}
            >
              <option value="channel">{t('visual.color.channel')}</option>
              <option value="track">{t('visual.color.track')}</option>
              <option value="velocity">{t('visual.color.velocity')}</option>
            </select>
          )}
          {s.visual === 'falling' && (
            <label class="small inline-range">
              {t('visual.speed')}
              <input
                type="range"
                min={0.8}
                max={6}
                step={0.1}
                value={7 - s.fallingSpeed}
                aria-label={t('visual.speed')}
                onInput={(e) =>
                  patchSettings({ fallingSpeed: 7 - Number((e.target as HTMLInputElement).value) })
                }
              />
            </label>
          )}
          <IconButton
            label={t('visual.pcKeyboard')}
            active={pcKeyboard.value}
            onClick={() => (pcKeyboard.value = !pcKeyboard.value)}
          >
            <Keyboard size={16} />
          </IconButton>
          <IconButton
            label={t('visual.split')}
            active={split}
            onClick={() =>
              patchSettings({ visual2: split ? 'none' : s.visual === 'falling' ? 'roll' : 'falling' })
            }
          >
            <Columns2 size={16} />
          </IconButton>
          <IconButton
            label={t('export.png')}
            disabled={!analysis.value}
            onClick={() =>
              import('../audio/export')
                .then((m) => m.exportPng())
                .catch((e) => toast(errorMessage(e), 'error'))
            }
          >
            <ImageDown size={16} />
          </IconButton>
          <IconButton
            label={isFs ? t('visual.exitFullscreen') : t('visual.fullscreen')}
            onClick={toggleFullscreen}
          >
            {isFs ? <Minimize size={16} /> : <Expand size={16} />}
          </IconButton>
        </div>
      </div>
      <div class={`viz-body ${split ? 'split' : ''}`}>
        <div class="viz-pane">
          <Suspense fallback={<div class="viz-empty">…</div>}>
            <View kind={s.visual} />
          </Suspense>
        </div>
        {split && (
          <div class="viz-pane">
            <select
              class="pane-select"
              aria-label={t('visual.secondView')}
              value={s.visual2}
              onChange={(e) => patchSettings({ visual2: (e.target as HTMLSelectElement).value as any })}
            >
              {VISUALS.map((v) => (
                <option key={v} value={v}>
                  {t('visual.' + v)}
                </option>
              ))}
            </select>
            <Suspense fallback={<div class="viz-empty">…</div>}>
              <View kind={s.visual2 as VisualKind} />
            </Suspense>
          </div>
        )}
      </div>
    </section>
  );
}
