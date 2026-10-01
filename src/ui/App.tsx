import { useEffect, useState } from 'preact/hooks';
import {
  Settings as SettingsIcon,
  HelpCircle,
  Info,
  FileDown,
  Redo2,
  Undo2,
  PanelLeft,
  PanelRight,
  Music2,
  ListMusic,
  SlidersHorizontal,
  Activity,
  Download as InstallIcon,
  Sun,
  Moon,
} from 'lucide-preact';
import {
  canRedo,
  canUndo,
  engineStatus,
  installPrompt,
  mobileTab,
  modal,
  patchSettings,
  redo,
  settings,
  sfLoadingName,
  sfProgress,
  undo,
  updateReady,
  voiceCount,
  status,
  recording,
} from '../state/store';
import { dismissToast, logs, toasts } from '../state/notify';
import { addFiles, ensureEngine } from '../audio/player';
import { Transport } from './Transport';
import { LibraryPanel } from './LibraryPanel';
import { MixerPanel } from './Mixer';
import { VisualPanel } from './VisualPanel';
import { SimpleApp } from './SimpleApp';
import { AboutModal, ExportModal, HelpModal, SettingsModal, UrlModal } from './Modals';
import { IconButton } from './primitives';
import { t } from './i18n';

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map((x) => (
        <div key={x.id} class={`toast ${x.kind}`}>
          <span>{x.text}</span>
          {x.action && (
            <button
              type="button"
              class="btn small"
              onClick={() => {
                x.action!.run();
                dismissToast(x.id);
              }}
            >
              {x.action.label}
            </button>
          )}
          <button
            type="button"
            class="icon-btn"
            aria-label={t('common.close')}
            onClick={() => dismissToast(x.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function DropOverlay() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setActive(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setActive(false);
      const files = await collectDropped(e.dataTransfer!);
      if (files.length) addFiles(files, { play: true });
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
  if (!active) return null;
  return (
    <div class="drop-overlay" aria-hidden="true">
      <div class="drop-box">
        <Music2 size={48} />
        <p>{t('drop.title')}</p>
        <small>{t('drop.hint')}</small>
      </div>
    </div>
  );
}

/** フォルダーのドロップにも対応してファイルを集める */
async function collectDropped(dt: DataTransfer): Promise<File[]> {
  const items = [...dt.items].filter((i) => i.kind === 'file');
  const entries = items.map((i) => (i as any).webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dt.files];
  const out: File[] = [];
  const walk = async (entry: any): Promise<void> => {
    if (entry.isFile) {
      out.push(await new Promise<File>((res, rej) => entry.file(res, rej)));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch: any[] = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function DebugPanel() {
  const l = logs.value.slice(-200).reverse();
  return (
    <div class="debug-panel" role="log" aria-label={t('set.debug')}>
      <div class="debug-head">
        <strong>{t('set.debug')}</strong>
        <span class="muted small">
          {t('debug.voices', { n: voiceCount.value })} · {t('debug.engine')}: {engineStatus.value}
        </span>
        <button
          type="button"
          class="icon-btn"
          aria-label={t('common.close')}
          onClick={() => patchSettings({ showDebug: false })}
        >
          ×
        </button>
      </div>
      <ul>
        {l.map((e, i) => (
          <li key={i} class={`log-${e.level}`}>
            <span class="mono muted">{new Date(e.time).toLocaleTimeString()}</span> {e.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Header() {
  const s = settings.value;
  const resolvedDark = document.documentElement.dataset.resolvedTheme !== 'light';
  return (
    <header class="app-header">
      <div class="brand">
        <img src="/icons/icon.svg" alt="" width={28} height={28} />
        <span class="brand-name">MIDI Studio</span>
        {recording.value.active && <span class="rec-dot" title={t('rec.recording')} />}
      </div>
      <div class="header-actions">
        <button
          type="button"
          class="btn small simple-switch"
          onClick={() => patchSettings({ uiMode: 'simple' })}
          title={t('simple.switchToSimpleHint')}
          data-testid="to-simple"
        >
          {t('simple.switchToSimple')}
        </button>
        <IconButton
          label={t('set.showLeft')}
          active={s.showLeft}
          class="desktop-only"
          onClick={() => patchSettings({ showLeft: !s.showLeft })}
        >
          <PanelLeft size={18} />
        </IconButton>
        <IconButton
          label={t('set.showRight')}
          active={s.showRight}
          class="desktop-only"
          onClick={() => patchSettings({ showRight: !s.showRight })}
        >
          <PanelRight size={18} />
        </IconButton>
        <IconButton label={t('common.undo')} disabled={!canUndo.value} onClick={undo}>
          <Undo2 size={18} />
        </IconButton>
        <IconButton label={t('common.redo')} disabled={!canRedo.value} onClick={redo}>
          <Redo2 size={18} />
        </IconButton>
        <IconButton
          label={t('export.title')}
          onClick={() => (modal.value = 'export')}
          data-testid="open-export"
        >
          <FileDown size={18} />
        </IconButton>
        <IconButton
          label={resolvedDark ? t('set.themeLight') : t('set.themeDark')}
          onClick={() => patchSettings({ theme: resolvedDark ? 'light' : 'dark' })}
        >
          {resolvedDark ? <Sun size={18} /> : <Moon size={18} />}
        </IconButton>
        {installPrompt.value && (
          <IconButton label={t('pwa.install')} onClick={() => installPrompt.value?.prompt()}>
            <InstallIcon size={18} />
          </IconButton>
        )}
        <IconButton label={t('help.title')} onClick={() => (modal.value = 'help')}>
          <HelpCircle size={18} />
        </IconButton>
        <IconButton label={t('about.title')} onClick={() => (modal.value = 'about')}>
          <Info size={18} />
        </IconButton>
        <IconButton
          label={t('set.title')}
          onClick={() => (modal.value = 'settings')}
          data-testid="open-settings"
        >
          <SettingsIcon size={18} />
        </IconButton>
      </div>
    </header>
  );
}

function StartGate() {
  // 初回操作まで AudioContext は止まっているので、読み込み状況を表示する
  const sf = sfProgress.value;
  if (engineStatus.value === 'ready' || engineStatus.value === 'none') return null;
  return (
    <div class="sf-banner" role="status">
      {engineStatus.value === 'error' ? (
        <>
          {t('error.engineShort')}{' '}
          <button type="button" class="btn small" onClick={() => ensureEngine()}>
            {t('common.retry')}
          </button>
        </>
      ) : (
        <>
          <span class="spinner" aria-hidden="true" />{' '}
          {t('sf.loadingName', { name: sfLoadingName.value || 'SoundFont' })}
          {sf !== null && <progress max={1} value={sf} />}
        </>
      )}
    </div>
  );
}

export function App() {
  if (settings.value.uiMode === 'simple') return <SimpleApp />;
  return <FullApp />;
}

function FullApp() {
  const s = settings.value;
  const m = modal.value;
  const mt = mobileTab.value;
  useEffect(() => {
    document.title =
      status.value === 'playing'
        ? `▶ ${document.title.replace(/^▶ /, '')}`
        : document.title.replace(/^▶ /, '');
  }, [status.value]);
  return (
    <div
      class={`app ${s.showLeft ? '' : 'no-left'} ${s.showRight ? '' : 'no-right'} mobile-${mt}`}
      style={{ '--left-w': `${s.leftWidth}px`, '--right-w': `${s.rightWidth}px` } as any}
    >
      <a class="skip-link" href="#main-viz">
        {t('a11y.skip')}
      </a>
      <Header />
      <StartGate />
      {updateReady.value && (
        <div class="update-banner" role="status">
          {t('pwa.update')}
          <button type="button" class="btn small primary" onClick={() => updateReady.value?.()}>
            {t('pwa.reload')}
          </button>
        </div>
      )}
      <div class="workspace">
        <LibraryPanel />
        <main id="main-viz" class="center">
          <VisualPanel />
        </main>
        <MixerPanel />
      </div>
      <nav class="mobile-nav" aria-label={t('a11y.mobileNav')}>
        <button
          type="button"
          class={mt === 'library' ? 'active' : ''}
          onClick={() => (mobileTab.value = 'library')}
        >
          <ListMusic size={20} />
          <span>{t('mobile.library')}</span>
        </button>
        <button
          type="button"
          class={mt === 'visual' ? 'active' : ''}
          onClick={() => (mobileTab.value = 'visual')}
        >
          <Activity size={20} />
          <span>{t('mobile.visual')}</span>
        </button>
        <button
          type="button"
          class={mt === 'mixer' ? 'active' : ''}
          onClick={() => (mobileTab.value = 'mixer')}
        >
          <SlidersHorizontal size={20} />
          <span>{t('mobile.mixer')}</span>
        </button>
      </nav>
      <Transport />
      {s.showDebug && <DebugPanel />}
      <DropOverlay />
      <Toasts />
      {m === 'settings' && <SettingsModal />}
      {m === 'export' && <ExportModal />}
      {m === 'url' && <UrlModal />}
      {m === 'help' && <HelpModal />}
      {m === 'about' && <AboutModal />}
    </div>
  );
}
