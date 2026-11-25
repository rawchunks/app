import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../../src/lib/store';
import type { Song } from '../../src/lib/schema';

const makeSong = (id: string, overrides: Partial<Song> = {}): Song => ({
  id,
  title: `Track ${id}`,
  creator: '0xaaaa00000000000000000000000000000000aaaa',
  duration: 120,
  url: `https://cdn.rawchunks.space/${id}.mp3`,
  image: '',
  tags: ['Electronic'],
  genres: ['Electronic'],
  production: [],
  mood: [],
  vocal: [],
  public: true,
  likes: 0,
  plays: 0,
  licenses: 10,
  license_price: 5,
  stream_price: 0.01,
  ...overrides,
});

describe('Deterministic Two-Tier Queue & Account Isolation', () => {
  beforeEach(() => {
    store.clearUserWorkspace(false);
    store.clearQueue();
  });

  it('replaces contextQueue when switching contexts while preserving explicit userQueue', () => {
    const marketA = makeSong('market-a');
    const marketB = makeSong('market-b');
    const userPick = makeSong('user-pick');
    const genreX = makeSong('genre-x');
    const genreY = makeSong('genre-y');

    store.setActiveSong(marketA, [marketA, marketB], null, 'market:new');
    expect(store.getState().queue.map((s) => s.id)).toEqual(['market-a', 'market-b']);

    store.addToQueue(userPick);
    expect(store.getState().userQueue.map((s) => s.id)).toEqual(['user-pick']);
    expect(store.getState().queue.map((s) => s.id)).toEqual(['market-a', 'user-pick', 'market-b']);

    // Playing from a new Genre context replaces marketB with genreY, while keeping userPick next in queue
    store.setActiveSong(genreX, [genreX, genreY], null, 'genre:electronic');
    expect(store.getState().userQueue.map((s) => s.id)).toEqual(['user-pick']);
    expect(store.getState().contextQueue.map((s) => s.id)).toEqual(['genre-y']);
    expect(store.getState().queue.map((s) => s.id)).toEqual(['genre-x', 'user-pick', 'genre-y']);
  });

  it('does not auto-pollute queue when setSongs or addSong is called with private drafts', () => {
    const accountA = '0xaaaa00000000000000000000000000000000aaaa';
    store.setUserAddress(accountA, accountA, null);

    const publicTrack = makeSong('pub-1');
    store.setActiveSong(publicTrack, [publicTrack], null, 'market:pulse');

    const privateDraft = makeSong('draft-1', { public: false, creator: accountA });
    store.setSongs([publicTrack, privateDraft]);
    expect(store.getState().queue.map((s) => s.id)).toEqual(['pub-1']);

    const newVariation = makeSong('draft-2', { public: false, creator: accountA });
    store.addSong(newVariation);
    expect(store.getState().activeSong?.id).toBe('pub-1');
    expect(store.getState().queue.map((s) => s.id)).toEqual(['pub-1']);
    expect(store.getState().userQueue).toHaveLength(0);
    expect(store.getState().contextQueue).toHaveLength(0);
  });

  it('purges private songs and isolates queues when switching accounts or logging out', () => {
    const accountA = '0xaaaa00000000000000000000000000000000aaaa';
    const accountB = '0xbbbb00000000000000000000000000000000bbbb';

    store.setUserAddress(accountA, accountA, null);
    const privateA1 = makeSong('priv-a1', { public: false, creator: accountA });
    const privateA2 = makeSong('priv-a2', { public: false, creator: accountA });
    store.setActiveSong(privateA1, [privateA1, privateA2], null, 'profile:workspace');
    expect(store.getState().queue.map((s) => s.id)).toEqual(['priv-a1', 'priv-a2']);

    // Switch to Account B: Account A's private songs must never leak into Account B's queue or activeSong
    store.setUserAddress(accountB, accountB, null);
    expect(store.getState().activeSong).toBeNull();
    expect(store.getState().queue).toHaveLength(0);
    expect(store.getState().userQueue).toHaveLength(0);
    expect(store.getState().contextQueue).toHaveLength(0);

    // Logout: workspace and queue are completely cleared
    store.clearUserWorkspace(false);
    expect(store.getState().userAddress).toBe('');
    expect(store.getState().queue).toHaveLength(0);
  });
});
