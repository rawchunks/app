import type { Song } from './schema';

export interface Mint {
  network: string;
  cid: string;
  after: string;
  submitted: boolean;
  hash?: string;
  id?: string;
}

export interface Registry {
  load: () => Promise<Song>;
  save: (updates: Partial<Song>) => Promise<Song>;
  read: () => Mint | null;
  write: (mint: Mint | null) => void;
  prepare: (song: Song) => Promise<Mint>;
  verify: (song: Song, mint: Mint) => Promise<void>;
  find: (song: Song, mint: Mint) => Promise<Mint | null>;
  preflight: (song: Song, mint: Mint) => Promise<void>;
  send: (song: Song, mint: Mint) => Promise<Mint>;
  confirm: (song: Song, mint: Mint) => Promise<Mint>;
}

export async function mintSong(registry: Registry): Promise<Song> {
  const song = await registry.load();
  if (song.chain_song_id) {
    if (!song.network || !song.metadata_cid) throw new Error('The saved mint is incomplete');
    const saved: Mint = { network: song.network, cid: song.metadata_cid, id: song.chain_song_id, hash: song.tx_hash, after: '0', submitted: true };
    await registry.verify(song, saved);
    registry.write(null);
    return song;
  }
  let mint = registry.read();
  if (!mint) {
    mint = await registry.prepare(song);
    registry.write(mint);
  }
  if (mint.id) {
    await registry.verify(song, mint);
  } else if (mint.hash) {
    mint = await registry.confirm(song, mint);
    registry.write(mint);
    await registry.verify(song, mint);
  } else {
    const found = await registry.find(song, mint);
    if (found) {
      mint = found;
      registry.write(mint);
      await registry.verify(song, mint);
    } else {
      if (mint.submitted) throw new Error('The previous mint is awaiting confirmation. Try again after it confirms.');
      await registry.save({ metadata_cid: mint.cid, network: mint.network });
      await registry.preflight(song, mint);
      mint = { ...mint, submitted: true };
      registry.write(mint);
      mint = await registry.send(song, mint);
      registry.write(mint);
      mint = await registry.confirm(song, mint);
      registry.write(mint);
      await registry.verify(song, mint);
    }
  }
  const saved = await registry.save({ metadata_cid: mint.cid, network: mint.network, chain_song_id: mint.id, ...(mint.hash ? { tx_hash: mint.hash } : {}) });
  registry.write(null);
  return saved;
}
