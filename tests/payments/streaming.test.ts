// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { store } from '@/lib/store';
import { audio } from '@/lib/audio';
import { sdk } from '@/lib/sdk';
import { closeGate, GATE_EVENT } from '@/lib/gate';

vi.mock('@/lib/audio', () => ({
  audio: {
    load: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    reset: vi.fn(),
    setVolume: vi.fn(),
    hasSource: vi.fn(() => false),
    setOnTimeUpdate: vi.fn(),
    setOnDuration: vi.fn(),
    setOnEnd: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

describe('Streaming Session Gate and Playback', () => {
  const song = {
    id: 'sng-neon-stream',
    title: 'Neon Stream',
    creator: '0xCreatorAddress123',
    url: '/api/songs/sng-neon-stream/stream',
    duration: 180,
    stream_price: 0.03,
    license_price: 1.0,
    tags: ['cyberpunk'],
    licenses: 10,
    public: true,
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    closeGate(false);
    store.setActiveSong(null);
  });

  it('blocks non-creator playback when no session token is present and dispatches open-gate event', async () => {
    let gateOpened = false;
    const listener = () => { gateOpened = true; };
    window.addEventListener(GATE_EVENT, listener);

    // Set non-creator user
    store.setUserAddress('0xListenerNonCreator');
    store.setActiveSong(song);

    // Mock no active token
    vi.spyOn(sdk.keys, 'currentToken').mockReturnValue(null);

    const started = await store.setPlaying(true);

    expect(started).toBe(false);
    expect(store.getState().isPlaying).toBe(false);
    expect(audio.play).not.toHaveBeenCalled();
    expect(gateOpened).toBe(true);

    window.removeEventListener(GATE_EVENT, listener);
  });

  it('allows creator to stream their own song without paying session fees', async () => {
    store.setUserAddress(song.creator);
    store.setActiveSong(song);

    vi.spyOn(sdk, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      id: song.id,
      url: 'https://cdn.rawchunks.io/stream-authorized.wav',
      isCreator: true,
      streamPriceUsd: 0,
    }), { status: 200 }));

    const started = await store.setPlaying(true);

    expect(started).toBe(true);
    expect(store.getState().isPlaying).toBe(true);
    expect(audio.load).toHaveBeenCalledWith('https://cdn.rawchunks.io/stream-authorized.wav');
    expect(audio.play).toHaveBeenCalled();
  });

  it('authorizes non-creator playback when active session token is present and plays stream', async () => {
    store.setUserAddress('0xListenerNonCreator');
    store.setActiveSong(song);

    vi.spyOn(sdk.keys, 'currentToken').mockReturnValue('compose-valid-session-jwt');

    vi.spyOn(sdk, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      id: song.id,
      url: 'https://cdn.rawchunks.io/stream-authorized.wav',
      isCreator: false,
      streamPriceUsd: 0.03,
    }), { status: 200 }));

    const started = await store.setPlaying(true);

    expect(started).toBe(true);
    expect(store.getState().isPlaying).toBe(true);
    expect(audio.load).toHaveBeenCalledWith('https://cdn.rawchunks.io/stream-authorized.wav');
    expect(audio.play).toHaveBeenCalled();
  });

  it('blocks playback and opens the funding gate when backend returns 402 payment required', async () => {
    let gateOpened = false;
    const listener = () => { gateOpened = true; };
    window.addEventListener(GATE_EVENT, listener);

    store.setUserAddress('0xListenerNonCreator');
    store.setActiveSong(song);

    vi.spyOn(sdk.keys, 'currentToken').mockReturnValue('compose-exhausted-session-jwt');

    vi.spyOn(sdk, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      error: 'Budget exhausted',
    }), { status: 402 }));

    const started = await store.setPlaying(true);

    expect(started).toBe(false);
    expect(store.getState().isPlaying).toBe(false);
    expect(audio.play).not.toHaveBeenCalled();
    expect(gateOpened).toBe(true);

    window.removeEventListener(GATE_EVENT, listener);
  });
});
