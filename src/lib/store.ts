import { Song, Track } from './schema';
import { audio } from './audio';
import { bus } from './bus';
import { sdk, hasStreamBudget, hasPromoCreditsOnly } from './sdk';
import { toast } from 'sonner';
import { openGate, type GateOptions } from './gate';

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
}

type Listener = (state: State) => void;

class Store {
  private state: State;
  private listeners: Set<Listener> = new Set();
  private authorizedSongId: string | null = null;
  private isExemptCreator: boolean = false;
  private playRequestId: number = 0;
  private streamResumeArmed = false;
  private currentPaymentIntentId: string | null = null;
  private accumulatedListenedSeconds: number = 0;
  private lastReportedSeconds: number = 0;
  private lastPlayhead: number = 0;
  private lastBroadcastAt: number = 0;

  constructor() {
    let initialSong: Song | null = null;
    let initialPlayhead = 0;
    let initialDuration = 0;
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('rawchunks:playback');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.song && typeof parsed.song.id === 'string') {
            initialSong = parsed.song as Song;
            initialPlayhead = typeof parsed.playhead === 'number' && parsed.playhead >= 0 ? parsed.playhead : 0;
            initialDuration = typeof parsed.duration === 'number' && parsed.duration > 0 ? parsed.duration : (initialSong.duration || 0);
          }
        }
      } catch { }
    }

    this.state = {
      songs: [],
      tracks: [],
      activeSong: initialSong,
      editingSong: null,
      isPlaying: false,
      playhead: initialPlayhead,
      duration: initialDuration,
      selection: null,
      isGenerating: false,
      userAddress: '',
      evmAddress: null,
      svmAddress: null,
    };

    bus.registerPlayer(() => {
      if (this.state.isPlaying) {
        this.playRequestId++;
        this.state = { ...this.state, isPlaying: false };
        audio.pause();
        this.notify();
        void this.reportStreamCheckpoint(false);
      }
    });

    bus.registerPlaybackSync(({ song, playhead, duration }) => {
      if (this.state.isPlaying) {
        this.playRequestId++;
        audio.pause();
      }
      const songChanged = this.state.activeSong?.id !== song?.id;
      if (songChanged) {
        this.authorizedSongId = null;
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
      this.state = { ...this.state, playhead: time };
      this.notify();
      const now = Date.now();
      if (this.state.isPlaying && this.state.activeSong && now - this.lastBroadcastAt >= 1000) {
        this.lastBroadcastAt = now;
        bus.broadcastPlayback(this.state.activeSong, time, this.state.duration, true);
      }

      if (this.state.isPlaying && !this.isExemptCreator) {
        if (this.lastPlayhead > 0 && time > this.lastPlayhead && (time - this.lastPlayhead) < 5) {
          this.accumulatedListenedSeconds += (time - this.lastPlayhead);
        }
        this.lastPlayhead = time;

        // Checkpoint every 20 seconds of playback
        if (this.accumulatedListenedSeconds - this.lastReportedSeconds >= 20) {
          void this.reportStreamCheckpoint(false);
        }
      } else {
        this.lastPlayhead = time;
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
      void this.reportStreamCheckpoint(true);
      this.currentPaymentIntentId = null;
      this.accumulatedListenedSeconds = 0;
      this.lastReportedSeconds = 0;
      this.lastPlayhead = 0;
      this.state = { ...this.state, isPlaying: false, playhead: 0 };
      this.notify();
    });
  }

  private async reportStreamCheckpoint(isTerminal = false) {
    if (this.isExemptCreator || !this.currentPaymentIntentId || !this.authorizedSongId) {
      return;
    }

    const listenedSeconds = Math.round(this.accumulatedListenedSeconds);
    if (listenedSeconds <= this.lastReportedSeconds && !isTerminal) {
      return;
    }
    if (listenedSeconds <= 0) {
      return;
    }

    const songId = this.authorizedSongId;
    const paymentIntentId = this.currentPaymentIntentId;
    this.lastReportedSeconds = listenedSeconds;

    try {
      const res = await sdk.fetch(`/api/songs/${songId}/stream/checkpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentIntentId,
          listenedSeconds,
          terminal: isTerminal,
        }),
      });

      if (res.status === 402) {
        audio.pause();
        this.state = { ...this.state, isPlaying: false };
        this.notify();
        this.resumeAfterGate({ steps: ['funding'], reason: 'Session budget exhausted', force: true });
      }
    } catch (err) {
      console.warn('[Stream Checkpoint] Failed to report checkpoint:', err);
    }
  }

  private resumeAfterGate(options: GateOptions): void {
    void openGate(options).then(ready => {
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
    this.state = {
      ...this.state,
      songs,
    };
    this.notify();
  }

  public addSong(song: Song) {
    const dur = typeof song.duration === 'number' && song.duration > 0 ? song.duration : 0;
    this.state = {
      ...this.state,
      songs: [song, ...this.state.songs],
      activeSong: song,
      duration: dur,
      playhead: 0,
      isPlaying: false,
    };
    this.notify();
  }

  public updateSong(id: string, updates: Partial<Song>) {
    this.state = {
      ...this.state,
      songs: this.state.songs.map((s) => (s.id === id ? { ...s, ...updates } : s)),
      tracks: this.state.tracks.map(track => track.song.id === id ? { ...track, song: { ...track.song, ...updates } } : track),
      activeSong: this.state.activeSong?.id === id ? { ...this.state.activeSong, ...updates } : this.state.activeSong,
      editingSong: this.state.editingSong?.id === id ? { ...this.state.editingSong, ...updates } : this.state.editingSong,
    };
    this.notify();
  }

  public deleteSong(id: string) {
    this.state = {
      ...this.state,
      songs: this.state.songs.filter((s) => s.id !== id),
      activeSong: this.state.activeSong?.id === id ? null : this.state.activeSong,
      editingSong: this.state.editingSong?.id === id ? null : this.state.editingSong,
    };
    this.notify();
  }

  public togglePublic(id: string) {
    const song = this.state.songs.find((s) => s.id === id);
    if (!song) return;
    this.updateSong(id, { public: !song.public });
  }

  public setActiveSong(song: Song | null) {
    if (this.currentPaymentIntentId && this.accumulatedListenedSeconds > this.lastReportedSeconds) {
      void this.reportStreamCheckpoint(true);
    }
    this.playRequestId++;
    audio.reset();
    this.authorizedSongId = null;
    this.isExemptCreator = false;
    this.currentPaymentIntentId = null;
    this.accumulatedListenedSeconds = 0;
    this.lastReportedSeconds = 0;
    this.lastPlayhead = 0;
    const dur = typeof song?.duration === 'number' && song.duration > 0 ? song.duration : 0;
    this.state = {
      ...this.state,
      activeSong: song,
      duration: dur,
      playhead: 0,
      isPlaying: false,
    };
    this.notify();
    bus.broadcastPlayback(song, 0, dur, false);
  }

  public clearUserWorkspace(broadcast = false) {
    if (this.currentPaymentIntentId && this.accumulatedListenedSeconds > this.lastReportedSeconds) {
      void this.reportStreamCheckpoint(true);
    }
    this.playRequestId++;
    audio.reset();
    bus.release('player');
    this.authorizedSongId = null;
    this.isExemptCreator = false;
    this.currentPaymentIntentId = null;
    this.accumulatedListenedSeconds = 0;
    this.lastReportedSeconds = 0;
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

    const candidates = new Set<string>();

    if (this.state.userAddress) candidates.add(this.state.userAddress.trim());
    if (this.state.evmAddress) candidates.add(this.state.evmAddress.trim());
    if (this.state.svmAddress) candidates.add(this.state.svmAddress.trim());

    const sdkWallet = sdk.wallets.current()?.address;
    if (sdkWallet) candidates.add(sdkWallet.trim());

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

  public async setPlaying(isPlaying: boolean): Promise<boolean> {
    if (!isPlaying) {
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

    const isCreator = this.isCreatorOfSong(song);

    if (this.authorizedSongId === song.id && audio.hasSource()) {
      bus.request('player');
      this.state = { ...this.state, isPlaying: true };
      this.lastPlayhead = this.state.playhead || 0;
      audio.play(this.state.playhead, this.state.duration);
      this.notify();
      bus.broadcastPlayback(song, this.state.playhead, this.state.duration, true);
      return true;
    }

    if (isCreator && song.url && !song.url.endsWith('/stream')) {
      this.authorizedSongId = song.id;
      this.isExemptCreator = true;
      this.currentPaymentIntentId = null;
      this.accumulatedListenedSeconds = 0;
      this.lastReportedSeconds = 0;
      this.lastPlayhead = this.state.playhead || 0;
      audio.load(song.url);
      bus.request('player');
      this.state = { ...this.state, isPlaying: true };
      audio.play(this.state.playhead, this.state.duration);
      this.notify();
      bus.broadcastPlayback(song, this.state.playhead, this.state.duration, true);
      return true;
    }

    const token = sdk.keys.currentToken();
    if (!isCreator && !token && !hasStreamBudget()) {
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

    const requestId = ++this.playRequestId;
    const targetSongId = song.id;
    const effectiveUserAddress = this.state.userAddress || this.state.evmAddress || this.state.svmAddress || sdk.wallets.current()?.address || '';

    try {
      const response = await sdk.fetch(`/api/songs/${song.id}/stream`, {
        userAddress: effectiveUserAddress || undefined,
        headers: {
          'Accept': 'application/json',
          ...(effectiveUserAddress ? { 'x-session-user-address': effectiveUserAddress } : {}),
        },
      });

      if (requestId !== this.playRequestId || this.state.activeSong?.id !== targetSongId) {
        return false;
      }

      if (response.status === 402) {
        this.state = { ...this.state, isPlaying: false };
        this.notify();
        this.resumeAfterGate({ steps: ['login', 'funding'], reason: 'Session budget exhausted', force: true });
        return false;
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        toast.error(errData.error || `Stream authorization failed (${response.status})`);
        this.state = { ...this.state, isPlaying: false };
        this.notify();
        return false;
      }

      const data = await response.json();
      if (requestId !== this.playRequestId || this.state.activeSong?.id !== targetSongId) {
        return false;
      }
      if (!data.url) {
        toast.error('Audio stream URL not returned by server');
        this.state = { ...this.state, isPlaying: false };
        this.notify();
        return false;
      }

      this.authorizedSongId = song.id;
      this.isExemptCreator = Boolean(data.isCreator);
      this.currentPaymentIntentId = data.paymentIntentId || null;
      this.accumulatedListenedSeconds = 0;
      this.lastReportedSeconds = 0;
      this.lastPlayhead = this.state.playhead || 0;

      audio.load(data.url);
      bus.request('player');
      this.state = { ...this.state, isPlaying: true };
      audio.play(this.state.playhead, this.state.duration);
      this.notify();
      bus.broadcastPlayback(song, this.state.playhead, this.state.duration, true);
      return true;
    } catch (err: any) {
      if (requestId !== this.playRequestId) return false;
      toast.error(err?.message || 'Failed to authorize stream playback');
      this.state = { ...this.state, isPlaying: false };
      this.notify();
      return false;
    }
  }

  public setPlayhead(time: number) {
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
