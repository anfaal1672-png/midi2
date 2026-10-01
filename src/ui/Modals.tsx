import { useRef, useState } from 'preact/hooks';
import {
  ArrowDown,
  ArrowUp,
  Download,
  Link2,
  Trash2,
  Upload,
  Usb,
  Circle,
  Square as SquareIcon,
} from 'lucide-preact';
import {
  analysis,
  currentSong,
  engineStatus,
  exportSettingsJSON,
  importSettingsJSON,
  midiAccess,
  modal,
  patchSettings,
  presets,
  recording,
  settings,
  settingsTab,
  soundfonts,
} from '../state/store';
import { ACCENTS, DEFAULT_SETTINGS, type Settings } from '../state/settings';
import { ENCODING_OPTIONS, type TextEncodingName } from '../midi/encoding';
import {
  addFromUrl,
  addSoundFontFile,
  moveSoundFont,
  removeSoundFont,
  shareUrl,
  updateSoundFontMeta,
} from '../audio/player';
import { Modal, Slider, Toggle } from './primitives';
import { pickFile, saveText } from './download';
import { SHORTCUTS } from './shortcuts';
import { t } from './i18n';
import { errorMessage, toast } from '../state/notify';

const close = () => (modal.value = null);

function Field(props: { label: string; children: preact.ComponentChildren; hint?: string }) {
  return (
    <div class="field">
      <span class="field-label">{props.label}</span>
      <div class="field-control">{props.children}</div>
      {props.hint && <small class="muted field-hint">{props.hint}</small>}
    </div>
  );
}

