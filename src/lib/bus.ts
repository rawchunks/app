/**
 * Unified Audio Session Arbiter
 * Enforces mutual exclusion across playback domains (global player, DAW transport, cue preview)
 * to prevent conflicting audio streams, volume spikes, and Web Audio context lockups.
 */

export type AudioDomain = 'none' | 'player' | 'daw' | 'cue';

class AudioBus {
  private activeDomain: AudioDomain = 'none';
  private playerStopHandler: (() => void) | null = null;
  private dawStopHandler: (() => void) | null = null;
  private cueStopHandler: (() => void) | null = null;

  public registerPlayer(stop: () => void) {
    this.playerStopHandler = stop;
  }

  public registerDaw(stop: () => void) {
    this.dawStopHandler = stop;
  }

  public registerCue(stop: () => void) {
    this.cueStopHandler = stop;
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
