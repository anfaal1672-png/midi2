import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { analysis, patchSettings, settings } from '../state/store';
import { playhead } from '../audio/player';
import { buildLyricLines, currentLineIndex, syllableProgress } from '../midi/lyrics';
import { ENCODING_OPTIONS, resolveEncoding, type TextEncodingName } from '../midi/encoding';
import { t } from '../ui/i18n';

export function Lyrics() {
  const a = analysis.value;
  const enc = settings.value.lyricEncoding;
  const resolved = useMemo(
    () =>
      a
        ? resolveEncoding(enc, [...a.lyrics.map((l) => l.bytes), ...(a.nameBytes ? [a.nameBytes] : [])])
        : 'utf-8',
    [a, enc],
  );
  const lines = useMemo(() => (a ? buildLyricLines(a.lyrics, resolved, a.duration) : []), [a, resolved]);
  const [cur, setCur] = useState(-1);
  const curRef = useRef(-1);
  const spans = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const time = playhead();
      // 次の行が始まる少し前に表示を切り替える
      let idx = currentLineIndex(lines, time);
      const nextLine = lines[idx + 1];
      if (nextLine && nextLine.start - time < 0.25 && (idx < 0 || time >= lines[idx].end)) idx++;
      if (idx !== curRef.current) {
        curRef.current = idx;
        setCur(idx);
      }
      const line = lines[idx];
      if (!line) return;
      line.syllables.forEach((s, i) => {
        const el = spans.current[i];
        if (el) el.style.setProperty('--p', syllableProgress(s, time).toFixed(3));
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [lines]);

  const header = (
    <div class="lyrics-toolbar">
      <label>
        {t('lyrics.encoding')}{' '}
        <select
          value={enc}
          onChange={(e) =>
            patchSettings({ lyricEncoding: (e.target as HTMLSelectElement).value as TextEncodingName })
          }
        >
          {ENCODING_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o === 'auto' ? `${t('lyrics.auto')} (${resolved})` : o}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  if (!a) return <div class="viz-empty">{t('visual.empty')}</div>;
  if (!lines.length)
    return (
      <div class="lyrics">
        {header}
        <div class="viz-empty">{t('lyrics.none')}</div>
      </div>
    );

  const show = (i: number, cls: string) => {
    const l = lines[i];
    if (!l) return <div class={`lyric-line ${cls}`}>&nbsp;</div>;
    return (
      <div class={`lyric-line ${cls}`} key={`${cls}-${i}`}>
        {l.syllables.map((s, j) => (
          <span key={j}>{s.text}</span>
        ))}
      </div>
    );
  };
  const line = lines[cur];
  spans.current = [];
  return (
    <div class="lyrics">
      {header}
      <div class="lyrics-stage" aria-live="polite">
        {show(cur - 1, 'prev')}
        <div class="lyric-line current" key={`cur-${cur}`}>
          {line
            ? line.syllables.map((s, j) => (
                <span
                  key={j}
                  class="syl"
                  ref={(el) => {
                    spans.current[j] = el;
                  }}
                  style={{ '--p': 0 } as any}
                >
                  {s.text}
                </span>
              ))
            : ' '}
        </div>
        {show(cur + 1, 'next')}
        {show(cur + 2, 'next2')}
      </div>
    </div>
  );
}
