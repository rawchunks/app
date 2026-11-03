import { useCallback, useMemo, useState } from 'react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { ArrowUpDown, Search } from 'lucide-react';
import { Tooltip } from '../daw/Tooltip';
import { formatUsd } from '../../hooks/use-earnings';
import type { Song } from '../../lib/schema';
import { AgHeaderTooltip, BlockDropdown } from './dropdown';
import { GenreBreakdown } from './genres';
import {
  DEFAULT_AG_COL_DEF,
  GENRE_METRIC_OPTIONS,
  SONGS_SORT_OPTIONS,
  SONGS_VIEW_OPTIONS,
  formatMs,
  getSongRowId,
  ratioTone,
  type GenreMetric,
  type NormalizedSongRow,
  type SongsSortKey,
  type SongsView,
} from './utils';

export interface SongsBlockProps {
  songs: NormalizedSongRow[];
  focused: boolean;
  isMobile: boolean;
  onToggleFocus: () => void;
  onSelectSong?: (song: Song) => void;
}

export function SongsBlock({
  songs,
  focused,
  isMobile,
  onToggleFocus,
  onSelectSong,
}: SongsBlockProps) {
  const [songsView, setSongsView] = useState<SongsView>('songs');
  const [songsSort, setSongsSort] = useState<SongsSortKey>('profit');
  const [songsQuery, setSongsQuery] = useState('');
  const [genreMetric, setGenreMetric] = useState<GenreMetric>('profit');

  const sortedSongs = useMemo(() => {
    const q = songsQuery.trim().toLowerCase();
    const filtered = q
      ? songs.filter(
          (r) =>
            r.title.toLowerCase().includes(q) ||
            r.genreLabel.toLowerCase().includes(q) ||
            r.networkLabel.toLowerCase().includes(q),
        )
      : songs;

    return [...filtered].sort((a, b) => {
      switch (songsSort) {
        case 'profit':
          return b.profitUsd - a.profitUsd || b.rawPlays - a.rawPlays;
        case 'plays':
          return b.rawPlays - a.rawPlays || b.profitUsd - a.profitUsd;
        case 'streamed':
          return b.streamedMs - a.streamedMs || b.rawPlays - a.rawPlays;
        case 'ratio':
          return b.ratioPct - a.ratioPct || b.rawPlays - a.rawPlays;
        case 'recent':
          return (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0);
        case 'genre':
          return a.genre.localeCompare(b.genre) || b.profitUsd - a.profitUsd;
        default:
          return 0;
      }
    });
  }, [songs, songsQuery, songsSort]);

  const handleSongRowClicked = useCallback(
    <T extends { song?: Song }>(e: { data?: T }) => {
      if (focused && e.data?.song && onSelectSong) {
        onSelectSong(e.data.song);
      }
    },
    [focused, onSelectSong],
  );

  const songsColumnDefs = useMemo<ColDef<NormalizedSongRow>[]>(() => {
    const cols: ColDef<NormalizedSongRow>[] = [
      {
        headerName: 'Song',
        headerComponent: AgHeaderTooltip,
        headerComponentParams: {
          tooltip: 'Track title, cover art, and genres',
          align: 'left',
        },
        field: 'title',
        flex: 1.6,
        minWidth: isMobile ? 105 : 130,
        cellRenderer: (params: ICellRendererParams<NormalizedSongRow>) => {
          const row = params.data;
          if (!row) return null;
          const coverSrc =
            row.song?.image && row.song.image.trim() !== ''
              ? row.song.image
              : '/branding/mark.svg';
          const isFallback = coverSrc === '/branding/mark.svg';
          return (
            <Tooltip
              title={row.title}
              description={`Genres: ${row.genreLabel} · ${row.networkLabel}`}
              position="top"
              style={{ display: 'flex', minWidth: 0, maxWidth: '100%', width: '100%' }}
            >
              <div className="cm-usage-song" title={row.title}>
                <img
                  src={coverSrc}
                  alt={row.title}
                  className={`cm-usage-song__icon${isFallback ? ' cm-usage-song__icon--fallback' : ''}`}
                  onError={(e) => {
                    const target = e.currentTarget;
                    if (!target.src.endsWith('/branding/mark.svg')) {
                      target.src = '/branding/mark.svg';
                      target.classList.add('cm-usage-song__icon--fallback');
                    }
                  }}
                />
                <div className="cm-usage-song__name">
                  <span className="cm-usage-song__id" title={row.title}>
                    {row.title}
                  </span>
                </div>
              </div>
            </Tooltip>
          );
        },
      },
      {
        headerName: 'Profit',
        headerComponent: AgHeaderTooltip,
        headerComponentParams: {
          tooltip: 'Net creator royalties (80% share) from streams and licenses',
          align: 'right',
        },
        field: 'profitUsd',
        width: isMobile ? 76 : 88,
        headerClass: 'cm-ag-right',
        cellClass: 'cm-ag-right',
        cellRenderer: (params: ICellRendererParams<NormalizedSongRow>) =>
          params.data ? (
            <span className="cm-usage-cost">{formatUsd(params.data.profitUsd)}</span>
          ) : null,
      },
      {
        headerName: 'Plays',
        headerComponent: AgHeaderTooltip,
        headerComponentParams: {
          tooltip: 'Qualified streams played for 30 seconds or more',
          align: 'right',
        },
        field: 'rawPlays',
        width: isMobile ? 58 : 74,
        headerClass: 'cm-ag-right',
        cellClass: 'cm-ag-right',
        valueFormatter: (p) => Number(p.value || 0).toLocaleString(),
      },
    ];

    if (focused && !isMobile) {
      cols.push(
        {
          headerName: 'Streamed',
          headerComponent: AgHeaderTooltip,
          headerComponentParams: {
            tooltip: 'Total exact listening duration (s / m / h)',
            align: 'right',
          },
          field: 'streamedMs',
          width: 96,
          headerClass: 'cm-ag-right',
          cellClass: 'cm-ag-right',
          valueFormatter: (p) => formatMs(Number(p.value || 0)),
        },
        {
          headerName: 'Ratio',
          headerComponent: AgHeaderTooltip,
          headerComponentParams: {
            tooltip: 'Average % of track duration streamed per play',
            align: 'right',
          },
          field: 'ratioPct',
          width: 72,
          headerClass: 'cm-ag-right',
          cellClass: 'cm-ag-right',
          cellRenderer: (params: ICellRendererParams<NormalizedSongRow>) => {
            const pct = params.data?.ratioPct ?? 0;
            return (
              <span className="cm-usage-success" data-tone={ratioTone(pct)}>
                {pct.toFixed(1)}%
              </span>
            );
          },
        },
        {
          headerName: 'Genre',
          headerComponent: AgHeaderTooltip,
          headerComponentParams: {
            tooltip: 'Track genres (hover badge to view full list)',
            align: 'right',
          },
          field: 'genreLabel',
          width: 154,
          headerClass: 'cm-ag-right',
          cellClass: 'cm-ag-right',
          cellRenderer: (params: ICellRendererParams<NormalizedSongRow>) =>
            params.data ? (
              <Tooltip
                title={
                  params.data.allGenres.length > 1
                    ? `Genres (${params.data.allGenres.length})`
                    : 'Genre'
                }
                description={params.data.genreLabel}
                position="top"
                style={{ display: 'inline-flex', minWidth: 0, maxWidth: '100%' }}
              >
                <span className="cm-usage-modality" title={params.data.genreLabel}>
                  {params.data.genreLabel}
                </span>
              </Tooltip>
            ) : null,
        },
      );
    } else if (focused && isMobile) {
      cols.push({
        headerName: 'Ratio',
        headerComponent: AgHeaderTooltip,
        headerComponentParams: {
          tooltip: 'Average % of track duration streamed per play',
          align: 'right',
        },
        field: 'ratioPct',
        width: 64,
        headerClass: 'cm-ag-right',
        cellClass: 'cm-ag-right',
        cellRenderer: (params: ICellRendererParams<NormalizedSongRow>) => {
          const pct = params.data?.ratioPct ?? 0;
          return (
            <span className="cm-usage-success" data-tone={ratioTone(pct)}>
              {pct.toFixed(1)}%
            </span>
          );
        },
      });
    }

    return cols;
  }, [focused, isMobile]);

  return (
    <section
      className="cm-block"
      data-block="songs"
      data-focused={focused ? 'true' : 'false'}
      onClick={onToggleFocus}
    >
      <header className="cm-block__header">
        <BlockDropdown
          value={songsView}
          options={SONGS_VIEW_OPTIONS}
          onChange={setSongsView}
          ariaLabel="Songs breakdown view"
        />

        <div className="cm-block__header-side" onClick={(e) => e.stopPropagation()}>
          {songsView === 'songs' ? (
            <>
              {focused && (
                <label className="cm-usage-search" aria-label="Filter songs">
                  <Search className="cm-usage-search__icon" />
                  <input
                    type="search"
                    className="cm-usage-search__input"
                    placeholder="Filter songs…"
                    value={songsQuery}
                    onChange={(e) => setSongsQuery(e.target.value)}
                  />
                </label>
              )}
              <BlockDropdown
                value={songsSort}
                options={SONGS_SORT_OPTIONS}
                onChange={setSongsSort}
                ariaLabel="Sort songs"
                align="end"
                chevron={false}
                triggerIcon={ArrowUpDown}
              />
            </>
          ) : (
            <BlockDropdown
              value={genreMetric}
              options={GENRE_METRIC_OPTIONS}
              onChange={setGenreMetric}
              ariaLabel="Genre metric"
              align="end"
            />
          )}
        </div>
      </header>

      <div className="cm-block__body">
        {songsView === 'songs' ? (
          sortedSongs.length === 0 ? (
            <div className="cm-block__empty">No songs match filter</div>
          ) : (
            <div
              className="cm-ag-grid-wrap"
              onClick={(e) => {
                if (focused) e.stopPropagation();
              }}
            >
              <AgGridReact
                rowData={sortedSongs}
                columnDefs={songsColumnDefs}
                getRowId={getSongRowId}
                suppressScrollOnNewData
                defaultColDef={DEFAULT_AG_COL_DEF}
                headerHeight={isMobile ? 28 : 30}
                rowHeight={isMobile ? 38 : 40}
                suppressCellFocus
                animateRows
                onRowClicked={handleSongRowClicked}
              />
            </div>
          )
        ) : (
          <GenreBreakdown
            songs={songs}
            genreMetric={genreMetric}
            focused={focused}
            isMobile={isMobile}
          />
        )}
      </div>
    </section>
  );
}
