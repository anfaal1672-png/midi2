import { useMemo, useState } from 'preact/hooks';
import {
  FolderOpen,
  FilePlus2,
  Link2,
  ListMusic,
  Music,
  Play,
  Plus,
  Star,
  Trash2,
  GripVertical,
  Download,
  Upload,
  Pencil,
  ListPlus,
  Sparkles,
  Save,
  ArrowUp,
  ArrowDown,
} from 'lucide-preact';
import { currentSong, modal, playlists, queue, queueIndex, songs, status } from '../state/store';
import {
  addFiles,
  addFromUrl,
  clearQueue,
  loadDemos,
  moveInQueue,
  playQueueIndex,
  refreshLibrary,
  removeFromQueue,
  removeSongs,
  renameSong,
  setQueue,
  toggleFavorite,
} from '../audio/player';
import * as dbm from '../library/db';
import { parseM3U, parsePlaylistJSON, toM3U, toPlaylistJSON } from '../library/playlist';
import { formatTime } from '../visual/common';
import { IconButton, MoreMenu } from './primitives';
import { pickFile, safeFileName, saveText } from './download';
import { t } from './i18n';
import { toast } from '../state/notify';

type Tab = 'queue' | 'library' | 'playlists';
type Sort = 'added' | 'name' | 'duration' | 'plays' | 'recent';

const ACCEPT = '.mid,.midi,.smf,.kar,.rmi,.xmf,.zip,.sf2,.sf3,.dls';

