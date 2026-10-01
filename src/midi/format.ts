import { CC_NAMES, keySignatureName, noteName, programName } from './gm';
import { decodeText } from './encoding';
import { META_NAMES, type EventTable } from './types';

export type EventCategory = 'note' | 'cc' | 'program' | 'pitch' | 'pressure' | 'meta' | 'sysex';

export function eventCategory(status: number): EventCategory {
  if (status === 0xff) return 'meta';
  if (status === 0xf0 || status === 0xf7) return 'sysex';
  switch (status & 0xf0) {
    case 0x80:
    case 0x90:
      return 'note';
    case 0xb0:
      return 'cc';
    case 0xc0:
      return 'program';
    case 0xe0:
      return 'pitch';
    default:
      return 'pressure';
  }
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');

export interface FormattedEvent {
  type: string;
  detail: string;
}

/** イベント表の 1 行を人が読める形にする */
export function formatEvent(
  e: EventTable,
  i: number,
  encoding: Parameters<typeof decodeText>[1] = 'utf-8',
): FormattedEvent {
  const status = e.status[i];
  const data = e.data.subarray(e.dataOffset[i], e.dataOffset[i] + e.dataLength[i]);
  if (status === 0xff) {
    const mt = e.metaType[i];
    const name = META_NAMES[mt] ?? `Meta 0x${mt.toString(16)}`;
    if (mt >= 0x01 && mt <= 0x09) return { type: name, detail: decodeText(data, encoding) };
    if (mt === 0x51 && data.length >= 3) {
      const us = (data[0] << 16) | (data[1] << 8) | data[2];
      return { type: name, detail: `${(60e6 / us).toFixed(2)} BPM (${us} µs)` };
    }
    if (mt === 0x58 && data.length >= 2) return { type: name, detail: `${data[0]}/${Math.pow(2, data[1])}` };
    if (mt === 0x59 && data.length >= 2)
      return { type: name, detail: keySignatureName((data[0] << 24) >> 24, data[1] === 1) };
    if (mt === 0x21 || mt === 0x20) return { type: name, detail: String(data[0] ?? '') };
    return { type: name, detail: hex(data) };
  }
  if (status === 0xf0 || status === 0xf7) return { type: 'SysEx', detail: 'F0 ' + hex(data) };
  const type = status & 0xf0;
  switch (type) {
    case 0x90:
      return data[1] === 0
        ? { type: 'Note Off', detail: `${noteName(data[0])} (${data[0]})` }
        : { type: 'Note On', detail: `${noteName(data[0])} (${data[0]}) vel ${data[1]}` };
    case 0x80:
      return { type: 'Note Off', detail: `${noteName(data[0])} (${data[0]}) vel ${data[1]}` };
    case 0xa0:
      return { type: 'Poly Pressure', detail: `${noteName(data[0])} ${data[1]}` };
    case 0xb0:
      return {
        type: 'Control Change',
        detail: `${data[0]} ${CC_NAMES[data[0]] ?? ''} = ${data[1]}`.replace('  ', ' '),
      };
    case 0xc0:
      return { type: 'Program Change', detail: `${data[0]} ${programName(data[0])}` };
    case 0xd0:
      return { type: 'Channel Pressure', detail: String(data[0]) };
    case 0xe0: {
      const v = (data[1] << 7) | data[0];
      return { type: 'Pitch Bend', detail: `${v - 8192}` };
    }
  }
  return { type: `0x${status.toString(16)}`, detail: hex(data) };
}
