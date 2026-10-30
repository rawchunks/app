function createAudioElement(): HTMLAudioElement {
  const el =
    typeof Audio !== 'undefined'
      ? new Audio()
      : ({
          crossOrigin: '',
          preload: '',
          currentTime: 0,
          duration: 0,
          readyState: 0,
          volume: 1,
          paused: true,
          src: '',
          addEventListener: () => {},
          removeAttribute: () => {},
          load: () => {},
          pause: () => {},
          play: async () => {},
        } as unknown as HTMLAudioElement);
  el.crossOrigin = 'anonymous';
  el.preload = 'auto';
  return el;
}

function resolveUrl(url: string): string {
  if (!url) return '';
  try {
    return typeof window !== 'undefined' ? new URL(url, window.location.href).href : url;
  } catch {
    return url;
  }
}

class AudioEngine {
  private deckA: HTMLAudioElement;
  private deckB: HTMLAudioElement;
  private activeDeck: HTMLAudioElement;
  private standbyDeck: HTMLAudioElement;

  private isPlaying = false;
  private duration = 0;
  private masterVolume = 1;
  private pendingSeek: number | null = null;
  private pendingPlay = false;
  private resetting = false;
  private trackSwitchId = 0;
  private fadeRafId: number | null = null;
  private fadeOutDeck: HTMLAudioElement | null = null;

  private onTimeUpdateCallback: ((time: number) => void) | null = null;
  private onDurationCallback: ((duration: number) => void) | null = null;
  private onEndCallback: (() => void) | null = null;

  constructor() {
    this.deckA = createAudioElement();
    this.deckB = createAudioElement();
    this.activeDeck = this.deckA;
    this.standbyDeck = this.deckB;

    this.attachDeckListeners(this.deckA);
    this.attachDeckListeners(this.deckB);
  }

