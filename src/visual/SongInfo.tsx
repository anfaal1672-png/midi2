import { useMemo, useRef } from 'preact/hooks';
import { analysis, currentSong, settings, presets } from '../state/store';
import { playhead, seek } from '../audio/player';
import { decodeText, resolveEncoding } from '../midi/encoding';
import { keySignatureName, noteName, programName } from '../midi/gm';
import { useCanvasLoop } from './useCanvas';
import { channelColor } from './colors';
import { formatTime } from './common';
import { t } from '../ui/i18n';

function TempoGraph() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useCanvasLoop(
    wrap,
    ({ w, h, dpr, theme }) => {
      const a = analysis.value;
      const c = canvas.current;
      if (!a || !c) return;
      const ctx = c.getContext('2d')!;
      if (c.width !== Math.round(w * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const tempos = a.tempos;
      const maxB = Math.max(...tempos.map((x) => x.bpm)) * 1.1;
      const minB = Math.min(...tempos.map((x) => x.bpm)) * 0.9;
      const pad = 28;
      const x = (s: number) => pad + (s / Math.max(1, a.duration)) * (w - pad - 6);
      const y = (b: number) => 6 + (1 - (b - minB) / Math.max(1, maxB - minB)) * (h - 22);
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      tempos.forEach((tp, i) => {
        if (i === 0) {
          ctx.moveTo(x(tp.sec), y(tp.bpm));
        } else {
          ctx.lineTo(x(tp.sec), y(tempos[i - 1].bpm));
          ctx.lineTo(x(tp.sec), y(tp.bpm));
        }
      });
      ctx.lineTo(x(a.duration), y(tempos[tempos.length - 1].bpm));
      ctx.stroke();
      ctx.fillStyle = theme.muted;
      ctx.font = '10px system-ui';
      ctx.fillText(maxB.toFixed(0), 2, 12);
      ctx.fillText(minB.toFixed(0), 2, h - 16);
      ctx.fillText('0:00', pad, h - 3);
      ctx.textAlign = 'right';
      ctx.fillText(formatTime(a.duration), w - 4, h - 3);
      ctx.textAlign = 'left';
      // 時間方向の拍子変化
      ctx.fillStyle = theme.text;
      for (const ts of a.timeSigs) ctx.fillText(`${ts.num}/${ts.den}`, x(ts.sec) + 3, 14);
      const ph = playhead();
      ctx.fillStyle = theme.accent;
      ctx.fillRect(x(ph) - 1, 0, 2, h - 14);
    },
    undefined,
    () => [playhead(), analysis.value],
  );
  return (
    <div class="tempo-graph" ref={wrap} role="img" aria-label={t('info.tempoGraph')}>
      <canvas ref={canvas} class="layer" />
    </div>
  );
}

export function SongInfo() {
  const a = analysis.value;
  const song = currentSong.value;
  const enc = useMemo(
    () =>
      a
        ? resolveEncoding(
            settings.value.lyricEncoding,
            a.texts.slice(0, 60).map((x) => x.bytes),
          )
        : 'utf-8',
    [a, settings.value.lyricEncoding],
  );
  if (!a) return <div class="viz-empty">{t('visual.empty')}</div>;
  const texts = (type: number) =>
    a.texts.filter((x) => x.type === type).map((x) => ({ ...x, text: decodeText(x.bytes, enc) }));
  const copyright = texts(0x02);
  const markers = texts(0x06).concat(texts(0x07));
  const otherText = texts(0x01)
    .filter((x) => !x.text.startsWith('@') && !a.lyrics.includes(x as any))
    .slice(0, 40);
  const pl = presets.value;
  const presetName = (prog: number, msb: number, isDrum: boolean) =>
    pl.find((p) => p.program === prog && p.bankMSB === msb && p.isDrum === isDrum)?.name ??
    pl.find((p) => p.program === prog && p.isDrum === isDrum)?.name ??
    programName(prog, isDrum);
  const minT = Math.min(...a.tempos.map((x) => x.bpm));
  const maxT = Math.max(...a.tempos.map((x) => x.bpm));

  return (
    <div class="song-info">
      <section>
        <h3>{song?.name ?? a.fileName}</h3>
        <dl class="stats">
          <div>
            <dt>{t('info.duration')}</dt>
            <dd>{formatTime(a.duration)}</dd>
          </div>
          <div>
            <dt>{t('info.notes')}</dt>
            <dd>{a.noteCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt>{t('info.tracks')}</dt>
            <dd>{a.tracks.length}</dd>
          </div>
          <div>
            <dt>{t('info.channels')}</dt>
            <dd>{a.channels.filter((c) => c.noteCount).length}</dd>
          </div>
          <div>
            <dt>{t('info.tempo')}</dt>
            <dd>{minT === maxT ? `${minT.toFixed(1)}` : `${minT.toFixed(0)}–${maxT.toFixed(0)}`} BPM</dd>
          </div>
          <div>
            <dt>{t('info.format')}</dt>
            <dd>
              SMF {a.format} · {a.ppq} PPQ
            </dd>
          </div>
          <div>
            <dt>{t('info.system')}</dt>
            <dd>{a.detectedSystem.toUpperCase()}</dd>
          </div>
          <div>
            <dt>{t('info.size')}</dt>
            <dd>{song ? `${(song.size / 1024).toFixed(1)} KB` : '—'}</dd>
          </div>
          <div>
            <dt>{t('info.fileName')}</dt>
            <dd class="ellipsis">{song?.fileName ?? a.fileName}</dd>
          </div>
          {a.isKaraoke && (
            <div>
              <dt>{t('info.karaoke')}</dt>
              <dd>KAR</dd>
            </div>
          )}
          {a.hasEmbeddedSoundBank && (
            <div>
              <dt>RMIDI</dt>
              <dd>{t('info.embeddedSf')}</dd>
            </div>
          )}
        </dl>
        {copyright.length > 0 && <p class="muted">© {copyright.map((c) => c.text).join(' / ')}</p>}
      </section>
      <section>
        <h4>{t('info.tempoGraph')}</h4>
        <TempoGraph />
        {a.keySigs.length > 0 && (
          <p class="small">
            {t('info.key')}:{' '}
            {a.keySigs.map((k) => `${keySignatureName(k.sf, k.minor)} @${formatTime(k.sec)}`).join(', ')}
          </p>
        )}
      </section>
      {markers.length > 0 && (
        <section>
          <h4>{t('info.markers')}</h4>
          <ul class="link-list">
            {markers.map((mk, i) => (
              <li key={i}>
                <button class="link" onClick={() => seek(mk.sec)}>
                  <span class="mono">{formatTime(mk.sec)}</span> {mk.text}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h4>{t('info.instruments')}</h4>
        <table class="table">
          <thead>
            <tr>
              <th>Ch</th>
              <th>{t('info.instrument')}</th>
              <th>{t('info.notes')}</th>
              <th>{t('info.range')}</th>
              <th>{t('info.tracks')}</th>
            </tr>
          </thead>
          <tbody>
            {a.channels
              .filter((c) => c.noteCount > 0)
              .map((c) => (
                <tr key={c.ch}>
                  <td>
                    <span class="ch-dot" style={{ background: channelColor(c.ch) }} aria-hidden="true" />
                    {c.ch + 1}
                  </td>
                  <td>
                    {presetName(c.firstProgram, c.bankMSB, c.isDrum)}
                    {c.programs.length > 1 && <span class="muted small"> +{c.programs.length - 1}</span>}
                  </td>
                  <td>{c.noteCount}</td>
                  <td>{c.isDrum ? '—' : `${noteName(c.minKey)}–${noteName(c.maxKey)}`}</td>
                  <td>{c.tracks.map((x) => x + 1).join(', ')}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>
      <section>
        <h4>{t('info.trackList')}</h4>
        <table class="table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('info.trackName')}</th>
              <th>{t('info.events')}</th>
              <th>{t('info.notes')}</th>
              <th>Ch</th>
            </tr>
          </thead>
          <tbody>
            {a.tracks.map((tr) => (
              <tr key={tr.index}>
                <td>{tr.index + 1}</td>
                <td>{decodeText(tr.nameBytes, enc) || '—'}</td>
                <td>{tr.eventCount}</td>
                <td>{tr.noteCount}</td>
                <td>{tr.channels.map((c) => c + 1).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {otherText.length > 0 && (
        <section>
          <h4>{t('info.texts')}</h4>
          <ul class="text-list">
            {otherText.map((x, i) => (
              <li key={i}>
                <span class="mono muted">{formatTime(x.sec)}</span> {x.text}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
