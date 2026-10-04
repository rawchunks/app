import React, { useState, useMemo } from 'react';
import { useDawStore, DAWTrack } from '../../lib/daw/store';
import { dawEngine } from '../../lib/daw/engine';
import { PIANO_STEPS } from '../../lib/daw/notes';
import { Button } from '../button';
import { Badge } from '../badge';
import { Plus, Trash2, Volume2, ChevronUp, ChevronDown } from 'lucide-react';
import { Key } from './Key';

interface PianoRollProps {
  track?: DAWTrack;
}

const NOTE_NAMES = ['B', 'A#', 'A', 'G#', 'G', 'F#', 'F', 'E', 'D#', 'D', 'C#', 'C'];

const pitchToMidi = (pitch: string): number => {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = parseInt(pitch.slice(-1), 10);
  const note = pitch.slice(0, -1);
  const noteIdx = noteNames.indexOf(note);
  return (octave + 1) * 12 + (noteIdx >= 0 ? noteIdx : 0);
};

const GRID_DIVISIONS = [
  { label: '1/4', steps: 4 },
  { label: '1/8', steps: 2 },
  { label: '1/16', steps: 1 },
  { label: '1/32', steps: 0.5 },
];

export const PianoRoll: React.FC<PianoRollProps> = ({ track }) => {
  const {
    tracks,
    selectedTrackId,
    addTrack,
    addPianoRollNote,
    removePianoRollNote,
    clearPianoRollNotes,
    quantizePianoRoll,
  } = useDawStore();

  const pianoTrack =
    (track && track.type === 'pianoroll' ? track : null) ||
    tracks.find((t) => t.id === selectedTrackId && t.type === 'pianoroll') ||
    tracks.find((t) => t.type === 'pianoroll');

  const [baseOctave, setBaseOctave] = useState<number>(3);
  const [selectedGrid, setSelectedGrid] = useState<number>(1);
  const [velocity, setVelocity] = useState<number>(0.85);
  const [activeAuditionPitch, setActiveAuditionPitch] = useState<string | null>(null);

  // Generate 2 octaves dynamically from baseOctave (e.g., C3 to B4 = 24 pitches)
  const pitches = useMemo(() => {
    const list: string[] = [];
    for (let oct = baseOctave + 1; oct >= baseOctave; oct--) {
      for (const name of NOTE_NAMES) {
        list.push(`${name}${oct}`);
      }
    }
    return list;
  }, [baseOctave]);

  if (!pianoTrack) {
    return (
      <div className="pianoroll-wrap">
        <div className="pianoroll-empty-card">
          <Key size={32} className="pianoroll-empty-icon" />
          <h4 className="pianoroll-empty-title">NO PIANO ROLL TRACK ACTIVE</h4>
          <p className="pianoroll-empty-desc">
            Create an instrument synthesizer track to compose notes, melodies, and chords.
          </p>
          <Button
            size="sm"
            variant="default"
            onClick={() => addTrack('pianoroll', 'Keys Synth')}
          >
            <Plus size={13} /> CREATE KEYS TRACK
          </Button>
        </div>
      </div>
    );
  }

  const notes = pianoTrack.pianoRollNotes || [];

  const handleKeyAudition = (pitch: string) => {
    setActiveAuditionPitch(pitch);
    dawEngine.playNote(pitch, '8n', velocity, pianoTrack.id);
    setTimeout(() => setActiveAuditionPitch(null), 250);
  };

  const handleCellClick = (pitch: string, timeStep: number) => {
    // Check if an existing note covers this exact cell
    const existing = notes.find(
      (n) => n.pitch === pitch && Math.floor(n.startTime) === timeStep
    );

    if (existing) {
      removePianoRollNote(pianoTrack.id, existing.id);
    } else {
      dawEngine.playNote(pitch, '8n', velocity, pianoTrack.id);
      addPianoRollNote(pianoTrack.id, {
        pitch,
        midi: pitchToMidi(pitch),
        startTime: timeStep,
        duration: selectedGrid,
        velocity,
      });
    }
  };

  return (
    <div className="pianoroll-wrap">
      {/* Top Toolbar */}
      <div className="pianoroll-toolbar">
        <div className="pianoroll-meta">
          <Key size={14} className="pianoroll-meta-icon" />
          <span className="pianoroll-track-name">{pianoTrack.name}</span>
          <Badge variant="outline">{notes.length} NOTES</Badge>
        </div>

        <div className="pianoroll-controls-cluster">
          {/* Octave Shift */}
          <div className="pianoroll-octave-picker">
            <span className="pianoroll-label">OCT:</span>
            <button
              type="button"
              className="pianoroll-mini-btn"
              disabled={baseOctave <= 1}
              onClick={() => setBaseOctave((o) => Math.max(1, o - 1))}
              title="Octave Down"
            >
              <ChevronDown size={12} />
            </button>
            <span className="pianoroll-octave-val">C{baseOctave}–B{baseOctave + 1}</span>
            <button
              type="button"
              className="pianoroll-mini-btn"
              disabled={baseOctave >= 6}
              onClick={() => setBaseOctave((o) => Math.min(6, o + 1))}
              title="Octave Up"
            >
              <ChevronUp size={12} />
            </button>
          </div>

          {/* Grid Snap Selector */}
          <div className="pianoroll-grid-picker">
            <span className="pianoroll-label">SNAP:</span>
            {GRID_DIVISIONS.map((g) => (
              <button
                key={g.label}
                type="button"
                className={`pianoroll-grid-btn ${selectedGrid === g.steps ? 'active' : ''}`}
                onClick={() => setSelectedGrid(g.steps)}
              >
                {g.label}
              </button>
            ))}
          </div>

          {/* Quantize Action */}
          <Button
            size="sm"
            variant="outline"
            className="pianoroll-action-btn"
            onClick={() => quantizePianoRoll(pianoTrack.id, selectedGrid)}
          >
            QUANTIZE
          </Button>

          {/* Clear Action */}
          {notes.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="pianoroll-action-btn danger"
              onClick={() => clearPianoRollNotes(pianoTrack.id)}
            >
              <Trash2 size={12} /> CLEAR
            </Button>
          )}
        </div>
      </div>

      {/* Main Piano Roll Container */}
      <div className="pianoroll-body">
        {/* Left Keys Gutter */}
        <div className="pianoroll-keys-gutter">
          {pitches.map((pitch) => {
            const isAccidental = pitch.includes('#');
            const isAuditioning = activeAuditionPitch === pitch;
            return (
              <div
                key={pitch}
                className={`pianoroll-key ${isAccidental ? 'accidental' : 'natural'} ${isAuditioning ? 'active' : ''}`}
                onClick={() => handleKeyAudition(pitch)}
                title={`Play ${pitch}`}
              >
                <span className="pianoroll-key-label">{pitch}</span>
              </div>
            );
          })}
        </div>

        {/* Right Scrollable Step Grid */}
        <div className="pianoroll-grid-scroll">
          <div className="pianoroll-grid-content">
            {pitches.map((pitch) => {
              const isAccidental = pitch.includes('#');
              return (
                <div
                  key={pitch}
                  className={`pianoroll-pitch-row ${isAccidental ? 'accidental' : 'natural'}`}
                >
                  {Array.from({ length: PIANO_STEPS }).map((_, stepIdx) => {
                    const isQuarter = stepIdx % 4 === 0;
                    return (
                      <button
                        type="button"
                        aria-label={`Add ${pitch} at step ${stepIdx + 1}`}
                        key={stepIdx}
                        className={`pianoroll-grid-cell ${isQuarter ? 'quarter-beat' : ''}`}
                        onClick={() => handleCellClick(pitch, stepIdx)}
                      />
                    );
                  })}
                </div>
              );
            })}

            {/* Note Blocks Overlay */}
            {notes.map((n) => {
              const pitchIdx = pitches.indexOf(n.pitch);
              if (pitchIdx === -1) return null;

              const rowHeightPct = 100 / pitches.length;
              const topPct = pitchIdx * rowHeightPct;
              const leftPct = (n.startTime / PIANO_STEPS) * 100;
              const widthPct = Math.max(1.8, (n.duration / PIANO_STEPS) * 100);

              return (
                <button
                  type="button"
                  aria-label={`Remove ${n.pitch} at step ${n.startTime + 1}`}
                  key={n.id}
                  className="pianoroll-note-item"
                  style={{
                    top: `${topPct}%`,
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    height: `${rowHeightPct}%`,
                    opacity: 0.4 + (n.velocity || 0.8) * 0.6,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    removePianoRollNote(pianoTrack.id, n.id);
                  }}
                  title={`${n.pitch} (Step ${n.startTime}, Length ${n.duration}) - Click to delete`}
                >
                  <span className="pianoroll-note-label">{n.pitch}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer Velocity Bar */}
      <div className="pianoroll-footer">
        <div className="pianoroll-velocity-ctrl">
          <Volume2 size={12} className="pianoroll-vel-icon" />
          <span className="pianoroll-label">VELOCITY:</span>
          <input
            type="range"
            min="0.1"
            max="1.0"
            step="0.05"
            value={velocity}
            onChange={(e) => setVelocity(parseFloat(e.target.value))}
            className="pianoroll-velocity-slider"
          />
          <span className="pianoroll-velocity-readout">
            {Math.round(velocity * 100)}%
          </span>
        </div>
        <span className="pianoroll-hint">Click grid to add/delete note • Click key to audition</span>
      </div>
    </div>
  );
};
