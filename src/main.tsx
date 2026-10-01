import { render } from 'preact';
import './styles/app.css';
import { App } from './ui/App';
import { VisualPanel } from './ui/VisualPanel';
import { setupTheme } from './ui/theme';
import { setupShortcuts } from './ui/shortcuts';
import {
  addIncoming,
  ensureEngine,
  handleLaunchParams,
  loadDemos,
  refreshLibrary,
  restoreQueue,
  resumeLast,
  setupMediaSessionHandlers,
  togglePlay,
} from './audio/player';
import { installPrompt, settings, songs, updateReady } from './state/store';
import { errorMessage, log, toast } from './state/notify';
import { t } from './ui/i18n';

const params = new URLSearchParams(location.search);
const obs = params.get('obs') === '1';

setupTheme();
setupShortcuts();
setupMediaSessionHandlers();

window.addEventListener('error', (e) => log('error', `${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => log('error', `unhandled: ${errorMessage(e.reason)}`));

const root = document.getElementById('app')!;
if (obs) {
  document.documentElement.classList.add('obs');
  render(
    <div class="obs-root" onDblClick={() => togglePlay()}>
      <VisualPanel />
    </div>,
    root,
  );
} else {
  render(<App />, root);
}

async function boot() {
  try {
    await refreshLibrary();
    await restoreQueue();
    // 共有ターゲット（Service Worker が一時保存したファイル）
    if (params.has('shared')) await consumeSharedFiles();
    const launched = await handleLaunchParams(params);
    if (!launched && settings.value.resumeLast) await resumeLast();
    if (!songs.value.length) await loadDemos();
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
  // SoundFont を先読み（初回表示を妨げないよう、最初の操作か少し待ってから）
  const preload = () => ensureEngine().catch(() => {});
  window.addEventListener('pointerdown', preload, { once: true });
  window.addEventListener('keydown', preload, { once: true });
  const idle = (window as any).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 300));
  setTimeout(() => idle(preload, { timeout: 3000 }), 2500);
  if (params.has('url') || params.has('shared'))
    history.replaceState(null, '', location.pathname + (obs ? '?obs=1' : ''));
}

async function consumeSharedFiles() {
  try {
    const cache = await caches.open('share-target');
    const keys = await cache.keys();
    const files = [];
    for (const req of keys) {
      const res = await cache.match(req);
      if (!res) continue;
      const name = decodeURIComponent(new URL(req.url).pathname.split('/').pop() ?? 'shared.mid');
      files.push({ name, data: await res.arrayBuffer() });
      await cache.delete(req);
    }
    if (files.length) await addIncoming(files, { play: true });
  } catch (err) {
    log('warn', 'share target: ' + errorMessage(err));
  }
}

// ファイルハンドラー（PWA としてインストール時に .mid を開く）
if ('launchQueue' in window) {
  (window as any).launchQueue.setConsumer(async (lp: { files: FileSystemFileHandle[] }) => {
    if (!lp.files?.length) return;
    const files = [];
    for (const h of lp.files) {
      const f = await h.getFile();
      files.push({ name: f.name, data: await f.arrayBuffer() });
    }
    addIncoming(files, { play: true });
  });
}

window.addEventListener('beforeinstallprompt', (e: any) => {
  e.preventDefault();
  installPrompt.value = {
    prompt: () => {
      e.prompt();
      installPrompt.value = null;
    },
  };
});

// iOS: 消音スイッチの案内（audioSession API が使えない古い Safari のみ）
const isIOS =
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (isIOS && !(navigator as any).audioSession) {
  window.addEventListener('pointerdown', () => toast(t('ios.silent'), 'info', { timeout: 7000 }), {
    once: true,
  });
}

if (import.meta.env.PROD && 'serviceWorker' in navigator && !obs) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    const update = registerSW({
      onNeedRefresh() {
        updateReady.value = () => update(true);
      },
      onOfflineReady() {
        toast(t('pwa.offlineReady'), 'success');
      },
    });
  });
}

boot();
