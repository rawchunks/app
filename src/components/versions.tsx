import type { Song } from '../lib/schema';

export function Versions({ songs, selected, onSelect }: { songs: Song[]; selected: string; onSelect: (song: Song) => void }) {
  if (songs.length < 2) return null;
  return <div className="board-category-badges-list" aria-label="Song versions">
    {songs.map(song => <button key={song.id} type="button"
      className={`board-take-badge-pill ${song.id === selected ? 'selected' : ''}`}
      aria-pressed={song.id === selected} title={`Version ${song.version ?? 1}`}
      onClick={() => onSelect(song)}>
      #{song.version ?? 1}
    </button>)}
  </div>;
}
