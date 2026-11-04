import type React from 'react';
import {
  AllCommunityModule as GridCommunityModule,
  ModuleRegistry as GridModuleRegistry,
  type ColDef,
} from 'ag-grid-community';
import {
  AllCommunityModule as ChartsCommunityModule,
  ModuleRegistry as ChartsModuleRegistry,
} from 'ag-charts-community';
import {
  Activity,
  Calendar,
  Clock,
  Disc3,
  DollarSign,
  Filter,
  Headphones,
  Layers,
  Music2,
  Radio,
} from 'lucide-react';
import type { NetworkFilter } from '../../hooks/use-earnings';
import type { EarningEventItem, Song, SongEarningsItem } from '../../lib/schema';

GridModuleRegistry.registerModules([GridCommunityModule]);
ChartsModuleRegistry.registerModules([ChartsCommunityModule]);

// ============================================================================
// Types
// ============================================================================

export type BlockId = 'chart' | 'songs' | 'feed';
export type DateWindow = '24h' | '7d' | '30d' | '180d';
export type RevenueSourceFilter = 'all' | 'streams' | 'licenses';
export type ChartView = 'profit' | 'plays' | 'streamed' | 'ratio';
export type SongsView = 'songs' | 'genre';
export type SongsSortKey = 'profit' | 'plays' | 'streamed' | 'ratio' | 'recent' | 'genre';
export type GenreMetric = 'profit' | 'plays' | 'streamed';
export type FeedView = 'plays' | 'settlements';
export type PlaysFilter = 'all' | 'stream' | 'license';
export type SettlementsFilter = 'all' | 'settled';
export type StatId = 'profit' | 'plays' | 'streamed' | 'ratio' | 'licenses';

export interface EarnChartsProps {
  songs: Song[];
  songMetrics: Record<string, SongEarningsItem>;
  events?: EarningEventItem[];
  globalNetworkFilter: NetworkFilter;
  onNetworkFilterChange: (net: NetworkFilter) => void;
  dateWindow?: DateWindow;
  onDateWindowChange?: (win: DateWindow) => void;
  sourceFilter?: RevenueSourceFilter;
  onSourceFilterChange?: (src: RevenueSourceFilter) => void;
  hideControlRail?: boolean;
  earnView?: 'list' | 'charts';
  onEarnViewChange?: (view: 'list' | 'charts') => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onSelectSong?: (song: Song) => void;
}

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  icon?: React.ComponentType<{ className?: string; size?: number }>;
  logoUrl?: string | null;
  tooltip?: string;
}

export interface NormalizedSongRow {
  song: Song;
  songId: string;
  title: string;
  genre: string;
  allGenres: string[];
  genreLabel: string;
  network: string;
  networkFamily: 'base' | 'solana' | 'tempo' | 'other';
  networkLabel: string;
  logoUrl: string | null;
  profitUsd: number;
  streamProfitUsd: number;
  licenseProfitUsd: number;
  platformFeeUsd: number;
  grossUsd: number;
  plays: number;
  rawPlays: number;
  licensesSold: number;
  licensesMinted: number;
  licensesRemaining: number;
  durationMs: number;
  streamedMs: number;
  ratioPct: number;
  txHash: string | null;
  explorerUrl: string | null;
  lastPlayedAt: number;
}

export type EnrichedEventItem = EarningEventItem & {
  allGenres: string[];
  genreLabel: string;
};

export interface TimeSeriesBucket {
  index: number;
  startMs: number;
  endMs: number;
  label: string;
  royaltiesUsd: number;
  platformFeeUsd: number;
  totalUsd: number;
  plays: number;
  playTop0: number;
  playTop1: number;
  playTop2: number;
  playOthers: number;
  streamedMs: number;
  streamTop0: number;
  streamTop1: number;
  streamTop2: number;
  streamOthers: number;
  ratioWeightedSum: number;
  ratioWeightCount: number;
  ratioPct: number;
  avgRatioPct: number;
}

export interface OverviewStats {
  totalProfitUsd: number;
  totalPlays: number;
  totalStreamedMs: number;
  avgMsPerPlay: number;
  avgRatioPct: number;
  peakRatioPct: number;
  licensesSold: number;
  licensesMinted: number;
  licenseProfitUsd: number;
  profitSparkline: number[];
}

export interface GenreSlice {
  genre: string;
  profitUsd: number;
  plays: number;
  streamedMs: number;
  ratioSum: number;
  songCount: number;
  value: number;
  avgRatioPct: number;
  color: (typeof BRAND_PALETTE)[number];
  pct: number;
}

// ============================================================================
// Constants
// ============================================================================

export const BRAND_PALETTE = [
  '#00ff41',
  '#00ccff',
  '#ff0055',
  '#ffaa00',
  '#00e5a3',
  '#38bdf8',
] as const;

export const DEFAULT_AG_COL_DEF: ColDef = {
  suppressHeaderMenuButton: true,
  sortable: false,
  resizable: false,
};

export const DATE_WINDOW_OPTIONS: DropdownOption<DateWindow>[] = [
  { value: '24h', label: 'LAST 24H', icon: Calendar, tooltip: 'Activity over the last 24 hours' },
  { value: '7d', label: 'LAST 7D', icon: Calendar, tooltip: 'Activity over the last 7 days' },
  { value: '30d', label: 'LAST 30D', icon: Calendar, tooltip: 'Activity over the last 30 days' },
  { value: '180d', label: 'LAST 6M', icon: Calendar, tooltip: 'Activity over the last 6 months' },
];

