import { Song, Track } from './schema';
import { audio } from './audio';
import { bus } from './bus';
import { api, hasStreamBudget, hasPromoCreditsOnly, captureStreamBilling, streamOptions, type StreamBilling } from './api';
import { compose } from './compose';
import { readSongs } from './cache';
import { clearPrefetchCache, prefetchSongAssets } from './prefetch';
import { toast } from 'sonner';
import { openGate, type GateOptions } from './gate';

export type RepeatMode = 'off' | 'all' | 'one';
export type SleepTimerMode = '5' | '15' | '30' | 'track' | 'queue';
export type ContextDomain = 'market' | 'playlist' | 'album' | 'creator' | 'workspace' | 'studio' | 'song';
export type TransitionDirection = 'next' | 'prev' | 'direct';

export interface PlaybackContext {
  domain: ContextDomain;
  id: string;
  label: string;
  isPrivate: boolean;
}

export interface SleepTimerState {
  mode: SleepTimerMode;
  endsAtMs: number | null;
  label: string;
}

export interface SleepTimerPrompt {
  mode: SleepTimerMode;
  label: string;
  expiredAt: number;
}

export interface State {
  songs: Song[];
  tracks: Track[];
  activeSong: Song | null;
  editingSong: Song | null;
  isPlaying: boolean;
  playhead: number;
  duration: number;
  selection: { start: number; end: number } | null;
  isGenerating: boolean;
  userAddress: string;
  evmAddress?: string | null;
  svmAddress?: string | null;
  queue: Song[];
  userQueue: Song[];
  contextQueue: Song[];
  queueIndex: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  autoplay: boolean;
  activePlaylistId: string | null;
  activeContextId: string | null;
  playbackContext: PlaybackContext | null;
  transitionDirection: TransitionDirection;
  transitionSeq: number;
  sleepTimer: SleepTimerState | null;
  sleepTimerPrompt: SleepTimerPrompt | null;
}

type Listener = (state: State) => void;

const STORAGE_KEYS = {
  playback: 'playback',
  repeat: 'repeatMode',
  shuffle: 'shuffle',
  autoplay: 'autoplay',
  queue: 'queue',
  sleepTimerExpired: 'sleep-timer-expired',
};

interface StoredQueuePayload {
  userQueue?: Song[];
  contextQueue?: Song[];
  queue?: Song[];
  activePlaylistId?: string | null;
  activeContextId?: string | null;
  playbackContext?: PlaybackContext | null;
}

interface Playback {
  id: string;
  songId: string;
  billing: StreamBilling;
  alternatives: StreamBilling[];
  intent: string | null;
  observedMs: number;
  durationMs: number;
  acceptedMs: number;
  terminal: boolean;
  exempt: boolean;
  flush: boolean;
  pending?: { paymentIntentId: string; listenedSeconds: number; terminal: boolean };
  running?: Promise<void>;
  admitting?: Promise<any>;
  retry?: ReturnType<typeof setTimeout>;
  failures?: number;
  rejected?: boolean;
}
const STREAM_STORAGE = 'stream:';

class Store {
  private state: State;
  private listeners: Set<Listener> = new Set();
  private authorizedSongId: string | null = null;
  private playRequestId: number = 0;
  private streamResumeArmed = false;
  private playback: Playback | null = null;
  private playbacks = new Map<string, Playback>();
  private lastPlayhead: number = 0;
  private lastBroadcastAt: number = 0;
  private pendingAutoAdvanceOverlap: boolean = false;
  private userSeekedWhilePaused: boolean = false;
  private autoCrossfadedSongId: string | null = null;
  private preloadedNextSongId: string | null = null;
  private playCountedSongId: string | null = null;
  private playedHistory: Song[] = [];
  private contextOriginSongs: Song[] = [];
  private loadedAccountKey: string = 'guest';
  private sleepTimerTimeout: ReturnType<typeof setTimeout> | null = null;

  private pushPlayedHistory(song: Song | null | undefined) {
    if (!song || !song.id) return;
    this.playedHistory = [
      song,
      ...this.playedHistory.filter((s) => s.id !== song.id),
    ].slice(0, 50);
  }

