import { effect } from '@preact/signals';
import { midiAccess, recording, settings } from '../state/store';
import { ensureEngine, liveMessage, getEngine, addIncoming, liveHooks } from './player';
import { recordingToSMF, type RecordedEvent } from './recorder';
import { errorMessage, toast } from '../state/notify';
import { t } from '../ui/i18n';

let access: MIDIAccess | null = null;
let currentInput: MIDIInput | null = null;
let recorded: RecordedEvent[] = [];

function refresh() {
  if (!access) return;
  const inputs = [...access.inputs.values()].map((p) => ({ id: p.id, name: p.name ?? p.id }));
  const outputs = [...access.outputs.values()].map((p) => ({ id: p.id, name: p.name ?? p.id }));
  midiAccess.value = { ...midiAccess.value, enabled: true, inputs, outputs, error: undefined };
  const eng = getEngine();
  if (eng) {
    eng.setOutputs(
      [...access.outputs.values()].map((o) => ({
        id: o.id,
        send: (d: number[] | Uint8Array) => {
          try {
            o.send(d);
          } catch {}
        },
      })),
    );
    const s = settings.value;
    eng.setRouting(s.midiOutput === 'external', s.channelRoutes, s.defaultOutputId);
  }
  bindInput(settings.value.midiInputId);
}

export async function enableMIDI(): Promise<boolean> {
  if (!('requestMIDIAccess' in navigator)) {
    midiAccess.value = { ...midiAccess.value, supported: false };
    return false;
  }
  try {
    await ensureEngine();
    try {
      access = await navigator.requestMIDIAccess({ sysex: true });
    } catch {
      access = await navigator.requestMIDIAccess({ sysex: false });
    }
    access.onstatechange = () => refresh();
    refresh();
    return true;
  } catch (err) {
    midiAccess.value = { ...midiAccess.value, enabled: false, error: errorMessage(err) };
    toast(t('midi.denied', { msg: errorMessage(err) }), 'error');
    return false;
  }
}

function onMessage(e: MIDIMessageEvent) {
  const data = e.data;
  if (!data || data.length === 0) return;
  // アクティブセンシングとクロックは無視
  if (data[0] === 0xfe || data[0] === 0xf8) return;
  liveMessage(data);
  const r = recording.value;
  if (r.active) {
    recorded.push({ ms: performance.now() - r.startedAt, data: Array.from(data) });
    if (recorded.length % 16 === 0) recording.value = { ...r, count: recorded.length };
  }
}

function bindInput(id: string) {
  if (!access) return;
  if (currentInput) currentInput.onmidimessage = null;
  currentInput = null;
  const input = id ? access.inputs.get(id) : [...access.inputs.values()][0];
  if (input) {
    currentInput = input;
    input.onmidimessage = onMessage;
  }
}

effect(() => {
  const id = settings.value.midiInputId;
  if (access) bindInput(id);
});

// ---- 画面鍵盤 / PC キーボードの演奏も録音対象にする
liveHooks.record = (data: number[]) => {
  const r = recording.value;
  if (r.active) recorded.push({ ms: performance.now() - r.startedAt, data });
};

export function startRecording() {
  recorded = [];
  recording.value = { active: true, startedAt: performance.now(), count: 0 };
  toast(t('rec.started'), 'info');
}

export async function stopRecording(save = true) {
  const r = recording.value;
  recording.value = { active: false, startedAt: 0, count: 0 };
  if (!save || !r.active) return;
  if (!recorded.length) {
    toast(t('rec.empty'), 'warn');
    return;
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const data = recordingToSMF(recorded, 120, `Recording ${stamp}`);
  await addIncoming([{ name: `recording-${stamp}.mid`, data, source: 'recording' }], { play: false });
  toast(t('rec.saved'), 'success');
}

export function sendReset(mode: 'gm' | 'gs' | 'xg' | 'gm2') {
  getEngine()?.sendResetToExternal(mode);
}
