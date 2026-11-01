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
  private isAutoOverlap = false;

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
   * Applies a smooth sine fade-in on start, or an equal-power (sin/cos) crossfade
   * when transitioning from an outgoing deck on manual switch or auto-advance.
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

      if (typeof requestAnimationFrame === 'undefined' || typeof performance === 'undefined') {
        try {
          incoming.volume = this.masterVolume;
        } catch {}
        return;
      }

      const fadeInMs = 140;
      const startTime = performance.now();
      const baseGain = this.masterVolume * 0.22;
      try {
        incoming.volume = Math.max(0, Math.min(1, baseGain));
      } catch {}

      const tickIn = (now: number) => {
        const t = Math.min(1, Math.max(0, (now - startTime) / fadeInMs));
        const inGain = baseGain + Math.sin(t * Math.PI * 0.5) * (this.masterVolume - baseGain);
        try {
          incoming.volume = Math.max(0, Math.min(1, inGain));
        } catch {}
        if (t < 1) {
          this.fadeRafId = requestAnimationFrame(tickIn);
        } else {
          this.fadeRafId = null;
          try {
            incoming.volume = this.masterVolume;
          } catch {}
        }
      };

      this.fadeRafId = requestAnimationFrame(tickIn);
      return;
    }

    const durationMs = this.isAutoOverlap ? 420 : 320;
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
    const startOutgoingVol = outgoing.volume > 0 ? outgoing.volume : this.masterVolume;
    try {
      incoming.volume = this.masterVolume * 0.18;
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
   * Swaps the active deck out and fades it down smoothly so the new activeDeck is
   * immediately isolated at 0s (zero stale timeupdate events) while avoiding sharp cuts.
   */
  public stopImmediate(hard = false) {
    this.trackSwitchId++;
    this.isAutoOverlap = false;

    if (
      !hard &&
      !this.activeDeck.paused &&
      this.activeDeck.currentTime > 0 &&
      typeof requestAnimationFrame !== 'undefined' &&
      typeof performance !== 'undefined'
    ) {
      if (this.fadeRafId !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(this.fadeRafId);
        this.fadeRafId = null;
      }
      if (this.fadeOutDeck && this.fadeOutDeck !== this.activeDeck) {
        try {
          this.fadeOutDeck.pause();
          this.fadeOutDeck.currentTime = 0;
          this.fadeOutDeck.volume = 0;
        } catch {}
      }

      const outgoing = this.activeDeck;
      this.activeDeck = this.standbyDeck;
      this.standbyDeck = outgoing;
      this.fadeOutDeck = outgoing;

      this.resetting = true;
      this.isPlaying = false;
      this.pendingPlay = false;
      this.pendingSeek = 0;
      try {
        this.activeDeck.pause();
        this.activeDeck.currentTime = 0;
      } catch {}
      this.resetting = false;

      const startTime = performance.now();
      const startVol = outgoing.volume > 0 ? outgoing.volume : this.masterVolume;
      const fadeOutMs = 300;
      const tickOut = (now: number) => {
        if (this.fadeOutDeck !== outgoing) return;
        const t = Math.min(1, Math.max(0, (now - startTime) / fadeOutMs));
        const outGain = Math.cos(t * Math.PI * 0.5) * startVol;
        try {
          outgoing.volume = Math.max(0, Math.min(1, outGain));
        } catch {}
        if (t < 1) {
          this.fadeRafId = requestAnimationFrame(tickOut);
        } else {
          this.fadeRafId = null;
          try {
            outgoing.pause();
            outgoing.currentTime = 0;
            outgoing.volume = 0;
          } catch {}
          if (this.fadeOutDeck === outgoing) {
            this.fadeOutDeck = null;
          }
        }
      };
      this.fadeRafId = requestAnimationFrame(tickOut);
      return;
    }

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
    this.stopImmediate(true);
    this.duration = 0;
  }

  public load(url: string, allowAutoOverlap = false) {
    if (!url) return;
    this.trackSwitchId++;
    this.isAutoOverlap = allowAutoOverlap;
    const resolved = resolveUrl(url);
    const activeResolved = resolveUrl(this.activeDeck.src);

    if (!this.activeDeck.paused && Boolean(activeResolved) && activeResolved !== resolved) {
      if (this.fadeOutDeck && this.fadeOutDeck !== this.activeDeck) {
        try {
          this.fadeOutDeck.pause();
          this.fadeOutDeck.currentTime = 0;
          this.fadeOutDeck.volume = 0;
        } catch {}
      }
      const previousDeck = this.activeDeck;
      this.activeDeck = this.standbyDeck;
      this.standbyDeck = previousDeck;
      this.fadeOutDeck = previousDeck;
    } else if (!this.fadeOutDeck || this.fadeOutDeck.paused) {
      this.cancelActiveFade();
    }

    this.resetting = true;
    this.isPlaying = false;
    this.pendingPlay = false;
    this.pendingSeek = 0;
    this.duration = 0;

    const currentActiveResolved = resolveUrl(this.activeDeck.src);
    const currentStandbyResolved = resolveUrl(this.standbyDeck.src);

    if (currentActiveResolved === resolved) {
      try {
        this.activeDeck.pause();
        this.activeDeck.currentTime = 0;
      } catch {}
      this.resetting = false;
      return;
    }

    if (currentStandbyResolved === resolved && this.fadeOutDeck !== this.standbyDeck) {
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
    const startTime = performance.now();
    const startVol = el.volume > 0 ? el.volume : this.masterVolume;
    const fadeOutMs = 120;
    const tickPause = (now: number) => {
      if (this.isPlaying || this.activeDeck !== el) return;
      const t = Math.min(1, Math.max(0, (now - startTime) / fadeOutMs));
      const outGain = Math.cos(t * Math.PI * 0.5) * startVol;
      try {
        el.volume = Math.max(0, Math.min(1, outGain));
      } catch {}
      if (t < 1) {
        this.fadeRafId = requestAnimationFrame(tickPause);
      } else {
        this.fadeRafId = null;
        try {
          el.pause();
          el.volume = this.masterVolume;
        } catch {}
      }
    };
    this.fadeRafId = requestAnimationFrame(tickPause);
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

  public position(): number | null {
    return this.pendingSeek === null && !this.resetting ? this.activeDeck.currentTime : null;
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