function SongRow(props: {
  song: dbm.SongMeta;
  index: number;
  current: boolean;
  onPlay: () => void;
  draggable?: boolean;
  onDrop?: (from: number, to: number) => void;
  actions: preact.ComponentChildren;
}) {
  const { song, current } = props;
  const [over, setOver] = useState(false);
  return (
    <li
      class={`song-row ${current ? 'current' : ''} ${over ? 'drag-over' : ''}`}
      draggable={props.draggable}
      onDragStart={(e) => {
        e.dataTransfer!.setData('text/x-queue-index', String(props.index));
        e.dataTransfer!.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (!props.onDrop || !e.dataTransfer?.types.includes('text/x-queue-index')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const from = Number(e.dataTransfer?.getData('text/x-queue-index'));
        if (props.onDrop && Number.isFinite(from)) {
          e.preventDefault();
          e.stopPropagation();
          props.onDrop(from, props.index);
        }
      }}
    >
      {props.draggable && <GripVertical size={14} class="grip" aria-hidden="true" />}
      <button
        type="button"
        class="song-main"
        onClick={props.onPlay}
        onDblClick={props.onPlay}
        title={song.fileName}
      >
        <span class="song-name ellipsis">
          {current && status.value === 'playing' ? <span class="eq" aria-hidden="true" /> : null}
          {song.name}
        </span>
        <span class="song-meta muted small">
          {song.duration ? formatTime(song.duration) : ''}
          {song.playCount ? ` · ${t('lib.plays', { n: song.playCount })}` : ''}
        </span>
      </button>
      <span class="row-actions">{props.actions}</span>
    </li>
  );
}

export function LibraryPanel() {
  const [tab, setTab] = useState<Tab>('library');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('added');
  const [favOnly, setFavOnly] = useState(false);
  const [openPl, setOpenPl] = useState<string | null>(null);
  const all = songs.value;
  const byId = useMemo(() => new Map(all.map((s) => [s.id, s])), [all]);
  const curId = currentSong.value?.id;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = all.filter(
      (s) => (!favOnly || s.favorite) && (!q || `${s.name} ${s.fileName}`.toLowerCase().includes(q)),
    );
    const cmp: Record<Sort, (a: dbm.SongMeta, b: dbm.SongMeta) => number> = {
      added: (a, b) => b.addedAt - a.addedAt,
      name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
      duration: (a, b) => a.duration - b.duration,
      plays: (a, b) => b.playCount - a.playCount,
      recent: (a, b) => b.lastPlayedAt - a.lastPlayedAt,
    };
    list = list.slice().sort(cmp[sort]);
    return list;
  }, [all, query, sort, favOnly]);

  const playFromLibrary = (id: string) => {
    const ids = filtered.map((s) => s.id);
    setQueue(ids, ids.indexOf(id), true);
  };

  const enqueue = (id: string) => {
    queue.value = [...queue.value, id];
    dbm.kvSet('queue', { ids: queue.value, index: queueIndex.value });
    toast(t('lib.enqueued'), 'success', { timeout: 1500 });
  };

  const addToPlaylist = async (songId: string) => {
    const pls = playlists.value;
    let target: dbm.PlaylistRec | undefined;
    if (!pls.length) {
      const name = prompt(t('pl.newName'), t('pl.defaultName'));
      if (!name) return;
      target = { id: dbm.uid(), name, songIds: [], createdAt: Date.now(), updatedAt: Date.now() };
    } else {
      const choice = prompt(
        `${t('pl.choose')}\n${pls.map((p, i) => `${i + 1}: ${p.name}`).join('\n')}\n0: ${t('pl.new')}`,
        '1',
      );
      if (choice === null) return;
      const n = Number(choice);
      if (n === 0) {
        const name = prompt(t('pl.newName'), t('pl.defaultName'));
        if (!name) return;
        target = { id: dbm.uid(), name, songIds: [], createdAt: Date.now(), updatedAt: Date.now() };
      } else target = pls[n - 1];
    }
    if (!target) return;
    await dbm.savePlaylist({ ...target, songIds: [...target.songIds, songId] });
    await refreshLibrary();
    toast(t('pl.added', { name: target.name }), 'success', { timeout: 1800 });
  };

  const saveQueueAsPlaylist = async () => {
    if (!queue.value.length) return;
    const name = prompt(t('pl.newName'), t('pl.defaultName'));
    if (!name) return;
    await dbm.savePlaylist({
      id: dbm.uid(),
      name,
      songIds: queue.value.slice(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await refreshLibrary();
    setTab('playlists');
  };

  const importPlaylist = async () => {
    const [file] = await pickFile('.m3u,.m3u8,.json');
    if (!file) return;
    const text = await file.text();
    let name = file.name.replace(/\.[^.]+$/, '');
    let entries;
    try {
      if (file.name.endsWith('.json')) {
        const doc = parsePlaylistJSON(text);
        name = doc.name;
        entries = doc.entries;
      } else entries = parseM3U(text);
    } catch (err) {
      toast(String(err), 'error');
      return;
    }
    const ids: string[] = [];
    let missing = 0;
    for (const e of entries) {
      const local = all.find((s) => (e.url && s.url === e.url) || s.fileName === e.fileName);
      if (local) ids.push(local.id);
      else if (e.url) {
        const added = await addFromUrl(e.url, { play: false });
        if (added[0]) ids.push(added[0].id);
        else missing++;
      } else missing++;
    }
    await dbm.savePlaylist({
      id: dbm.uid(),
      name,
      songIds: ids,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await refreshLibrary();
    setTab('playlists');
    toast(t('pl.imported', { n: ids.length, missing }), missing ? 'warn' : 'success');
  };

  const exportPlaylist = (p: { name: string; songIds: string[] }, kind: 'm3u' | 'json') => {
    const entries = p.songIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((s) => ({ name: s!.name, fileName: s!.fileName, url: s!.url }));
    if (kind === 'm3u') saveText(toM3U(entries, p.name), `${safeFileName(p.name)}.m3u`, 'audio/x-mpegurl');
    else saveText(toPlaylistJSON(p.name, entries), `${safeFileName(p.name)}.json`);
  };

  return (
    <aside class="panel library-panel" aria-label={t('lib.label')}>
      <div class="panel-toolbar">
        <IconButton
          label={t('lib.openFiles')}
          onClick={async () => addFiles(await pickFile(ACCEPT, true))}
          data-testid="open-files"
        >
          <FilePlus2 size={18} />
        </IconButton>
        <IconButton
          label={t('lib.openFolder')}
          onClick={async () => addFiles(await pickFile(ACCEPT, true, true))}
        >
          <FolderOpen size={18} />
        </IconButton>
        <IconButton label={t('lib.openUrl')} onClick={() => (modal.value = 'url')}>
          <Link2 size={18} />
        </IconButton>
        <IconButton label={t('lib.demos')} onClick={() => loadDemos()} data-testid="load-demos">
          <Sparkles size={18} />
        </IconButton>
        <IconButton label={t('pl.import')} onClick={importPlaylist}>
          <Upload size={18} />
        </IconButton>
      </div>
      <div class="tabs" role="tablist">
        {(['queue', 'library', 'playlists'] as Tab[]).map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            class={tab === k ? 'tab active' : 'tab'}
            onClick={() => setTab(k)}
          >
            {t('lib.tab.' + k)}
            {k === 'queue' && queue.value.length ? <span class="badge">{queue.value.length}</span> : null}
            {k === 'library' && all.length ? <span class="badge">{all.length}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'library' && (
        <>
          <div class="panel-filter">
            <input
              type="search"
              placeholder={t('lib.search')}
              aria-label={t('lib.search')}
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            />
            <select
              aria-label={t('lib.sort')}
              value={sort}
              onChange={(e) => setSort((e.target as HTMLSelectElement).value as Sort)}
            >
              {(['added', 'name', 'duration', 'plays', 'recent'] as Sort[]).map((k) => (
                <option key={k} value={k}>
                  {t('lib.sort.' + k)}
                </option>
              ))}
            </select>
            <IconButton label={t('lib.favorites')} active={favOnly} onClick={() => setFavOnly(!favOnly)}>
              <Star size={16} />
            </IconButton>
          </div>
          {all.length === 0 ? (
            <div class="empty-state">
              <Music size={40} aria-hidden="true" />
              <p>{t('lib.empty')}</p>
              <button type="button" class="btn primary" onClick={() => loadDemos()}>
                <Sparkles size={16} /> {t('lib.loadDemos')}
              </button>
              <button type="button" class="btn" onClick={async () => addFiles(await pickFile(ACCEPT, true))}>
                <FilePlus2 size={16} /> {t('lib.openFiles')}
              </button>
            </div>
          ) : (
            <ul class="song-list" data-testid="library-list">
              {filtered.map((s, i) => (
                <SongRow
                  key={s.id}
                  song={s}
                  index={i}
                  current={s.id === curId}
                  onPlay={() => playFromLibrary(s.id)}
                  actions={
                    <>
                      <IconButton
                        label={s.favorite ? t('lib.unfavorite') : t('lib.favorite')}
                        active={s.favorite}
                        onClick={() => toggleFavorite(s.id)}
                      >
                        <Star size={14} fill={s.favorite ? 'currentColor' : 'none'} />
                      </IconButton>
                      <MoreMenu
                        label={t('lib.more')}
                        items={[
                          {
                            label: t('pl.play'),
                            icon: <Play size={14} />,
                            onSelect: () => playFromLibrary(s.id),
                          },
                          {
                            label: t('lib.enqueue'),
                            icon: <Plus size={14} />,
                            onSelect: () => enqueue(s.id),
                          },
                          {
                            label: t('pl.addTo'),
                            icon: <ListPlus size={14} />,
                            onSelect: () => addToPlaylist(s.id),
                          },
                          {
                            label: t('lib.rename'),
                            icon: <Pencil size={14} />,
                            onSelect: () => {
                              const n = prompt(t('lib.rename'), s.name);
                              if (n) renameSong(s.id, n);
                            },
                          },
                          {
                            label: t('lib.delete'),
                            icon: <Trash2 size={14} />,
                            danger: true,
                            onSelect: () => {
                              if (confirm(t('lib.confirmDelete', { name: s.name }))) removeSongs([s.id]);
                            },
                          },
                        ]}
                      />
                    </>
                  }
                />
              ))}
            </ul>
          )}
        </>
      )}

      {tab === 'queue' && (
        <>
          <div class="panel-filter">
            <button
              type="button"
              class="btn small"
              onClick={saveQueueAsPlaylist}
              disabled={!queue.value.length}
            >
              <Save size={14} /> {t('pl.saveQueue')}
            </button>
            <button
              type="button"
              class="btn small"
              onClick={() => clearQueue()}
              disabled={!queue.value.length}
            >
              <Trash2 size={14} /> {t('lib.clearQueue')}
            </button>
          </div>
          {queue.value.length === 0 ? (
            <div class="empty-state">
              <ListMusic size={36} aria-hidden="true" />
              <p>{t('lib.queueEmpty')}</p>
            </div>
          ) : (
            <ul class="song-list" data-testid="queue-list">
              {queue.value.map((id, i) => {
                const s = byId.get(id);
                if (!s) return null;
                return (
                  <SongRow
                    key={`${id}-${i}`}
                    song={s}
                    index={i}
                    current={i === queueIndex.value}
                    draggable
                    onDrop={(from, to) => moveInQueue(from, to)}
                    onPlay={() => playQueueIndex(i, true)}
                    actions={
                      <MoreMenu
                        label={t('lib.more')}
                        items={[
                          {
                            label: t('lib.moveUp'),
                            icon: <ArrowUp size={14} />,
                            disabled: i === 0,
                            onSelect: () => moveInQueue(i, i - 1),
                          },
                          {
                            label: t('lib.moveDown'),
                            icon: <ArrowDown size={14} />,
                            disabled: i === queue.value.length - 1,
                            onSelect: () => moveInQueue(i, i + 1),
                          },
                          {
                            label: t('lib.removeFromQueue'),
                            icon: <Trash2 size={14} />,
                            danger: true,
                            onSelect: () => removeFromQueue(i),
                          },
                        ]}
                      />
                    }
                  />
                );
              })}
            </ul>
          )}
        </>
      )}

      {tab === 'playlists' && (
        <>
          <div class="panel-filter">
            <button
              type="button"
              class="btn small"
              onClick={async () => {
                const name = prompt(t('pl.newName'), t('pl.defaultName'));
                if (!name) return;
                await dbm.savePlaylist({
                  id: dbm.uid(),
                  name,
                  songIds: [],
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                });
                refreshLibrary();
              }}
            >
              <Plus size={14} /> {t('pl.new')}
            </button>
          </div>
          {playlists.value.length === 0 ? (
            <div class="empty-state">
              <ListMusic size={36} aria-hidden="true" />
              <p>{t('pl.empty')}</p>
            </div>
          ) : (
            <ul class="pl-list">
              {playlists.value.map((p) => (
                <li key={p.id} class="pl-item">
                  <div class="pl-head">
                    <button
                      type="button"
                      class="song-main"
                      onClick={() => setOpenPl(openPl === p.id ? null : p.id)}
                      aria-expanded={openPl === p.id}
                    >
                      <span class="song-name">{p.name}</span>
                      <span class="song-meta muted small">{t('pl.count', { n: p.songIds.length })}</span>
                    </button>
                    <span class="row-actions">
                      <IconButton
                        label={t('pl.play')}
                        onClick={() =>
                          setQueue(
                            p.songIds.filter((id) => byId.has(id)),
                            0,
                            true,
                          )
                        }
                      >
                        <Play size={14} />
                      </IconButton>
                      <IconButton label={t('pl.exportM3U')} onClick={() => exportPlaylist(p, 'm3u')}>
                        <Download size={14} />
                      </IconButton>
                      <IconButton label={t('pl.exportJSON')} onClick={() => exportPlaylist(p, 'json')}>
                        {'{}'}
                      </IconButton>
                      <IconButton
                        label={t('lib.rename')}
                        onClick={async () => {
                          const n = prompt(t('lib.rename'), p.name);
                          if (n) {
                            await dbm.savePlaylist({ ...p, name: n });
                            refreshLibrary();
                          }
                        }}
                      >
                        <Pencil size={14} />
                      </IconButton>
                      <IconButton
                        label={t('lib.delete')}
                        onClick={async () => {
                          if (confirm(t('pl.confirmDelete', { name: p.name }))) {
                            await dbm.deletePlaylist(p.id);
                            refreshLibrary();
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </span>
                  </div>
                  {openPl === p.id && (
                    <ol class="pl-songs">
                      {p.songIds.map((id, i) => {
                        const s = byId.get(id);
                        return (
                          <li key={`${id}-${i}`}>
                            <button
                              type="button"
                              class="link"
                              onClick={() =>
                                setQueue(
                                  p.songIds.filter((x) => byId.has(x)),
                                  i,
                                  true,
                                )
                              }
                            >
                              {s?.name ?? t('pl.missing')}
                            </button>
                            <IconButton
                              label={t('pl.removeSong')}
                              onClick={async () => {
                                await dbm.savePlaylist({
                                  ...p,
                                  songIds: p.songIds.filter((_, j) => j !== i),
                                });
                                refreshLibrary();
                              }}
                            >
                              <Trash2 size={12} />
                            </IconButton>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </aside>
  );
}
