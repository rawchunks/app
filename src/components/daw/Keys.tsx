import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useDawStore, DAWTrack } from '../../lib/daw/store';
import { dawEngine } from '../../lib/daw/engine';
import { PIANO_STEPS } from '../../lib/daw/notes';
import {
  usePianoMusicalTyping,
  getKeycapForPitch,
} from '../../lib/daw/typing';
import { Button } from '../button';
import { Modal } from '../modal';
import { Tooltip } from './Tooltip';
import { Plus, Trash2, ChevronUp, ChevronDown, Magnet, Maximize2, Disc } from 'lucide-react';
import { createLucideIcon } from 'lucide-react';

export const Key = createLucideIcon('Key', [
  ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 1, key: 'keys' }],
  ['path', { d: 'M9 3v18M15 3v18', key: 'white' }],
  ['path', { d: 'M7 3h4v10H7ZM13 3h4v10h-4Z', fill: 'currentColor', stroke: 'none', key: 'black' }],
]);

interface KeysProps {
  track?: DAWTrack;
}

const NOTE_NAMES = ['B', 'A#', 'A', 'G#', 'G', 'F#', 'F', 'E', 'D#', 'D', 'C#', 'C'];
const QUICK_PREVIEW_NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

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

export const Keys: React.FC<KeysProps> = ({ track }) => {
  const tracks = useDawStore((s) => s.tracks);
  const selectedTrackId = useDawStore((s) => s.selectedTrackId);
  const addTrack = useDawStore((s) => s.addTrack);
  const addPianoRollNote = useDawStore((s) => s.addPianoRollNote);
  const removePianoRollNote = useDawStore((s) => s.removePianoRollNote);
  const clearPianoRollNotes = useDawStore((s) => s.clearPianoRollNotes);
  const quantizePianoRoll = useDawStore((s) => s.quantizePianoRoll);
  const addSynthVersion = useDawStore((s) => s.addSynthVersion);
  const selectSynthVersion = useDawStore((s) => s.selectSynthVersion);
  const pendingModalTrackId = useDawStore((s) => s.pendingModalTrackId);
  const clearPendingModalTrackId = useDawStore((s) => s.clearPendingModalTrackId);

  const pianoTrack =
    (track && track.type === 'pianoroll' ? track : null) ||
    tracks.find((t) => t.id === selectedTrackId && t.type === 'pianoroll') ||
    tracks.find((t) => t.type === 'pianoroll');

  const [baseOctave, setBaseOctave] = useState<number>(3);
  const [selectedGrid, setSelectedGrid] = useState<number>(1);
  const [velocity, setVelocity] = useState<number>(0.85);
  const [activeAuditionPitch, setActiveAuditionPitch] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isKeyRecEnabled, setIsKeyRecEnabled] = useState<boolean>(true);
  const [stepCursor, setStepCursor] = useState<number>(0);

  // Auto-open modal when a new Keys track is created from Toolbox or Board '+' menu
  useEffect(() => {
    if (pianoTrack && pendingModalTrackId === pianoTrack.id) {
      setIsModalOpen(true);
      clearPendingModalTrackId();
    }
  }, [pianoTrack?.id, pendingModalTrackId, clearPendingModalTrackId]);

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

  const notes = pianoTrack?.pianoRollNotes || [];

  const handleKeyAudition = useCallback(
    (pitch: string) => {
      if (!pianoTrack) return;
      setActiveAuditionPitch(pitch);
      dawEngine.playNote(pitch, '8n', velocity, pianoTrack.id);
      setTimeout(() => setActiveAuditionPitch(null), 220);
    },
    [pianoTrack, velocity]
  );

  const handleCellClick = useCallback(
    (pitch: string, timeStep: number) => {
      if (!pianoTrack) return;
      setStepCursor(timeStep);
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
    },
    [pianoTrack, notes, removePianoRollNote, velocity, addPianoRollNote, selectedGrid]
  );

  const handleMusicalTypingTrigger = useCallback(
    (pitch: string, shouldRecord: boolean) => {
      if (!pianoTrack) return;
      handleKeyAudition(pitch);
      if (shouldRecord) {
        const step = Math.min(PIANO_STEPS - 1, Math.max(0, Math.floor(stepCursor)));
        const existing = notes.find(
          (n) => n.pitch === pitch && Math.floor(n.startTime) === step
        );
        if (!existing) {
          addPianoRollNote(pianoTrack.id, {
            pitch,
            midi: pitchToMidi(pitch),
            startTime: step,
            duration: selectedGrid,
            velocity,
          });
        }
        const advance = Math.max(1, Math.round(selectedGrid));
        setStepCursor((prev) => (prev + advance) % PIANO_STEPS);
      }
    },
    [pianoTrack, handleKeyAudition, stepCursor, notes, addPianoRollNote, selectedGrid, velocity]
  );

  const { heldPitches } = usePianoMusicalTyping({
    enabled: isModalOpen && Boolean(pianoTrack),
    baseOctave,
    setBaseOctave,
    velocity,
    setVelocity,
    stepCursor,
    setStepCursor,
    maxSteps: PIANO_STEPS,
    stepSize: Math.max(1, Math.round(selectedGrid)),
    onTriggerPitch: handleMusicalTypingTrigger,
    recordEnabled: isKeyRecEnabled,
  });

  if (!pianoTrack) {
    return (
      <div className="pianoroll-wrap">
        <div className="pianoroll-empty-card">
          <Key size={22} className="pianoroll-empty-icon" />
          <p className="pianoroll-empty-desc">
            Create a polyphonic synth track to compose melodies &amp; chords with mouse or laptop QWERTY keys.
          </p>
          <Button
            size="sm"
            variant="default"
            onClick={() => {
              addTrack('pianoroll', 'Keys Synth');
              setIsModalOpen(true);
            }}
          >
            <Plus size={13} /> CREATE KEYS TRACK
          </Button>
        </div>
      </div>
    );
  }

  const versions = pianoTrack.versions && pianoTrack.versions.length > 0
    ? pianoTrack.versions
    : [{ id: '1', number: 1, createdAt: 0 }];
  const activeVerId = pianoTrack.activeVersionId || versions[versions.length - 1].id;

  const renderToolbar = (inModal = false) => (
    <div className={`pianoroll-toolbar daw-ui-toolbar ${inModal ? 'is-modal-toolbar' : ''}`}>
      <div className="synth-version-pills">
        {versions.map((ver) => (
          <Tooltip key={ver.id} title={`Keys Version #${ver.number}`}>
            <button
              type="button"
              className={`synth-ver-pill ${activeVerId === ver.id ? 'active' : ''}`}
              onClick={() => selectSynthVersion(pianoTrack.id, ver.id)}
            >
              #{ver.number}
            </button>
          </Tooltip>
        ))}
        <Tooltip title="New Keys Version" description="Create a fresh version (#N+1) on this Keys lane">
          <button
            type="button"
            className="synth-ver-pill add"
            onClick={() => addSynthVersion(pianoTrack.id)}
            aria-label="Create new Keys version"
          >
            <Plus size={11} />
          </button>
        </Tooltip>
      </div>

      <div className="pianoroll-controls-cluster">
        {/* Octave Shift */}
        <div className="pianoroll-octave-picker">
          <Tooltip title="Octave Down (Key: Z)">
            <button
              type="button"
              className="pianoroll-mini-btn"
              disabled={baseOctave <= 1}
              onClick={() => setBaseOctave((o) => Math.max(1, o - 1))}
            >
              <ChevronDown size={12} />
            </button>
          </Tooltip>
          <span className="pianoroll-octave-val">C{baseOctave}–B{baseOctave + 1}</span>
          <Tooltip title="Octave Up (Key: X)">
            <button
              type="button"
              className="pianoroll-mini-btn"
              disabled={baseOctave >= 6}
              onClick={() => setBaseOctave((o) => Math.min(6, o + 1))}
            >
              <ChevronUp size={12} />
            </button>
          </Tooltip>
        </div>

        {/* Tempo / Division Dropdown */}
        <Tooltip title="Step Division" description="Grid note length and quantization division">
          <select
            className="toolbox-text-input toolbox-select-compact pianoroll-grid-select daw-select daw-ui-select"
            aria-label="Note division"
            value={selectedGrid}
            onChange={(e) => setSelectedGrid(parseFloat(e.target.value))}
          >
            {GRID_DIVISIONS.map((g) => (
              <option key={g.label} value={g.steps}>
                {g.label}
              </option>
            ))}
          </select>
        </Tooltip>

        {/* Velocity Dropdown */}
        <Tooltip title="Note Velocity (Keys: C / V)" description="Default velocity for newly placed notes">
          <select
            className="toolbox-text-input toolbox-select-compact pianoroll-vel-select daw-select daw-ui-select"
            aria-label="Note velocity"
            value={velocity}
            onChange={(e) => setVelocity(parseFloat(e.target.value))}
          >
            {[0.25, 0.5, 0.75, 0.85, 0.9, 1.0].map((v) => (
              <option key={v} value={v}>
                VEL {Math.round(v * 100)}%
              </option>
            ))}
          </select>
        </Tooltip>

        {inModal && (
          <Tooltip
            title="Computer Keyboard Step Recording"
            description="When active, typing laptop keys [A–'] records notes at the step cursor and advances automatically"
          >
            <button
              type="button"
              className={`daw-ui-btn daw-keyrec-btn ${isKeyRecEnabled ? 'active' : ''}`}
              onClick={() => setIsKeyRecEnabled((v) => !v)}
            >
              <Disc size={11} />
              <span>KEY {isKeyRecEnabled ? `S${stepCursor + 1}` : 'OFF'}</span>
            </button>
          </Tooltip>
        )}

        {/* Quantize Action */}
        <Tooltip title="Quantize Notes to Selected Division">
          <Button
            size="sm"
            variant="outline"
            className="pianoroll-action-btn daw-ui-btn"
            onClick={() => quantizePianoRoll(pianoTrack.id, selectedGrid)}
          >
            <Magnet size={12} />
            <span className="daw-btn-label">QUANTIZE</span>
          </Button>
        </Tooltip>

        {/* Clear Bin Action */}
        <Tooltip title="Clear All Notes">
          <Button
            size="sm"
            variant="outline"
            className="pianoroll-action-btn daw-ui-btn danger"
            disabled={notes.length === 0}
            onClick={() => clearPianoRollNotes(pianoTrack.id)}
            aria-label="Clear notes"
          >
            <Trash2 size={12} />
          </Button>
        </Tooltip>
      </div>
    </div>
  );

  return (
    <div className="pianoroll-wrap daw-compact-instrument-deck">
      {/* Row 1: Single-Row Command Bar */}
      {renderToolbar(false)}

      {/* Row 2: Self-Contained Compact Preview + Expand Modal Trigger */}
      <div className="daw-instrument-preview-row">
        <Tooltip
          title="Click to open full 2-octave Piano Roll & QWERTY Synth Modal"
          className="daw-preview-grow-wrap"
        >
        <div
          className="daw-instrument-preview-viz"
          onClick={() => setIsModalOpen(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsModalOpen(true);
            }
          }}
        >
          <span className="daw-instrument-preview-badge">
            {notes.length} {notes.length === 1 ? 'NOTE' : 'NOTES'}
          </span>

          <div className="daw-instrument-preview-steps" onClick={(e) => e.stopPropagation()}>
            {QUICK_PREVIEW_NOTES.map((noteName) => {
              const pitch = `${noteName}${baseOctave}`;
              const hasNote = notes.some((n) => n.pitch === pitch);
              const isAuditioning = activeAuditionPitch === pitch || heldPitches.has(pitch);
              return (
                <Tooltip key={pitch} title={`Audition ${pitch}`}>
                  <button
                    type="button"
                    className={`pianoroll-mini-btn ${hasNote || isAuditioning ? 'active' : ''}`}
                    onClick={() => handleKeyAudition(pitch)}
                  >
                    {pitch}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>
        </Tooltip>

        <button
          type="button"
          className="daw-expand-modal-btn"
          onClick={() => setIsModalOpen(true)}
        >
          <Maximize2 size={12} />
          <span>OPEN KEYS EDITOR</span>
        </button>
      </div>

      {/* Expanded Full-Featured 2D Piano Roll + QWERTY Synth Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={`PIANO ROLL & QWERTY SYNTH • ${pianoTrack.name.toUpperCase()}`}
        size="lg"
      >
        <div className="daw-instrument-modal-body">
          {renderToolbar(true)}

          <div className="pianoroll-body">
            {/* Left Keys Gutter with QWERTY Keycap Badges */}
            <div className="pianoroll-keys-gutter">
              {pitches.map((pitch) => {
                const isAccidental = pitch.includes('#');
                const isAuditioning = activeAuditionPitch === pitch || heldPitches.has(pitch);
                const keycap = getKeycapForPitch(pitch, baseOctave);
                return (
                  <Tooltip
                    key={pitch}
                    title={keycap ? `Play ${pitch} (Laptop Key: [${keycap}])` : `Play ${pitch}`}
                    className="pianoroll-key-wrap"
                  >
                    <div
                      className={`pianoroll-key ${isAccidental ? 'accidental' : 'natural'} ${isAuditioning ? 'active' : ''}`}
                      onClick={() => handleKeyAudition(pitch)}
                    >
                      {keycap && <kbd className="daw-keycap-badge">{keycap}</kbd>}
                      <span className="pianoroll-key-label">{pitch}</span>
                    </div>
                  </Tooltip>
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
                        const isCursorStep = isKeyRecEnabled && stepIdx === stepCursor;
                        return (
                          <button
                            type="button"
                            aria-label={`Add ${pitch} at step ${stepIdx + 1}`}
                            key={stepIdx}
                            className={`pianoroll-grid-cell ${isQuarter ? 'quarter-beat' : ''} ${isCursorStep ? 'cursor-step' : ''}`}
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
                    <Tooltip
                      key={n.id}
                      title={`${n.pitch} (Step ${n.startTime + 1}, Length ${n.duration}) - Click to delete`}
                      className="pianoroll-note-wrap"
                      style={{
                        '--note-top': `${topPct}%`,
                        '--note-left': `${leftPct}%`,
                        '--note-w': `${widthPct}%`,
                        '--note-h': `${rowHeightPct}%`,
                      } as React.CSSProperties}
                    >
                      <button
                        type="button"
                        aria-label={`Remove ${n.pitch} at step ${n.startTime + 1}`}
                        className="pianoroll-note-item"
                        style={{
                          '--note-opacity': 0.4 + (n.velocity || 0.8) * 0.6,
                        } as React.CSSProperties}
                        onClick={(e) => {
                          e.stopPropagation();
                          removePianoRollNote(pianoTrack.id, n.id);
                        }}
                      >
                        <span className="pianoroll-note-label">{n.pitch}</span>
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Musical Typing Legend Footer */}
          <div className="pianoroll-footer">
            <span className="pianoroll-hint">
              <strong>QWERTY SYNTH:</strong> Home Row <kbd>A</kbd>–<kbd>&apos;</kbd> White Keys • Top Row <kbd>W</kbd> <kbd>E</kbd> <kbd>T</kbd> <kbd>Y</kbd> <kbd>U</kbd> <kbd>O</kbd> <kbd>P</kbd> Black Keys
            </span>
            <span className="pianoroll-hint">
              <kbd>Z</kbd>/<kbd>X</kbd> Octave • <kbd>C</kbd>/<kbd>V</kbd> Velocity • <kbd>←</kbd>/<kbd>→</kbd> Step Cursor ({stepCursor + 1}/{PIANO_STEPS})
            </span>
          </div>
        </div>
      </Modal>
    </div>
  );
};
