/**
 * SCHEMA DEFINITIONS
 * STRICT RULES:
 * - Single-word files (schema.ts)
 * - Single-word types (Song, Track, Create, Edit, Model, Task, Response, Database)
 * - Single-word databases (songs, tracks)
 * - Zero versioning
 * - Zero name prefixes
 */

export type Model = 'acestep-v15-xl-turbo' | 'acestep-v15-xl-sft' | 'acestep-v15-xl-base';

export type Task = 'repaint' | 'lego' | 'complete' | 'extend' | 'cover' | 'extract';

/**
 * Pure Backend Inference Instructions for Song Creation
 */
export interface Create {
  model: 'acestep-v15-xl-turbo' | 'acestep-v15-xl-sft';
  prompt?: string;
  lyrics?: string;
  tags?: string[];
  duration?: number;
  voice?: File | null; // direct attachment only
  steps?: number;
  guidance?: number;
  seed?: number;
}

/**
 * Pure Backend Inference Instructions for Song Editing
 */
export interface Edit {
  model: 'acestep-v15-xl-base';
  task: Task;
  audio: string | File;
  prompt?: string;
  lyrics?: string;
  start?: number; // repainting_start
  end?: number;   // repainting_end
  steps?: number;
  guidance?: number;
  seed?: number;
}

/**
 * Persistent Song Entity with Metadata and Marketplace Pricing
 */
export interface Song {
  id: string;
  version?: number;
  family?: string | null;
  basis?: string | null;
  source?: string | null;
  is_remix?: boolean;
  parent_chain_song_id?: string | null;
  title: string;
  duration?: number;
  tags: string[];
  genres?: string[];
  production?: string[];
  mood?: string[];
  vocal?: string[];
  creator: string;       // useraddress
  public: boolean;       // isPublic
  image?: string;        // optional URL
  album_id?: string | null; // associated album ID
  album_title?: string | null;
  licenses: number;      // amount of licenses
  stream_price: number;  // $ per minute
  license_price: number; // $ per license
  url: string;
  metadata_cid?: string; // Pinata IPFS CID for song metadata
  chain_song_id?: string;
  network?: string;
  tx_hash?: string;
  tx_url?: string;
  plays?: number;
  likes?: number;
  comments_count?: number;
  last_played_at?: string | null;
  published_at?: string | null;
  created_at?: string;
}

export interface Comment {
  id: string;
  song_id: string;
  author: string;
  author_nickname?: string | null;
  author_avatar?: string | null;
  timestamp_sec: number;
  body: string;
  created_at: string;
}

export interface Social {
  creator: string;
  nickname?: string | null;
  avatar?: string | null;
  bio?: string | null;
  followers: number;
  following: number;
  isFollowed: boolean;
}

export interface Playlist {
  id: string;
  title: string;
  creator: string;
  description?: string | null;
  cover?: string | null;
  song_ids: string[];
  public: boolean;
  plays: number;
  created_at: string;
  updated_at: string;
  songs?: Song[];
}

export interface Fold {
  key: string;
  label: string;
  total: number;
  image?: string | null;
  imageStatus?: 'pending' | 'ready' | 'failed';
  songs: Song[];
}

export interface Folds {
  generatedAt: string;
  foldLimit: number;
  newReleases: {
    total: number;
    lastHourCount: number;
    songs: Song[];
  };
  popular: {
    total: number;
    songs: Song[];
  };
  genres: Fold[];
  creators: Fold[];
}