  constructor() {
    let initialSong: Song | null = null;
    let initialDuration = 0;
    let initialRepeat: RepeatMode = 'off';
    let initialShuffle = false;
    let initialAutoplay = false;
    let initialUserQueue: Song[] = [];
    let initialContextQueue: Song[] = [];
    let initialQueue: Song[] = [];
    let initialQueueIndex = -1;
    let initialActivePlaylistId: string | null = null;
    let initialActiveContextId: string | null = null;
    let initialPlaybackContext: PlaybackContext | null = null;
    let initialSleepTimerPrompt: SleepTimerPrompt | null = null;
    let initialAccountKey = 'guest';

    if (typeof window !== 'undefined') {
      try {
        // Purge legacy unscoped queue/playback keys so cross-account tracks never leak
        localStorage.removeItem(STORAGE_KEYS.queue);
        localStorage.removeItem(STORAGE_KEYS.playback);

        const rawAccount = localStorage.getItem('last_account');
        const bootAddresses = new Set<string>();
        if (rawAccount) {
          const parsedAccount = JSON.parse(rawAccount) as { address?: string; evmAddress?: string; svmAddress?: string };
          for (const raw of [parsedAccount?.address, parsedAccount?.evmAddress, parsedAccount?.svmAddress]) {
            const clean = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
            if (clean) bootAddresses.add(clean);
          }
          const addr = (parsedAccount?.address || parsedAccount?.evmAddress || parsedAccount?.svmAddress || '').trim().toLowerCase();
          if (addr) initialAccountKey = addr;
        }

        const isAllowedForBoot = (item: any): item is Song => {
          if (!item || typeof item.id !== 'string') return false;
          if (item.public === true) return true;
          if (initialAccountKey === 'guest') return false;
          const creator = typeof item.creator === 'string' ? item.creator.trim().toLowerCase() : '';
          return Boolean(creator && bootAddresses.has(creator));
        };

        const rawPlayback = localStorage.getItem(`${STORAGE_KEYS.playback}:${initialAccountKey}`);
        if (rawPlayback) {
          const parsed = JSON.parse(rawPlayback);
          if (isAllowedForBoot(parsed?.song)) {
            const bootSong: Song = parsed.song;
            initialSong = bootSong;
            initialDuration = typeof parsed.duration === 'number' && parsed.duration > 0 ? parsed.duration : (bootSong.duration || 0);
          }
        }
        const savedRepeat = localStorage.getItem(STORAGE_KEYS.repeat);
        if (savedRepeat === 'off' || savedRepeat === 'all' || savedRepeat === 'one') {
          initialRepeat = savedRepeat;
        }
        const savedShuffle = localStorage.getItem(STORAGE_KEYS.shuffle);
        if (savedShuffle !== null) {
          initialShuffle = savedShuffle === 'true';
        }
        const savedAutoplay = localStorage.getItem(STORAGE_KEYS.autoplay);
        if (savedAutoplay !== null) {
          initialAutoplay = savedAutoplay === 'true';
        }
        const savedQueue = localStorage.getItem(`${STORAGE_KEYS.queue}:${initialAccountKey}`);
        if (savedQueue) {
          const parsedQueue = JSON.parse(savedQueue) as StoredQueuePayload | Song[];
          if (Array.isArray(parsedQueue)) {
            initialContextQueue = parsedQueue.filter(isAllowedForBoot);
          } else if (parsedQueue && typeof parsedQueue === 'object') {
            if (Array.isArray(parsedQueue.userQueue)) {
              initialUserQueue = parsedQueue.userQueue.filter(isAllowedForBoot);
            }
            if (Array.isArray(parsedQueue.contextQueue)) {
              initialContextQueue = parsedQueue.contextQueue.filter(isAllowedForBoot);
            } else if (Array.isArray(parsedQueue.queue)) {
              initialContextQueue = parsedQueue.queue.filter(isAllowedForBoot);
            }
            if (typeof parsedQueue.activePlaylistId === 'string') {
              initialActivePlaylistId = parsedQueue.activePlaylistId;
            }
            if (typeof parsedQueue.activeContextId === 'string') {
              initialActiveContextId = parsedQueue.activeContextId;
            }
            if (parsedQueue.playbackContext && typeof parsedQueue.playbackContext.id === 'string') {
              initialPlaybackContext = parsedQueue.playbackContext;
            }
          }
        }
        const rawSleepExpired = localStorage.getItem(STORAGE_KEYS.sleepTimerExpired);
        if (rawSleepExpired) {
          const parsedExpired = JSON.parse(rawSleepExpired) as SleepTimerPrompt;
          const validModes: SleepTimerMode[] = ['5', '15', '30', 'track', 'queue'];
          if (
            parsedExpired &&
            validModes.includes(parsedExpired.mode) &&
            typeof parsedExpired.label === 'string' &&
            typeof parsedExpired.expiredAt === 'number' &&
            Date.now() - parsedExpired.expiredAt < 24 * 60 * 60 * 1000
          ) {
            initialSleepTimerPrompt = parsedExpired;
          } else {
            localStorage.removeItem(STORAGE_KEYS.sleepTimerExpired);
          }
        }
      } catch { }
    }

    this.loadedAccountKey = initialAccountKey;

    if (initialSong) {
      initialUserQueue = initialUserQueue.filter((s) => s.id !== initialSong!.id);
      const userIds = new Set(initialUserQueue.map((s) => s.id));
      initialContextQueue = initialContextQueue.filter((s) => s.id !== initialSong!.id && !userIds.has(s.id));
      initialQueue = [initialSong, ...initialUserQueue, ...initialContextQueue];
      initialQueueIndex = 0;
      this.contextOriginSongs = [initialSong, ...initialContextQueue];
    } else {
      const userIds = new Set(initialUserQueue.map((s) => s.id));
      initialContextQueue = initialContextQueue.filter((s) => !userIds.has(s.id));
      initialQueue = [...initialUserQueue, ...initialContextQueue];
      initialQueueIndex = initialQueue.length > 0 ? 0 : -1;
      if (initialQueue.length > 0) {
        initialSong = initialQueue[0];
        initialDuration = initialSong.duration || 0;
        initialUserQueue = initialUserQueue.filter((s) => s.id !== initialSong!.id);
        initialContextQueue = initialContextQueue.filter((s) => s.id !== initialSong!.id);
        this.contextOriginSongs = [initialSong, ...initialContextQueue];
      }
    }

    if (initialSong && !initialPlaybackContext) {
      initialPlaybackContext = this.derivePlaybackContext(
        initialActiveContextId,
        initialActivePlaylistId,
        this.contextOriginSongs,
      );
    }

    this.state = {
      songs: [],
      tracks: [],
      activeSong: initialSong,
      editingSong: null,
      isPlaying: false,
      playhead: 0,
      duration: initialDuration,
      selection: null,
      isGenerating: false,
      userAddress: '',
      evmAddress: null,
      svmAddress: null,
      queue: initialQueue,
      userQueue: initialUserQueue,
      contextQueue: initialContextQueue,
      queueIndex: initialQueueIndex,
      repeatMode: initialRepeat,
      shuffle: initialShuffle,
      autoplay: initialAutoplay,
      activePlaylistId: initialActivePlaylistId,
      activeContextId: initialActiveContextId,
      playbackContext: initialPlaybackContext,
      transitionDirection: 'direct',
      transitionSeq: 0,
      sleepTimer: null,
      sleepTimerPrompt: initialSleepTimerPrompt,
    };

    bus.registerPlayer(() => {
      if (this.state.isPlaying) {
        this.samplePlayback();
        this.playRequestId++;
        this.state = { ...this.state, isPlaying: false };
        audio.pause();
        this.notify();
        void this.reportStreamCheckpoint(false);
      }
    });

    bus.registerPlaybackSync(({ accountId, song, playhead, duration }) => {
      const currentAccount = this.getAccountStorageSuffix();
      if ((accountId || 'guest') !== currentAccount) return;
      if (song && !this.isSongAllowedForAccount(song)) return;
      this.finishPlayback();
      if (this.state.isPlaying) {
        this.playRequestId++;
        audio.pause();
      }
      const songChanged = this.state.activeSong?.id !== song?.id;
      if (songChanged) {
        this.authorizedSongId = null;
        this.userSeekedWhilePaused = false;
        audio.reset();
      }
      const combined = this.buildCombinedQueue(song, this.state.userQueue, this.state.contextQueue);
      this.state = {
        ...this.state,
        activeSong: song,
        playhead: typeof playhead === 'number' ? playhead : 0,
        duration: typeof duration === 'number' && duration > 0 ? duration : (song?.duration || 0),
        isPlaying: false,
        queue: combined.queue,
        userQueue: combined.userQueue,
        contextQueue: combined.contextQueue,
        queueIndex: combined.queueIndex,
      };
      this.notify();
    });

    bus.onRemoteLogout(() => {
      this.clearUserWorkspace(false);
    });

    bus.onRemoteAccountSwitch(() => {
      this.clearUserWorkspace(false);
    });

    audio.setOnTimeUpdate((time) => {
      if (!this.state.isPlaying) return;
      this.observePlayback(time);
      this.state = { ...this.state, playhead: time };
      this.notify();
      const now = Date.now();
      if (this.state.activeSong && now - this.lastBroadcastAt >= 1000) {
        this.lastBroadcastAt = now;
        bus.broadcastPlayback(this.getAccountStorageSuffix(), this.state.activeSong, time, this.state.duration, true);
      }

      if (this.state.activeSong) {
        if (time >= 10 && this.playCountedSongId !== this.state.activeSong.id) {
          this.playCountedSongId = this.state.activeSong.id;
          void this.recordSongPlay(this.state.activeSong.id);
        }

        const dur = this.state.duration || this.state.activeSong.duration || 0;
        if (dur >= 4 && time > 0) {
          const remaining = dur - time;
          const sleepMode = this.state.sleepTimer?.mode;
          const isStoppingAtTrackEnd =
            sleepMode === 'track' ||
            (sleepMode === 'queue' && (this.state.queueIndex >= 0 ? this.state.queueIndex : 0) + 1 >= this.state.queue.length);
          if (!isStoppingAtTrackEnd) {
            if (remaining <= 4.5 && remaining > 0.2) {
              this.preloadUpcomingTrack();
            }
            if (
              remaining <= 0.38 &&
              remaining > 0.02 &&
              this.autoCrossfadedSongId !== this.state.activeSong.id
            ) {
              const nextCandidate = this.peekNextSong();
              if (nextCandidate) {
                this.autoCrossfadedSongId = this.state.activeSong.id;
                this.pendingAutoAdvanceOverlap = true;
                void this.playNextTrack(true);
              }
            }
          }
        }
      }


    });

    audio.setOnDuration((duration) => {
      if (duration > 0 && isFinite(duration)) {
        const dur = Math.round(duration);
        let updatedTracks = this.state.tracks;
        let updatedActive = this.state.activeSong;
        if (updatedActive && updatedActive.duration !== dur) {
          updatedActive = { ...updatedActive, duration: dur };
          updatedTracks = updatedTracks.map((t) =>
            t.song.id === updatedActive!.id ? { ...t, song: updatedActive! } : t
          );
        }
        this.state = {
          ...this.state,
          duration: dur,
          activeSong: updatedActive,
          tracks: updatedTracks,
        };
        this.notify();
      }
    });

    audio.setOnEnd(() => {
      this.finishPlayback();
      this.authorizedSongId = null;
      this.lastPlayhead = 0;

      if (this.state.sleepTimer?.mode === 'track') {
        this.expireSleepTimer(false);
        this.state = { ...this.state, isPlaying: false, playhead: 0 };
        this.notify();
        return;
      }

      if (this.state.sleepTimer?.mode === 'queue') {
        const currentIdx = this.state.queueIndex >= 0 ? this.state.queueIndex : 0;
        if (currentIdx + 1 >= this.state.queue.length) {
          this.expireSleepTimer(false);
          this.state = { ...this.state, isPlaying: false, playhead: 0 };
          this.notify();
          return;
        }
      }

      // Advance continuously through the queue
      void this.playNextTrack(true).then((advanced) => {
        if (!advanced) {
          this.state = { ...this.state, isPlaying: false, playhead: 0 };
          this.notify();
        }
      });
    });
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', () => {
        this.samplePlayback();
        audio.pause();
        this.playback = null;
        this.authorizedSongId = null;
        this.state = { ...this.state, isPlaying: false };
        this.playRequestId++;
        for (const lane of this.playbacks.values()) {
          lane.terminal = true;
          this.persistPlayback(lane);
          if (lane.intent) {
            const options = streamOptions(lane.billing)!;
            void api.fetch(`/api/songs/${lane.songId}/stream/checkpoint`, {
              ...options, method: 'POST', keepalive: true,
              headers: { ...options.headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ paymentIntentId: lane.intent, listenedSeconds: Math.round(lane.observedMs) / 1000, terminal: true }),
            }).catch(() => { });
          }
        }
      });
      window.addEventListener('online', () => { for (const lane of this.playbacks.values()) void this.drainPlayback(lane); });
      queueMicrotask(() => this.restorePlaybacks());
    }
  }

  private getAccountStorageSuffix(overrideAddress?: string | null): string {
    const addr = (
      overrideAddress !== undefined
        ? overrideAddress
        : this.state?.userAddress || this.state?.evmAddress || this.state?.svmAddress || (this.loadedAccountKey !== 'guest' ? this.loadedAccountKey : '')
    )
      ?.trim()
      .toLowerCase();
    return addr || 'guest';
  }

  private derivePlaybackContext(
    contextId?: string | null,
    playlistId?: string | null,
    songs?: Song[],
    override?: Partial<PlaybackContext>,
  ): PlaybackContext {
    const rawId = (override?.id ?? contextId ?? (playlistId ? `playlist:${playlistId}` : 'market:feed')) || 'market:feed';
    const lower = rawId.toLowerCase();

    let domain: ContextDomain = override?.domain ?? 'market';
    let label = override?.label ?? '';
    let isPrivate = override?.isPrivate ?? false;

    if (!override?.domain) {
      if (lower.startsWith('studio')) domain = 'studio';
      else if (lower.startsWith('workspace') || lower.startsWith('profile') || lower.startsWith('voice:')) domain = 'workspace';
      else if (lower.startsWith('playlist:') || playlistId) domain = 'playlist';
      else if (lower.startsWith('album:')) domain = 'album';
      else if (lower.startsWith('creator:')) domain = 'creator';
      else if (lower.startsWith('song:')) domain = 'song';
      else domain = 'market';
    }

    if (override?.isPrivate === undefined) {
      const allNonPublic = Boolean(songs && songs.length > 0 && songs.every((s) => !s.public));
      isPrivate =
        domain === 'studio' ||
        lower.startsWith('workspace:draft') ||
        lower.startsWith('voice:') ||
        allNonPublic;
    }

    if (!label) {
      if (lower === 'studio:feed') label = 'Studio · Variations';
      else if (lower === 'workspace:drafts') label = 'Workspace · Drafts';
      else if (lower === 'workspace:published') label = 'Workspace · Published';
      else if (lower === 'workspace:licenses') label = 'Workspace · Licenses';
      else if (lower.startsWith('voice:')) label = 'Workspace · Voice';
      else if (lower === 'liked-crate' || lower === 'market:liked') label = 'Liked Tracks';
      else if (lower === 'market:new' || lower === 'pulse-new' || lower === 'latest') label = 'Market · New';
      else if (lower === 'market:popular' || lower === 'pulse-popular' || lower === 'popular') label = 'Market · Popular';
      else if (lower === 'market:radio') label = 'Market · Radio';
      else if (lower.startsWith('playlist:')) label = 'Playlist';
      else if (lower.startsWith('album:')) label = 'Album';
      else if (lower.startsWith('creator:')) label = 'Creator Releases';
      else if (lower.startsWith('song:')) label = 'Track';
      else label = 'Market';
    }

    return { domain, id: rawId, label, isPrivate };
  }

  private isSongAllowedForAccount(
    song: Song | null | undefined,
    additionalAddresses?: (string | null | undefined)[],
    strictExplicit = false,
  ): boolean {
    if (!song || typeof song.id !== 'string') return false;
    if (song.public === true) return true;

    if (strictExplicit) {
      const allowed = new Set(
        (additionalAddresses ?? [])
          .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
          .map((a) => a.trim().toLowerCase()),
      );
      if (allowed.size === 0) return false;
      const creator = typeof song.creator === 'string' ? song.creator.trim().toLowerCase() : '';
      return Boolean(creator && allowed.has(creator));
    }

    const suffix = this.getAccountStorageSuffix(additionalAddresses?.[0]);
    if (suffix === 'guest' && (!additionalAddresses || additionalAddresses.every((a) => !a))) {
      return false;
    }
    return this.isCreatorOfSong(song, additionalAddresses);
  }

  private buildCombinedQueue(
    activeSong: Song | null,
    userQueue: Song[],
    contextQueue: Song[],
    additionalAddresses?: (string | null | undefined)[],
    strictExplicit = false,
  ): { queue: Song[]; userQueue: Song[]; contextQueue: Song[]; queueIndex: number } {
    const allowedActive = activeSong && this.isSongAllowedForAccount(activeSong, additionalAddresses, strictExplicit) ? activeSong : null;
    const seenUser = new Set<string>();
    const cleanUser: Song[] = [];
    for (const s of userQueue) {
      if (!s || !this.isSongAllowedForAccount(s, additionalAddresses, strictExplicit)) continue;
      if (allowedActive && s.id === allowedActive.id) continue;
      if (!seenUser.has(s.id)) {
        seenUser.add(s.id);
        cleanUser.push(s);
      }
    }
    const seenContext = new Set<string>();
    const cleanContext: Song[] = [];
    for (const s of contextQueue) {
      if (!s || !this.isSongAllowedForAccount(s, additionalAddresses, strictExplicit)) continue;
      if (allowedActive && s.id === allowedActive.id) continue;
      if (seenUser.has(s.id) || seenContext.has(s.id)) continue;
      seenContext.add(s.id);
      cleanContext.push(s);
    }
    const queue = allowedActive ? [allowedActive, ...cleanUser, ...cleanContext] : [...cleanUser, ...cleanContext];
    const queueIndex = queue.length > 0 ? 0 : -1;
    return { queue, userQueue: cleanUser, contextQueue: cleanContext, queueIndex };
  }

  private persistQueue(
    queue?: Song[],
    userQueue: Song[] = this.state?.userQueue ?? [],
    contextQueue: Song[] = this.state?.contextQueue ?? [],
    activeSong: Song | null = this.state?.activeSong ?? null,
    playbackContext: PlaybackContext | null = this.state?.playbackContext ?? null,
  ) {
    if (typeof window === 'undefined') return;
    try {
      const suffix = this.getAccountStorageSuffix();
      const allowedUser = userQueue.filter((s) => this.isSongAllowedForAccount(s)).slice(0, 50);
      const allowedContext = contextQueue.filter((s) => this.isSongAllowedForAccount(s)).slice(0, 100);
      const allowedQueue = (queue ?? this.state?.queue ?? []).filter((s) => this.isSongAllowedForAccount(s)).slice(0, 100);
      const payload: StoredQueuePayload = {
        userQueue: allowedUser,
        contextQueue: allowedContext,
        queue: allowedQueue,
        activePlaylistId: this.state?.activePlaylistId ?? null,
        activeContextId: this.state?.activeContextId ?? null,
        playbackContext,
      };
      localStorage.setItem(`${STORAGE_KEYS.queue}:${suffix}`, JSON.stringify(payload));
      if (activeSong && this.isSongAllowedForAccount(activeSong)) {
        localStorage.setItem(
          `${STORAGE_KEYS.playback}:${suffix}`,
          JSON.stringify({
            song: activeSong,
            playhead: this.state?.playhead ?? 0,
            duration: this.state?.duration || activeSong.duration || 0,
          })
        );
      } else {
        localStorage.removeItem(`${STORAGE_KEYS.playback}:${suffix}`);
      }
    } catch { }
  }

  private getViewerAddresses(): string[] {
    const candidates = new Set<string>();
    if (this.state.userAddress) candidates.add(this.state.userAddress.trim());
    if (this.state.evmAddress) candidates.add(this.state.evmAddress.trim());
    if (this.state.svmAddress) candidates.add(this.state.svmAddress.trim());
    if (candidates.size === 0 && this.loadedAccountKey !== 'guest') {
      const currentWallet = compose.wallets.current() as { address?: string; svmAddress?: string } | null;
      if (currentWallet?.address) candidates.add(currentWallet.address.trim());
      if (currentWallet?.svmAddress) candidates.add(currentWallet.svmAddress.trim());
    }
    return Array.from(candidates).filter(Boolean);
  }

  private async recordSongPlay(songId: string) {
    const activeContext = (this.state.activeContextId || '').toLowerCase();
    const isProfileRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/profile');
    if (activeContext.startsWith('profile') || isProfileRoute) return;

    const song = this.state.activeSong?.id === songId ? this.state.activeSong : this.state.songs.find((s) => s.id === songId);
    if (!songId || !song?.public || this.isCreatorOfSong(song)) return;
    try {
      const viewerAddresses = this.getViewerAddresses();
      const effectiveUserAddress =
        this.state.userAddress || this.state.evmAddress || this.state.svmAddress || viewerAddresses[0] || '';
      const pairedSvm = this.state.svmAddress || viewerAddresses.find((a) => !a.startsWith('0x')) || '';
      const res = await api.fetch(`/api/songs/${songId}/play`, {
        method: 'POST',
        headers: {
          ...(effectiveUserAddress ? { 'x-user-address': effectiveUserAddress } : {}),
          ...(pairedSvm ? { 'x-paired-svm-address': pairedSvm } : {}),
          ...(activeContext ? { 'x-playback-context': activeContext } : {}),
        },
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && typeof data.plays === 'number' && !data.skipped) {
          this.updateSong(songId, { plays: data.plays, last_played_at: data.last_played_at });
        }
      }
    } catch { }
  }

  private persistPlayback(lane: Playback) {
    if (lane.exempt || lane.rejected || !lane.intent) {
      try { localStorage.removeItem(`${STREAM_STORAGE}${lane.id}`); } catch { }
      return;
    }
    const { running, admitting, retry, ...stored } = lane;
    try { localStorage.setItem(`${STREAM_STORAGE}${lane.id}`, JSON.stringify({ ...stored, observedMs: Math.round(lane.observedMs) })); }
    catch { /* Keep the in-memory obligation and attempt page-exit delivery. */ }
  }

  private restorePlaybacks() {
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(STREAM_STORAGE)) keys.push(key);
      }
      const restored: Playback[] = [];
      for (const key of keys) {
        let lane: any = null;
        try { lane = JSON.parse(localStorage.getItem(key)!); } catch { }
        if (!lane?.id || !lane.songId || !lane.billing || !lane.intent || lane.exempt || lane.rejected || !Number.isFinite(lane.observedMs) || !Number.isFinite(lane.acceptedMs)) {
          try { localStorage.removeItem(key); } catch { }
          continue;
        }
        if (this.playbacks.has(lane.id)) continue;
        lane.terminal = true;
        lane.rejected = false;
        this.playbacks.set(lane.id, lane);
        restored.push(lane);
      }
      for (const lane of restored) void this.drainPlayback(lane);
    } catch { }
  }

  private observePlayback(time: number) {
    const lane = this.playback;
    if (lane && !lane.exempt && this.state.isPlaying) {
      // HTMLAudioElement.currentTime advances with media playback, not loading or buffering time.
      lane.observedMs = Math.min(lane.durationMs, lane.observedMs + Math.max(0, time - this.lastPlayhead) * 1000);
      this.persistPlayback(lane);
      if (Math.round(lane.observedMs) - lane.acceptedMs >= 20000) void this.drainPlayback(lane);
    }
    this.lastPlayhead = time;
  }

  private samplePlayback() {
    const position = audio.position();
    if (this.state.isPlaying && position !== null) this.observePlayback(position);
  }

  private finishPlayback() {
    this.samplePlayback();
    const lane = this.playback;
    if (lane) {
      lane.terminal = true;
      this.persistPlayback(lane);
      void this.drainPlayback(lane);
    }
    this.playback = null;
  }

  private reportStreamCheckpoint(terminal = false) {
    const lane = this.playback;
    if (!lane) return Promise.resolve();
    lane.terminal ||= terminal;
    lane.flush = true;
    this.persistPlayback(lane);
    return this.drainPlayback(lane);
  }

  private failPlayback(lane: Playback, error: any) {
    lane.failures = (lane.failures || 0) + 1;
    const status = error?.status;
    if (status >= 400 && status < 500 && status !== 429) {
      lane.rejected = true;
      if (this.playback === lane) {
        this.samplePlayback();
        this.playback = null;
        if (this.authorizedSongId === lane.songId) this.authorizedSongId = null;
        audio.pause();
        this.state = { ...this.state, isPlaying: false };
        this.notify();
        if (status === 402) this.resumeAfterGate({ steps: ['funding'], reason: 'Session budget exhausted', force: true });
        else toast.error(error.message || 'Playback payment rejected');
      }
      this.removePlayback(lane);
      return;
    } else if (!lane.intent && lane.terminal) {
      this.removePlayback(lane);
      return;
    } else if (!lane.retry) {
      lane.retry = setTimeout(() => { lane.retry = undefined; void this.drainPlayback(lane); }, Math.min(30000, 1000 * 2 ** Math.min(lane.failures - 1, 5)));
    }
    this.persistPlayback(lane);
  }

  private admitPlayback(lane: Playback): Promise<any> {
    if (lane.admitting) return lane.admitting;
    lane.admitting = (async () => {
      for (; ;) {
        const options = streamOptions(lane.billing)!;
        const response = await api.fetch(`/api/songs/${lane.songId}/stream`, {
          ...options, headers: { ...options.headers, Accept: 'application/json', 'x-idempotency-key': lane.id },
        });
        const data = await response.json().catch(() => null);
        if ((response.status === 402 || response.status === 401) && lane.alternatives.length) {
          this.playbacks.delete(lane.id);
          lane.billing = lane.alternatives.shift()!;
          lane.id = crypto.randomUUID();
          if (!lane.exempt) this.playbacks.set(lane.id, lane);
          this.persistPlayback(lane);
          continue;
        }
        if (!response.ok) throw Object.assign(new Error(data?.error || 'Stream authorization failed'), { status: response.status });
        if (!data || (!data.isCreator && (typeof data.paymentIntentId !== 'string' || !data.paymentIntentId))) throw new Error('Missing playback admission');
        lane.exempt = Boolean(data.isCreator);
        lane.intent = data.paymentIntentId || null;
        if (Number.isFinite(data.duration) && data.duration > 0) {
          lane.durationMs = Math.ceil(data.duration * 1000);
          lane.observedMs = Math.min(lane.durationMs, lane.observedMs);
        }
        this.persistPlayback(lane);
        return data;
      }
    })().finally(() => { lane.admitting = undefined; });
    return lane.admitting;
  }

  private drainPlayback(lane: Playback): Promise<void> {
    if (lane.running) return lane.running;
    if (lane.rejected || lane.exempt || (!lane.intent && lane.terminal && !lane.admitting)) {
      this.removePlayback(lane);
      return Promise.resolve();
    }
    if (!lane.pending && lane.intent && !lane.exempt && (lane.terminal || lane.flush || Math.round(lane.observedMs) - lane.acceptedMs >= 20000)) {
      lane.pending = { paymentIntentId: lane.intent, listenedSeconds: Math.round(lane.observedMs) / 1000, terminal: lane.terminal };
      lane.flush = false;
      this.persistPlayback(lane);
    }
    lane.running = Promise.resolve().then(async () => {
      try {
        if (!lane.intent && !lane.exempt) await this.admitPlayback(lane);
        while (!lane.exempt && (lane.pending || lane.terminal || lane.flush || Math.round(lane.observedMs) - lane.acceptedMs >= 20000)) {
          if (!lane.pending) {
            lane.pending = { paymentIntentId: lane.intent!, listenedSeconds: Math.round(lane.observedMs) / 1000, terminal: lane.terminal };
            lane.flush = false;
            this.persistPlayback(lane);
          }
          const pending = lane.pending;
          const options = streamOptions(lane.billing)!;
          const activeContext = (this.state.activeContextId || '').toLowerCase();
          const isProfileRoute = typeof window !== 'undefined' && Boolean(window.location?.pathname?.startsWith('/profile'));
          const playbackContext = activeContext || (isProfileRoute ? 'profile' : '');
          const response = await api.fetch(`/api/songs/${lane.songId}/stream/checkpoint`, {
            ...options,
            method: 'POST',
            headers: {
              ...options.headers,
              'Content-Type': 'application/json',
              ...(this.state.svmAddress ? { 'x-paired-svm-address': this.state.svmAddress } : {}),
              ...(playbackContext ? { 'x-playback-context': playbackContext } : {}),
            },
            body: JSON.stringify(pending),
          });
          const data = await response.json().catch(() => null);
          const receipt = data?.result;
          if (!response.ok) throw Object.assign(new Error(data?.error || 'Playback payment rejected'), { status: response.status });
          if (data?.success !== true || !['confirmed', 'queued', 'submitted', 'credited', 'skipped'].includes(receipt?.status) || !Number.isFinite(receipt?.acceptedListenedSeconds) || receipt.acceptedListenedSeconds < pending.listenedSeconds || !/^\d+$/.test(receipt?.billedWei) || !/^\d+$/.test(receipt?.deltaWei)) throw new Error('Checkpoint was not accepted');
          lane.acceptedMs = Math.round(receipt.acceptedListenedSeconds * 1000);
          delete lane.pending;
          lane.failures = 0;
          this.persistPlayback(lane);
          if (pending.terminal) { this.removePlayback(lane); return; }
        }
        if (lane.exempt) this.removePlayback(lane);
      } catch (error) { this.failPlayback(lane, error); }
      finally { lane.running = undefined; }
    });
    return lane.running;
  }

  private removePlayback(lane: Playback) {
    this.playbacks.delete(lane.id);
    if (lane.retry) clearTimeout(lane.retry);
    try { localStorage.removeItem(`${STREAM_STORAGE}${lane.id}`); } catch { }
  }

  public async closeSessionPlayback(token: string | null): Promise<boolean> {
    if (!token) return true;
    const matches = (lane: Playback) => !lane.exempt && lane.billing.source === 'usdc' && lane.billing.token === token;
    if (this.playback && matches(this.playback)) {
      this.finishPlayback();
      this.playRequestId++;
      this.authorizedSongId = null;
      audio.pause();
      bus.release('player');
      this.state = { ...this.state, isPlaying: false };
      this.notify();
      bus.broadcastPlayback(this.getAccountStorageSuffix(), this.state.activeSong, this.state.playhead, this.state.duration, false);
    }
    const lanes = [...this.playbacks.values()].filter(matches);
    for (const lane of lanes) {
      lane.terminal = true;
      this.persistPlayback(lane);
    }
    await Promise.all(lanes.map(lane => this.drainPlayback(lane)));
    return lanes.every(lane => !this.playbacks.has(lane.id));
  }

  private resumeAfterGate(options: GateOptions): void {
    void openGate(options).then((ready) => {
      if (!ready || this.streamResumeArmed) return;
      this.streamResumeArmed = true;
      void this.setPlaying(true).finally(() => {
        this.streamResumeArmed = false;
      });
    });
  }

  public getState(): State {
    return this.state;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => l(this.state));
  }

  public setSongs(songs: Song[]) {
    const byId = new Map<string, Song>();
    for (const s of songs) {
      if (s && s.id) byId.set(s.id, s);
    }
    const refresh = (list: Song[]) => list.map((item) => (byId.has(item.id) ? { ...item, ...byId.get(item.id)! } : item));
    const nextActive =
      this.state.activeSong && byId.has(this.state.activeSong.id)
        ? { ...this.state.activeSong, ...byId.get(this.state.activeSong.id)! }
        : this.state.activeSong;

    this.state = {
      ...this.state,
      songs,
      activeSong: nextActive,
      queue: refresh(this.state.queue),
      userQueue: refresh(this.state.userQueue),
      contextQueue: refresh(this.state.contextQueue),
    };
    this.notify();
  }

  public addSong(song: Song) {
    if (!song || !song.id) return;
    this.state = {
      ...this.state,
      songs: [song, ...this.state.songs.filter((s) => s.id !== song.id)],
    };
    this.notify();
  }

  public updateSong(id: string, updates: Partial<Song>) {
    this.state = {
      ...this.state,
      songs: this.state.songs.map((s) => (s.id === id ? { ...s, ...updates } : s)),
      tracks: this.state.tracks.map((track) => (track.song.id === id ? { ...track, song: { ...track.song, ...updates } } : track)),
      queue: this.state.queue.map((s) => (s.id === id ? { ...s, ...updates } : s)),
      userQueue: this.state.userQueue.map((s) => (s.id === id ? { ...s, ...updates } : s)),
      contextQueue: this.state.contextQueue.map((s) => (s.id === id ? { ...s, ...updates } : s)),
      activeSong: this.state.activeSong?.id === id ? { ...this.state.activeSong, ...updates } : this.state.activeSong,
      editingSong: this.state.editingSong?.id === id ? { ...this.state.editingSong, ...updates } : this.state.editingSong,
    };
    this.notify();
  }

  public deleteSong(id: string) {
    const nextUserQueue = this.state.userQueue.filter((s) => s.id !== id);
    const nextContextQueue = this.state.contextQueue.filter((s) => s.id !== id);
    const activeRemoved = this.state.activeSong?.id === id;
    if (activeRemoved) { this.finishPlayback(); audio.stopImmediate(); this.authorizedSongId = null; }
    const nextActive = activeRemoved ? null : this.state.activeSong;
    const combined = this.buildCombinedQueue(nextActive, nextUserQueue, nextContextQueue);
    this.state = {
      ...this.state,
      songs: this.state.songs.filter((s) => s.id !== id),
      queue: combined.queue,
      userQueue: combined.userQueue,
      contextQueue: combined.contextQueue,
      queueIndex: combined.queueIndex,
      activeSong: nextActive,
      editingSong: this.state.editingSong?.id === id ? null : this.state.editingSong,
    };
    this.persistQueue(combined.queue, combined.userQueue, combined.contextQueue, nextActive);
    this.notify();
  }

  public togglePublic(id: string) {
    const song = this.state.songs.find((s) => s.id === id);
    if (!song) return;
    this.updateSong(id, { public: !song.public });
  }

  public setActiveSong(
    song: Song | null,
    contextSongs?: Song[],
    playlistId?: string | null,
    contextId?: string | null,
    forceRestart = false,
    contextMeta?: Partial<PlaybackContext>,
    direction: TransitionDirection = 'direct',
  ) {
    const isSameSong = Boolean(song && this.state.activeSong?.id === song.id);
    if (!isSameSong && this.state.activeSong) {
      this.pushPlayedHistory(this.state.activeSong);
    }
    if (!isSameSong || forceRestart) this.finishPlayback();

    this.playRequestId++;

    if (!song) {
      audio.reset();
    } else if (!isSameSong || forceRestart) {
      // Stop outgoing deck immediately on manual song switch so there is zero lingering fade or timeupdate bleed
      audio.stopImmediate();
    }

    if (!isSameSong || forceRestart) {
      this.authorizedSongId = null;

      this.lastPlayhead = 0;
      this.autoCrossfadedSongId = null;
      this.preloadedNextSongId = null;
      this.playCountedSongId = null;
      this.userSeekedWhilePaused = false;
    }

    let nextUserQueue = this.state.userQueue;
    let nextContextQueue = this.state.contextQueue;
    const nextPlaylistId = playlistId !== undefined ? playlistId : this.state.activePlaylistId;
    const nextContextId = contextId !== undefined ? contextId : this.state.activeContextId;
    let nextPlaybackContext = this.state.playbackContext;

    if (song) {
      nextUserQueue = nextUserQueue.filter((s) => s.id !== song.id);
      if (Array.isArray(contextSongs) && contextSongs.length > 0) {
        // Explicit new listening context replaces contextQueue cleanly (never concatenates or circularly wraps prior tracks)
        const cleanContext = contextSongs.filter((s): s is Song => Boolean(s && s.id && this.isSongAllowedForAccount(s)));
        this.contextOriginSongs = cleanContext.slice(0, 200);
        const startIdx = cleanContext.findIndex((s) => s.id === song.id);
        nextContextQueue =
          startIdx >= 0
            ? cleanContext.slice(startIdx + 1)
            : cleanContext.filter((s) => s.id !== song.id);
        nextPlaybackContext = this.derivePlaybackContext(nextContextId, nextPlaylistId, cleanContext, contextMeta);
      } else {
        const ctxIdx = nextContextQueue.findIndex((s) => s.id === song.id);
        if (ctxIdx >= 0) {
          for (let i = 0; i < ctxIdx; i++) {
            this.pushPlayedHistory(nextContextQueue[i]);
          }
          nextContextQueue = nextContextQueue.slice(ctxIdx + 1);
        } else {
          nextContextQueue = nextContextQueue.filter((s) => s.id !== song.id);
        }
        if (contextMeta || contextId !== undefined || playlistId !== undefined || !nextPlaybackContext) {
          nextPlaybackContext = this.derivePlaybackContext(
            nextContextId,
            nextPlaylistId,
            [song, ...nextContextQueue],
            contextMeta,
          );
        }
      }
    } else {
      this.contextOriginSongs = [];
      nextPlaybackContext = null;
    }

    const combined = this.buildCombinedQueue(song, nextUserQueue, nextContextQueue);
    const dur = typeof song?.duration === 'number' && song.duration > 0 ? song.duration : 0;
    const preserveSameState = isSameSong && !forceRestart;

    this.state = {
      ...this.state,
      activeSong: song,
      duration: preserveSameState ? (this.state.duration || dur) : dur,
      playhead: preserveSameState ? this.state.playhead : 0,
      isPlaying: preserveSameState ? this.state.isPlaying : false,
      queue: combined.queue,
      userQueue: combined.userQueue,
      contextQueue: combined.contextQueue,
      queueIndex: combined.queueIndex,
      activePlaylistId: nextPlaylistId,
      activeContextId: nextContextId,
      playbackContext: nextPlaybackContext,
      transitionDirection: direction,
      transitionSeq: isSameSong ? this.state.transitionSeq : this.state.transitionSeq + 1,
    };
    this.persistQueue(combined.queue, combined.userQueue, combined.contextQueue, song, nextPlaybackContext);
    this.notify();
    bus.broadcastPlayback(this.getAccountStorageSuffix(), song, this.state.playhead, this.state.duration, this.state.isPlaying);
    this.prefetchUpcomingMetadata();
  }

  public async playCollection(
    songs: Song[],
    contextId: string,
    playlistId?: string | null,
    contextMeta?: Partial<PlaybackContext>,
  ): Promise<boolean> {
    const validSongs = songs.filter((s): s is Song => Boolean(s && s.id && this.isSongAllowedForAccount(s)));
    if (validSongs.length === 0) return false;

    const isSameContext = this.state.activeContextId === contextId;
    const activeInCollection = Boolean(
      this.state.activeSong && validSongs.some((s) => s.id === this.state.activeSong!.id)
    );

    if (isSameContext && activeInCollection && this.state.activeSong && this.authorizedSongId === this.state.activeSong.id && audio.hasSource()) {
      return await this.setPlaying(!this.state.isPlaying);
    }

    this.setActiveSong(validSongs[0], validSongs, playlistId ?? null, contextId, true, contextMeta, 'direct');
    return await this.setPlaying(true);
  }

  public async playSong(
    song: Song,
    contextSongs?: Song[],
    playlistId?: string | null,
    contextId?: string | null,
    restart = false,
    contextMeta?: Partial<PlaybackContext>,
  ): Promise<boolean> {
    const resolvedPlaylistId = playlistId ?? null;
    const resolvedContextId =
      contextId !== undefined
        ? contextId
        : resolvedPlaylistId
          ? `playlist:${resolvedPlaylistId}`
          : this.state.activeContextId || 'market:feed';
    const sameSong = this.state.activeSong?.id === song.id;
    const samePlaylist = this.state.activePlaylistId === resolvedPlaylistId;
    const sameContext = this.state.activeContextId === resolvedContextId;
    if (!restart && sameSong && samePlaylist && sameContext && this.authorizedSongId === song.id && audio.hasSource()) {
      return await this.setPlaying(!this.state.isPlaying);
    }
    this.setActiveSong(song, contextSongs, resolvedPlaylistId, resolvedContextId, true, contextMeta, 'direct');
    return await this.setPlaying(true);
  }

  public async playQueueIndex(index: number): Promise<boolean> {
    if (index < 0 || index >= this.state.queue.length) return false;
    const targetSong = this.state.queue[index];
    if (!targetSong) return false;

    const isCurrentActive =
      (index === this.state.queueIndex || index === 0) &&
      this.state.activeSong?.id === targetSong.id;

    if (isCurrentActive) {
      if (this.authorizedSongId === targetSong.id && audio.hasSource()) {
        return await this.setPlaying(!this.state.isPlaying);
      }
      return await this.setPlaying(true);
    }

    for (let i = 0; i < index; i++) {
      this.pushPlayedHistory(this.state.queue[i]);
    }

    // Consume any userQueue / contextQueue items prior to the selected index
    const skippedIds = new Set(this.state.queue.slice(0, index + 1).map((s) => s.id));
    const nextUserQueue = this.state.userQueue.filter((s) => !skippedIds.has(s.id));
    const nextContextQueue = this.state.contextQueue.filter((s) => !skippedIds.has(s.id));
    this.state = {
      ...this.state,
      userQueue: nextUserQueue,
      contextQueue: nextContextQueue,
    };
    this.setActiveSong(targetSong, undefined, undefined, undefined, true, undefined, 'next');
    return await this.setPlaying(true);
  }

  public setQueue(
    songs: Song[],
    startIndex = 0,
    playlistId: string | null = null,
    contextId?: string | null,
    contextMeta?: Partial<PlaybackContext>,
  ) {
    const clean = songs.filter((s): s is Song => Boolean(s && s.id && this.isSongAllowedForAccount(s)));
    this.contextOriginSongs = clean.slice(0, 200);
    const clampedIdx = clean.length > 0 ? Math.min(Math.max(startIndex, 0), clean.length - 1) : -1;
    const active = clampedIdx >= 0 ? clean[clampedIdx] : this.state.activeSong;
    const upcomingContext = clampedIdx >= 0 ? clean.slice(clampedIdx + 1) : clean;
    const nextContextId = contextId !== undefined ? contextId : this.state.activeContextId;
    const nextPlaybackContext = this.derivePlaybackContext(nextContextId, playlistId, clean, contextMeta);
    const combined = this.buildCombinedQueue(active, this.state.userQueue, upcomingContext);
    this.state = {
      ...this.state,
      activeSong: active,
      queue: combined.queue,
      userQueue: combined.userQueue,
      contextQueue: combined.contextQueue,
      queueIndex: combined.queueIndex,
      activePlaylistId: playlistId,
      activeContextId: nextContextId,
      playbackContext: nextPlaybackContext,
    };
    this.persistQueue(combined.queue, combined.userQueue, combined.contextQueue, active, nextPlaybackContext);
    this.notify();
  }

  public playNext(song: Song) {
    if (!this.isSongAllowedForAccount(song)) return;
    if (!this.state.activeSong) {
      this.setActiveSong(song, [song], null, `song:${song.id}`, false, {
        domain: 'song',
        id: `song:${song.id}`,
        label: song.public ? 'Single' : 'Private Draft',
        isPrivate: !song.public,
      });
      toast.success(`Loaded "${song.title}"`);
      return;
    }
    if (this.state.activeSong.id === song.id) {
      toast.success(`"${song.title}" is already playing`);
      return;
    }
    const nextUserQueue = [song, ...this.state.userQueue.filter((s) => s.id !== song.id)];
    const nextContextQueue = this.state.contextQueue.filter((s) => s.id !== song.id);
    const combined = this.buildCombinedQueue(this.state.activeSong, nextUserQueue, nextContextQueue);
    this.state = {
      ...this.state,
      queue: combined.queue,
      userQueue: combined.userQueue,
      contextQueue: combined.contextQueue,
      queueIndex: combined.queueIndex,
    };
    this.persistQueue(combined.queue, combined.userQueue, combined.contextQueue, this.state.activeSong);
    this.notify();
    this.prefetchUpcomingMetadata();
    toast.success(`Playing "${song.title}" next`);
  }

  public addToQueue(song: Song) {
    if (!this.isSongAllowedForAccount(song)) return;
    const alreadyInUserQueue = this.state.userQueue.some((s) => s.id === song.id);
    const isActive = this.state.activeSong?.id === song.id;
    const nextUserQueue = alreadyInUserQueue || isActive ? [...this.state.userQueue] : [...this.state.userQueue, song];
    const nextContextQueue = this.state.contextQueue.filter((s) => s.id !== song.id);
    const active = this.state.activeSong ?? song;
    const effectiveUserQueue = this.state.activeSong ? nextUserQueue : nextUserQueue.filter((s) => s.id !== song.id);
    const nextContext =
      this.state.playbackContext ??
      this.derivePlaybackContext(`song:${active.id}`, null, [active], {
        domain: 'song',
        id: `song:${active.id}`,
        label: active.public ? 'Queue' : 'Private Draft',
        isPrivate: !active.public,
      });
    const combined = this.buildCombinedQueue(active, effectiveUserQueue, nextContextQueue);
    this.state = {
      ...this.state,
      activeSong: active,
      queue: combined.queue,
      userQueue: combined.userQueue,
      contextQueue: combined.contextQueue,
      queueIndex: combined.queueIndex,
      playbackContext: nextContext,
    };
    this.persistQueue(combined.queue, combined.userQueue, combined.contextQueue, active, nextContext);
    this.notify();
    this.prefetchUpcomingMetadata();
    toast.success(alreadyInUserQueue ? `"${song.title}" is already in queue` : `Added "${song.title}" to queue`);
  }

  public removeFromQueue(index: number) {
    if (index < 0 || index >= this.state.queue.length) return;
    const removed = this.state.queue[index];
    if (!removed) return;

    if (index === 0 && this.state.activeSong?.id === removed.id) {
      const nextUser = [...this.state.userQueue];
      const nextContext = [...this.state.contextQueue];
      const replacement = nextUser.shift() ?? nextContext.shift() ?? null;
      const wasPlaying = this.state.isPlaying;
      const combined = this.buildCombinedQueue(replacement, nextUser, nextContext);
      this.state = {
        ...this.state,
        queue: combined.queue,
        userQueue: combined.userQueue,
        contextQueue: combined.contextQueue,
        queueIndex: combined.queueIndex,
      };
      this.setActiveSong(replacement, undefined, undefined, undefined, true, undefined, 'next');
      if (wasPlaying && replacement) {
        void this.setPlaying(true);
      }
      return;
    }

    const nextUserQueue = this.state.userQueue.filter((s) => s.id !== removed.id);
    const nextContextQueue = this.state.contextQueue.filter((s) => s.id !== removed.id);
    const combined = this.buildCombinedQueue(this.state.activeSong, nextUserQueue, nextContextQueue);
    this.state = {
      ...this.state,
      queue: combined.queue,
      userQueue: combined.userQueue,
      contextQueue: combined.contextQueue,
      queueIndex: combined.queueIndex,
    };
    this.persistQueue(combined.queue, combined.userQueue, combined.contextQueue, this.state.activeSong);
    this.notify();
  }

  public moveQueueItem(fromIndex: number, toIndex: number) {
    const q = [...this.state.queue];
    if (fromIndex < 0 || fromIndex >= q.length || toIndex < 0 || toIndex >= q.length || fromIndex === toIndex) {
      return;
    }
    const activeAtTop = Boolean(this.state.activeSong && q[0]?.id === this.state.activeSong.id);
    if (activeAtTop && fromIndex === 0) {
      return;
    }
    const targetToIndex = activeAtTop && toIndex === 0 ? 1 : toIndex;
    if (fromIndex === targetToIndex) return;
    const [moved] = q.splice(fromIndex, 1);
    q.splice(targetToIndex, 0, moved);

    const upcoming = activeAtTop ? q.slice(1) : q;
    const userCount = this.state.userQueue.length;
    const nextUserQueue = upcoming.slice(0, userCount);
    const nextContextQueue = upcoming.slice(userCount);
    const combined = this.buildCombinedQueue(this.state.activeSong, nextUserQueue, nextContextQueue);
    this.state = {
      ...this.state,
      queue: combined.queue,
      userQueue: combined.userQueue,
      contextQueue: combined.contextQueue,
      queueIndex: combined.queueIndex,
    };
    this.persistQueue(combined.queue, combined.userQueue, combined.contextQueue, this.state.activeSong);
    this.notify();
  }

  public clearUserQueue() {
    const combined = this.buildCombinedQueue(this.state.activeSong, [], this.state.contextQueue);
    this.state = {
      ...this.state,
      queue: combined.queue,
      userQueue: [],
      contextQueue: combined.contextQueue,
      queueIndex: combined.queueIndex,
    };
    this.persistQueue(combined.queue, [], combined.contextQueue, this.state.activeSong);
    this.notify();
  }

  public clearQueue() {
    const active = this.state.activeSong;
    const nextQueue = active ? [active] : [];
    const nextIndex = active ? 0 : -1;
    this.contextOriginSongs = active ? [active] : [];
    this.state = {
      ...this.state,
      queue: nextQueue,
      userQueue: [],
      contextQueue: [],
      queueIndex: nextIndex,
      activePlaylistId: null,
      activeContextId: active ? `song:${active.id}` : null,
      playbackContext: active
        ? {
          domain: 'song',
          id: `song:${active.id}`,
          label: active.public ? 'Single' : 'Private Draft',
          isPrivate: !active.public,
        }
        : null,
    };
    this.persistQueue(nextQueue, [], [], active, this.state.playbackContext);
    this.notify();
  }

  private preloadUpcomingTrack() {
    const nextCandidate = this.peekNextSong();
    if (
      nextCandidate &&
      nextCandidate.id !== this.preloadedNextSongId &&
      nextCandidate.url &&
      !nextCandidate.url.endsWith('/stream')
    ) {
      this.preloadedNextSongId = nextCandidate.id;
      audio.preloadNext(nextCandidate.url);
    }
  }

  private getPublicCatalog(): Song[] {
    const cachedPublic = readSongs('public') || [];
    const map = new Map<string, Song>();
    for (const s of this.state.songs) {
      if (s && s.id && s.public) map.set(s.id, s);
    }
    for (const s of cachedPublic) {
      if (s && s.id && s.public && !map.has(s.id)) map.set(s.id, s);
    }
    return Array.from(map.values());
  }

  private peekNextSong(): Song | null {
    const { queue, queueIndex, repeatMode, shuffle, autoplay, activeSong } = this.state;
    if (queue.length === 0 && !activeSong) return null;
    if (repeatMode === 'one' && activeSong) return activeSong;
    if (shuffle && queue.length > 1) {
      const candidates = queue.filter((_, idx) => idx !== queueIndex);
      return candidates[0] || null;
    }
    const nextIdx = queueIndex + 1;
    if (nextIdx < queue.length) {
      return queue[nextIdx];
    }
    if (autoplay) {
      const playedIds = new Set([activeSong?.id, ...this.playedHistory.map((s) => s.id)]);
      const unplayedCatalog = this.getPublicCatalog().filter((s) => !playedIds.has(s.id));
      if (unplayedCatalog.length > 0) {
        return unplayedCatalog[0];
      }
    }
    if (repeatMode === 'all') {
      return this.playedHistory[0] || queue[0] || null;
    }
    return null;
  }

  public async playNextTrack(fromAutoAdvance = false): Promise<boolean> {
    const { queue, queueIndex, repeatMode, shuffle, autoplay, activeSong } = this.state;
    if (queue.length === 0 && !activeSong) return false;

    if (fromAutoAdvance && repeatMode === 'one' && activeSong) {
      this.setActiveSong(activeSong, undefined, undefined, undefined, true);
      return await this.setPlaying(true);
    }

    const currentIdx = queueIndex >= 0 ? queueIndex : 0;
    const finishedSong = queue[currentIdx] || activeSong;
    if (finishedSong) {
      this.pushPlayedHistory(finishedSong);
    }

    let remaining = queue.slice(currentIdx + 1);

    if (remaining.length === 0) {
      const publicCatalog = this.getPublicCatalog();
      const playedIds = new Set([finishedSong?.id, ...this.playedHistory.map((s) => s.id)]);
      const unplayedCatalog = publicCatalog.filter((s) => !playedIds.has(s.id));
      if (unplayedCatalog.length > 0 && (!fromAutoAdvance || autoplay)) {
        remaining = unplayedCatalog;
      } else if (repeatMode === 'all' || !fromAutoAdvance) {
        const refill = [...this.playedHistory].reverse().filter((s) => s && s.id !== finishedSong?.id);
        const catalogFallback = publicCatalog.filter((s) => s.id !== finishedSong?.id);
        if (refill.length > 0) {
          remaining = refill;
          this.playedHistory = [];
        } else if (catalogFallback.length > 0 && (!fromAutoAdvance || autoplay)) {
          remaining = catalogFallback;
          this.playedHistory = [];
        } else if (finishedSong) {
          remaining = [finishedSong];
        }
      } else {
        this.setActiveSong(null);
        this.state = { ...this.state, queue: [], queueIndex: -1, isPlaying: false };
        this.persistQueue([]);
        this.notify();
        return false;
      }
    }

    if (remaining.length === 0) {
      return false;
    }

    if (shuffle && remaining.length > 1) {
      const randIdx = Math.floor(Math.random() * remaining.length);
      const [picked] = remaining.splice(randIdx, 1);
      remaining = [picked, ...remaining];
    }

    const nextSong = remaining[0];
    if (!nextSong) return false;

    this.state = {
      ...this.state,
      queue: remaining,
      queueIndex: 0,
    };
    this.persistQueue(remaining);



    this.setActiveSong(nextSong, undefined, undefined, undefined, true);
    return await this.setPlaying(true);
  }

  public async playPreviousTrack(): Promise<boolean> {
    const { queue, playhead } = this.state;
    if (playhead > 3.5) {
      this.setPlayhead(0);
      if (!this.state.isPlaying) {
        return await this.setPlaying(true);
      }
      return true;
    }

    if (this.playedHistory.length > 0) {
      const prevSong = this.playedHistory.pop()!;
      const nextQueue = [prevSong, ...queue.filter((s) => s.id !== prevSong.id)];
      this.state = {
        ...this.state,
        queue: nextQueue,
        queueIndex: 0,
      };
      this.persistQueue(nextQueue);
      this.setActiveSong(prevSong, undefined, undefined, undefined, true);
      return await this.setPlaying(true);
    }

    this.setPlayhead(0);
    if (queue.length > 0 && !this.state.isPlaying) {
      return await this.setPlaying(true);
    }
    return false;
  }

  public setRepeatMode(mode: RepeatMode) {
    this.state = { ...this.state, repeatMode: mode };
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEYS.repeat, mode);
      } catch { }
    }
    this.notify();
  }

  public toggleRepeatMode() {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    const next = order[(order.indexOf(this.state.repeatMode) + 1) % order.length];
    this.setRepeatMode(next);
  }

  public setShuffle(shuffle: boolean) {
    this.state = { ...this.state, shuffle };
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEYS.shuffle, String(shuffle));
      } catch { }
    }
    this.notify();
  }

  public setAutoplay(autoplay: boolean) {
    this.state = { ...this.state, autoplay };
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEYS.autoplay, String(autoplay));
      } catch { }
    }
    this.notify();
  }

  public toggleAutoplay() {
    this.setAutoplay(!this.state.autoplay);
  }

  public toggleShuffle() {
    this.setShuffle(!this.state.shuffle);
  }

  public setActivePlaylistId(id: string | null) {
    this.state = { ...this.state, activePlaylistId: id };
    this.notify();
  }

  private getSleepTimerLabel(mode: SleepTimerMode): string {
    if (mode === '5') return '5 MIN';
    if (mode === '15') return '15 MIN';
    if (mode === '30') return '30 MIN';
    if (mode === 'track') return 'END OF TRACK';
    return this.state.activePlaylistId ? 'END OF PLAYLIST' : 'END OF QUEUE';
  }

  private expireSleepTimer(pauseAudio = true) {
    if (this.sleepTimerTimeout) {
      clearTimeout(this.sleepTimerTimeout);
      this.sleepTimerTimeout = null;
    }
    const expired = this.state.sleepTimer;
    this.state = {
      ...this.state,
      sleepTimer: null,
    };
    if (expired && typeof window !== 'undefined') {
      try {
        const promptData: SleepTimerPrompt = {
          mode: expired.mode,
          label: expired.label,
          expiredAt: Date.now(),
        };
        localStorage.setItem(STORAGE_KEYS.sleepTimerExpired, JSON.stringify(promptData));
      } catch { }
    }
    if (pauseAudio && this.state.isPlaying) {
      void this.setPlaying(false);
    } else {
      this.notify();
    }
  }

  public setSleepTimer(mode: SleepTimerMode | null) {
    if (this.sleepTimerTimeout) {
      clearTimeout(this.sleepTimerTimeout);
      this.sleepTimerTimeout = null;
    }
    if (!mode) {
      this.state = {
        ...this.state,
        sleepTimer: null,
      };
      this.notify();
      return;
    }

    const label = this.getSleepTimerLabel(mode);
    const isMinutes = mode === '5' || mode === '15' || mode === '30';
    const durationMs = isMinutes ? Number(mode) * 60_000 : null;
    const endsAtMs = durationMs ? Date.now() + durationMs : null;

    if (durationMs) {
      this.sleepTimerTimeout = setTimeout(() => {
        this.expireSleepTimer(true);
      }, durationMs);
    }

    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEYS.sleepTimerExpired);
      } catch { }
    }

    this.state = {
      ...this.state,
      sleepTimer: {
        mode,
        endsAtMs,
        label,
      },
      sleepTimerPrompt: null,
    };
    this.notify();
  }

  public reactivateSleepTimer() {
    const prompt = this.state.sleepTimerPrompt;
    if (!prompt) return;
    this.setSleepTimer(prompt.mode);
  }

  public dismissSleepTimerPrompt() {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEYS.sleepTimerExpired);
      } catch { }
    }
    if (this.state.sleepTimerPrompt) {
      this.state = { ...this.state, sleepTimerPrompt: null };
      this.notify();
    }
  }

  public clearUserWorkspace(broadcast = false) {
    this.finishPlayback();
    this.playRequestId++;
    audio.reset();
    bus.release('player');
    this.authorizedSongId = null;

    this.lastPlayhead = 0;
    this.state = {
      ...this.state,
      songs: this.state.songs.filter((s) => s.public),
      tracks: [],
      activeSong: this.state.activeSong?.public ? this.state.activeSong : null,
      editingSong: null,
      isPlaying: false,
      playhead: 0,
      duration: this.state.activeSong?.public ? (this.state.activeSong.duration || 0) : 0,
      selection: null,
      isGenerating: false,
      userAddress: '',
      evmAddress: null,
      svmAddress: null,
    };
    this.notify();
    if (broadcast) {
      bus.broadcastLogout();
    }
  }

  public setEditingSong(song: Song | null) {
    this.state = {
      ...this.state,
      editingSong: song,
      selection: song && song.duration ? { start: 0, end: Math.min(30, song.duration) } : null,
    };
    this.notify();
  }

  public isCreatorOfSong(song: Song | null | undefined, additionalAddresses?: (string | null | undefined)[]): boolean {
    if (!song || !song.creator) return false;
    const songCreator = song.creator.trim();
    const songCreatorLower = songCreator.toLowerCase();

    const candidates = new Set<string>(this.getViewerAddresses());

    if (additionalAddresses) {
      for (const addr of additionalAddresses) {
        if (addr && typeof addr === 'string') {
          candidates.add(addr.trim());
        }
      }
    }

    if (candidates.size === 0) return false;

    for (const cand of candidates) {
      if (!cand) continue;
      if (cand.toLowerCase() === songCreatorLower || cand === songCreator) {
        return true;
      }
    }

    return false;
  }

  private createPlayback(song: Song, exempt: boolean): Playback {
    const [billing, ...alternatives] = captureStreamBilling(this.state.userAddress || this.state.evmAddress || this.state.svmAddress || '');
    const durationMs = song.duration && Number.isFinite(song.duration) && song.duration > 0 ? Math.ceil(song.duration * 1000) : Number.MAX_SAFE_INTEGER;
    const lane: Playback = { id: crypto.randomUUID(), songId: song.id, billing, alternatives, intent: null, observedMs: 0, durationMs, acceptedMs: 0, terminal: false, exempt, flush: false };
    this.playback = lane;
    if (!exempt) this.playbacks.set(lane.id, lane);
    return lane;
  }

  public async setPlaying(isPlaying: boolean): Promise<boolean> {
    if (!isPlaying) {
      this.samplePlayback();
      this.playRequestId++;
      bus.release('player');
      this.state = { ...this.state, isPlaying: false };
      audio.pause();
      this.notify();
      bus.broadcastPlayback(this.state.activeSong, this.state.playhead, this.state.duration, false);
      void this.reportStreamCheckpoint(false);
      return false;
    }

    const song = this.state.activeSong;
    if (!song) {
      console.warn('Playback prevented: No active song');
      return false;
    }

    if (!this.state.sleepTimer && !this.state.sleepTimerPrompt && typeof window !== 'undefined') {
      try {
        const rawSleepExpired = localStorage.getItem(STORAGE_KEYS.sleepTimerExpired);
        if (rawSleepExpired) {
          const parsedExpired = JSON.parse(rawSleepExpired) as SleepTimerPrompt;
          if (parsedExpired?.mode && parsedExpired?.label) {
            this.state = { ...this.state, sleepTimerPrompt: parsedExpired };
          }
        }
      } catch { }
    }

    const allowOverlap = this.pendingAutoAdvanceOverlap;
    this.pendingAutoAdvanceOverlap = false;

    const isCreator = this.isCreatorOfSong(song);

    const token = compose.keys.currentToken();
    const reservedCredit = this.playback?.billing.source === 'card' && this.playback.intent
      && !this.playback.rejected && !this.playback.terminal && this.authorizedSongId === song.id;
    if (!isCreator && !reservedCredit && !token && !hasStreamBudget()) {
      this.finishPlayback();
      this.playRequestId++;
      this.authorizedSongId = null;
      audio.pause();
      bus.release('player');
      this.state = { ...this.state, isPlaying: false };
      this.notify();
      this.resumeAfterGate({
        steps: ['login', 'funding'],
        action: 'stream',
        reason: hasPromoCreditsOnly()
          ? 'Promo credits cannot be used for streaming. Add Card Credits or start an On-Chain USDC Session.'
          : undefined,
      });
      return false;
    }

    if (this.playback?.rejected) {
      if (this.authorizedSongId === this.playback.songId) this.authorizedSongId = null;
      this.removePlayback(this.playback);
      this.playback = null;
    }

    // Resuming the already-loaded active song from its current playhead
    if (this.authorizedSongId === song.id && audio.hasSource() && !this.playback?.terminal) {
      bus.request('player');
      this.state = { ...this.state, isPlaying: true };
      this.lastPlayhead = this.state.playhead || 0;
      audio.play(this.state.playhead, this.state.duration);
      this.notify();
      bus.broadcastPlayback(song, this.state.playhead, this.state.duration, true);
      return true;
    }

    // New track start: always start from 0:00 unless user explicitly dragged the scrubber while paused
    const startOffset = this.userSeekedWhilePaused ? this.state.playhead : 0;
    this.userSeekedWhilePaused = false;

    const requestId = ++this.playRequestId;
    const lane = this.createPlayback(song, isCreator);

    // Zero-latency direct CDN start when song.url is present
    if (song.url && !song.url.endsWith('/stream')) {
      this.authorizedSongId = song.id;

      this.lastPlayhead = startOffset;

      audio.load(song.url, allowOverlap);
      bus.request('player');
      this.state = { ...this.state, playhead: startOffset, isPlaying: true };
      audio.play(startOffset, this.state.duration);
      this.notify();
      bus.broadcastPlayback(song, startOffset, this.state.duration, true);

      if (!isCreator) {
        void this.drainPlayback(lane);
      }
      return true;
    }

    const targetSongId = song.id;
    try {
      const data = await this.admitPlayback(lane);
      if (requestId !== this.playRequestId || this.state.activeSong?.id !== targetSongId) {
        return false;
      }

      if (!data.url) {
        this.finishPlayback();
        toast.error('Audio stream URL not returned by server');
        this.state = { ...this.state, isPlaying: false, playhead: 0 };
        this.notify();
        return false;
      }

      this.authorizedSongId = song.id;

      this.lastPlayhead = startOffset;

      audio.load(data.url, allowOverlap);
      bus.request('player');
      this.state = { ...this.state, playhead: startOffset, isPlaying: true };
      audio.play(startOffset, this.state.duration);
      this.notify();
      bus.broadcastPlayback(song, startOffset, this.state.duration, true);
      return true;
    } catch (err: any) {
      this.failPlayback(lane, err);
      if (requestId !== this.playRequestId) return false;
      toast.error(err?.message || 'Failed to authorize stream playback');
      this.state = { ...this.state, isPlaying: false, playhead: 0 };
      this.notify();
      return false;
    }
  }

  public setPlayhead(time: number) {
    this.samplePlayback();
    this.lastPlayhead = time;
    this.userSeekedWhilePaused = !this.state.isPlaying && time > 0;
    this.state = { ...this.state, playhead: time };
    audio.seek(time);
    this.lastPlayhead = time;
    this.notify();
  }

  public setSelection(selection: { start: number; end: number } | null) {
    this.state = { ...this.state, selection };
    this.notify();
  }

  public setGenerating(isGenerating: boolean) {
    this.state = { ...this.state, isGenerating };
    this.notify();
  }

  public addTracks(tracks: Track[]) {
    this.state = {
      ...this.state,
      tracks: [...tracks, ...this.state.tracks],
    };
    this.notify();
  }

  public updateTrack(id: string, updates: Partial<Track>) {
    this.state = {
      ...this.state,
      tracks: this.state.tracks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    };
    this.notify();
  }

  public setUserAddress(userAddress: string, evmAddress?: string | null, svmAddress?: string | null) {
    if (this.state.userAddress && this.state.userAddress !== userAddress) {
      this.finishPlayback();
      audio.pause();
      this.authorizedSongId = null;
      this.state = { ...this.state, isPlaying: false };
    }
    this.state = {
      ...this.state,
      userAddress: userAddress || '',
      evmAddress: evmAddress ?? null,
      svmAddress: svmAddress ?? null,
    };
    this.notify();
  }
}

export const store = new Store();
