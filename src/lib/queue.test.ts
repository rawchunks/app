import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from './schema';

vi.mock('./audio', () => ({
  audio: {
    load: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    reset: vi.fn(),
    stopImmediate: vi.fn(),
    preloadNext: vi.fn(),
    hasSource: vi.fn(() => false),
    position: vi.fn(() => 0),
    setOnTimeUpdate: vi.fn(),
    setOnDuration: vi.fn(),
    setOnEnd: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('./compose', () => ({
  compose: {
    wallets: { current: () => null },
    keys: { currentToken: () => 'test-token' },
  },
}));

vi.mock('./api', () => ({
  api: { fetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })) },
  hasStreamBudget: () => true,
  hasPromoCreditsOnly: () => false,
  captureStreamBilling: () => [{ source: 'usdc', token: 'test-token' }],
  streamOptions: () => ({ headers: {} }),
}));

const makeSong = (overrides: Partial<Song> & { id: string }): Song => ({
  id: overrides.id,
  title: overrides.title ?? `Track ${overrides.id}`,
  creator: overrides.creator ?? '0xaaa',
  url: overrides.url ?? `https://cdn.test/${overrides.id}.mp3`,
  image: overrides.image ?? '',
  duration: overrides.duration ?? 180,
  tags: overrides.tags ?? ['electronic'],
  public: overrides.public ?? true,
  stream_price: overrides.stream_price ?? 0.01,
  license_price: overrides.license_price ?? 5,
  licenses: overrides.licenses ?? 10,
  plays: overrides.plays ?? 0,
  likes: overrides.likes ?? 0,
  ...overrides,
});

describe('Store queue & account isolation', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('isolates private songs across account switches and never writes unscoped playback', async () => {
    const { store } = await import('./store');
    const privateA = makeSong({ id: 'priv-a', title: 'Secret Draft A', creator: '0xaaa', public: false });
    const privateB = makeSong({ id: 'priv-b', title: 'Secret Draft B', creator: '0xbbb', public: false });

    store.clearUserWorkspace(false);
    store.setUserAddress('0xaaa', '0xaaa', null);
    store.setActiveSong(privateA, [privateA], null, 'workspace:drafts', true);

    expect(store.getState().activeSong?.id).toBe('priv-a');
    expect(localStorage.getItem('playback')).toBeNull();
    expect(localStorage.getItem('queue')).toBeNull();
    expect(localStorage.getItem('playback:0xaaa')).toContain('priv-a');

    // Switch directly to Account B: Account A's private draft MUST NOT carry over
    store.setUserAddress('0xbbb', '0xbbb', null);
    expect(store.getState().activeSong).toBeNull();
    expect(store.getState().queue).toEqual([]);

    // Account B plays its own draft
    store.setActiveSong(privateB, [privateB], null, 'workspace:drafts', true);
    expect(store.getState().activeSong?.id).toBe('priv-b');

    // Switching back to Account A restores ONLY Account A's cached session, never Account B's
    store.setUserAddress('0xaaa', '0xaaa', null);
    expect(store.getState().activeSong?.id).toBe('priv-a');
    expect(store.getState().queue.some((s) => s.id === 'priv-b')).toBe(false);
  });

  it('does not leak Account A queue after logout -> login as Account B', async () => {
    const { store } = await import('./store');
    const privateA = makeSong({ id: 'priv-a2', creator: '0xaaa', public: false });

    store.clearUserWorkspace(false);
    store.setUserAddress('0xaaa', '0xaaa', null);
    store.setActiveSong(privateA, [privateA], null, 'studio:feed', true);
    expect(store.getState().activeSong?.id).toBe('priv-a2');

    store.clearUserWorkspace(false);
    expect(store.getState().activeSong).toBeNull();
    expect(store.getState().queue).toEqual([]);

    store.setUserAddress('0xccc', '0xccc', null);
    expect(store.getState().activeSong).toBeNull();
    expect(store.getState().queue).toEqual([]);
  });

  it('never circularly wraps prior tracks into contextQueue and addSong never hijacks active playback', async () => {
    const { store } = await import('./store');
    const s1 = makeSong({ id: 's1', creator: '0xaaa', public: true });
    const s2 = makeSong({ id: 's2', creator: '0xaaa', public: true });
    const s3 = makeSong({ id: 's3', creator: '0xaaa', public: true });
    const freshDraft = makeSong({ id: 'draft-new', creator: '0xaaa', public: false });

    store.clearUserWorkspace(false);
    store.setUserAddress('0xaaa', '0xaaa', null);
    store.setActiveSong(s2, [s1, s2, s3], null, 'market:new', true);

    expect(store.getState().activeSong?.id).toBe('s2');
    // Only s3 comes after s2 (s1 must NOT wrap around behind s3!)
    expect(store.getState().contextQueue.map((s) => s.id)).toEqual(['s3']);

    // Generating a new draft in Studio via addSong MUST NOT hijack activeSong or corrupt the queue
    store.addSong(freshDraft);
    expect(store.getState().activeSong?.id).toBe('s2');
    expect(store.getState().contextQueue.map((s) => s.id)).toEqual(['s3']);
    expect(store.getState().songs.some((s) => s.id === 'draft-new')).toBe(true);
  });

  it('hard-blocks private contexts from auto-advancing into paid public catalog songs', async () => {
    const { store } = await import('./store');
    const privateDraft = makeSong({ id: 'priv-only', creator: '0xaaa', public: false });
    const paidPublic = makeSong({ id: 'paid-pub', creator: '0xother', public: true, stream_price: 0.05 });

    store.clearUserWorkspace(false);
    store.setUserAddress('0xaaa', '0xaaa', null);
    store.setSongs([privateDraft, paidPublic]);
    store.setAutoplay(true);
    store.setRepeatMode('off');
    store.setActiveSong(privateDraft, [privateDraft], null, 'workspace:drafts', true);

    expect(store.getState().playbackContext?.isPrivate).toBe(true);
    expect(store.peekNextSong()).toBeNull();

    const advanced = await store.playNextTrack(true);
    expect(advanced).toBe(false);
    expect(store.getState().activeSong?.id).toBe('priv-only');
  });

  it('orders playNext before addToQueue and drains userQueue before contextQueue', async () => {
    const { store } = await import('./store');
    const s1 = makeSong({ id: 'm1', public: true });
    const s2 = makeSong({ id: 'm2', public: true });
    const qTail = makeSong({ id: 'q-tail', public: true });
    const qHead = makeSong({ id: 'q-head', public: true });

    store.clearUserWorkspace(false);
    store.setUserAddress('0xaaa', '0xaaa', null);
    store.setActiveSong(s1, [s1, s2], null, 'market:new', true);
    store.addToQueue(qTail);
    store.playNext(qHead);

    expect(store.getState().userQueue.map((s) => s.id)).toEqual(['q-head', 'q-tail']);
    expect(store.getState().contextQueue.map((s) => s.id)).toEqual(['m2']);
    expect(store.peekNextSong()?.id).toBe('q-head');
  });
});
