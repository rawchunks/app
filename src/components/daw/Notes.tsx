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
  const pattern = useMemo(() => sequence(track, bpm), [track.type, track.pianoRollNotes, track.sequencerVoices, bpm]);
  return (
    <svg className="board-notes" role="img" aria-label={`${track.name} notes`}
      viewBox={`0 0 ${duration} ${pattern.rows}`} preserveAspectRatio="none">
      <defs>
        <pattern id={id} patternUnits="userSpaceOnUse" width={pattern.duration} height={pattern.rows}>
          {pattern.notes.flatMap(note => {
            const overflow = note.start + note.duration > pattern.duration;
            return [0, ...(overflow ? [-pattern.duration] : [])].map(offset => (
              <rect key={`${note.id}-${offset}`} x={note.start + offset} y={note.row + 0.15}
                width={note.duration} height={0.7} fill={color}
                fillOpacity={note.muted ? 0.15 : 0.35 + note.velocity * 0.65}
                stroke="var(--bg)" strokeWidth="1" vectorEffect="non-scaling-stroke">
                <title>{note.label}</title>
              </rect>
            ));
          })}
        </pattern>
      </defs>
      <rect width={duration} height={pattern.rows} fill={`url(#${id})`} />
    </svg>
  );
});
