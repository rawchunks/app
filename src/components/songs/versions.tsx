import type { Song } from '../../lib/schema';
import { Tooltip } from '../daw/Tooltip';

export function Versions({ songs, selected, onSelect }: { songs: Song[]; selected: string; onSelect: (song: Song) => void }) {
  if (songs.length < 2) return null;
  return <div data-guide="card.version-menu" className="board-category-badges-list" aria-label="Song versions">
    {songs.map((song, idx) => {
      const vNum = idx + 1;
      return (
        <Tooltip key={song.id} title={`VERSION #${vNum}`} description="Switch to this song version" position="top">
          <button type="button"
            className={`board-take-badge-pill ${song.id === selected ? 'selected' : ''}`}
            aria-pressed={song.id === selected}
            aria-label={`Version ${vNum}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(song);
            }}>
            #{vNum}
          </button>
        </Tooltip>
      );
    })}
  </div>;
}