export interface Page {
  items: Song[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface AlbumReleaseConfig {
  targetNetwork?: string | null;
  bundlePrice?: number;
  bundle_price?: number;
  editionSize?: number;
  edition_size?: number;
  ready?: boolean;
  releaseNotes?: string | null;
  licenses?: number;
  license_price?: number;
  stream_price?: number;
  network?: string | null;
  remixable?: boolean;
  status?: 'draft' | 'ready' | 'released';
  release_date?: string | null;
}

export interface Album {
  id: string;
  title: string;
  creator: string;
  description?: string | null;
  concept?: string | null;
  genre?: string | null;
  cover?: string | null;
  gallery?: string[];
  release_config?: AlbumReleaseConfig | null;
  public: boolean;
  created_at: string;
  songs?: Song[];
}

export interface SongEarningsItem {
  songId: string;
  title: string;
  image: string | null;
  genres: string[];
  primaryGenre: string;
  durationSec: number;
  durationMs: number;
  chainSongId: string | null;
  network: string | null;
  networkFamily: 'base' | 'tempo' | 'solana' | 'other';
  networkLabel: string;
  explorerUrl: string | null;
  txHash: string | null;
  licensesMinted: number;
  licensesRemaining: number;
  licensesSold: number;
  licensePriceUsd: number;
  streamPriceUsd: number;
  licenseProfitUsd: number;
  streamProfitUsd: number;
  totalProfitUsd: number;
  platformFeeUsd: number;
  grossUsd: number;
  plays: number;
  streamSettlements: number;
  streamedMs: number;
  avgStreamedMs: number;
  ratioPct: number;
  lastPlayedAt: number;
}

export interface EarningEventItem {
  id: string;
  songId: string;
  songTitle: string;
  genre: string;
  network: string;
  networkFamily: 'base' | 'tempo' | 'solana' | 'other';
  networkLabel: string;
  kind: 'stream' | 'license';
  royaltiesUsd: number;
  platformFeeUsd: number;
  totalUsd: number;
  streamedMs: number;
  durationMs: number;
  ratioPct: number;
  txHash: string | null;
  explorerUrl: string | null;
  payer: string | null;
  timestamp: number;
}

export interface NetworkEarningsBreakdown {
  network: string;
  family: 'base' | 'tempo' | 'solana' | 'other';
  label: string;
  songCount: number;
  licensesSold: number;
  licensesRemaining: number;
  plays: number;
  streamedMs: number;
  licenseProfitUsd: number;
  streamProfitUsd: number;
  totalProfitUsd: number;
  platformFeeUsd: number;
  grossUsd: number;
}

export interface CreatorEarningsSummary {
  totalProfitUsd: number;
  licenseProfitUsd: number;
  streamProfitUsd: number;
  platformFeeUsd: number;
  grossUsd: number;
  licensesSold: number;
  licensesRemaining: number;
  licensesMinted: number;
  totalPlays: number;
  totalStreamedMs: number;
  avgStreamedMs: number;
  avgRatioPct: number;
  peakRatioPct: number;
  publishedCount: number;
  activeNetworkFilter: string;
}

export interface CreatorEarningsResponse {
  creator: string;
  updatedAt: number;
  summary: CreatorEarningsSummary;
  networks: NetworkEarningsBreakdown[];
  songs: Record<string, SongEarningsItem>;
  events: EarningEventItem[];
}

export interface Voice {
  id: string;
  name: string;
  creator: string;
  sample_url?: string | null;
  status: 'saved' | 'extracting' | 'queued' | 'training' | 'ready' | 'error';
  created_at: string;
  metadata?: Record<string, unknown> | null;
  error?: string | null;
  availability: Record<'turbo' | 'sft', {
    model: 'acestep-v15-xl-turbo' | 'acestep-v15-xl-sft';
    status: 'unavailable' | 'queued' | 'training' | 'ready' | 'error';
    stage?: string;
    step?: number;
    total_steps?: number;
    error?: string | null;
    adapter?: {
      id: string;
      model: 'acestep-v15-xl-turbo' | 'acestep-v15-xl-sft';
      status: 'queued' | 'training' | 'ready' | 'error';
      task_id?: string | null;
      artifact_url?: string | null;
      artifact_digest?: string | null;
      checkpoint_fingerprint?: string | null;
      metrics?: Record<string, unknown> | null;
      error?: string | null;
    };
  }>;
}

export interface Track {
  id: string;
  song: Song;
  variation: 1 | 2;
  status: 'queued' | 'generating' | 'ready' | 'error';
  progress: number;
}

export interface Response {
  id: string;
  status: 'pending' | 'processing' | 'ready' | 'error';
  progress: number;
  url?: string;
}

export interface Database {
  songs: Map<string, Song>;
  tracks: Map<string, Track>;
}

export interface Stem {
  id: string;
  song_id: string;
  name: string;
  type: 'vocal' | 'drums' | 'bass' | 'synth' | 'fx' | 'other';
  url: string;
  volume: number;
  pan: number;
  is_muted: boolean;
  is_solo: boolean;
}

export interface Take {
  id: string;
  song_id: string;
  stem_id?: string | null;
  take_number: number;
  task: Task;
  repainting_start?: number | null;
  repainting_end?: number | null;
  url: string;
  is_active: boolean;
}

export interface Commit {
  id: string;
  song_id: string;
  message: string;
  take_id?: string | null;
  created_at: string;
}