  private attachDeckListeners(deck: HTMLAudioElement) {
    deck.addEventListener('timeupdate', () => {
      if (
        deck !== this.activeDeck ||
        !this.isPlaying ||
        this.resetting ||
        deck.paused ||
        this.pendingSeek !== null
      ) {
        return;
      }
      if (this.onTimeUpdateCallback) {
        this.onTimeUpdateCallback(deck.currentTime);
      }
    });

    const applyPendingSeekAndDuration = () => {
      if (deck !== this.activeDeck || this.resetting) return;
      if (!isNaN(deck.duration) && deck.duration > 0 && isFinite(deck.duration)) {
        this.duration = Math.round(deck.duration);
        if (this.onDurationCallback) {
          this.onDurationCallback(this.duration);
        }
      }
      if (this.pendingSeek !== null && deck.readyState >= 1) {
        const target = this.pendingSeek;
        this.pendingSeek = null;
        try {
          deck.currentTime = target;
        } catch {}
      }
    };

    deck.addEventListener('loadedmetadata', applyPendingSeekAndDuration);
    deck.addEventListener('durationchange', applyPendingSeekAndDuration);
    deck.addEventListener('canplay', () => {
      if (deck !== this.activeDeck || this.resetting) return;
      applyPendingSeekAndDuration();
      if (this.pendingPlay && this.isPlaying && deck.paused) {
        this.pendingPlay = false;
        this.startDeckEnvelope(deck);
        const playPromise = deck.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            console.warn('Playback interrupted:', err);
            this.isPlaying = false;
            if (this.onEndCallback) this.onEndCallback();
          });
        }
      }
    });

    deck.addEventListener('ended', () => {
      if (deck === this.fadeOutDeck) {
        try {
          deck.pause();
          deck.currentTime = 0;
          deck.volume = 0;
        } catch {}
        this.fadeOutDeck = null;
        return;
      }
      if (deck !== this.activeDeck) return;
      this.isPlaying = false;
      this.pendingPlay = false;
      if (this.onEndCallback) {
        this.onEndCallback();
      }
      if (this.onTimeUpdateCallback) {
        this.onTimeUpdateCallback(0);
      }
    });

    deck.addEventListener('error', (e) => {
      if (deck !== this.activeDeck) return;
      console.error('Audio playback error', e);
      this.isPlaying = false;
      this.pendingPlay = false;
    });
  }

  private cancelActiveFade() {
    if (this.fadeRafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.fadeRafId);
      this.fadeRafId = null;
    }
    if (this.fadeOutDeck) {
      try {
        this.fadeOutDeck.pause();
        this.fadeOutDeck.currentTime = 0;
        this.fadeOutDeck.volume = 0;
      } catch {}
      this.fadeOutDeck = null;
    }
  }

  /**
   * Applies an imperceptible 12ms (single-frame) zero-crossing anti-click ramp on start,
   * or a tight 60ms overlap only when auto-advancing into a pre-buffered standby deck.
   */
  private startDeckEnvelope(incoming: HTMLAudioElement) {
    if (this.fadeRafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.fadeRafId);
      this.fadeRafId = null;
    }

    const outgoing =
      this.fadeOutDeck && this.fadeOutDeck !== incoming && !this.fadeOutDeck.paused
        ? this.fadeOutDeck
        : null;

    if (!outgoing) {
      if (this.fadeOutDeck && this.fadeOutDeck !== incoming) {
        try {
          this.fadeOutDeck.pause();
          this.fadeOutDeck.currentTime = 0;
          this.fadeOutDeck.volume = 0;
        } catch {}
      }
      this.fadeOutDeck = null;

      // Single-frame (12ms) zero-crossing de-click: starts at 88% gain and reaches 100% on next frame.
      // Preserves 100% of the opening transient/kick with zero audible fade-in.
      if (typeof requestAnimationFrame === 'undefined' || typeof performance === 'undefined') {
        try {
          incoming.volume = this.masterVolume;
        } catch {}
        return;
      }

      const initialGain = this.masterVolume * 0.88;
      try {
        incoming.volume = Math.max(0, Math.min(1, initialGain));
      } catch {}

      this.fadeRafId = requestAnimationFrame(() => {
        this.fadeRafId = null;
        try {
          incoming.volume = this.masterVolume;
        } catch {}
      });
      return;
    }

    // Pre-buffered auto-advance overlap (60ms gapless handoff)
    const durationMs = 60;
    if (typeof requestAnimationFrame === 'undefined' || typeof performance === 'undefined') {
      try {
        incoming.volume = this.masterVolume;
        outgoing.pause();
        outgoing.currentTime = 0;
        outgoing.volume = 0;
      } catch {}
      this.fadeOutDeck = null;
      return;
    }

    const startTime = performance.now();
    const startOutgoingVol = outgoing.volume;
    try {
      incoming.volume = this.masterVolume * 0.5;
    } catch {}

    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - startTime) / durationMs));
      const angle = t * Math.PI * 0.5;
      const inGain = Math.sin(angle) * this.masterVolume;
      const outGain = Math.cos(angle) * startOutgoingVol;

      try {
        incoming.volume = Math.max(0, Math.min(1, inGain));
        outgoing.volume = Math.max(0, Math.min(1, outGain));
      } catch {}

      if (t < 1) {
        this.fadeRafId = requestAnimationFrame(tick);
      } else {
        this.fadeRafId = null;
        try {
          incoming.volume = this.masterVolume;
          outgoing.pause();
          outgoing.currentTime = 0;
          outgoing.volume = 0;
        } catch {}
        this.fadeOutDeck = null;
      }
    };

    this.fadeRafId = requestAnimationFrame(tick);
  }

  public setOnTimeUpdate(cb: (time: number) => void) {
    this.onTimeUpdateCallback = cb;
  }

  public setOnDuration(cb: (duration: number) => void) {
    this.onDurationCallback = cb;
  }

  public setOnEnd(cb: () => void) {
    this.onEndCallback = cb;
  }

  public preloadNext(url: string) {
    if (!url) return;
    const resolved = resolveUrl(url);
    if (!resolved) return;
    if (resolveUrl(this.standbyDeck.src) === resolved) return;
    if (this.fadeOutDeck === this.standbyDeck) return;
    try {
      this.standbyDeck.pause();
      this.standbyDeck.volume = 0;
      this.standbyDeck.currentTime = 0;
      this.standbyDeck.src = url;
      this.standbyDeck.load();
    } catch {}
  }

  /**
   * Immediately stops any playing deck at 0ms when switching tracks so the old track
   * never lingers or emits stale timeupdate events.
   */
  public stopImmediate() {
    this.trackSwitchId++;
    this.cancelActiveFade();
    this.resetting = true;
    this.isPlaying = false;
    this.pendingPlay = false;
    this.pendingSeek = 0;
    try {
      this.activeDeck.pause();
      this.activeDeck.currentTime = 0;
    } catch {}
    try {
      this.standbyDeck.pause();
      this.standbyDeck.currentTime = 0;
    } catch {}
    this.resetting = false;
  }

  public reset() {
    this.stopImmediate();
    this.duration = 0;
  }

  public load(url: string, allowAutoOverlap = false) {
    if (!url) return;
    this.trackSwitchId++;
    const resolved = resolveUrl(url);
    const activeResolved = resolveUrl(this.activeDeck.src);
    const standbyResolved = resolveUrl(this.standbyDeck.src);

    // Gapless handoff ONLY when auto-advancing at end of track AND standbyDeck is already buffered
    const canGaplessSwap =
      allowAutoOverlap &&
      !this.activeDeck.paused &&
      Boolean(activeResolved) &&
      activeResolved !== resolved &&
      standbyResolved === resolved &&
      this.standbyDeck.readyState >= 3;

    if (canGaplessSwap) {
      if (this.fadeOutDeck && this.fadeOutDeck !== this.activeDeck) {
        try {
          this.fadeOutDeck.pause();
          this.fadeOutDeck.currentTime = 0;
          this.fadeOutDeck.volume = 0;
        } catch {}
      }
      const previousDeck = this.activeDeck;
      const nextDeck = this.standbyDeck;
      this.activeDeck = nextDeck;
      this.standbyDeck = previousDeck;

      this.resetting = true;
      this.pendingPlay = false;
      this.pendingSeek = 0;
      this.duration = 0;
      try {
        this.activeDeck.currentTime = 0;
      } catch {}
      this.resetting = false;
      this.fadeOutDeck = previousDeck;
      return;
    }

    // Immediate cut of any outgoing audio
    this.cancelActiveFade();
    this.resetting = true;
    this.isPlaying = false;
    this.pendingPlay = false;
    this.pendingSeek = 0;
    this.duration = 0;

    if (activeResolved === resolved) {
      try {
        this.activeDeck.pause();
        this.activeDeck.currentTime = 0;
      } catch {}
      this.resetting = false;
      return;
    }

    if (standbyResolved === resolved) {
      try {
        this.activeDeck.pause();
        this.activeDeck.currentTime = 0;
      } catch {}
      const prev = this.activeDeck;
      this.activeDeck = this.standbyDeck;
      this.standbyDeck = prev;
      try {
        this.activeDeck.pause();
        this.activeDeck.currentTime = 0;
      } catch {}
      this.resetting = false;
      return;
    }

    try {
      this.activeDeck.pause();
      this.activeDeck.currentTime = 0;
    } catch {}
    this.activeDeck.src = url;
    this.activeDeck.load();
    this.resetting = false;
  }

  public play(offset = 0, duration = 0) {
    if (!this.activeDeck.src) {
      console.warn('AudioEngine: No audio source loaded to play.');
      return;
    }

    if (duration > 0) {
      this.duration = duration;
    }
    this.isPlaying = true;
    this.pendingPlay = false;

    const targetOffset = Math.max(0, offset);
    if (this.activeDeck.readyState >= 1) {
      this.pendingSeek = null;
      if (targetOffset === 0 || Math.abs(this.activeDeck.currentTime - targetOffset) > 0.05) {
        try {
          this.activeDeck.currentTime = targetOffset;
        } catch {}
      }
    } else {
      this.pendingSeek = targetOffset;
    }

    this.startDeckEnvelope(this.activeDeck);

    const currentSwitchId = this.trackSwitchId;
    const deck = this.activeDeck;
    const playPromise = deck.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        if (currentSwitchId !== this.trackSwitchId || deck !== this.activeDeck || !this.isPlaying) {
          return;
        }
        // If browser deferred play because media is still loading initial metadata, arm canplay fallback
        if (deck.readyState < 2) {
          this.pendingPlay = true;
          return;
        }
        console.warn('Playback interrupted or blocked by browser policy:', err);
        this.isPlaying = false;
        this.pendingPlay = false;
        if (this.onEndCallback) this.onEndCallback();
      });
    }
  }

  public pause() {
    this.cancelActiveFade();
    this.isPlaying = false;
    this.pendingPlay = false;
    const el = this.activeDeck;
    if (
      el.paused ||
      typeof requestAnimationFrame === 'undefined' ||
      typeof performance === 'undefined'
    ) {
      try {
        el.pause();
        el.volume = this.masterVolume;
      } catch {}
      return;
    }
    // Single-frame zero-crossing de-click before pause
    try {
      el.volume = Math.max(0, el.volume * 0.25);
    } catch {}
    this.fadeRafId = requestAnimationFrame(() => {
      this.fadeRafId = null;
      if (this.isPlaying) return;
      try {
        el.pause();
        el.volume = this.masterVolume;
      } catch {}
    });
  }

  public seek(seconds: number) {
    if (isNaN(seconds)) return;
    const target = Math.max(0, seconds);
    if (this.activeDeck.readyState >= 1) {
      this.pendingSeek = null;
      try {
        this.activeDeck.currentTime = target;
      } catch {}
    } else {
      this.pendingSeek = target;
    }
    if (this.onTimeUpdateCallback) {
      this.onTimeUpdateCallback(target);
    }
  }

  public setVolume(val: number) {
    this.masterVolume = Math.max(0, Math.min(1, val));
    if (this.fadeRafId === null) {
      try {
        this.activeDeck.volume = this.masterVolume;
      } catch {}
    }
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getDuration(): number {
    return this.duration;
  }

  public hasSource(): boolean {
    return Boolean(this.activeDeck.src && this.activeDeck.src !== window.location.href);
  }
}

export const audio = new AudioEngine();
