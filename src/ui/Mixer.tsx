import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-preact';
import {
  analysis,
  channelPatches,
  midiAccess,
  mixer,
  patchChannel,
  patchSettings,
  presets,
  settings,
  usedChannels,
} from '../state/store';
import { applyPreset, defaultMixer, effectiveMute, type MixerPreset } from '../state/mixer';
import { getEngine } from '../audio/player';
import { channelColor } from '../visual/colors';
import { programName } from '../midi/gm';
import { decodeText, resolveEncoding } from '../midi/encoding';
import { IconButton, Slider } from './primitives';
import { t } from './i18n';

function guessRoles() {
  const a = analysis.value;
  if (!a) return { melody: null as number | null, bass: null as number | null, drums: [] as number[] };
  const n = a.notes;
  const sum = new Map<number, { s: number; c: number }>();
  for (let i = 0; i < n.count; i++) {
    const e = sum.get(n.ch[i]) ?? { s: 0, c: 0 };
    e.s += n.key[i];
    e.c++;
    sum.set(n.ch[i], e);
  }
  const drums = a.channels.filter((c) => c.isDrum).map((c) => c.ch);
  const melodic = [...sum.entries()].filter(([ch]) => !drums.includes(ch));
  const maxCount = Math.max(1, ...melodic.map(([, v]) => v.c));
  const candidates = melodic.filter(([, v]) => v.c >= maxCount * 0.1);
  const avg = (v: { s: number; c: number }) => v.s / v.c;
  const melody = candidates.sort((x, y) => avg(y[1]) - avg(x[1]))[0]?.[0] ?? null;
  const bass = candidates.sort((x, y) => avg(x[1]) - avg(y[1]))[0]?.[0] ?? null;
  return { melody, bass, drums };
}

