import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { analysis, settings } from '../state/store';
import { playhead, seek } from '../audio/player';
import { eventCategory, formatEvent, type EventCategory } from '../midi/format';
import { resolveEncoding } from '../midi/encoding';
import { formatTime } from './common';
import { channelColor } from './colors';
import { t } from '../ui/i18n';

const ROW_H = 26;
const CATEGORIES: (EventCategory | 'all')[] = [
  'all',
  'note',
  'cc',
  'program',
  'pitch',
  'pressure',
  'meta',
  'sysex',
];

export function EventList() {
  const a = analysis.value;
  const [cat, setCat] = useState<EventCategory | 'all'>('all');
  const [ch, setCh] = useState<number>(-1);
  const [track, setTrack] = useState<number>(-1);
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [current, setCurrent] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const enc = useMemo(
    () =>
      a
        ? resolveEncoding(
            settings.value.lyricEncoding,
            a.texts.slice(0, 50).map((x) => x.bytes),
          )
        : 'utf-8',
    [a, settings.value.lyricEncoding],
  );

  const rows = useMemo(() => {
    if (!a) return new Uint32Array(0);
    const e = a.events;
    const out: number[] = [];
    const q = query.trim().toLowerCase();
    for (let i = 0; i < e.count; i++) {
      if (cat !== 'all' && eventCategory(e.status[i]) !== cat) continue;
      if (ch >= 0 && e.ch[i] !== ch) continue;
      if (track >= 0 && e.track[i] !== track) continue;
      if (q) {
        const f = formatEvent(e, i, enc);
        if (!`${f.type} ${f.detail}`.toLowerCase().includes(q)) continue;
      }
      out.push(i);
    }
    return Uint32Array.from(out);
  }, [a, cat, ch, track, query, enc]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [a]);

  // 再生位置に追従
  useEffect(() => {
    if (!a) return;
    let raf = 0;
    let last = -1;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const time = playhead();
      let lo = 0;
      let hi = rows.length - 1;
      let idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (a.events.sec[rows[mid]] <= time) {
          idx = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (idx !== last) {
        last = idx;
        setCurrent(idx);
        if (follow && box.current && idx >= 0) {
          const target = idx * ROW_H - box.current.clientHeight / 2;
          box.current.scrollTop = Math.max(0, target);
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [a, rows, follow]);

  if (!a) return <div class="viz-empty">{t('visual.empty')}</div>;
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 10);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_H) + 10);
  const items = [];
  for (let r = first; r < last; r++) {
    const i = rows[r];
    const f = formatEvent(a.events, i, enc);
    const chn = a.events.ch[i];
    items.push(
      <div
        key={i}
        class={r === current ? 'ev-row current' : 'ev-row'}
        style={{ top: `${r * ROW_H}px` }}
        role="row"
        onClick={() => seek(a.events.sec[i])}
      >
        <span class="ev-time" role="cell">
          {formatTime(a.events.sec[i], true)}
        </span>
        <span class="ev-tick" role="cell">
          {a.events.tick[i]}
        </span>
        <span class="ev-track" role="cell">
          {a.events.track[i] + 1}
        </span>
        <span class="ev-ch" role="cell">
          {chn !== 0xffff && (
            <span class="ch-dot" style={{ background: channelColor(chn) }} aria-hidden="true" />
          )}
          {chn === 0xffff ? '—' : chn + 1}
        </span>
        <span class="ev-type" role="cell">
          {f.type}
        </span>
        <span class="ev-detail" role="cell" title={f.detail}>
          {f.detail}
        </span>
      </div>,
    );
  }

  return (
    <div class="event-list">
      <div class="ev-toolbar">
        <select
          aria-label={t('events.type')}
          value={cat}
          onChange={(e) => setCat((e.target as HTMLSelectElement).value as any)}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t('events.cat.' + c)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('events.channel')}
          value={ch}
          onChange={(e) => setCh(Number((e.target as HTMLSelectElement).value))}
        >
          <option value={-1}>{t('events.allChannels')}</option>
          {a.channels.map((c) => (
            <option key={c.ch} value={c.ch}>
              Ch {c.ch + 1}
            </option>
          ))}
        </select>
        <select
          aria-label={t('events.track')}
          value={track}
          onChange={(e) => setTrack(Number((e.target as HTMLSelectElement).value))}
        >
          <option value={-1}>{t('events.allTracks')}</option>
          {a.tracks.map((tr) => (
            <option key={tr.index} value={tr.index}>
              Tr {tr.index + 1}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder={t('events.search')}
          aria-label={t('events.search')}
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        <label class="check">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow((e.target as HTMLInputElement).checked)}
          />
          {t('events.follow')}
        </label>
        <span class="muted small">{t('events.count', { n: rows.length.toLocaleString() })}</span>
      </div>
      <div class="ev-head" role="row">
        <span class="ev-time">{t('events.time')}</span>
        <span class="ev-tick">Tick</span>
        <span class="ev-track">Tr</span>
        <span class="ev-ch">Ch</span>
        <span class="ev-type">{t('events.type')}</span>
        <span class="ev-detail">{t('events.detail')}</span>
      </div>
      <div
        class="ev-body"
        ref={box}
        role="table"
        aria-label={t('visual.events')}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        onWheel={() => setFollow(false)}
      >
        <div style={{ height: `${rows.length * ROW_H}px`, position: 'relative' }}>{items}</div>
      </div>
    </div>
  );
}
