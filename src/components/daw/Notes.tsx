import { memo, useId, useMemo } from 'react';
import type { DAWTrack } from '../../lib/daw/store';
import { sequence } from '../../lib/daw/notes';

export const Notes = memo(function Notes({ track, bpm, duration, color }: {
  track: DAWTrack;
  bpm: number;
  duration: number;
  color: string;
}) {
  const id = useId();
  const pattern = useMemo(
    () => sequence(track, bpm),
    [track.type, track.pianoRollNotes, track.sequencerVoices, track.strudelCode, bpm]
  );
  return (
    <svg className="board-notes" role="img" aria-label={`${track.name} notes`}
      viewBox={`0 0 ${duration} ${pattern.rows}`} preserveAspectRatio="none">
      <defs>
        <pattern id={id} patternUnits="userSpaceOnUse" width={pattern.duration} height={pattern.rows}>
          {pattern.notes.flatMap(note => {
            const overflow = note.start + note.duration > pattern.duration;
            return [0, ...(overflow ? [-pattern.duration] : [])].map(offset => (
              <rect key={`${note.id}-${offset}`} x={note.start + offset} y={note.row + 0.15}
                width={Math.max(0.02, note.duration * 0.92)} height={0.7} fill={color}
                fillOpacity={note.muted ? 0.15 : 0.35 + note.velocity * 0.65}>
                <title>{note.label}</title>
              </rect>
            ));
          })}
        </pattern>
      </defs>
      <rect width={duration} height={pattern.rows} fill={`url(#${id})`} />
    </svg>
  );
}, (prev, next) =>
  prev.track.type === next.track.type &&
  prev.track.name === next.track.name &&
  prev.track.pianoRollNotes === next.track.pianoRollNotes &&
  prev.track.sequencerVoices === next.track.sequencerVoices &&
  prev.track.strudelCode === next.track.strudelCode &&
  prev.bpm === next.bpm &&
  prev.duration === next.duration &&
  prev.color === next.color
);
