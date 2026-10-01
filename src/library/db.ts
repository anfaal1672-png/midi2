import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface SongMeta {
  id: string;
  name: string;
  fileName: string;
  size: number;
  addedAt: number;
  lastPlayedAt: number;
  playCount: number;
  favorite: boolean;
  duration: number;
  source: 'file' | 'url' | 'demo' | 'recording';
  url?: string;
}

export interface PlaylistRec {
  id: string;
  name: string;
  songIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SoundFontMeta {
  id: string;
  name: string;
  size: number;
  enabled: boolean;
  priority: number; // 小さいほど優先
  bankOffset: number;
  addedAt: number;
}

interface MidiDB extends DBSchema {
  songs: { key: string; value: SongMeta; indexes: { addedAt: number } };
  songData: { key: string; value: { id: string; data: ArrayBuffer } };
  playlists: { key: string; value: PlaylistRec };
  soundfonts: { key: string; value: SoundFontMeta };
  sfData: { key: string; value: { id: string; data: ArrayBuffer } };
  kv: { key: string; value: { key: string; value: unknown } };
}

let dbp: Promise<IDBPDatabase<MidiDB>> | null = null;

export function db(): Promise<IDBPDatabase<MidiDB>> {
  if (!dbp) {
    dbp = openDB<MidiDB>('midi-studio', 1, {
      upgrade(d) {
        const songs = d.createObjectStore('songs', { keyPath: 'id' });
        songs.createIndex('addedAt', 'addedAt');
        d.createObjectStore('songData', { keyPath: 'id' });
        d.createObjectStore('playlists', { keyPath: 'id' });
        d.createObjectStore('soundfonts', { keyPath: 'id' });
        d.createObjectStore('sfData', { keyPath: 'id' });
        d.createObjectStore('kv', { keyPath: 'key' });
      },
    });
  }
  return dbp;
}

/** 内容ハッシュから ID を作る（同じファイルの重複登録を防ぐ） */
export async function hashId(data: ArrayBuffer): Promise<string> {
  try {
    if (globalThis.crypto?.subtle) {
      const h = await crypto.subtle.digest('SHA-256', data);
      return [...new Uint8Array(h).subarray(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {}
  // フォールバック: FNV-1a 32bit ×2
  const b = new Uint8Array(data);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < b.length; i++) {
    h1 = Math.imul(h1 ^ b[i], 0x01000193);
    h2 = Math.imul(h2 ^ b[b.length - 1 - i], 0x811c9dc5);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, '0') +
    (h2 >>> 0).toString(16).padStart(8, '0') +
    b.length.toString(16)
  );
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// ---- songs
export async function addSong(
  data: ArrayBuffer,
  meta: Pick<SongMeta, 'name' | 'fileName' | 'source'> & Partial<SongMeta>,
): Promise<SongMeta> {
  const d = await db();
  const id = await hashId(data);
  const existing = await d.get('songs', id);
  if (existing) return existing;
  const rec: SongMeta = {
    id,
    size: data.byteLength,
    addedAt: Date.now(),
    lastPlayedAt: 0,
    playCount: 0,
    favorite: false,
    duration: 0,
    ...meta,
  };
  const tx = d.transaction(['songs', 'songData'], 'readwrite');
  await Promise.all([
    tx.objectStore('songs').put(rec),
    tx.objectStore('songData').put({ id, data }),
    tx.done,
  ]);
  return rec;
}

export async function listSongs(): Promise<SongMeta[]> {
  return (await db()).getAll('songs');
}
export async function getSongData(id: string): Promise<ArrayBuffer | undefined> {
  return (await (await db()).get('songData', id))?.data;
}
export async function updateSong(id: string, patch: Partial<SongMeta>): Promise<SongMeta | undefined> {
  const d = await db();
  const cur = await d.get('songs', id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch, id };
  await d.put('songs', next);
  return next;
}
export async function deleteSong(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['songs', 'songData'], 'readwrite');
  await Promise.all([tx.objectStore('songs').delete(id), tx.objectStore('songData').delete(id), tx.done]);
}

// ---- playlists
export async function listPlaylists(): Promise<PlaylistRec[]> {
  return (await (await db()).getAll('playlists')).sort((a, b) => a.createdAt - b.createdAt);
}
export async function savePlaylist(p: PlaylistRec): Promise<void> {
  await (await db()).put('playlists', { ...p, updatedAt: Date.now() });
}
export async function deletePlaylist(id: string): Promise<void> {
  await (await db()).delete('playlists', id);
}

// ---- soundfonts
export async function listSoundFonts(): Promise<SoundFontMeta[]> {
  return (await (await db()).getAll('soundfonts')).sort((a, b) => a.priority - b.priority);
}
export async function addSoundFont(name: string, data: ArrayBuffer): Promise<SoundFontMeta> {
  const d = await db();
  const id = 'sf-' + (await hashId(data));
  const all = await d.getAll('soundfonts');
  const rec: SoundFontMeta = {
    id,
    name,
    size: data.byteLength,
    enabled: true,
    priority: all.length ? Math.min(...all.map((s) => s.priority)) - 1 : 0,
    bankOffset: 0,
    addedAt: Date.now(),
  };
  const tx = d.transaction(['soundfonts', 'sfData'], 'readwrite');
  await Promise.all([
    tx.objectStore('soundfonts').put(rec),
    tx.objectStore('sfData').put({ id, data }),
    tx.done,
  ]);
  return rec;
}
export async function getSoundFontData(id: string): Promise<ArrayBuffer | undefined> {
  return (await (await db()).get('sfData', id))?.data;
}
export async function updateSoundFont(meta: SoundFontMeta): Promise<void> {
  await (await db()).put('soundfonts', meta);
}
export async function deleteSoundFont(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['soundfonts', 'sfData'], 'readwrite');
  await Promise.all([tx.objectStore('soundfonts').delete(id), tx.objectStore('sfData').delete(id), tx.done]);
}

// ---- kv
export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('kv', key))?.value as T | undefined;
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await db()).put('kv', { key, value });
}
