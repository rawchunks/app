/**
 * Unified Audio Session Arbiter & Cross-Tab Synchronizer
 * Enforces mutual exclusion across playback domains (global player, DAW transport, cue preview)
 * and across browser tabs via BroadcastChannel('rawchunks:sync').
 */

import type { Song } from './schema';

export type AudioDomain = 'none' | 'player' | 'daw' | 'cue';

export type CrossTabEvent =
  | { type: 'claim'; tabId: string; domain: AudioDomain }
  | { type: 'playback'; tabId: string; song: Song | null; playhead: number; duration: number; isPlaying: boolean }
  | { type: 'logout'; tabId: string }
  | { type: 'account_switch'; tabId: string; address: string };

class AudioBus {
  private activeDomain: AudioDomain = 'none';
  private playerStopHandler: (() => void) | null = null;
  private dawStopHandler: (() => void) | null = null;
  private cueStopHandler: (() => void) | null = null;
  private playbackSyncHandler: ((payload: { song: Song | null; playhead: number; duration: number; isPlaying: boolean }) => void) | null = null;
  private logoutHandlers: Set<() => void> = new Set();
  private accountSwitchHandlers: Set<(address: string) => void> = new Set();
  private channel: BroadcastChannel | null = null;
  private readonly tabId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}`;

  constructor() {
    if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel('rawchunks:sync');
        this.channel.onmessage = (event: MessageEvent<CrossTabEvent>) => {
          const msg = event.data;
          if (!msg || msg.tabId === this.tabId) return;
          if (msg.type === 'claim' && msg.domain !== 'none') {
            this.stopAllLocal();
          } else if (msg.type === 'playback') {
            if (msg.isPlaying) {
              this.stopAllLocal();
            }
            this.playbackSyncHandler?.({
              song: msg.song,
              playhead: msg.playhead,
              duration: msg.duration,
              isPlaying: msg.isPlaying,
            });
          } else if (msg.type === 'logout') {
            this.stopAllLocal();
            this.logoutHandlers.forEach((cb) => cb());
          } else if (msg.type === 'account_switch') {
            this.stopAllLocal();
            this.accountSwitchHandlers.forEach((cb) => cb(msg.address));
          }
        };
      } catch { }
    }
  }

  private stopAllLocal() {
    this.playerStopHandler?.();
    this.dawStopHandler?.();
    this.cueStopHandler?.();
    this.activeDomain = 'none';
  }

  public registerPlayer(stop: () => void) {
    this.playerStopHandler = stop;
  }

  public registerDaw(stop: () => void) {
    this.dawStopHandler = stop;
  }

  public registerCue(stop: () => void) {
    this.cueStopHandler = stop;
  }

  public registerPlaybackSync(handler: (payload: { song: Song | null; playhead: number; duration: number; isPlaying: boolean }) => void) {
    this.playbackSyncHandler = handler;
  }

  public onRemoteLogout(handler: () => void): () => void {
    this.logoutHandlers.add(handler);
    return () => this.logoutHandlers.delete(handler);
  }

  public onRemoteAccountSwitch(handler: (address: string) => void): () => void {
    this.accountSwitchHandlers.add(handler);
    return () => this.accountSwitchHandlers.delete(handler);
  }

  public broadcastPlayback(song: Song | null, playhead: number, duration: number, isPlaying: boolean) {
    try {
      this.channel?.postMessage({
        type: 'playback',
        tabId: this.tabId,
        song,
        playhead,
        duration,
        isPlaying,
      } satisfies CrossTabEvent);
      if (typeof window !== 'undefined') {
        if (song) {
          localStorage.setItem(
            'rawchunks:playback',
            JSON.stringify({ song, playhead, duration, updatedAt: Date.now() }),
          );
        } else {
          localStorage.removeItem('rawchunks:playback');
        }
      }
    } catch { }
  }

  public broadcastLogout() {
    try {
      this.channel?.postMessage({
        type: 'logout',
        tabId: this.tabId,
      } satisfies CrossTabEvent);
    } catch { }
  }

  public broadcastAccountSwitch(address: string) {
    try {
      this.channel?.postMessage({
        type: 'account_switch',
        tabId: this.tabId,
        address,
      } satisfies CrossTabEvent);
    } catch { }
  }

  public request(domain: AudioDomain) {
    if (domain === 'daw') {
      if (this.activeDomain === 'player') {
        this.playerStopHandler?.();
      }
      this.cueStopHandler?.();
    } else if (domain === 'player') {
      if (this.activeDomain === 'daw') {
        this.dawStopHandler?.();
      }
      this.cueStopHandler?.();
    } else if (domain === 'cue') {
      this.cueStopHandler?.();
    } else if (domain === 'none') {
      this.playerStopHandler?.();
      this.dawStopHandler?.();
      this.cueStopHandler?.();
    }

    this.activeDomain = domain;
    if (domain !== 'none') {
      try {
        this.channel?.postMessage({
          type: 'claim',
          tabId: this.tabId,
          domain,
        } satisfies CrossTabEvent);
      } catch { }
    }
  }

  public release(domain: AudioDomain) {
    if (this.activeDomain === domain) {
      this.activeDomain = 'none';
    }
  }

  public getDomain(): AudioDomain {
    return this.activeDomain;
  }
}

export const bus = new AudioBus();