function Meters({ channels }: { channels: number[] }) {
  // メーターは DOM を直接更新して再描画を避ける
  useEffect(() => {
    let raf = 0;
    const levels = new Float32Array(64);
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const e = getEngine();
      if (!e) return;
      for (const ch of channels) {
        const el = document.getElementById(`meter-${ch}`);
        const vc = document.getElementById(`voices-${ch}`);
        const lv = ch < 16 ? e.channelLevel(ch) : 0;
        levels[ch] = Math.max(lv, levels[ch] * 0.92);
        if (el) el.style.setProperty('--level', String(Math.min(1, levels[ch] * 1.4)));
        if (vc) vc.textContent = String(e.channelVoices(ch));
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [channels.join(',')]);
  return null;
}

function InstrumentSelect({ ch }: { ch: number }) {
  const c = mixer.value[ch];
  const info = analysis.value?.channels.find((x) => x.ch === ch);
  const list = presets.value;
  const live = channelPatches.value[ch];
  const fromSong = info
    ? (list.find(
        (p) => p.program === info.firstProgram && p.bankMSB === info.bankMSB && p.isDrum === info.isDrum,
      )?.name ??
      list.find((p) => p.program === info.firstProgram && p.isDrum === info.isDrum)?.name ??
      programName(info.firstProgram, info.isDrum))
    : '—';
  const label = c.program?.name ?? live?.name ?? fromSong;
  // 選択肢（数百件）はフォーカスされるまで描画しない（DOM を軽く保つ）
  const [expanded, setExpanded] = useState(false);
  const value = c.program
    ? `${c.program.bankMSB}:${c.program.bankLSB}:${c.program.program}:${c.program.isDrum ? 1 : 0}`
    : '';
  const sorted = useMemo(
    () =>
      list
        .slice()
        .sort(
          (a, b) => Number(a.isDrum) - Number(b.isDrum) || a.bankMSB - b.bankMSB || a.program - b.program,
        ),
    [list],
  );
  return (
    <select
      class={`inst-select ${c.program ? 'overridden' : ''}`}
      aria-label={t('mixer.instrument', { ch: ch + 1 })}
      title={label}
      value={value}
      onFocus={() => setExpanded(true)}
      onPointerDown={() => setExpanded(true)}
      onChange={(e) => {
        const v = (e.target as HTMLSelectElement).value;
        if (!v) return patchChannel(ch, { program: null });
        const [msb, lsb, prog, drum] = v.split(':').map(Number);
        const p = list.find(
          (x) => x.bankMSB === msb && x.bankLSB === lsb && x.program === prog && Number(x.isDrum) === drum,
        );
        patchChannel(ch, {
          program: {
            program: prog,
            bankMSB: msb,
            bankLSB: lsb,
            isDrum: drum === 1,
            name: p?.name ?? programName(prog),
          },
        });
      }}
    >
      <option value="">
        {label} ({t('mixer.fromSong')})
      </option>
      {!expanded && c.program && <option value={value}>{c.program.name}</option>}
      {expanded && (
        <>
          <optgroup label={t('mixer.melodic')}>
            {sorted
              .filter((p) => !p.isDrum)
              .map((p) => (
                <option
                  key={`${p.bankMSB}:${p.bankLSB}:${p.program}`}
                  value={`${p.bankMSB}:${p.bankLSB}:${p.program}:0`}
                >
                  {p.bankMSB}:{p.program + 1} {p.name}
                </option>
              ))}
          </optgroup>
          <optgroup label={t('mixer.drums')}>
            {sorted
              .filter((p) => p.isDrum)
              .map((p) => (
                <option
                  key={`d${p.bankMSB}:${p.bankLSB}:${p.program}`}
                  value={`${p.bankMSB}:${p.bankLSB}:${p.program}:1`}
                >
                  {p.program + 1} {p.name}
                </option>
              ))}
          </optgroup>
        </>
      )}
    </select>
  );
}

function Strip({ ch }: { ch: number }) {
  const [open, setOpen] = useState(false);
  const c = mixer.value[ch];
  const m = mixer.value;
  const info = analysis.value?.channels.find((x) => x.ch === ch);
  const muted = effectiveMute(m, ch);
  const s = settings.value;
  const ext = s.midiOutput === 'external' && midiAccess.value.enabled;
  return (
    <li
      class={`strip ${muted ? 'muted' : ''}`}
      style={{ '--ch-color': channelColor(ch) } as any}
      data-testid={`strip-${ch}`}
    >
      <div class="strip-row">
        <IconButton
          label={open ? t('mixer.collapse') : t('mixer.expand')}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </IconButton>
        <span class="ch-num" title={info?.isDrum ? t('mixer.drumChannel') : undefined}>
          {ch + 1}
          {info?.isDrum ? '🥁' : ''}
        </span>
        <InstrumentSelect ch={ch} />
        <button
          type="button"
          class={`ms-btn mute ${c.mute ? 'on' : ''}`}
          aria-pressed={c.mute}
          aria-label={t('mixer.mute', { ch: ch + 1 })}
          onClick={() => patchChannel(ch, { mute: !c.mute })}
          data-testid={`mute-${ch}`}
        >
          M
        </button>
        <button
          type="button"
          class={`ms-btn solo ${c.solo ? 'on' : ''}`}
          aria-pressed={c.solo}
          aria-label={t('mixer.solo', { ch: ch + 1 })}
          onClick={() => patchChannel(ch, { solo: !c.solo })}
        >
          S
        </button>
        <span class="meter" id={`meter-${ch}`} aria-hidden="true">
          <span />
        </span>
        <span class="voices mono small muted" id={`voices-${ch}`} title={t('mixer.voices')}>
          0
        </span>
      </div>
      {open && (
        <div class="strip-detail">
          <Slider
            label={t('mixer.volume')}
            value={c.gain}
            min={0}
            max={2}
            step={0.01}
            resetTo={1}
            onInput={(v) => patchChannel(ch, { gain: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Slider
            label={t('mixer.pan')}
            value={c.pan}
            min={-1}
            max={1}
            step={0.01}
            resetTo={0}
            onInput={(v) => patchChannel(ch, { pan: v })}
            format={(v) =>
              Math.abs(v) < 0.01 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`
            }
          />
          <Slider
            label={t('mixer.reverb')}
            value={c.reverb}
            min={-1}
            max={127}
            step={1}
            resetTo={-1}
            onInput={(v) => patchChannel(ch, { reverb: v })}
            format={(v) => (v < 0 ? t('mixer.auto') : String(v))}
          />
          <Slider
            label={t('mixer.chorus')}
            value={c.chorus}
            min={-1}
            max={127}
            step={1}
            resetTo={-1}
            onInput={(v) => patchChannel(ch, { chorus: v })}
            format={(v) => (v < 0 ? t('mixer.auto') : String(v))}
          />
          <Slider
            label={t('mixer.transpose')}
            value={c.transpose}
            min={-24}
            max={24}
            step={1}
            resetTo={0}
            onInput={(v) => patchChannel(ch, { transpose: v })}
            format={(v) => (v > 0 ? `+${v}` : String(v))}
          />
          <label class="field-inline">
            {t('mixer.drumMode')}
            <select
              value={c.drum === null ? 'auto' : c.drum ? 'on' : 'off'}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value;
                patchChannel(ch, { drum: v === 'auto' ? null : v === 'on' });
              }}
            >
              <option value="auto">{t('mixer.auto')}</option>
              <option value="on">{t('mixer.drumOn')}</option>
              <option value="off">{t('mixer.drumOff')}</option>
            </select>
          </label>
          {ext && (
            <label class="field-inline">
              {t('mixer.output')}
              <select
                value={s.channelRoutes[ch] ?? ''}
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value;
                  const routes = { ...s.channelRoutes };
                  if (v) routes[ch] = v;
                  else delete routes[ch];
                  patchSettings({ channelRoutes: routes });
                }}
              >
                <option value="">{t('mixer.outputDefault')}</option>
                <option value="internal">{t('mixer.outputInternal')}</option>
                {midiAccess.value.outputs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" class="btn small" onClick={() => patchChannel(ch, { ...defaultMixer()[0] })}>
            <RotateCcw size={12} /> {t('common.reset')}
          </button>
        </div>
      )}
    </li>
  );
}

function TrackView() {
  const a = analysis.value;
  const m = mixer.value;
  if (!a) return null;
  const enc = resolveEncoding(
    settings.value.lyricEncoding,
    a.tracks.map((x) => x.nameBytes),
  );
  return (
    <ul class="track-list">
      {a.tracks
        .filter((tr) => tr.channels.length)
        .map((tr) => {
          const allMuted = tr.channels.every((ch) => m[ch]?.mute);
          const allSolo = tr.channels.every((ch) => m[ch]?.solo);
          const setAll = (patch: { mute?: boolean; solo?: boolean }) => {
            const next = m.slice();
            for (const ch of tr.channels) next[ch] = { ...next[ch], ...patch };
            mixer.value = next;
          };
          return (
            <li key={tr.index} class="strip">
              <div class="strip-row">
                <span class="ch-num">T{tr.index + 1}</span>
                <span class="ellipsis track-name">
                  {decodeText(tr.nameBytes, enc) || `Track ${tr.index + 1}`}
                </span>
                <span class="small muted">ch {tr.channels.map((c) => c + 1).join(',')}</span>
                <button
                  type="button"
                  class={`ms-btn mute ${allMuted ? 'on' : ''}`}
                  aria-pressed={allMuted}
                  onClick={() => setAll({ mute: !allMuted })}
                >
                  M
                </button>
                <button
                  type="button"
                  class={`ms-btn solo ${allSolo ? 'on' : ''}`}
                  aria-pressed={allSolo}
                  onClick={() => setAll({ solo: !allSolo })}
                >
                  S
                </button>
              </div>
            </li>
          );
        })}
    </ul>
  );
}

export function MixerPanel() {
  const [view, setView] = useState<'channels' | 'tracks'>('channels');
  const used = usedChannels.value;
  const roles = useMemo(guessRoles, [analysis.value]);
  const s = settings.value;
  const listRef = useRef<HTMLUListElement>(null);
  const preset = (p: MixerPreset) => {
    mixer.value = applyPreset(mixer.value, p, {
      used,
      drums: roles.drums,
      melody: roles.melody,
      bass: roles.bass,
    });
  };
  return (
    <aside class="panel mixer-panel" aria-label={t('mixer.label')}>
      <div class="panel-toolbar">
        <div class="tabs compact" role="tablist">
          <button
            role="tab"
            type="button"
            aria-selected={view === 'channels'}
            class={view === 'channels' ? 'tab active' : 'tab'}
            onClick={() => setView('channels')}
          >
            {t('mixer.channels')}
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={view === 'tracks'}
            class={view === 'tracks' ? 'tab active' : 'tab'}
            onClick={() => setView('tracks')}
          >
            {t('mixer.tracks')}
          </button>
        </div>
        <IconButton label={t('mixer.resetAll')} onClick={() => (mixer.value = defaultMixer())}>
          <RotateCcw size={16} />
        </IconButton>
      </div>
      <div class="preset-row" role="group" aria-label={t('mixer.presets')}>
        {(['all', 'melody', 'noDrums', 'drumsOnly', 'bassOnly'] as MixerPreset[]).map((p) => (
          <button key={p} type="button" class="chip" onClick={() => preset(p)}>
            {t('mixer.preset.' + p)}
          </button>
        ))}
      </div>
      <div class="master-fx">
        <Slider
          label={t('mixer.masterReverb')}
          value={s.reverb}
          min={0}
          max={2}
          step={0.01}
          resetTo={1}
          onInput={(v) => patchSettings({ reverb: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label={t('mixer.masterChorus')}
          value={s.chorus}
          min={0}
          max={2}
          step={0.01}
          resetTo={1}
          onInput={(v) => patchSettings({ chorus: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </div>
      {view === 'channels' ? (
        <ul class="strips" ref={listRef}>
          {used.map((ch) => (
            <Strip key={ch} ch={ch} />
          ))}
          <Meters channels={used} />
        </ul>
      ) : (
        <TrackView />
      )}
    </aside>
  );
}
