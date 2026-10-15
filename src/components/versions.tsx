import type { Song } from '../lib/schema';
import { Tooltip } from './daw/Tooltip';

export function Versions({ songs, selected, onSelect }: { songs: Song[]; selected: string; onSelect: (song: Song) => void }) {
  if (songs.length < 2) return null;
  return <div className="board-category-badges-list" aria-label="Song versions">
    {songs.map(song => (
      <Tooltip key={song.id} title={`VERSION #${song.version ?? 1}`} description="Switch to this song version" position="top">
        <button type="button"
          className={`board-take-badge-pill ${song.id === selected ? 'selected' : ''}`}
          aria-pressed={song.id === selected}
          aria-label={`Version ${song.version ?? 1}`}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(song);
          }}>
          #{song.version ?? 1}
        </button>
      </Tooltip>
    ))}
  </div>;
}
