import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Globe, List, RotateCcw } from 'lucide-react';
import { Tooltip } from '../daw/Tooltip';
import { getNetworkLogo, type NetworkFilter } from '../../hooks/use-earnings';
import { BlockDropdown } from './dropdown';
import { ActivityFeed } from './feed';
import { OverviewCards } from './overview';
import { SongsBlock } from './songs';
import { TimelineChart } from './timeline';
import {
  DATE_WINDOW_OPTIONS,
  SOURCE_OPTIONS,
  type BlockId,
  type DateWindow,
  type DropdownOption,
  type EarnChartsProps,
  type EnrichedEventItem,
  type NormalizedSongRow,
  type OverviewStats,
  type RevenueSourceFilter,
  type TimeSeriesBucket,
} from './utils';

export * from './utils';
export * from './dropdown';
export * from './overview';
export * from './timeline';
export * from './songs';
export * from './genres';
export * from './feed';

export function Earn({
  songs,
  songMetrics,
  events = [],
  globalNetworkFilter,
  onNetworkFilterChange,
  dateWindow: controlledDateWindow,
  onDateWindowChange,
  sourceFilter: controlledSourceFilter,
  onSourceFilterChange,
  hideControlRail = false,
  earnView = 'charts',
  onEarnViewChange,
  onRefresh,
  isRefreshing = false,
  onSelectSong,
}: EarnChartsProps) {
  const [focusedBlock, setFocusedBlock] = useState<BlockId | null>(null);

  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const [internalDateWindow, setInternalDateWindow] = useState<DateWindow>('7d');
  const [internalSourceFilter, setInternalSourceFilter] = useState<RevenueSourceFilter>('all');

  const dateWindow = controlledDateWindow ?? internalDateWindow;
  const setDateWindow = onDateWindowChange ?? setInternalDateWindow;
  const sourceFilter = controlledSourceFilter ?? internalSourceFilter;
  const setSourceFilter = onSourceFilterChange ?? setInternalSourceFilter;

  const toggleFocus = (id: BlockId) => {
    setFocusedBlock((prev) => (prev === id ? null : id));
  };

  const networkOptions = useMemo<DropdownOption<NetworkFilter>[]>(
    () => [
      { value: 'all', label: 'All', icon: Globe, tooltip: 'All supported networks' },
      { value: 'base', label: 'Base', logoUrl: getNetworkLogo('base'), tooltip: 'Base L2 network' },
      {
        value: 'solana',
        label: 'Solana',
        logoUrl: getNetworkLogo('solana'),
        tooltip: 'Solana network',
      },
      {
        value: 'tempo',
        label: 'Tempo',
        logoUrl: getNetworkLogo('tempo'),
        tooltip: 'Tempo network',
      },
    ],
    [],
  );

  const viewSwitchOptions = useMemo<DropdownOption<'list' | 'charts'>[]>(
    () => [
      { value: 'list', label: 'List', icon: List, tooltip: 'Switch to song list view' },
      {
        value: 'charts',
        label: 'Charts',
        icon: BarChart3,
        tooltip: 'Switch to interactive charts dashboard',
      },
    ],
    [],
  );

  const anchorNowRef = useRef<number>(Date.now());

  const windowCutoffMs = useMemo(() => {
    const now = anchorNowRef.current;
    const hours =
      dateWindow === '24h'
        ? 24
        : dateWindow === '7d'
          ? 24 * 7
          : dateWindow === '30d'
            ? 24 * 30
            : 24 * 180;
    return now - hours * 3600_000;
  }, [dateWindow]);

  const normalizedSongs = useMemo<NormalizedSongRow[]>(() => {
    const fallbackNow = anchorNowRef.current;
    return songs
      .map((song) => {
        const m = songMetrics[song.id];
        if (!m) return null;
        if (globalNetworkFilter !== 'all' && m.networkFamily !== globalNetworkFilter) {
          return null;
        }
        const profitUsd =
          sourceFilter === 'streams'
            ? m.streamProfitUsd
            : sourceFilter === 'licenses'
              ? m.licenseProfitUsd
              : m.totalProfitUsd;
        const grossUsd = Number((profitUsd / 0.8).toFixed(6));
        const platformFeeUsd = Number((grossUsd - profitUsd).toFixed(6));
        const plays = sourceFilter === 'licenses' ? m.licensesSold : m.plays;
        const durationMs =
          m.durationMs && m.durationMs > 0
            ? m.durationMs
            : Math.round(Math.max(0, Number(song.duration || 0)) * 1000);
        const streamedMs =
          sourceFilter === 'licenses'
            ? 0
            : m.streamedMs && m.streamedMs > 0
              ? m.streamedMs
              : plays > 0 && durationMs > 0
                ? Math.round(plays * Math.min(durationMs, 35_000))
                : 0;
        const ratioPct =
          m.ratioPct && m.ratioPct > 0
            ? m.ratioPct
            : plays > 0 && durationMs > 0 && streamedMs > 0
              ? Number(Math.min(100, (streamedMs / (plays * durationMs)) * 100).toFixed(1))
              : 0;
        const rawGenres = [
          ...(Array.isArray(m.genres) ? m.genres : []),
          ...(Array.isArray(song.genres) ? song.genres : []),
          ...(Array.isArray(song.tags) ? song.tags : []),
          m.primaryGenre || '',
        ]
          .flatMap((g) => (typeof g === 'string' ? g.split(',') : []))
          .map((g) => g.trim())
          .filter(Boolean);
        const seenLower = new Set<string>();
        const dedupedGenres: string[] = [];
        for (const g of rawGenres) {
          const k = g.toLowerCase();
          if (!seenLower.has(k)) {
            seenLower.add(k);
            dedupedGenres.push(g);
          }
        }
        const allGenres = dedupedGenres.length > 0 ? dedupedGenres : ['Audio'];
        const genre = allGenres[0];
        const genreLabel = allGenres.join(', ');
        const lastPlayedAt =
          m.lastPlayedAt && m.lastPlayedAt > 0
            ? m.lastPlayedAt
            : song.created_at
              ? Date.parse(song.created_at) || fallbackNow
              : fallbackNow;

        return {
          song,
          songId: song.id,
          title: song.title || 'Untitled',
          genre,
          allGenres,
          genreLabel,
          network: m.network || 'other',
          networkFamily: m.networkFamily,
          networkLabel: m.networkLabel,
          logoUrl: getNetworkLogo(m.network || m.networkFamily),
          profitUsd,
          streamProfitUsd: m.streamProfitUsd,
          licenseProfitUsd: m.licenseProfitUsd,
          platformFeeUsd,
          grossUsd,
          plays,
          rawPlays: m.plays,
          licensesSold: m.licensesSold,
          licensesMinted: m.licensesMinted,
          licensesRemaining: m.licensesRemaining,
          durationMs,
          streamedMs,
          ratioPct,
          txHash: m.txHash || song.tx_hash || null,
          explorerUrl: m.explorerUrl || song.tx_url || null,
          lastPlayedAt,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [songs, songMetrics, globalNetworkFilter, sourceFilter]);

  const unifiedEvents = useMemo<EnrichedEventItem[]>(() => {
    const songById = new Map(normalizedSongs.map((s) => [s.songId, s]));

    const baseEvents = events
      .map((ev) => {
        const songRow = songById.get(ev.songId);
        let streamedMs = ev.streamedMs;
        let durationMs = ev.durationMs || songRow?.durationMs || 0;
        let ratioPct = ev.ratioPct;
        let royaltiesUsd = ev.royaltiesUsd;
        let platformFeeUsd = ev.platformFeeUsd;
        let totalUsd = ev.totalUsd;
        let timestamp = ev.timestamp;

        if (ev.kind === 'stream' && songRow) {
          if (streamedMs <= 0) {
            streamedMs =
              songRow.rawPlays > 0
                ? Math.round(songRow.streamedMs / songRow.rawPlays)
                : songRow.streamedMs;
          }
          if (ratioPct <= 0) {
            ratioPct =
              durationMs > 0 && streamedMs > 0
                ? Number(Math.min(100, (streamedMs / durationMs) * 100).toFixed(1))
                : songRow.ratioPct;
          }
          if (royaltiesUsd <= 0 && songRow.rawPlays > 0 && songRow.streamProfitUsd > 0) {
            royaltiesUsd = Number((songRow.streamProfitUsd / songRow.rawPlays).toFixed(6));
            totalUsd = Number((royaltiesUsd / 0.8).toFixed(6));
            platformFeeUsd = Number((totalUsd - royaltiesUsd).toFixed(6));
          }
          if (ev.id.startsWith('play:')) {
            const parts = ev.id.split(':');
            const playIndex = Math.max(0, (Number(parts[parts.length - 1]) || 1) - 1);
            const createdMs = songRow.song.created_at
              ? Date.parse(songRow.song.created_at) || timestamp
              : timestamp - 86_400_000 * 3;
            const spanMs = Math.max(3600_000 * 12, timestamp - createdMs);
            const step = spanMs / Math.max(1, songRow.rawPlays);
            timestamp = Math.round(timestamp - playIndex * step);
          }
        }

        const fallbackEvGenres = (ev.genre || 'Audio')
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean);
        const allGenres =
          songRow?.allGenres && songRow.allGenres.length > 0
            ? songRow.allGenres
            : fallbackEvGenres.length > 0
              ? fallbackEvGenres
              : ['Audio'];
        const genreLabel = allGenres.join(', ');

        return {
          ...ev,
          allGenres,
          genreLabel,
          streamedMs,
          durationMs,
          ratioPct,
          royaltiesUsd,
          platformFeeUsd,
          totalUsd,
          timestamp,
        };
      })
      .filter((ev) => {
        if (globalNetworkFilter !== 'all' && ev.networkFamily !== globalNetworkFilter) return false;
        if (sourceFilter === 'streams' && ev.kind !== 'stream') return false;
        if (sourceFilter === 'licenses' && ev.kind !== 'license') return false;
        const ts = ev.timestamp;
        if (Number.isFinite(ts) && ts > 0 && ts < windowCutoffMs) return false;
        return true;
      });

    const coveredSongIds = new Set(baseEvents.map((e) => e.songId));
    const synthesized: EnrichedEventItem[] = [];

    for (const row of normalizedSongs) {
      if (coveredSongIds.has(row.songId)) continue;
      if (row.rawPlays <= 0 && row.licensesSold <= 0 && row.profitUsd <= 0) continue;

      if (sourceFilter !== 'licenses' && (row.rawPlays > 0 || row.streamProfitUsd > 0)) {
        const royalties = row.streamProfitUsd;
        const total = Number((royalties / 0.8).toFixed(6));
        const fee = Number((total - royalties).toFixed(6));
        synthesized.push({
          id: `song-stream-${row.songId}`,
          songId: row.songId,
          songTitle: row.title,
          genre: row.genre,
          allGenres: row.allGenres,
          genreLabel: row.genreLabel,
          network: row.network,
          networkFamily: row.networkFamily,
          networkLabel: row.networkLabel,
          kind: 'stream',
          totalUsd: total,
          royaltiesUsd: royalties,
          platformFeeUsd: fee,
          streamedMs: row.streamedMs,
          durationMs: row.durationMs,
          ratioPct: row.ratioPct,
          txHash: row.txHash,
          explorerUrl: row.explorerUrl,
          payer: null,
          timestamp: row.lastPlayedAt || anchorNowRef.current,
        });
      }

      if (sourceFilter !== 'streams' && (row.licensesSold > 0 || row.licenseProfitUsd > 0)) {
        const royalties = row.licenseProfitUsd;
        const total = Number((royalties / 0.8).toFixed(6));
        const fee = Number((total - royalties).toFixed(6));
        synthesized.push({
          id: `song-license-${row.songId}`,
          songId: row.songId,
          songTitle: row.title,
          genre: row.genre,
          allGenres: row.allGenres,
          genreLabel: row.genreLabel,
          network: row.network,
          networkFamily: row.networkFamily,
          networkLabel: row.networkLabel,
          kind: 'license',
          totalUsd: total,
          royaltiesUsd: royalties,
          platformFeeUsd: fee,
          streamedMs: row.streamedMs,
          durationMs: row.durationMs,
          ratioPct: row.ratioPct,
          txHash: row.txHash,
          explorerUrl: row.explorerUrl,
          payer: null,
          timestamp: row.lastPlayedAt || anchorNowRef.current,
        });
      }
    }

    return [...baseEvents, ...synthesized].sort(
      (a, b) => (b.timestamp || 0) - (a.timestamp || 0),
    );
  }, [events, normalizedSongs, globalNetworkFilter, sourceFilter, windowCutoffMs]);

  const topPlaysSongs = useMemo(() => {
    return [...normalizedSongs]
      .sort((a, b) => b.rawPlays - a.rawPlays || b.profitUsd - a.profitUsd)
      .slice(0, 3);
  }, [normalizedSongs]);

  const topStreamedSongs = useMemo(() => {
    return [...normalizedSongs]
      .sort((a, b) => b.streamedMs - a.streamedMs || b.rawPlays - a.rawPlays)
      .slice(0, 3);
  }, [normalizedSongs]);

  const timeSeriesData = useMemo<TimeSeriesBucket[]>(() => {
    const now = Date.now();
    const bucketCount =
      dateWindow === '24h' ? 12 : dateWindow === '7d' ? 7 : dateWindow === '30d' ? 15 : 12;
    const totalWindowMs = now - windowCutoffMs;
    const stepMs = Math.max(1, Math.floor(totalWindowMs / bucketCount));

    const playTopIds = topPlaysSongs.map((s) => s.songId);
    const streamTopIds = topStreamedSongs.map((s) => s.songId);

    const buckets = Array.from({ length: bucketCount }, (_, idx) => {
      const startMs = windowCutoffMs + idx * stepMs;
      const endMs = idx === bucketCount - 1 ? now + 1000 : startMs + stepMs;
      const d = new Date(startMs);
      const label =
        dateWindow === '24h'
          ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
          : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      return {
        index: idx,
        startMs,
        endMs,
        label,
        royaltiesUsd: 0,
        platformFeeUsd: 0,
        totalUsd: 0,
        plays: 0,
        playTop0: 0,
        playTop1: 0,
        playTop2: 0,
        playOthers: 0,
        streamedMs: 0,
        streamTop0: 0,
        streamTop1: 0,
        streamTop2: 0,
        streamOthers: 0,
        ratioWeightedSum: 0,
        ratioWeightCount: 0,
        ratioPct: 0,
      };
    });

    if (events.length > 0) {
      for (const ev of unifiedEvents) {
        const ts = ev.timestamp;
        const clampedTs =
          Number.isFinite(ts) && ts > 0
            ? Math.max(windowCutoffMs, Math.min(now, ts))
            : now;
        const bIdx = Math.min(
          bucketCount - 1,
          Math.max(0, Math.floor((clampedTs - windowCutoffMs) / stepMs)),
        );
        const b = buckets[bIdx];
        b.royaltiesUsd = Number((b.royaltiesUsd + ev.royaltiesUsd).toFixed(6));
        b.platformFeeUsd = Number((b.platformFeeUsd + ev.platformFeeUsd).toFixed(6));
        b.totalUsd = Number((b.royaltiesUsd + b.platformFeeUsd).toFixed(6));

        const playIncrement = ev.kind === 'stream' ? 1 : 0;
        if (playIncrement > 0) {
          b.plays += playIncrement;
          const pIdx = playTopIds.indexOf(ev.songId);
          if (pIdx === 0) b.playTop0 += playIncrement;
          else if (pIdx === 1) b.playTop1 += playIncrement;
          else if (pIdx === 2) b.playTop2 += playIncrement;
          else b.playOthers += playIncrement;
        }

        const msIncrement = Math.max(0, Math.round(ev.streamedMs || 0));
        if (msIncrement > 0) {
          b.streamedMs += msIncrement;
          const sIdx = streamTopIds.indexOf(ev.songId);
          if (sIdx === 0) b.streamTop0 += msIncrement;
          else if (sIdx === 1) b.streamTop1 += msIncrement;
          else if (sIdx === 2) b.streamTop2 += msIncrement;
          else b.streamOthers += msIncrement;
        }

        if (ev.ratioPct > 0) {
          b.ratioWeightedSum += ev.ratioPct;
          b.ratioWeightCount += 1;
        }
      }
    }

    const bucketTotalPlays = buckets.reduce((acc, b) => acc + b.plays, 0);
    const catalogTotalPlays = normalizedSongs.reduce((acc, s) => acc + s.rawPlays, 0);
    if (catalogTotalPlays > bucketTotalPlays) {
      for (const s of normalizedSongs) {
        const ts = s.lastPlayedAt || now;
        const clampedTs =
          Number.isFinite(ts) && ts > 0
            ? Math.max(windowCutoffMs, Math.min(now, ts))
            : now;
        const bIdx = Math.min(
          bucketCount - 1,
          Math.max(0, Math.floor((clampedTs - windowCutoffMs) / stepMs)),
        );
        const b = buckets[bIdx];
        const pIdx = playTopIds.indexOf(s.songId);
        const sIdx = streamTopIds.indexOf(s.songId);

        if (bucketTotalPlays === 0) {
          b.plays += s.rawPlays;
          if (pIdx === 0) b.playTop0 += s.rawPlays;
          else if (pIdx === 1) b.playTop1 += s.rawPlays;
          else if (pIdx === 2) b.playTop2 += s.rawPlays;
          else b.playOthers += s.rawPlays;

          b.streamedMs += s.streamedMs;
          if (sIdx === 0) b.streamTop0 += s.streamedMs;
          else if (sIdx === 1) b.streamTop1 += s.streamedMs;
          else if (sIdx === 2) b.streamTop2 += s.streamedMs;
          else b.streamOthers += s.streamedMs;

          b.royaltiesUsd = Number((b.royaltiesUsd + s.profitUsd).toFixed(6));
          b.platformFeeUsd = Number((b.platformFeeUsd + s.platformFeeUsd).toFixed(6));
          b.totalUsd = Number((b.royaltiesUsd + b.platformFeeUsd).toFixed(6));

          if (s.ratioPct > 0) {
            b.ratioWeightedSum += s.ratioPct;
            b.ratioWeightCount += 1;
          }
        }
      }
    }

    const activeRatioBuckets = buckets.filter((b) => b.ratioWeightCount > 0);
    const overallAvgRatio =
      activeRatioBuckets.length > 0
        ? Number(
            (
              activeRatioBuckets.reduce(
                (acc, b) => acc + b.ratioWeightedSum / b.ratioWeightCount,
                0,
              ) / activeRatioBuckets.length
            ).toFixed(1),
          )
        : normalizedSongs.length > 0
          ? Number(
              (
                normalizedSongs.reduce((acc, s) => acc + s.ratioPct, 0) / normalizedSongs.length
              ).toFixed(1),
            )
          : 0;

    return buckets.map((b) => {
      const ratioPct =
        b.ratioWeightCount > 0
          ? Number((b.ratioWeightedSum / b.ratioWeightCount).toFixed(1))
          : overallAvgRatio;
      return {
        ...b,
        ratioPct,
        avgRatioPct: overallAvgRatio,
      };
    });
  }, [
    dateWindow,
    windowCutoffMs,
    topPlaysSongs,
    topStreamedSongs,
    events.length,
    unifiedEvents,
    normalizedSongs,
  ]);

  const overviewStats = useMemo<OverviewStats>(() => {
    const totalProfitUsd = normalizedSongs.reduce((acc, s) => acc + s.profitUsd, 0);
    const totalPlays = normalizedSongs.reduce((acc, s) => acc + s.rawPlays, 0);
    const totalStreamedMs = normalizedSongs.reduce((acc, s) => acc + s.streamedMs, 0);
    const avgMsPerPlay = totalPlays > 0 ? Math.round(totalStreamedMs / totalPlays) : 0;
    const songsWithRatio = normalizedSongs.filter((s) => s.ratioPct > 0);
    const avgRatioPct =
      songsWithRatio.length > 0
        ? Number(
            (
              songsWithRatio.reduce((acc, s) => acc + s.ratioPct, 0) / songsWithRatio.length
            ).toFixed(1),
          )
        : 0;
    const peakRatioPct =
      songsWithRatio.length > 0
        ? Number(Math.max(...songsWithRatio.map((s) => s.ratioPct)).toFixed(1))
        : 0;
    const licensesSold = normalizedSongs.reduce((acc, s) => acc + s.licensesSold, 0);
    const licensesMinted = normalizedSongs.reduce((acc, s) => acc + s.licensesMinted, 0);
    const licenseProfitUsd = normalizedSongs.reduce((acc, s) => acc + s.licenseProfitUsd, 0);

    return {
      totalProfitUsd,
      totalPlays,
      totalStreamedMs,
      avgMsPerPlay,
      avgRatioPct,
      peakRatioPct,
      licensesSold,
      licensesMinted,
      licenseProfitUsd,
      profitSparkline: timeSeriesData.map((d) => d.royaltiesUsd),
    };
  }, [normalizedSongs, timeSeriesData]);

  return (
    <div
      className="cm-dashboard"
      data-focus={focusedBlock ?? undefined}
      data-rail={hideControlRail ? 'hidden' : undefined}
    >
      {!hideControlRail && (
        <header className="cm-dashboard-control-rail">
          <div className="cm-dashboard-control-rail__brand">
            {onEarnViewChange && (
              <BlockDropdown
                variant="header"
                value={earnView}
                options={viewSwitchOptions}
                onChange={onEarnViewChange}
                ariaLabel="Switch Earn View"
              />
            )}
            {isRefreshing && <span className="cm-dashboard__updating">UPDATING…</span>}
          </div>

          <div />

          <div className="cm-dashboard-control-rail__actions">
            <BlockDropdown
              variant="header"
              value={globalNetworkFilter}
              options={networkOptions}
              onChange={onNetworkFilterChange}
              ariaLabel="Filter by Network"
              align="end"
            />

            <BlockDropdown
              variant="header"
              value={sourceFilter}
              options={SOURCE_OPTIONS}
              onChange={setSourceFilter}
              ariaLabel="Filter by Revenue Source"
              align="end"
            />

            <BlockDropdown
              variant="header"
              value={dateWindow}
              options={DATE_WINDOW_OPTIONS}
              onChange={setDateWindow}
              ariaLabel="Select Date Range"
              align="end"
            />

            {onRefresh && (
              <Tooltip title="Sync Revenue" description="Refresh on-chain & streaming metrics">
                <button
                  type="button"
                  className="cm-control-icon-button"
                  onClick={onRefresh}
                  disabled={isRefreshing}
                  aria-label="Sync on-chain revenue"
                >
                  <RotateCcw size={13} className={isRefreshing ? 'spin-icon' : ''} />
                </button>
              </Tooltip>
            )}
          </div>
        </header>
      )}

      <OverviewCards stats={overviewStats} />

      <TimelineChart
        timeSeriesData={timeSeriesData}
        topPlaysSongs={topPlaysSongs}
        topStreamedSongs={topStreamedSongs}
        totalSongsCount={normalizedSongs.length}
        overviewStats={overviewStats}
        isMobile={isMobile}
        focused={focusedBlock === 'chart'}
        onToggleFocus={() => toggleFocus('chart')}
      />

      <SongsBlock
        songs={normalizedSongs}
        focused={focusedBlock === 'songs'}
        isMobile={isMobile}
        onToggleFocus={() => toggleFocus('songs')}
        onSelectSong={onSelectSong}
      />

      <ActivityFeed
        events={unifiedEvents}
        focused={focusedBlock === 'feed'}
        isMobile={isMobile}
        onToggleFocus={() => toggleFocus('feed')}
      />
    </div>
  );
}

export default Earn;
