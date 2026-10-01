import { batch } from '@preact/signals';
import {
  fullscreenViz,
  masterMuted,
  mixer,
  modal,
  patchSettings,
  pcKeyboard,
  redo,
  settings,
  undo,
} from '../state/store';
import {
  clearLoop,
  liveNoteOff,
  liveNoteOn,
  next,
  prev,
  seekBars,
  seekBy,
  setLoopA,
  setLoopB,
  togglePlay,
  toggleLoop,
} from '../audio/player';
import { pickFile } from './download';
import { addFiles } from '../audio/player';

/** PC キーボード → MIDI ノート（下段 C3〜、上段 C4〜） */
export const PC_KEYMAP: Record<string, number> = {
  KeyZ: 48,
  KeyS: 49,
  KeyX: 50,
  KeyD: 51,
  KeyC: 52,
  KeyV: 53,
  KeyG: 54,
  KeyB: 55,
  KeyH: 56,
  KeyN: 57,
  KeyJ: 58,
  KeyM: 59,
  Comma: 60,
  KeyL: 61,
  Period: 62,
  Semicolon: 63,
  Slash: 64,
  KeyQ: 60,
  Digit2: 61,
  KeyW: 62,
  Digit3: 63,
  KeyE: 64,
  KeyR: 65,
  Digit5: 66,
  KeyT: 67,
  Digit6: 68,
  KeyY: 69,
  Digit7: 70,
  KeyU: 71,
  KeyI: 72,
  Digit9: 73,
  KeyO: 74,
  Digit0: 75,
  KeyP: 76,
  BracketLeft: 77,
  Equal: 78,
  BracketRight: 79,
};

export interface ShortcutDef {
  keys: string;
  action: string; // i18n key
}

export const SHORTCUTS: ShortcutDef[] = [
  { keys: 'Space', action: 'sc.play' },
  { keys: '← / →', action: 'sc.seek5' },
  { keys: 'Shift + ← / →', action: 'sc.seekBar' },
  { keys: '↑ / ↓', action: 'sc.volume' },
  { keys: '[ / ]', action: 'sc.tempo' },
  { keys: '- / =', action: 'sc.transpose' },
  { keys: 'M', action: 'sc.mute' },
  { keys: 'L', action: 'sc.loop' },
  { keys: 'A / B', action: 'sc.loopAB' },
  { keys: 'Esc', action: 'sc.escape' },
  { keys: 'F', action: 'sc.fullscreen' },
  { keys: 'N / P', action: 'sc.nextPrev' },
  { keys: '1 – 9', action: 'sc.solo' },
  { keys: '0', action: 'sc.unsolo' },
  { keys: 'K', action: 'sc.pcKeyboard' },
  { keys: 'Ctrl + O', action: 'sc.open' },
  { keys: 'Ctrl + Z / Ctrl + Shift + Z', action: 'sc.undo' },
  { keys: '?', action: 'sc.help' },
];

const isTyping = (el: EventTarget | null) => {
  const e = el as HTMLElement | null;
  if (!e) return false;
  const tag = e.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.isContentEditable;
};

const held = new Set<string>();

export function toggleFullscreen() {
  const el = document.querySelector('.viz-panel') as HTMLElement | null;
  if (!document.fullscreenElement && el?.requestFullscreen) {
    el.requestFullscreen().catch(() => (fullscreenViz.value = !fullscreenViz.value));
  } else if (document.fullscreenElement) document.exitFullscreen();
  else fullscreenViz.value = !fullscreenViz.value;
}

export function setupShortcuts() {
  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && e.code === 'KeyY') {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && e.code === 'KeyO') {
      e.preventDefault();
      pickFile('.mid,.midi,.smf,.kar,.rmi,.zip,.sf2,.sf3,.dls', true).then((f) => {
        if (f.length) addFiles(f);
      });
      return;
    }
    if (mod || e.altKey) return;
    if (modal.value && e.code !== 'Escape') return;

    // PC キーボード演奏モード
    if (pcKeyboard.value && PC_KEYMAP[e.code] !== undefined) {
      e.preventDefault();
      if (!e.repeat && !held.has(e.code)) {
        held.add(e.code);
        liveNoteOn(0, PC_KEYMAP[e.code], e.shiftKey ? 127 : 96);
      }
      return;
    }

    const s = settings.value;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (e.shiftKey) seekBars(-1);
        else seekBy(-5);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (e.shiftKey) seekBars(1);
        else seekBy(5);
        break;
      case 'ArrowUp':
        e.preventDefault();
        patchSettings({ volume: Math.min(1.5, Math.round((s.volume + 0.05) * 100) / 100) });
        break;
      case 'ArrowDown':
        e.preventDefault();
        patchSettings({ volume: Math.max(0, Math.round((s.volume - 0.05) * 100) / 100) });
        break;
      case 'BracketLeft':
        patchSettings({ tempo: Math.max(0.25, Math.round((s.tempo - 0.05) * 100) / 100) });
        break;
      case 'BracketRight':
        patchSettings({ tempo: Math.min(4, Math.round((s.tempo + 0.05) * 100) / 100) });
        break;
      case 'Minus':
        patchSettings({ transpose: s.transpose - 1 });
        break;
      case 'Equal':
        patchSettings({ transpose: s.transpose + 1 });
        break;
      case 'KeyM':
        masterMuted.value = !masterMuted.value;
        break;
      case 'KeyL':
        toggleLoop();
        break;
      case 'KeyA':
        setLoopA();
        break;
      case 'KeyB':
        setLoopB();
        break;
      case 'KeyF':
        toggleFullscreen();
        break;
      case 'KeyN':
        next();
        break;
      case 'KeyP':
        prev();
        break;
      case 'KeyK':
        pcKeyboard.value = !pcKeyboard.value;
        break;
      case 'Escape':
        if (modal.value) modal.value = null;
        else if (fullscreenViz.value) fullscreenViz.value = false;
        else clearLoop();
        break;
      default:
        if (e.key === '?') {
          modal.value = modal.value === 'help' ? null : 'help';
          break;
        }
        if (/^Digit[0-9]$/.test(e.code)) {
          const n = Number(e.code.slice(5));
          batch(() => {
            const m = mixer.value.map((c) => ({ ...c }));
            if (n === 0) m.forEach((c) => (c.solo = false));
            else m[n - 1].solo = !m[n - 1].solo;
            mixer.value = m;
          });
        }
    }
  });
  window.addEventListener('keyup', (e) => {
    if (held.has(e.code)) {
      held.delete(e.code);
      liveNoteOff(0, PC_KEYMAP[e.code]);
    }
  });
  window.addEventListener('blur', () => {
    for (const code of held) liveNoteOff(0, PC_KEYMAP[code]);
    held.clear();
  });
}
