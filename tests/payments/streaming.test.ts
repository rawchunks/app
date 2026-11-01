// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { store } from '@/lib/store';
import { audio } from '@/lib/audio';
import { api, setCreditRequestContext, hasStreamBudget } from '@/lib/api';
import { compose } from '@/lib/compose';
import { closeGate, GATE_EVENT } from '@/lib/gate';

vi.mock('@/lib/audio', () => ({
  audio: {
    load: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    reset: vi.fn(),
    stopImmediate: vi.fn(),
    preloadNext: vi.fn(),
    position: vi.fn(() => 0),
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
    setCreditRequestContext(null);
  });

  it('does not treat a stale active-session flag as authorization after the token is cleared', () => {
    vi.spyOn(compose.keys, 'currentToken').mockReturnValue(null);
    setCreditRequestContext({ userAddress: 'listener', usdcActive: true, cardAvailableAtomics: '0' });
    expect(hasStreamBudget()).toBe(false);
  });

  it('checks funding before resuming an already loaded song', async () => {
    store.setUserAddress('listener'); store.setActiveSong(song);
    const token = vi.spyOn(compose.keys, 'currentToken').mockReturnValue('session');
    const loaded = vi.spyOn(audio, 'hasSource').mockReturnValue(true);
    vi.spyOn(api, 'fetch').mockResolvedValueOnce(Response.json({ paymentIntentId: 'intent', url: 'https://cdn.test/song.wav' }));
    expect(await store.setPlaying(true)).toBe(true);
    token.mockReturnValue(null);
    const played = vi.mocked(audio.play).mock.calls.length;
    expect(await store.setPlaying(true)).toBe(false);
    expect(vi.mocked(audio.play).mock.calls.length).toBe(played);
    expect(store.getState().isPlaying).toBe(false);
    loaded.mockRestore();
  });

  it('blocks non-creator playback when no session token is present and dispatches open-gate event', async () => {
    let gateOpened = false;
    const listener = () => { gateOpened = true; };
    window.addEventListener(GATE_EVENT, listener);

    // Set non-creator user
    store.setUserAddress('0xListenerNonCreator');
    store.setActiveSong(song);

    // Mock no active token
    vi.spyOn(compose.keys, 'currentToken').mockReturnValue(null);

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

    vi.spyOn(api, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      id: song.id,
      url: 'https://cdn.rawchunks.io/stream-authorized.wav',
      isCreator: true,
      streamPriceUsd: 0,
    }), { status: 200 }));

    const started = await store.setPlaying(true);

    expect(started).toBe(true);
    expect(store.getState().isPlaying).toBe(true);
    expect(audio.load).toHaveBeenCalledWith('https://cdn.rawchunks.io/stream-authorized.wav', false);
    expect(audio.play).toHaveBeenCalled();
  });

  it('authorizes non-creator playback when active session token is present and plays stream', async () => {
    store.setUserAddress('0xListenerNonCreator');
    store.setActiveSong(song);

    vi.spyOn(compose.keys, 'currentToken').mockReturnValue('compose-valid-session-jwt');

    vi.spyOn(api, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      id: song.id,
      url: 'https://cdn.rawchunks.io/stream-authorized.wav',
      paymentIntentId: 'intent',
      isCreator: false,
      streamPriceUsd: 0.03,
    }), { status: 200 }));

    const started = await store.setPlaying(true);

    expect(started).toBe(true);
    expect(store.getState().isPlaying).toBe(true);
    expect(audio.load).toHaveBeenCalledWith('https://cdn.rawchunks.io/stream-authorized.wav', false);
    expect(audio.play).toHaveBeenCalled();
  });

  it('blocks playback and opens the funding gate when backend returns 402 payment required', async () => {
    let gateOpened = false;
    const listener = () => { gateOpened = true; };
    window.addEventListener(GATE_EVENT, listener);

    store.setUserAddress('0xListenerNonCreator');
    store.setActiveSong(song);

    vi.spyOn(compose.keys, 'currentToken').mockReturnValue('compose-exhausted-session-jwt');

    vi.spyOn(api, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
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
