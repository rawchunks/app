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
  prompt: string;
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
  title: string;
  duration?: number;
  tags: string[];
  creator: string;       // useraddress
  public: boolean;       // isPublic
  image?: string;        // optional URL
  album_id?: string | null; // associated album ID
  licenses: number;      // amount of licenses
  stream_price: number;  // $ per minute
  license_price: number; // $ per license
  url: string;
  metadata_cid?: string; // Pinata IPFS CID for song metadata
  chain_song_id?: string;
  network?: string;
  tx_hash?: string;
  tx_url?: string;
}

export interface Album {
  id: string;
  title: string;
  creator: string;
  description?: string | null;
  cover?: string | null;
  public: boolean;
  created_at: string;
  songs?: Song[];
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
