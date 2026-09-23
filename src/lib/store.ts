import { Song, Track } from './schema';
import { audio } from './audio';
import { bus } from './bus';

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
}

type Listener = (state: State) => void;

class Store {
  private state: State;
  private listeners: Set<Listener> = new Set();

  constructor() {
    this.state = {
      songs: [],
      tracks: [],
      activeSong: null,
      editingSong: null,
      isPlaying: false,
      playhead: 0,
      duration: 0,
      selection: null,
      isGenerating: false,
      userAddress: '',
    };

    bus.registerPlayer(() => {
      if (this.state.isPlaying) {
        this.state = { ...this.state, isPlaying: false };
        audio.pause();
        this.notify();
      }
    });

    audio.setOnTimeUpdate((time) => {
      this.state = { ...this.state, playhead: time };
      this.notify();
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
      this.state = { ...this.state, isPlaying: false, playhead: 0 };
      this.notify();
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
    if (song.url) {
      audio.load(song.url);
    }
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
    audio.pause();
    const dur = typeof song?.duration === 'number' && song.duration > 0 ? song.duration : 0;
    this.state = {
      ...this.state,
      activeSong: song,
      duration: dur,
      playhead: 0,
      isPlaying: false,
    };
    if (song && song.url) {
      audio.load(song.url);
    }
    this.notify();
  }

  public setEditingSong(song: Song | null) {
    this.state = {
      ...this.state,
      editingSong: song,
      selection: song && song.duration ? { start: 0, end: Math.min(30, song.duration) } : null,
    };
    this.notify();
  }

  public setPlaying(isPlaying: boolean) {
    if (isPlaying) {
      const url = this.state.activeSong?.url;
      if (!url && !audio.hasSource()) {
        console.warn('Playback prevented: No audio URL available for song');
        return;
      }
      bus.request('player');
      if (url && !audio.hasSource()) {
        audio.load(url);
      }
      this.state = { ...this.state, isPlaying: true };
      audio.play(this.state.playhead, this.state.duration);
    } else {
      bus.release('player');
      this.state = { ...this.state, isPlaying: false };
      audio.pause();
    }
    this.notify();
  }

  public setPlayhead(time: number) {
    this.state = { ...this.state, playhead: time };
    audio.seek(time);
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

  public setUserAddress(userAddress: string) {
    this.state = { ...this.state, userAddress };
    this.notify();
  }
}

export const store = new Store();
