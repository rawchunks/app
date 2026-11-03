import { useMemo } from 'react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { Tooltip } from '../daw/Tooltip';
import { formatUsd } from '../../hooks/use-earnings';
import {
  BRAND_PALETTE,
  DEFAULT_AG_COL_DEF,
  formatMs,
  getGenreRowId,
  type GenreMetric,
  type GenreSlice,
  type NormalizedSongRow,
} from './utils';

export interface GenreBreakdownProps {
  songs: NormalizedSongRow[];
  genreMetric: GenreMetric;
  focused: boolean;
  isMobile: boolean;
}

export function GenreBreakdown({
  songs,
  genreMetric,
  focused,
  isMobile,
}: GenreBreakdownProps) {
  const genreSlices = useMemo<GenreSlice[]>(() => {
    const map = new Map<
      string,
      {
        genre: string;
        profitUsd: number;
        plays: number;
        streamedMs: number;
        ratioSum: number;
        songCount: number;
      }
    >();

    for (const row of songs) {
      const genresForRow =
        row.allGenres && row.allGenres.length > 0 ? row.allGenres : [row.genre || 'Audio'];
      for (const gName of genresForRow) {
        const key = gName || 'Audio';
        const cur = map.get(key) || {
          genre: key,
          profitUsd: 0,
          plays: 0,
          streamedMs: 0,
          ratioSum: 0,
          songCount: 0,
        };
        cur.profitUsd = Number((cur.profitUsd + row.profitUsd).toFixed(6));
        cur.plays += row.rawPlays;
        cur.streamedMs += row.streamedMs;
        cur.ratioSum += row.ratioPct;
        cur.songCount += 1;
        map.set(key, cur);
      }
    }

    const items = Array.from(map.values()).map((g) => {
      const value =
        genreMetric === 'profit'
          ? g.profitUsd
          : genreMetric === 'plays'
            ? g.plays
            : g.streamedMs;
      return {
        ...g,
        value,
        avgRatioPct: g.songCount > 0 ? Number((g.ratioSum / g.songCount).toFixed(1)) : 0,
      };
    });

    items.sort((a, b) => b.value - a.value || b.plays - a.plays);
    const total = items.reduce((acc, i) => acc + i.value, 0);

    return items.map((item, idx) => ({
      ...item,
      color: BRAND_PALETTE[idx % BRAND_PALETTE.length],
      pct: total > 0 ? (item.value / total) * 100 : 100 / Math.max(1, items.length),
    }));
  }, [songs, genreMetric]);

  const genreDetailCols = useMemo<ColDef<GenreSlice>[]>(
    () => [
      {
        headerName: 'Genre',
        field: 'genre',
        flex: 1,
        cellRenderer: (params: ICellRendererParams<GenreSlice>) => {
          const s = params.data;
          if (!s) return null;
          return (
            <div className="cm-modality-detail__row">
              <Tooltip
                title={s.genre}
                description={`${s.songCount} ${s.songCount === 1 ? 'song' : 'songs'} · ${formatUsd(s.profitUsd)} · ${s.plays.toLocaleString()} plays · ${formatMs(s.streamedMs)}`}
                position="top"
                style={{ display: 'inline-flex', minWidth: 0, maxWidth: '100%' }}
              >
                <span className="cm-modality-detail__name" title={s.genre}>
                  <span className="cm-modality-legend__dot" style={{ background: s.color }} />
                  {s.genre}
                </span>
              </Tooltip>
              <span className="cm-modality-detail__stats">
                <span data-tone="primary">{formatUsd(s.profitUsd)}</span>
                <span>{s.plays.toLocaleString()} plays</span>
                <span>{formatMs(s.streamedMs)}</span>
                <span data-tone="emerald">{s.avgRatioPct.toFixed(1)}%</span>
              </span>
            </div>
          );
        },
      },
    ],
    [],
  );

  if (genreSlices.length === 0) {
    return <div className="cm-block__empty">No genre activity in window</div>;
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'clamp(0.28rem, 0.7cqi, 0.45rem)',
        flex: '1 1 auto',
        minHeight: 0,
      }}
      onClick={(e) => {
        if (focused) e.stopPropagation();
      }}
    >
      <div className="cm-modality-bar" role="img" aria-label="Songs by genre">
        {genreSlices.map((s) => (
          <Tooltip
            key={s.genre}
            title={s.genre}
            description={`${formatUsd(s.profitUsd)} · ${s.plays.toLocaleString()} plays · ${formatMs(s.streamedMs)} (${s.pct.toFixed(1)}%)`}
            position="top"
            style={{
              display: 'flex',
              width: `${Math.max(s.pct, 4)}%`,
              height: '100%',
              minWidth: 0,
            }}
          >
            <div
              className="cm-modality-bar__segment"
              style={{
                width: '100%',
                background: s.color,
              }}
              title={`${s.genre}: ${s.pct.toFixed(1)}%`}
            >
              {s.pct >= 12 ? `${s.pct.toFixed(0)}%` : ''}
            </div>
          </Tooltip>
        ))}
      </div>

      <div className="cm-modality-legend">
        {genreSlices.map((s) => (
          <Tooltip
            key={s.genre}
            title={s.genre}
            description={`${s.songCount} ${s.songCount === 1 ? 'song' : 'songs'} · ${formatUsd(s.profitUsd)} · ${s.plays.toLocaleString()} plays · ${formatMs(s.streamedMs)} (${s.pct.toFixed(1)}%)`}
            position="top"
            style={{ display: 'inline-flex', minWidth: 0 }}
          >
            <div className="cm-modality-legend__item" title={s.genre}>
              <span className="cm-modality-legend__dot" style={{ background: s.color }} />
              <span>{s.genre}</span>
              <span style={{ color: 'var(--primary)', fontWeight: 700 }}>
                {genreMetric === 'profit'
                  ? formatUsd(s.profitUsd)
                  : genreMetric === 'plays'
                    ? s.plays.toLocaleString()
                    : formatMs(s.streamedMs)}
              </span>
              <span style={{ opacity: 0.65 }}>({s.pct.toFixed(0)}%)</span>
            </div>
          </Tooltip>
        ))}
      </div>

      {focused && (
        <div className="cm-ag-grid-wrap cm-ag-feed">
          <AgGridReact
            rowData={genreSlices}
            columnDefs={genreDetailCols}
            getRowId={getGenreRowId}
            suppressScrollOnNewData
            defaultColDef={DEFAULT_AG_COL_DEF}
            headerHeight={0}
            rowHeight={isMobile ? 36 : 38}
            suppressCellFocus
            animateRows
          />
        </div>
      )}
    </div>
  );
}
