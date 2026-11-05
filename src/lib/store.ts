import { Song, Track } from './schema';
import { audio } from './audio';
import { bus } from './bus';
import { api, hasStreamBudget, hasPromoCreditsOnly, captureStreamBilling, streamOptions, type StreamBilling } from './api';
import { compose } from './compose';
import { readSongs } from './cache';
import { toast } from 'sonner';
import { openGate, type GateOptions } from './gate';

export type RepeatMode = 'off' | 'all' | 'one';
export type SleepTimerMode = '5' | '15' | '30' | 'track' | 'queue';

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
  queueIndex: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  autoplay: boolean;
  activePlaylistId: string | null;
  activeContextId: string | null;
  sleepTimer: SleepTimerState | null;
  sleepTimerPrompt: SleepTimerPrompt | null;
}

type Listener = (state: State) => void;

const STORAGE_KEYS = {
  playback: 'rawchunks:playback',
  repeat: 'rawchunks:repeatMode',
  shuffle: 'rawchunks:shuffle',
  autoplay: 'rawchunks:autoplay',
  queue: 'rawchunks:queue',
  sleepTimerExpired: 'rawchunks:sleep-timer-expired',
};

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
const STREAM_STORAGE = 'rawchunks:stream:';

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
    let initialRepeat: RepeatMode = 'all';
    let initialShuffle = false;
    let initialAutoplay = true;
    let initialQueue: Song[] = [];
    let initialQueueIndex = -1;
    let initialSleepTimerPrompt: SleepTimerPrompt | null = null;

    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.playback);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.song && typeof parsed.song.id === 'string') {
            initialSong = parsed.song as Song;
            initialDuration = typeof parsed.duration === 'number' && parsed.duration > 0 ? parsed.duration : (initialSong.duration || 0);
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
          initialAutoplay = savedAutoplay !== 'false';
        }
        const savedQueue = localStorage.getItem(STORAGE_KEYS.queue);
        if (savedQueue) {
          const parsedQueue = JSON.parse(savedQueue);
          if (Array.isArray(parsedQueue)) {
            initialQueue = parsedQueue.filter((item): item is Song => Boolean(item && typeof item.id === 'string'));
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
      } catch {}
    }

    if (initialSong && initialQueue.length === 0) {
      initialQueue = [initialSong];
      initialQueueIndex = 0;
    } else if (initialSong) {
      const foundIdx = initialQueue.findIndex((s) => s.id === initialSong!.id);
      if (foundIdx >= 0) {
        initialQueue = initialQueue.slice(foundIdx);
        initialQueueIndex = 0;
      } else {
        initialQueue = [initialSong, ...initialQueue];
        initialQueueIndex = 0;
      }
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
      queueIndex: initialQueueIndex,
      repeatMode: initialRepeat,
      shuffle: initialShuffle,
      autoplay: initialAutoplay,
      activePlaylistId: null,
      activeContextId: null,
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

    bus.registerPlaybackSync(({ song, playhead, duration }) => {
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
      this.state = {
        ...this.state,
        activeSong: song,
        playhead: typeof playhead === 'number' ? playhead : 0,
        duration: typeof duration === 'number' && duration > 0 ? duration : (song?.duration || 0),
        isPlaying: false,
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
        bus.broadcastPlayback(this.state.activeSong, time, this.state.duration, true);
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
            }).catch(() => {});
          }
        }
      });
      window.addEventListener('online', () => { for (const lane of this.playbacks.values()) void this.drainPlayback(lane); });
      queueMicrotask(() => this.restorePlaybacks());
    }
  }

  private persistQueue(queue: Song[]) {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEYS.queue, JSON.stringify(queue.slice(0, 100)));
    } catch {}
  }

  private getViewerAddresses(): string[] {
    const candidates = new Set<string>();
    if (this.state.userAddress) candidates.add(this.state.userAddress.trim());
    if (this.state.evmAddress) candidates.add(this.state.evmAddress.trim());
    if (this.state.svmAddress) candidates.add(this.state.svmAddress.trim());
    const currentWallet = compose.wallets.current() as { address?: string; svmAddress?: string } | null;
    if (currentWallet?.address) candidates.add(currentWallet.address.trim());
    if (currentWallet?.svmAddress) candidates.add(currentWallet.svmAddress.trim());
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('last_account');
        if (raw) {
          const parsed = JSON.parse(raw) as { address?: string; evmAddress?: string; svmAddress?: string };
          if (parsed?.address) candidates.add(parsed.address.trim());
          if (parsed?.evmAddress) candidates.add(parsed.evmAddress.trim());
          if (parsed?.svmAddress) candidates.add(parsed.svmAddress.trim());
        }
      } catch {}
    }
    return Array.from(candidates).filter(Boolean);
  }

  private async recordSongPlay(songId: string) {
    const activeContext = (this.state.activeContextId || '').toLowerCase();
    const isMyPageRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/my-page');
    if (activeContext.startsWith('mypage') || isMyPageRoute) return;

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
          'Content-Type': 'application/json',
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
    } catch {}
  }

  private persistPlayback(lane: Playback) {
    if (lane.exempt || lane.rejected || !lane.intent) {
      try { localStorage.removeItem(`${STREAM_STORAGE}${lane.id}`); } catch {}
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
        try { lane = JSON.parse(localStorage.getItem(key)!); } catch {}
        if (!lane?.id || !lane.songId || !lane.billing || !lane.intent || lane.exempt || lane.rejected || !Number.isFinite(lane.observedMs) || !Number.isFinite(lane.acceptedMs)) {
          try { localStorage.removeItem(key); } catch {}
          continue;
        }
        if (this.playbacks.has(lane.id)) continue;
        lane.terminal = true;
        lane.rejected = false;
        this.playbacks.set(lane.id, lane);
        restored.push(lane);
      }
      for (const lane of restored) void this.drainPlayback(lane);
    } catch {}
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
      for (;;) {
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
          const isMyPageRoute = typeof window !== 'undefined' && Boolean(window.location?.pathname?.startsWith('/my-page'));
          const playbackContext = activeContext || (isMyPageRoute ? 'mypage' : '');
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
    try { localStorage.removeItem(`${STREAM_STORAGE}${lane.id}`); } catch {}
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
      bus.broadcastPlayback(this.state.activeSong, this.state.playhead, this.state.duration, false);
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
    // If queue has not been seeded yet, seed with public songs so continuous play works out of the box
    let nextQueue = this.state.queue;
    let nextQueueIndex = this.state.queueIndex;
    if (nextQueue.length <= 1 && songs.length > 1) {
      const publicPool = songs.filter((s) => s.public);
      if (publicPool.length > 0) {
        nextQueue = publicPool;
        if (this.state.activeSong) {
          const idx = nextQueue.findIndex((s) => s.id === this.state.activeSong!.id);
          if (idx >= 0) {
            nextQueue = [...nextQueue.slice(idx), ...nextQueue.slice(0, idx)];
            nextQueueIndex = 0;
          } else {
            nextQueue = [this.state.activeSong, ...nextQueue];
            nextQueueIndex = 0;
          }
        }
      }
    }

    this.state = {
      ...this.state,
      songs,
      queue: nextQueue,
      queueIndex: nextQueueIndex,
    };
    this.notify();
  }

  public addSong(song: Song) {
    this.finishPlayback();
    this.authorizedSongId = null;
    audio.stopImmediate();
    const dur = typeof song.duration === 'number' && song.duration > 0 ? song.duration : 0;
    const nextQueue = [song, ...this.state.queue.filter((s) => s.id !== song.id)];
    this.state = {
      ...this.state,
      songs: [song, ...this.state.songs],
      activeSong: song,
      duration: dur,
      playhead: 0,
      isPlaying: false,
      queue: nextQueue,
      queueIndex: 0,
    };
    this.persistQueue(nextQueue);
    this.notify();
  }

  public updateSong(id: string, updates: Partial<Song>) {
    this.state = {
      ...this.state,
      songs: this.state.songs.map((s) => (s.id === id ? { ...s, ...updates } : s)),
      tracks: this.state.tracks.map((track) => (track.song.id === id ? { ...track, song: { ...track.song, ...updates } } : track)),
      queue: this.state.queue.map((s) => (s.id === id ? { ...s, ...updates } : s)),
      activeSong: this.state.activeSong?.id === id ? { ...this.state.activeSong, ...updates } : this.state.activeSong,
      editingSong: this.state.editingSong?.id === id ? { ...this.state.editingSong, ...updates } : this.state.editingSong,
    };
    this.notify();
  }

  public deleteSong(id: string) {
    const nextQueue = this.state.queue.filter((s) => s.id !== id);
    const activeRemoved = this.state.activeSong?.id === id;
    if (activeRemoved) { this.finishPlayback(); audio.stopImmediate(); this.authorizedSongId = null; }
    const nextActive = activeRemoved ? null : this.state.activeSong;
    const nextQueueIndex = nextActive ? nextQueue.findIndex((s) => s.id === nextActive.id) : -1;
    this.state = {
      ...this.state,
      songs: this.state.songs.filter((s) => s.id !== id),
      queue: nextQueue,
      queueIndex: nextQueueIndex,
      activeSong: nextActive,
      editingSong: this.state.editingSong?.id === id ? null : this.state.editingSong,
    };
    this.persistQueue(nextQueue);
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
    forceRestart = false
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

    let nextQueue = this.state.queue;
    let nextQueueIndex = this.state.queueIndex;

    if (song) {
      if (Array.isArray(contextSongs) && contextSongs.length > 0) {
        const cleanContext = contextSongs.filter((s): s is Song => Boolean(s && s.id));
        const startIdx = cleanContext.findIndex((s) => s.id === song.id);
        const upcomingFromContext = startIdx >= 0 ? cleanContext.slice(startIdx) : [song, ...cleanContext];
        const upcomingIds = new Set(upcomingFromContext.map((s) => s.id));
        const unplayedCurrentQueue =
          this.state.queueIndex >= 0 ? nextQueue.slice(this.state.queueIndex) : nextQueue;
        const restOfQueue = unplayedCurrentQueue.filter((q) => q && !upcomingIds.has(q.id));
        nextQueue = [...upcomingFromContext, ...restOfQueue];
        nextQueueIndex = 0;
      } else {
        const existingIdx = nextQueue.findIndex((s) => s.id === song.id);
        if (existingIdx >= 0) {
          for (let i = 0; i < existingIdx; i++) {
            this.pushPlayedHistory(nextQueue[i]);
          }
          nextQueue = nextQueue.slice(existingIdx);
          nextQueueIndex = 0;
        } else if (nextQueue.length === 0 && this.state.songs.length > 0) {
          const publicPool = this.state.songs.filter((s) => s.public);
          const poolIdx = publicPool.findIndex((s) => s.id === song.id);
          if (poolIdx >= 0) {
            nextQueue = [...publicPool.slice(poolIdx), ...publicPool.slice(0, poolIdx)];
            nextQueueIndex = 0;
          } else {
            nextQueue = [song, ...publicPool];
            nextQueueIndex = 0;
          }
        } else {
          const unplayed = this.state.queueIndex >= 0 ? nextQueue.slice(this.state.queueIndex) : nextQueue;
          nextQueue = [song, ...unplayed.filter((q) => q && q.id !== song.id)];
          nextQueueIndex = 0;
        }
      }
      this.persistQueue(nextQueue);
    }

    const dur = typeof song?.duration === 'number' && song.duration > 0 ? song.duration : 0;
    const preserveSameState = isSameSong && !forceRestart;
    this.state = {
      ...this.state,
      activeSong: song,
      duration: preserveSameState ? (this.state.duration || dur) : dur,
      playhead: preserveSameState ? this.state.playhead : 0,
      isPlaying: preserveSameState ? this.state.isPlaying : false,
      queue: nextQueue,
      queueIndex: nextQueueIndex,
      activePlaylistId: playlistId !== undefined ? playlistId : this.state.activePlaylistId,
      activeContextId: contextId !== undefined ? contextId : this.state.activeContextId,
    };
    this.notify();
    bus.broadcastPlayback(song, this.state.playhead, this.state.duration, this.state.isPlaying);
  }

  public async playCollection(
    songs: Song[],
    contextId: string,
    playlistId?: string | null
  ): Promise<boolean> {
    const validSongs = songs.filter((s): s is Song => Boolean(s && s.id));
    if (validSongs.length === 0) return false;

    const isSameContext = this.state.activeContextId === contextId;
    const activeInCollection = Boolean(
      this.state.activeSong && validSongs.some((s) => s.id === this.state.activeSong!.id)
    );

    const collectionIds = new Set(validSongs.map((s) => s.id));
    const unplayedCurrentQueue =
      this.state.queueIndex >= 0 ? this.state.queue.slice(this.state.queueIndex) : this.state.queue;
    const restOfQueue = unplayedCurrentQueue.filter((q) => q && !collectionIds.has(q.id));
    const mergedQueue = [...validSongs, ...restOfQueue];

    if (isSameContext && activeInCollection && this.state.activeSong && this.authorizedSongId === this.state.activeSong.id && audio.hasSource()) {
      const idx = mergedQueue.findIndex((s) => s.id === this.state.activeSong!.id);
      const sliced = idx >= 0 ? mergedQueue.slice(idx) : mergedQueue;
      this.setQueue(sliced, 0, playlistId ?? null, contextId);
      return await this.setPlaying(!this.state.isPlaying);
    }

    this.setActiveSong(validSongs[0], mergedQueue, playlistId ?? null, contextId, true);
    return await this.setPlaying(true);
  }

  public async playSong(
    song: Song,
    contextSongs?: Song[],
    playlistId?: string | null,
    contextId?: string | null,
    restart = false
  ): Promise<boolean> {
    const sameSong = this.state.activeSong?.id === song.id;
    const sameContext = contextId === undefined || this.state.activeContextId === contextId;
    if (!restart && sameSong && sameContext && this.authorizedSongId === song.id && audio.hasSource()) {
      if (Array.isArray(contextSongs) && contextSongs.length > 0) {
        const cleanContext = contextSongs.filter((s): s is Song => Boolean(s && s.id));
        const startIdx = cleanContext.findIndex((s) => s.id === song.id);
        const upcomingFromContext = startIdx >= 0 ? cleanContext.slice(startIdx) : [song, ...cleanContext];
        const upcomingIds = new Set(upcomingFromContext.map((s) => s.id));
        const unplayedCurrentQueue =
          this.state.queueIndex >= 0 ? this.state.queue.slice(this.state.queueIndex) : this.state.queue;
        const restOfQueue = unplayedCurrentQueue.filter((q) => q && !upcomingIds.has(q.id));
        const mergedQueue = [...upcomingFromContext, ...restOfQueue];
        this.setQueue(mergedQueue, 0, playlistId ?? null, contextId);
      }
      return await this.setPlaying(!this.state.isPlaying);
    }
    this.setActiveSong(song, contextSongs, playlistId, contextId, true);
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
    const remainingQueue = this.state.queue.slice(index);
    this.state = {
      ...this.state,
      queue: remainingQueue,
      queueIndex: 0,
    };
    this.persistQueue(remainingQueue);
    this.setActiveSong(targetSong, undefined, undefined, undefined, true);
    return await this.setPlaying(true);
  }

  public setQueue(
    songs: Song[],
    startIndex = 0,
    playlistId: string | null = null,
    contextId?: string | null
  ) {
    const clean = songs.filter((s): s is Song => Boolean(s && s.id));
    const clampedIdx = clean.length > 0 ? Math.min(Math.max(startIndex, 0), clean.length - 1) : -1;
    this.state = {
      ...this.state,
      queue: clean,
      queueIndex: clampedIdx,
      activePlaylistId: playlistId,
      activeContextId: contextId !== undefined ? contextId : this.state.activeContextId,
    };
    this.persistQueue(clean);
    this.notify();
  }

  public addToQueue(song: Song) {
    const exists = this.state.queue.some((s) => s.id === song.id);
    const nextQueue = exists ? [...this.state.queue] : [...this.state.queue, song];
    const nextIndex = this.state.queueIndex >= 0 ? this.state.queueIndex : 0;
    this.state = {
      ...this.state,
      queue: nextQueue,
      queueIndex: nextIndex,
    };
    this.persistQueue(nextQueue);
    this.notify();
    toast.success(exists ? `"${song.title}" is already in queue` : `Added "${song.title}" to queue`);
  }

  public removeFromQueue(index: number) {
    if (index < 0 || index >= this.state.queue.length) return;
    const removed = this.state.queue[index];
    const nextQueue = this.state.queue.filter((_, idx) => idx !== index);
    let nextIndex = this.state.queueIndex;

    if (index < nextIndex) {
      nextIndex--;
    } else if (index === nextIndex) {
      if (nextQueue.length === 0) {
        this.setActiveSong(null);
        this.state = { ...this.state, queue: [], queueIndex: -1 };
        this.persistQueue([]);
        this.notify();
        return;
      }
      nextIndex = Math.min(nextIndex, nextQueue.length - 1);
      const replacement = nextQueue[nextIndex];
      const wasPlaying = this.state.isPlaying;
      this.state = { ...this.state, queue: nextQueue, queueIndex: nextIndex };
      this.persistQueue(nextQueue);
      this.setActiveSong(replacement, undefined, undefined, undefined, true);
      if (wasPlaying) {
        void this.setPlaying(true);
      }
      return;
    }

    this.state = {
      ...this.state,
      queue: nextQueue,
      queueIndex: nextQueue.length === 0 ? -1 : nextIndex,
      activeSong: removed?.id === this.state.activeSong?.id && nextQueue.length === 0 ? null : this.state.activeSong,
    };
    this.persistQueue(nextQueue);
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
    const activeId = this.state.activeSong?.id;
    const [moved] = q.splice(fromIndex, 1);
    q.splice(targetToIndex, 0, moved);
    const nextIndex = activeId ? q.findIndex((s) => s.id === activeId) : this.state.queueIndex;
    this.state = {
      ...this.state,
      queue: q,
      queueIndex: nextIndex,
    };
    this.persistQueue(q);
    this.notify();
  }

  public clearQueue() {
    const active = this.state.activeSong;
    const nextQueue = active ? [active] : [];
    const nextIndex = active ? 0 : -1;
    this.state = {
      ...this.state,
      queue: nextQueue,
      queueIndex: nextIndex,
      activePlaylistId: null,
    };
    this.persistQueue(nextQueue);
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
      } catch {}
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
      } catch {}
    }
    this.notify();
  }

  public setAutoplay(autoplay: boolean) {
    this.state = { ...this.state, autoplay };
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEYS.autoplay, String(autoplay));
      } catch {}
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
      } catch {}
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
      } catch {}
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
      } catch {}
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
      } catch {}
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