function Select<K extends keyof Settings>(props: {
  k: K;
  options: { value: Settings[K]; label: string }[];
  label: string;
}) {
  const s = settings.value;
  return (
    <select
      aria-label={props.label}
      value={String(s[props.k])}
      onChange={(e) => {
        const raw = (e.target as HTMLSelectElement).value;
        const opt = props.options.find((o) => String(o.value) === raw);
        if (opt) patchSettings({ [props.k]: opt.value } as Partial<Settings>);
      }}
    >
      {props.options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function GeneralTab() {
  const s = settings.value;
  return (
    <div class="settings-grid">
      <Field label={t('set.lang')}>
        <Select
          k="lang"
          label={t('set.lang')}
          options={[
            { value: 'auto', label: t('set.auto') },
            { value: 'ja', label: '日本語' },
            { value: 'en', label: 'English' },
          ]}
        />
      </Field>
      <Field label={t('set.theme')}>
        <Select
          k="theme"
          label={t('set.theme')}
          options={[
            { value: 'system', label: t('set.themeSystem') },
            { value: 'dark', label: t('set.themeDark') },
            { value: 'light', label: t('set.themeLight') },
          ]}
        />
      </Field>
      <Field label={t('set.accent')}>
        <div class="swatches" role="radiogroup" aria-label={t('set.accent')}>
          {ACCENTS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={s.accent === c}
              aria-label={c}
              class={`swatch ${s.accent === c ? 'on' : ''}`}
              style={{ background: c }}
              onClick={() => patchSettings({ accent: c })}
            />
          ))}
          <input
            type="color"
            aria-label={t('set.customColor')}
            value={s.accent}
            onInput={(e) => patchSettings({ accent: (e.target as HTMLInputElement).value })}
          />
        </div>
      </Field>
      <Field label={t('set.repeat')}>
        <Select
          k="repeat"
          label={t('set.repeat')}
          options={[
            { value: 'none', label: t('repeat.none') },
            { value: 'one', label: t('repeat.one') },
            { value: 'all', label: t('repeat.all') },
          ]}
        />
      </Field>
      <Field label={t('set.fade')} hint={t('set.fadeHint')}>
        <Slider
          label={t('set.fade')}
          hideLabel
          value={s.fade}
          min={0}
          max={10}
          step={0.5}
          resetTo={0}
          onInput={(v) => patchSettings({ fade: v })}
          format={(v) => `${v.toFixed(1)}s`}
        />
      </Field>
      <Field label={t('set.loopCount')} hint={t('set.loopCountHint')}>
        <input
          type="number"
          min={0}
          max={999}
          value={s.loopCount}
          aria-label={t('set.loopCount')}
          onInput={(e) => patchSettings({ loopCount: Number((e.target as HTMLInputElement).value) })}
        />
      </Field>
      <Toggle
        label={t('set.skipToFirst')}
        checked={s.skipToFirstNote}
        onChange={(v) => patchSettings({ skipToFirstNote: v })}
      />
      <Toggle
        label={t('set.keepMixer')}
        checked={s.keepMixer}
        onChange={(v) => patchSettings({ keepMixer: v })}
      />
      <Toggle
        label={t('set.resume')}
        checked={s.resumeLast}
        onChange={(v) => patchSettings({ resumeLast: v })}
      />
      <Field label={t('lyrics.encoding')}>
        <Select
          k="lyricEncoding"
          label={t('lyrics.encoding')}
          options={ENCODING_OPTIONS.map((o) => ({
            value: o as TextEncodingName,
            label: o === 'auto' ? t('lyrics.auto') : o,
          }))}
        />
      </Field>
    </div>
  );
}

function AudioTab() {
  const s = settings.value;
  return (
    <div class="settings-grid">
      <Field label={t('set.volume')}>
        <Slider
          label={t('set.volume')}
          hideLabel
          value={s.volume}
          min={0}
          max={1.5}
          resetTo={0.8}
          onInput={(v) => patchSettings({ volume: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </Field>
      <Field label={t('set.tempo')}>
        <Slider
          label={t('set.tempo')}
          hideLabel
          value={s.tempo}
          min={0.25}
          max={4}
          step={0.01}
          resetTo={1}
          onInput={(v) => patchSettings({ tempo: v })}
          format={(v) => `×${v.toFixed(2)}`}
        />
      </Field>
      <Field label={t('set.transpose')}>
        <Slider
          label={t('set.transpose')}
          hideLabel
          value={s.transpose}
          min={-24}
          max={24}
          step={1}
          resetTo={0}
          onInput={(v) => patchSettings({ transpose: v })}
          format={(v) => (v > 0 ? `+${v}` : String(v))}
        />
      </Field>
      <Field label={t('set.tuning')}>
        <Slider
          label={t('set.tuning')}
          hideLabel
          value={s.a4}
          min={415}
          max={466}
          step={0.5}
          resetTo={440}
          onInput={(v) => patchSettings({ a4: v })}
          format={(v) => `A4 = ${v.toFixed(1)} Hz`}
        />
      </Field>
      <Field label={t('set.reverb')}>
        <Slider
          label={t('set.reverb')}
          hideLabel
          value={s.reverb}
          min={0}
          max={2}
          resetTo={1}
          onInput={(v) => patchSettings({ reverb: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </Field>
      <Field label={t('set.chorus')}>
        <Slider
          label={t('set.chorus')}
          hideLabel
          value={s.chorus}
          min={0}
          max={2}
          resetTo={1}
          onInput={(v) => patchSettings({ chorus: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </Field>
      <Field label={t('set.system')} hint={t('set.systemHint')}>
        <Select
          k="system"
          label={t('set.system')}
          options={[
            {
              value: 'auto',
              label: `${t('set.auto')}${analysis.value ? ` (${analysis.value.detectedSystem.toUpperCase()})` : ''}`,
            },
            { value: 'gm', label: 'GM' },
            { value: 'gm2', label: 'GM2' },
            { value: 'gs', label: 'GS' },
            { value: 'xg', label: 'XG' },
          ]}
        />
      </Field>
      <Field label={t('set.voiceCap')} hint={t('set.voiceCapHint')}>
        <Slider
          label={t('set.voiceCap')}
          hideLabel
          value={s.voiceCap}
          min={32}
          max={1024}
          step={16}
          resetTo={256}
          onInput={(v) => patchSettings({ voiceCap: v })}
          format={(v) => String(v)}
        />
      </Field>
      <Toggle
        label={t('set.autoVoice')}
        checked={s.autoVoiceReduce}
        onChange={(v) => patchSettings({ autoVoiceReduce: v })}
      />
      <Toggle label={t('set.limiter')} checked={s.limiter} onChange={(v) => patchSettings({ limiter: v })} />
      <Field label={t('set.latency')} hint={t('set.latencyHint')}>
        <Select
          k="latencyHint"
          label={t('set.latency')}
          options={[
            { value: 'interactive', label: t('set.latency.interactive') },
            { value: 'balanced', label: t('set.latency.balanced') },
            { value: 'playback', label: t('set.latency.playback') },
          ]}
        />
      </Field>
    </div>
  );
}

function SoundFontTab() {
  const list = soundfonts.value;
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <p class="muted small">{t('sf.desc')}</p>
      <button
        type="button"
        class="btn primary"
        disabled={busy}
        onClick={async () => {
          const files = await pickFile('.sf2,.sf3,.sfogg,.dls', true);
          setBusy(true);
          for (const f of files) await addSoundFontFile(f);
          setBusy(false);
        }}
      >
        <Upload size={16} /> {busy ? t('sf.adding') : t('sf.add')}
      </button>
      <ol class="sf-list">
        {list.map((sf, i) => (
          <li key={sf.id} class="sf-item">
            <Toggle
              label={sf.name}
              hint={`${(sf.size / 1048576).toFixed(1)} MB`}
              checked={sf.enabled}
              onChange={(v) => updateSoundFontMeta({ ...sf, enabled: v })}
            />
            <label class="small">
              {t('sf.bankOffset')}
              <input
                type="number"
                min={0}
                max={127}
                value={sf.bankOffset}
                onChange={(e) =>
                  updateSoundFontMeta({ ...sf, bankOffset: Number((e.target as HTMLInputElement).value) })
                }
              />
            </label>
            <span class="row-actions">
              <button
                type="button"
                class="icon-btn"
                aria-label={t('sf.up')}
                disabled={i === 0}
                onClick={() => moveSoundFont(sf.id, -1)}
              >
                <ArrowUp size={14} />
              </button>
              <button
                type="button"
                class="icon-btn"
                aria-label={t('sf.down')}
                disabled={i === list.length - 1}
                onClick={() => moveSoundFont(sf.id, 1)}
              >
                <ArrowDown size={14} />
              </button>
              <button
                type="button"
                class="icon-btn"
                aria-label={t('lib.delete')}
                onClick={() => confirm(t('sf.confirmDelete', { name: sf.name })) && removeSoundFont(sf.id)}
              >
                <Trash2 size={14} />
              </button>
            </span>
          </li>
        ))}
        <li class="sf-item default">
          <span>
            <strong>GeneralUser GS v2.0.3</strong> <span class="muted small">— {t('sf.default')}</span>
          </span>
          <span class="muted small">{t('sf.presets', { n: presets.value.length })}</span>
        </li>
      </ol>
      <p class="muted small">{t('sf.priorityHint')}</p>
    </div>
  );
}

function DevicesTab() {
  const ma = midiAccess.value;
  const s = settings.value;
  const rec = recording.value;
  if (!ma.supported) return <p class="notice">{t('midi.unsupported')}</p>;
  return (
    <div class="settings-grid">
      {!ma.enabled ? (
        <div>
          <p class="muted small">{t('midi.desc')}</p>
          <button
            type="button"
            class="btn primary"
            onClick={() => import('../audio/midiDevices').then((m) => m.enableMIDI())}
          >
            <Usb size={16} /> {t('midi.enable')}
          </button>
          {ma.error && <p class="notice error">{ma.error}</p>}
        </div>
      ) : (
        <>
          <Field label={t('midi.outputMode')}>
            <Select
              k="midiOutput"
              label={t('midi.outputMode')}
              options={[
                { value: 'internal', label: t('midi.internal') },
                { value: 'external', label: t('midi.external') },
              ]}
            />
          </Field>
          <Field label={t('midi.defaultOutput')} hint={t('midi.routeHint')}>
            <select
              aria-label={t('midi.defaultOutput')}
              value={s.defaultOutputId}
              onChange={(e) => patchSettings({ defaultOutputId: (e.target as HTMLSelectElement).value })}
            >
              <option value="">{t('midi.none')}</option>
              {ma.outputs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('midi.reset')}>
            <div class="btn-row">
              {(['gm', 'gs', 'xg', 'gm2'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  class="btn small"
                  onClick={() => import('../audio/midiDevices').then((x) => x.sendReset(m))}
                >
                  {m.toUpperCase()} Reset
                </button>
              ))}
            </div>
          </Field>
          <Field label={t('midi.input')}>
            <select
              aria-label={t('midi.input')}
              value={s.midiInputId}
              onChange={(e) => patchSettings({ midiInputId: (e.target as HTMLSelectElement).value })}
            >
              <option value="">{t('midi.firstInput')}</option>
              {ma.inputs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <p class="muted small">{t('midi.devices', { i: ma.inputs.length, o: ma.outputs.length })}</p>
        </>
      )}
      <Field label={t('rec.label')} hint={t('rec.hint')}>
        {rec.active ? (
          <button
            type="button"
            class="btn danger"
            onClick={() => import('../audio/midiDevices').then((m) => m.stopRecording(true))}
          >
            <SquareIcon size={14} /> {t('rec.stop')}
          </button>
        ) : (
          <button
            type="button"
            class="btn"
            onClick={() => import('../audio/midiDevices').then((m) => m.startRecording())}
          >
            <Circle size={14} fill="currentColor" color="#ef4444" /> {t('rec.start')}
          </button>
        )}
      </Field>
    </div>
  );
}

function DisplayTab() {
  const s = settings.value;
  return (
    <div class="settings-grid">
      <Toggle
        label={t('set.noteNames')}
        checked={s.showNoteNames}
        onChange={(v) => patchSettings({ showNoteNames: v })}
      />
      <Toggle
        label={t('visual.follow')}
        checked={s.rollFollow}
        onChange={(v) => patchSettings({ rollFollow: v })}
      />
      <Field label={t('visual.colorBy')}>
        <Select
          k="colorBy"
          label={t('visual.colorBy')}
          options={[
            { value: 'channel', label: t('visual.color.channel') },
            { value: 'track', label: t('visual.color.track') },
            { value: 'velocity', label: t('visual.color.velocity') },
          ]}
        />
      </Field>
      <Field label={t('set.rollZoom')}>
        <Slider
          label={t('set.rollZoom')}
          hideLabel
          value={s.rollZoom}
          min={20}
          max={800}
          step={5}
          resetTo={140}
          onInput={(v) => patchSettings({ rollZoom: v })}
          format={(v) => `${Math.round(v)} px/s`}
        />
      </Field>
      <Field label={t('visual.speed')}>
        <Slider
          label={t('visual.speed')}
          hideLabel
          value={s.fallingSpeed}
          min={0.5}
          max={8}
          step={0.1}
          resetTo={2.5}
          onInput={(v) => patchSettings({ fallingSpeed: v })}
          format={(v) => `${v.toFixed(1)}s`}
        />
      </Field>
      <Toggle
        label={t('set.showLeft')}
        checked={s.showLeft}
        onChange={(v) => patchSettings({ showLeft: v })}
      />
      <Toggle
        label={t('set.showRight')}
        checked={s.showRight}
        onChange={(v) => patchSettings({ showRight: v })}
      />
      <Toggle
        label={t('set.debug')}
        checked={s.showDebug}
        onChange={(v) => patchSettings({ showDebug: v })}
      />
      <p class="muted small">{t('set.obsHint')}</p>
    </div>
  );
}

function DataTab() {
  return (
    <div class="settings-grid">
      <Field label={t('set.exportSettings')}>
        <button
          type="button"
          class="btn"
          onClick={() => saveText(exportSettingsJSON(), 'midi-studio-settings.json')}
        >
          <Download size={14} /> {t('set.exportSettings')}
        </button>
      </Field>
      <Field label={t('set.importSettings')}>
        <button
          type="button"
          class="btn"
          onClick={async () => {
            const [f] = await pickFile('.json');
            if (!f) return;
            try {
              importSettingsJSON(await f.text());
              toast(t('set.imported'), 'success');
            } catch (e) {
              toast(errorMessage(e), 'error');
            }
          }}
        >
          <Upload size={14} /> {t('set.importSettings')}
        </button>
      </Field>
      <Field label={t('set.resetSettings')}>
        <button
          type="button"
          class="btn danger"
          onClick={() => {
            if (confirm(t('set.confirmReset'))) settings.value = { ...DEFAULT_SETTINGS };
          }}
        >
          {t('set.resetSettings')}
        </button>
      </Field>
      <Field label={t('set.storage')}>
        <StorageInfo />
      </Field>
    </div>
  );
}

function StorageInfo() {
  const [info, setInfo] = useState<string>('…');
  useState(() => {
    navigator.storage
      ?.estimate?.()
      .then((e) =>
        setInfo(`${((e.usage ?? 0) / 1048576).toFixed(1)} MB / ${((e.quota ?? 0) / 1048576).toFixed(0)} MB`),
      )
      .catch(() => setInfo('—'));
    navigator.storage?.persist?.().catch(() => {});
  });
  return <span class="mono small">{info}</span>;
}

export function SettingsModal() {
  const tabs = ['general', 'audio', 'soundfonts', 'devices', 'display', 'data'];
  const tab = settingsTab.value;
  return (
    <Modal title={t('set.title')} onClose={close} wide>
      <div class="tabs" role="tablist">
        {tabs.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            class={tab === k ? 'tab active' : 'tab'}
            onClick={() => (settingsTab.value = k)}
          >
            {t('set.tab.' + k)}
          </button>
        ))}
      </div>
      <div class="settings-body">
        {tab === 'general' && <GeneralTab />}
        {tab === 'audio' && <AudioTab />}
        {tab === 'soundfonts' && <SoundFontTab />}
        {tab === 'devices' && <DevicesTab />}
        {tab === 'display' && <DisplayTab />}
        {tab === 'data' && <DataTab />}
      </div>
    </Modal>
  );
}

export function ExportModal() {
  const [sr, setSr] = useState(48000);
  const [bits, setBits] = useState<16 | 24 | 32>(24);
  const [stems, setStems] = useState(false);
  const [norm, setNorm] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const a = analysis.value;
  const start = async () => {
    abort.current = new AbortController();
    setProgress(0);
    try {
      const m = await import('../audio/export');
      await m.exportWav({
        sampleRate: sr,
        bitDepth: bits,
        stems,
        normalize: norm,
        onProgress: setProgress,
        signal: abort.current.signal,
      });
      toast(t('export.done'), 'success');
    } catch (e) {
      if (errorMessage(e) === 'cancelled') toast(t('export.cancelled'), 'warn');
      else toast(t('export.failed', { msg: errorMessage(e) }), 'error');
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };
  const run = (fn: (m: typeof import('../audio/export')) => Promise<void>) =>
    import('../audio/export').then(fn).catch((e) => toast(errorMessage(e), 'error'));
  return (
    <Modal title={t('export.title')} onClose={() => (progress === null ? close() : undefined)}>
      {!a ? (
        <p>{t('export.noSong')}</p>
      ) : (
        <>
          <h3>{t('export.wav')}</h3>
          <div class="settings-grid">
            <Field label={t('export.sampleRate')}>
              <select
                value={sr}
                onChange={(e) => setSr(Number((e.target as HTMLSelectElement).value))}
                aria-label={t('export.sampleRate')}
              >
                <option value={44100}>44.1 kHz</option>
                <option value={48000}>48 kHz</option>
                <option value={96000}>96 kHz</option>
              </select>
            </Field>
            <Field label={t('export.bitDepth')}>
              <select
                value={bits}
                onChange={(e) => setBits(Number((e.target as HTMLSelectElement).value) as 16 | 24 | 32)}
                aria-label={t('export.bitDepth')}
              >
                <option value={16}>16 bit</option>
                <option value={24}>24 bit</option>
                <option value={32}>32 bit float</option>
              </select>
            </Field>
            <Toggle
              label={t('export.stems')}
              hint={t('export.stemsHint')}
              checked={stems}
              onChange={setStems}
            />
            <Toggle label={t('export.normalize')} checked={norm} onChange={setNorm} />
          </div>
          <p class="muted small">{t('export.wavHint', { song: currentSong.value?.name ?? '' })}</p>
          {progress !== null ? (
            <div class="progress-row">
              <progress max={1} value={progress} aria-label={t('export.progress')} />
              <span class="mono">{Math.round(progress * 100)}%</span>
              <button type="button" class="btn" onClick={() => abort.current?.abort()}>
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              class="btn primary"
              onClick={start}
              disabled={engineStatus.value !== 'ready'}
              data-testid="export-wav"
            >
              <Download size={16} /> {t('export.start')}
            </button>
          )}
          <hr />
          <h3>{t('export.midi')}</h3>
          <div class="btn-row">
            <button type="button" class="btn" onClick={() => run((m) => m.exportMidi(true))}>
              {t('export.midiEdited')}
            </button>
            <button type="button" class="btn" onClick={() => run((m) => m.exportMidi(false))}>
              {t('export.midiOriginal')}
            </button>
            <button type="button" class="btn" onClick={() => run((m) => m.exportPng())}>
              {t('export.png')}
            </button>
          </div>
          <p class="muted small">{t('export.midiHint')}</p>
        </>
      )}
    </Modal>
  );
}

export function UrlModal() {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const share = shareUrl();
  return (
    <Modal title={t('url.title')} onClose={close}>
      <form
        class="url-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!url.trim()) return;
          setBusy(true);
          const added = await addFromUrl(url.trim());
          setBusy(false);
          if (added.length) close();
        }}
      >
        <label class="field">
          <span class="field-label">{t('url.label')}</span>
          <input
            type="url"
            required
            placeholder="https://example.com/song.mid"
            value={url}
            onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
            autoFocus
          />
        </label>
        <p class="muted small">{t('url.corsHint')}</p>
        <button type="submit" class="btn primary" disabled={busy}>
          <Link2 size={16} /> {busy ? t('url.loading') : t('url.load')}
        </button>
      </form>
      {share && (
        <>
          <hr />
          <h3>{t('url.share')}</h3>
          <div class="share-row">
            <input
              type="text"
              readOnly
              value={share}
              aria-label={t('url.share')}
              onFocus={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              type="button"
              class="btn"
              onClick={() => {
                if (navigator.share)
                  navigator.share({ url: share, title: currentSong.value?.name }).catch(() => {});
                else navigator.clipboard?.writeText(share).then(() => toast(t('url.copied'), 'success'));
              }}
            >
              {t('url.copy')}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function HelpModal() {
  return (
    <Modal title={t('help.title')} onClose={close}>
      <table class="table shortcuts">
        <tbody>
          {SHORTCUTS.map((sc) => (
            <tr key={sc.keys}>
              <td>
                {sc.keys.split(' / ').map((k, i) => (
                  <span key={k}>
                    {i > 0 && ' / '}
                    <kbd>{k}</kbd>
                  </span>
                ))}
              </td>
              <td>{t(sc.action)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>{t('help.pcKeys')}</h3>
      <p class="small">{t('help.pcKeysDesc')}</p>
      <h3>{t('help.tips')}</h3>
      <ul class="small">
        <li>{t('help.tip1')}</li>
        <li>{t('help.tip2')}</li>
        <li>{t('help.tip3')}</li>
        <li>{t('help.tip4')}</li>
      </ul>
    </Modal>
  );
}

export function AboutModal() {
  return (
    <Modal title={t('about.title')} onClose={close}>
      <p>{t('about.desc')}</p>
      <p class="notice">{t('about.privacy')}</p>
      <h3>{t('about.credits')}</h3>
      <ul class="small">
        <li>
          <a href="https://github.com/spessasus/spessasynth_lib" target="_blank" rel="noopener noreferrer">
            spessasynth_lib / spessasynth_core
          </a>{' '}
          — Apache-2.0 (© Spessasus)
        </li>
        <li>
          <a href="https://schristiancollins.com/generaluser.php" target="_blank" rel="noopener noreferrer">
            GeneralUser GS v2.0.3
          </a>{' '}
          — © S. Christian Collins. {t('about.guLicense')}
        </li>
        <li>Preact, @preact/signals — MIT</li>
        <li>idb — ISC · fflate — MIT · Lucide icons — ISC</li>
        <li>{t('about.demos')}</li>
      </ul>
      <p class="small">
        <a href="/LICENSES/GeneralUser-GS.txt" target="_blank" rel="noopener">
          GeneralUser GS License
        </a>{' '}
        ·{' '}
        <a href="/LICENSES/THIRD_PARTY.txt" target="_blank" rel="noopener">
          Third-party licenses
        </a>
      </p>
    </Modal>
  );
}
