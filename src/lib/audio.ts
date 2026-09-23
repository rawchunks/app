class AudioEngine {
  private element: HTMLAudioElement;
  private isPlaying = false;
  private duration = 0;
  private pendingSeek: number | null = null;
  private pendingPlay = false;
  private onTimeUpdateCallback: ((time: number) => void) | null = null;
  private onDurationCallback: ((duration: number) => void) | null = null;
  private onEndCallback: (() => void) | null = null;

  constructor() {
    this.element = new Audio();
    this.element.crossOrigin = 'anonymous';
    this.element.preload = 'auto';

    this.element.addEventListener('timeupdate', () => {
      if (this.onTimeUpdateCallback) {
        this.onTimeUpdateCallback(this.element.currentTime);
      }
    });

    const updateDuration = () => {
      if (!isNaN(this.element.duration) && this.element.duration > 0 && isFinite(this.element.duration)) {
        this.duration = Math.round(this.element.duration);
        if (this.onDurationCallback) {
          this.onDurationCallback(this.duration);
        }
      }
      if (this.pendingSeek !== null && this.element.readyState >= 1) {
        const target = this.pendingSeek;
        this.pendingSeek = null;
        this.element.currentTime = target;
      }
    };

    this.element.addEventListener('loadedmetadata', updateDuration);
    this.element.addEventListener('durationchange', updateDuration);
    this.element.addEventListener('canplay', () => {
      updateDuration();
      if (this.pendingPlay) {
        this.pendingPlay = false;
        this.element.play().catch((err) => {
          console.warn('Playback interrupted:', err);
          this.isPlaying = false;
          if (this.onEndCallback) this.onEndCallback();
        });
      }
    });

    this.element.addEventListener('ended', () => {
      this.isPlaying = false;
      this.pendingPlay = false;
      if (this.onEndCallback) {
        this.onEndCallback();
      }
      if (this.onTimeUpdateCallback) {
        this.onTimeUpdateCallback(0);
      }
    });

    this.element.addEventListener('error', (e) => {
      console.error('Audio playback error', e);
      this.isPlaying = false;
      this.pendingPlay = false;
    });
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

  public load(url: string) {
    if (!url) return;
    try {
      const resolved = new URL(url, window.location.href).href;
      if (this.element.src === resolved) return;
    } catch {
      if (this.element.src === url) return;
    }
    this.element.src = url;
    this.element.load();
  }

  public play(offset = 0, duration = 0) {
    if (!this.element.src) {
      console.warn('AudioEngine: No audio source loaded to play.');
      return;
    }

    if (duration > 0) {
      this.duration = duration;
    }
    this.isPlaying = true;

    if (offset >= 0 && this.element.readyState >= 1) {
      if (Math.abs(this.element.currentTime - offset) > 0.5) {
        this.element.currentTime = offset;
      }
    } else if (offset > 0) {
      this.pendingSeek = offset;
    }

    if (this.element.readyState < 2) {
      // Audio is still loading data, set flag to auto-play when ready
      this.pendingPlay = true;
      return;
    }

    this.pendingPlay = false;
    const playPromise = this.element.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn('Playback interrupted or blocked by browser policy:', err);
        this.isPlaying = false;
        this.pendingPlay = false;
        if (this.onEndCallback) this.onEndCallback();
      });
    }
  }

  public pause() {
    this.isPlaying = false;
    this.pendingPlay = false;
    this.element.pause();
  }

  public seek(seconds: number) {
    if (isNaN(seconds)) return;
    const target = Math.max(0, seconds);
    if (this.element.readyState >= 1) {
      this.element.currentTime = target;
    } else {
      this.pendingSeek = target;
    }
    if (this.onTimeUpdateCallback) {
      this.onTimeUpdateCallback(target);
    }
  }

  public setVolume(val: number) {
    this.element.volume = Math.max(0, Math.min(1, val));
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getDuration(): number {
    return this.duration;
  }

  public hasSource(): boolean {
    return Boolean(this.element.src && this.element.src !== window.location.href);
  }
}

export const audio = new AudioEngine();
