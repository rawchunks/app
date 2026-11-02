import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { NETWORK_LOGOS } from '../contexts/Network';
import type {
  CreatorEarningsResponse,
  CreatorEarningsSummary,
  NetworkEarningsBreakdown,
  Song,
  SongEarningsItem,
} from '../lib/schema';

export function formatUsd(val: number, withSymbol = true): string {
  const prefix = withSymbol ? '$' : '';
  if (!Number.isFinite(val) || val <= 0) return `${prefix}0.00`;
  if (val < 0.01) return `${prefix}${val.toFixed(4)}`;
  if (val < 1) {
    const fixed3 = val.toFixed(3);
    return fixed3.endsWith('0') ? `${prefix}${val.toFixed(2)}` : `${prefix}${fixed3}`;
  }
  return `${prefix}${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function getNetworkLogo(networkOrFamily?: string | null): string | null {
  if (!networkOrFamily) return null;
  if (NETWORK_LOGOS[networkOrFamily]) return NETWORK_LOGOS[networkOrFamily];
  const lower = networkOrFamily.trim().toLowerCase();
  if (lower === 'base' || lower === 'eip155:8453') return NETWORK_LOGOS['eip155:8453'] || '/networks/base.png';
  if (lower === 'eip155:84532') return NETWORK_LOGOS['eip155:84532'] || '/networks/baseSepolia.png';
  if (lower === 'tempo' || lower === 'eip155:4217') return NETWORK_LOGOS['eip155:4217'] || '/networks/tempo.png';
  if (lower === 'eip155:42431') return NETWORK_LOGOS['eip155:42431'] || '/networks/tempoModerato.png';
  if (lower === 'solana' || lower === 'solana:5eykt4usfv8p8njdtrepy1vzqkqzqvdp') {
    return NETWORK_LOGOS['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'] || '/networks/solana.jpeg';
  }
  if (lower.startsWith('solana:')) {
    return NETWORK_LOGOS['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'] || '/networks/solanaDevnet.jpeg';
  }
  return null;
}

export function classifySongNetwork(network?: string | null): {
  family: 'base' | 'tempo' | 'solana' | 'other';
  label: string;
} {
  if (!network) return { family: 'other', label: 'Unassigned' };
  const lower = network.toLowerCase();
  if (lower.startsWith('solana:')) {
    return {
      family: 'solana',
      label: lower.includes('etwtrab') ? 'Solana Devnet' : 'Solana',
    };
  }
  if (lower === 'eip155:84532') return { family: 'base', label: 'Base Sepolia' };
  if (lower === 'eip155:8453') return { family: 'base', label: 'Base' };
  if (lower === 'eip155:42431' || lower === 'eip155:4217') {
    return { family: 'tempo', label: lower === 'eip155:42431' ? 'Tempo Testnet' : 'Tempo' };
  }
  return { family: 'other', label: network };
}

export function buildFallbackSongEarning(song: Song): SongEarningsItem {
  const { family, label } = classifySongNetwork(song.network);
  const minted = Math.max(0, Number(song.licenses || 0));
  return {
    songId: song.id,
    chainSongId: song.chain_song_id || null,
    network: song.network || null,
    networkFamily: family,
    networkLabel: label,
    explorerUrl: song.tx_url || null,
    txHash: song.tx_hash || null,
    licensesMinted: minted,
    licensesRemaining: minted,
    licensesSold: 0,
    licensePriceUsd: Math.max(0, Number(song.license_price || 0)),
    streamPriceUsd: Math.max(0, Number(song.stream_price || 0)),
    licenseProfitUsd: 0,
    streamProfitUsd: 0,
    totalProfitUsd: 0,
    plays: Math.max(0, Number(song.plays || 0)),
    streamSettlements: 0,
  };
}

export function computeAggregatedEarnings(
  publishedSongs: Song[],
  remoteData: CreatorEarningsResponse | null | undefined,
  networkFilter: string,
): {
  summary: CreatorEarningsSummary;
  networks: NetworkEarningsBreakdown[];
  songMetrics: Record<string, SongEarningsItem>;
  filteredSongs: Song[];
} {
  const allSongMetrics: Record<string, SongEarningsItem> = {};
  const networkBuckets = new Map<string, NetworkEarningsBreakdown>();

  for (const song of publishedSongs) {
    const remote = remoteData?.songs?.[song.id];
    const base = remote ? { ...remote } : buildFallbackSongEarning(song);
    base.plays = Math.max(base.plays, Number(song.plays || 0));
    if (!base.txHash && song.tx_hash) base.txHash = song.tx_hash;
    if (!base.explorerUrl && song.tx_url) base.explorerUrl = song.tx_url;
    allSongMetrics[song.id] = base;

    const key = base.networkFamily !== 'other' ? base.networkFamily : (base.network || 'other');
    const existing = networkBuckets.get(key) || {
      network: key,
      family: base.networkFamily,
      label:
        base.networkFamily === 'base'
          ? 'Base'
          : base.networkFamily === 'tempo'
            ? 'Tempo'
            : base.networkFamily === 'solana'
              ? 'Solana'
              : base.networkLabel,
      songCount: 0,
      licensesSold: 0,
      licensesRemaining: 0,
      plays: 0,
      licenseProfitUsd: 0,
      streamProfitUsd: 0,
      totalProfitUsd: 0,
    };
    existing.songCount += 1;
    existing.licensesSold += base.licensesSold;
    existing.licensesRemaining += base.licensesRemaining;
    existing.plays += base.plays;
    existing.licenseProfitUsd = Number((existing.licenseProfitUsd + base.licenseProfitUsd).toFixed(6));
    existing.streamProfitUsd = Number((existing.streamProfitUsd + base.streamProfitUsd).toFixed(6));
    existing.totalProfitUsd = Number((existing.totalProfitUsd + base.totalProfitUsd).toFixed(6));
    networkBuckets.set(key, existing);
  }

  const normalizedFilter = (networkFilter || 'all').trim().toLowerCase();
  const matchesFilter = (item: SongEarningsItem | undefined) => {
    if (!item) return false;
    if (normalizedFilter === 'all') return true;
    return (
      item.networkFamily === normalizedFilter ||
      (item.network || '').toLowerCase() === normalizedFilter
    );
  };

  const filteredSongs = publishedSongs.filter((song) => matchesFilter(allSongMetrics[song.id]));
  const activeItems = filteredSongs.map((s) => allSongMetrics[s.id]).filter(Boolean);

  const displaySongMetrics: Record<string, SongEarningsItem> = {};
  for (const [songId, item] of Object.entries(allSongMetrics)) {
    if (matchesFilter(item)) {
      displaySongMetrics[songId] = item;
    } else {
      displaySongMetrics[songId] = {
        ...item,
        licensesSold: 0,
        licenseProfitUsd: 0,
        streamProfitUsd: 0,
        totalProfitUsd: 0,
        streamSettlements: 0,
      };
    }
  }

  const summary: CreatorEarningsSummary = {
    totalProfitUsd: Number(activeItems.reduce((acc, s) => acc + s.totalProfitUsd, 0).toFixed(6)),
    licenseProfitUsd: Number(activeItems.reduce((acc, s) => acc + s.licenseProfitUsd, 0).toFixed(6)),
    streamProfitUsd: Number(activeItems.reduce((acc, s) => acc + s.streamProfitUsd, 0).toFixed(6)),
    licensesSold: activeItems.reduce((acc, s) => acc + s.licensesSold, 0),
    licensesRemaining: activeItems.reduce((acc, s) => acc + s.licensesRemaining, 0),
    licensesMinted: activeItems.reduce((acc, s) => acc + s.licensesMinted, 0),
    totalPlays: activeItems.reduce((acc, s) => acc + s.plays, 0),
    publishedCount: activeItems.length,
    activeNetworkFilter: normalizedFilter,
  };

  return {
    summary,
    networks: Array.from(networkBuckets.values()),
    songMetrics: displaySongMetrics,
    filteredSongs,
  };
}

export type NetworkFilter = 'all' | 'base' | 'tempo' | 'solana';

export function useCreatorEarnings(creatorAddress?: string | null, _networkFilter?: NetworkFilter) {
  const addr = creatorAddress?.trim() || '';
  return useQuery({
    queryKey: ['earnings', 'creator', addr],
    enabled: Boolean(addr),
    queryFn: async ({ signal }): Promise<CreatorEarningsResponse | null> => {
      if (!addr) return null;
      const response = await api.fetch(`/api/earnings?creator=${encodeURIComponent(addr)}`, {
        signal,
        headers: { 'x-user-address': addr },
      });
      if (!response.ok) return null;
      return (await response.json()) as CreatorEarningsResponse;
    },
    staleTime: 20_000,
    refetchInterval: 45_000,
  });
}
