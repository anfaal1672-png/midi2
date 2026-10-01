import { effect } from '@preact/signals';
import { settings } from '../state/store';

/** テーマ（ダーク/ライト/システム）とアクセントカラーを DOM に反映 */
export function setupTheme() {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    const s = settings.value;
    const root = document.documentElement;
    if (s.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = s.theme;
    const resolved = s.theme === 'system' ? (mq.matches ? 'dark' : 'light') : s.theme;
    root.dataset.resolvedTheme = resolved;
    root.style.setProperty('--accent', s.accent);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0e1116' : '#f6f7f9');
  };
  effect(apply);
  mq.addEventListener('change', apply);
}