export const SOURCE_OPTIONS: DropdownOption<RevenueSourceFilter>[] = [
  { value: 'all', label: 'ALL SOURCES', icon: Filter, tooltip: 'Combined earnings from streams and licenses' },
  { value: 'streams', label: 'STREAMS', icon: Headphones, tooltip: 'Royalties from x402 pay-per-stream plays' },
  { value: 'licenses', label: 'LICENSES', icon: Disc3, tooltip: 'Royalties from commercial & remix license sales' },
];

export const CHART_VIEW_OPTIONS: DropdownOption<ChartView>[] = [
  { value: 'profit', label: 'PROFIT', icon: DollarSign, tooltip: 'Net creator royalties (80%) and platform fee breakdown over time' },
  { value: 'plays', label: 'PLAYS', icon: Headphones, tooltip: 'Qualified plays (>= 30s) segmented by Top 3 songs + Others' },
  { value: 'streamed', label: 'STREAMED', icon: Clock, tooltip: 'Exact listening duration segmented by Top 3 songs + Others' },
  { value: 'ratio', label: 'RATIO', icon: Activity, tooltip: 'Percentage of track duration streamed vs. average' },
];

export const SONGS_VIEW_OPTIONS: DropdownOption<SongsView>[] = [
  { value: 'songs', label: 'SONGS', icon: Music2, tooltip: 'Per-song performance, earnings, and listening ratio' },
  { value: 'genre', label: 'BY GENRE', icon: Layers, tooltip: 'Catalog performance aggregated by genre' },
];

export const SONGS_SORT_OPTIONS: DropdownOption<SongsSortKey>[] = [
  { value: 'profit', label: 'PROFIT', icon: DollarSign, tooltip: 'Sort songs by net profit earned' },
  { value: 'plays', label: 'PLAYS', icon: Headphones, tooltip: 'Sort songs by qualified play count' },
  { value: 'streamed', label: 'STREAMED', icon: Clock, tooltip: 'Sort songs by total listening duration' },
  { value: 'ratio', label: 'RATIO', icon: Activity, tooltip: 'Sort songs by streamed-to-duration ratio (%)' },
  { value: 'recent', label: 'RECENT', icon: Clock, tooltip: 'Sort songs by most recent activity' },
  { value: 'genre', label: 'GENRE', icon: Layers, tooltip: 'Sort songs alphabetically by genre' },
];

export const GENRE_METRIC_OPTIONS: DropdownOption<GenreMetric>[] = [
  { value: 'profit', label: 'PROFIT', icon: DollarSign, tooltip: 'Share of net profit by genre' },
  { value: 'plays', label: 'PLAYS', icon: Headphones, tooltip: 'Share of total plays by genre' },
  { value: 'streamed', label: 'STREAMED', icon: Clock, tooltip: 'Share of total listening duration by genre' },
];

export const FEED_VIEW_OPTIONS: DropdownOption<FeedView>[] = [
  { value: 'plays', label: 'PLAYS', icon: Radio, tooltip: 'Chronological stream and license activity feed' },
  { value: 'settlements', label: 'SETTLEMENTS', icon: Layers, tooltip: 'Verified on-chain royalty settlements and transactions' },
];

// ============================================================================
// Pure Helpers
// ============================================================================

export function formatMs(ms: number): string {
  const safe = Math.max(0, Math.round(Number(ms) || 0));
  if (safe < 60_000) {
    const secs = Math.floor(safe / 1000);
    const cs = Math.floor((safe % 1000) / 10);
    return `${String(secs).padStart(2, '0')},${String(cs).padStart(2, '0')}s`;
  }
  if (safe < 3_600_000) {
    const totalSecs = Math.floor(safe / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2, '0')}.${String(secs).padStart(2, '0')}m`;
  }
  const totalSecs = Math.floor(safe / 1000);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  return `${String(hrs).padStart(2, '0')}.${String(mins).padStart(2, '0')},${String(secs).padStart(2, '0')}h`;
}

export function shortTx(txHash?: string | null): string {
  if (!txHash) return '';
  if (txHash.length <= 12) return txHash;
  return `${txHash.slice(0, 6)}…${txHash.slice(-4)}`;
}

export function timeAgo(ts?: number | string | null): string {
  if (!ts) return 'recent';
  const parsed = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(parsed) || parsed <= 0) return 'recent';
  const diffSec = Math.max(1, Math.floor((Date.now() - parsed) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function ratioTone(pct: number): 'emerald' | 'amber' | 'danger' {
  if (pct >= 65) return 'emerald';
  if (pct >= 35) return 'amber';
  return 'danger';
}

export function renderTooltipHtml(
  title: string,
  rows: Array<{ label: string; value: string; color?: string; strong?: boolean }>,
): string {
  const rowsHtml = rows
    .map((r) => {
      const dot = r.color
        ? `<span class="cm-chart-tooltip__dot" style="background:${r.color}"></span>`
        : '';
      return `<div class="cm-chart-tooltip__row" ${r.strong ? 'data-strong="true"' : ''}>
        <span class="cm-chart-tooltip__label">${dot}${r.label}</span>
        <span class="cm-chart-tooltip__value">${r.value}</span>
      </div>`;
    })
    .join('');
  return `<div class="cm-chart-tooltip">
    <div class="cm-chart-tooltip__time">${title}</div>
    ${rowsHtml}
  </div>`;
}

export const getSongRowId = <T extends { songId: string }>(params: { data: T }) =>
  params.data.songId;
export const getGenreRowId = <T extends { genre: string }>(params: { data: T }) =>
  params.data.genre;
export const getFeedRowId = <T extends { id: string }>(params: { data: T }) => params.data.id;
