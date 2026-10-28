import React, { useState, useEffect, useCallback } from 'react';
import { useDawStore, DAWTrack } from '../../lib/daw/store';
import { dawEngine } from '../../lib/daw/engine';
import { DRUM_STEPS } from '../../lib/daw/notes';
import {
  useDrumMusicalTyping,
  getDrumKeycap,
} from '../../lib/daw/typing';
import { Button } from '../button';
import { Badge } from '../badge';
import { Modal } from '../modal';
import { Tooltip } from './Tooltip';
import { Drum, Plus, Volume2, Trash2, Shuffle, Maximize2, Disc } from 'lucide-react';

interface DrumsProps {
  track?: DAWTrack;
}

export const Drums: React.FC<DrumsProps> = ({ track }) => {
  const tracks = useDawStore((s) => s.tracks);
  const selectedTrackId = useDawStore((s) => s.selectedTrackId);
  const addTrack = useDawStore((s) => s.addTrack);
  const toggleSequencerStep = useDawStore((s) => s.toggleSequencerStep);
  const clearSequencerSteps = useDawStore((s) => s.clearSequencerSteps);
  const randomizeSequencerSteps = useDawStore((s) => s.randomizeSequencerSteps);
  const addSynthVersion = useDawStore((s) => s.addSynthVersion);
  const selectSynthVersion = useDawStore((s) => s.selectSynthVersion);
  const isPlaying = useDawStore((s) => s.isPlaying);
  const sequencerSteps = useDawStore((s) => s.sequencerSteps);
  const pendingModalTrackId = useDawStore((s) => s.pendingModalTrackId);
  const clearPendingModalTrackId = useDawStore((s) => s.clearPendingModalTrackId);

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [previewVoiceIdx, setPreviewVoiceIdx] = useState<number>(0);
  const [isKeyRecEnabled, setIsKeyRecEnabled] = useState<boolean>(true);
  const [stepCursor, setStepCursor] = useState<number>(0);

  const isDrumTrack = (t: DAWTrack) =>
    t.type === 'sequencer' || Boolean(t.sequencerVoices && t.sequencerVoices.length > 0);

  const sequencerTrack =
    (track && isDrumTrack(track) ? track : null) ||
    tracks.find((t) => t.id === selectedTrackId && isDrumTrack(t)) ||
    tracks.find((t) => isDrumTrack(t));

  useEffect(() => {
    if (sequencerTrack && pendingModalTrackId === sequencerTrack.id) {
      setIsModalOpen(true);
      clearPendingModalTrackId();
    }
  }, [sequencerTrack?.id, pendingModalTrackId, clearPendingModalTrackId]);

  const voices = sequencerTrack?.sequencerVoices || [];
  const activeStep =
    sequencerTrack && sequencerSteps && typeof sequencerSteps[sequencerTrack.id] === 'number'
      ? (sequencerSteps[sequencerTrack.id] as number)
      : 0;

  const safeVoiceIdx = Math.min(previewVoiceIdx, Math.max(0, voices.length - 1));
  const activePreviewVoice = voices[safeVoiceIdx];

  const handleVoiceAudition = useCallback(
    (voiceIdx: number) => {
      if (!sequencerTrack) return;
      const voice = voices[voiceIdx];
      if (!voice) return;
      const voiceKey = voice.name.toLowerCase().replace(/[^a-z]/g, '') as any;
      dawEngine.triggerDrum(sequencerTrack.id, voiceKey, 0.9);
    },
    [sequencerTrack, voices]
  );

  const handleStepClick = useCallback(
    (voiceIdx: number, stepIdx: number) => {
      if (!sequencerTrack) return;
      const voice = voices[voiceIdx];
      if (!voice) return;

      setStepCursor(stepIdx);
      toggleSequencerStep(sequencerTrack.id, voiceIdx, stepIdx);

      const willBeActive = !voice.steps[stepIdx];
      if (willBeActive) {
        const voiceKey = voice.name.toLowerCase().replace(/[^a-z]/g, '') as any;
        dawEngine.triggerDrum(sequencerTrack.id, voiceKey, voice.velocity[stepIdx] || 0.85);
      }
    },
    [sequencerTrack, voices, toggleSequencerStep]
  );

  const handleDrumTypingTrigger = useCallback(
    (voiceIdx: number, shouldRecord: boolean) => {
      if (!sequencerTrack || voiceIdx >= voices.length) return;
      setPreviewVoiceIdx(voiceIdx);
      handleVoiceAudition(voiceIdx);
      if (shouldRecord) {
        const targetStep = isPlaying ? activeStep : stepCursor;
        toggleSequencerStep(sequencerTrack.id, voiceIdx, targetStep);
        if (!isPlaying) {
          setStepCursor((prev) => (prev + 1) % DRUM_STEPS);
        }
      }
    },
    [sequencerTrack, voices.length, handleVoiceAudition, isPlaying, activeStep, stepCursor, toggleSequencerStep]
  );

  const { heldVoices } = useDrumMusicalTyping({
    enabled: isModalOpen && Boolean(sequencerTrack),
    stepCursor,
    setStepCursor,
    maxSteps: DRUM_STEPS,
    recordEnabled: isKeyRecEnabled,
    onTriggerVoice: handleDrumTypingTrigger,
  });

  if (!sequencerTrack) {
    return (
      <div className="sequencer-wrap">
        <div className="sequencer-empty-card">
          <Drum size={22} className="sequencer-empty-icon" />
          <p className="sequencer-empty-desc">
            Create a 16-step rhythmic drum machine track to program kicks, snares, claps &amp; live QWERTY pads.
          </p>
          <Button
            size="sm"
            variant="default"
            onClick={() => {
              addTrack('sequencer', 'Drum Machine');
              setIsModalOpen(true);
            }}
          >
            <Plus size={13} /> CREATE DRUMS TRACK
          </Button>
        </div>
      </div>
    );
  }

  const versions = sequencerTrack.versions && sequencerTrack.versions.length > 0
    ? sequencerTrack.versions
    : [{ id: '1', number: 1, createdAt: 0 }];
  const hasOriginal = sequencerTrack.type === 'stem' && sequencerTrack.hasOriginalStem !== false;
  const activeVerId = sequencerTrack.type === 'stem'
    ? sequencerTrack.activeVersionId || null
    : sequencerTrack.activeVersionId || versions[versions.length - 1].id;

  const renderToolbar = (showVoiceSelect: boolean) => (
    <div className="sequencer-toolbar daw-ui-toolbar">
      <div className="sequencer-meta">
        <div className="synth-version-pills">
          {hasOriginal && (
            <Tooltip title="Original Drum Stem">
              <button
                type="button"
                className={`synth-ver-pill ${!activeVerId ? 'active' : ''}`}
                onClick={() => selectSynthVersion(sequencerTrack.id, 'ORG')}
              >
                ORG
              </button>
            </Tooltip>
          )}
          {versions.map((ver) => (
            <Tooltip key={ver.id} title={`Drums Version #${ver.number}`}>
              <button
                type="button"
                className={`synth-ver-pill ${activeVerId === ver.id ? 'active' : ''}`}
                onClick={() => selectSynthVersion(sequencerTrack.id, ver.id)}
              >
                #{ver.number}
              </button>
            </Tooltip>
          ))}
          <Tooltip title="New Drums Version" description="Create a fresh version (#N+1) on this Drums lane">
            <button
              type="button"
              className="synth-ver-pill add"
              onClick={() => addSynthVersion(sequencerTrack.id)}
              aria-label="Create new Drums version"
            >
              <Plus size={11} />
            </button>
          </Tooltip>
        </div>
        <Badge variant="outline">{DRUM_STEPS} STEPS</Badge>
        {showVoiceSelect && voices.length > 0 && (
          <Tooltip title="Quick Lane Selector" description="Select drum voice lane for inline 16-step editing">
            <select
              className="toolbox-text-input toolbox-select-compact daw-select daw-ui-select"
              aria-label="Drum voice lane"
              value={safeVoiceIdx}
              onChange={(e) => {
                const idx = parseInt(e.target.value, 10);
                setPreviewVoiceIdx(idx);
                handleVoiceAudition(idx);
              }}
            >
              {voices.map((v, idx) => (
                <option key={v.name} value={idx}>
                  {v.name.toUpperCase()} ({v.steps.filter(Boolean).length})
                </option>
              ))}
            </select>
          </Tooltip>
        )}
      </div>

      <div className="sequencer-controls-cluster">
        {!showVoiceSelect && (
          <Tooltip
            title="Computer Keyboard Pad Recording"
            description="When active, pressing laptop keys [1–5] or [Q–T] triggers and toggles drum steps at the cursor/playhead"
          >
            <button
              type="button"
              className={`daw-ui-btn daw-keyrec-btn ${isKeyRecEnabled ? 'active' : ''}`}
              onClick={() => setIsKeyRecEnabled((v) => !v)}
            >
              <Disc size={11} />
              <span>PAD REC {isKeyRecEnabled ? `• S${(isPlaying ? activeStep : stepCursor) + 1}` : 'OFF'}</span>
            </button>
          </Tooltip>
        )}

        {/* Randomize generator */}
        <Tooltip title="Randomize Drum Pattern">
          <Button
            size="sm"
            variant="outline"
            className="sequencer-action-btn daw-ui-btn"
            onClick={() => randomizeSequencerSteps(sequencerTrack.id, 0.25)}
          >
            <Shuffle size={11} />
            <span className="daw-btn-label">RANDOMIZE</span>
          </Button>
        </Tooltip>

        {/* Clear all */}
        <Tooltip title="Clear All Steps">
          <Button
            size="sm"
            variant="outline"
            className="sequencer-action-btn daw-ui-btn danger"
            onClick={() => clearSequencerSteps(sequencerTrack.id)}
            aria-label="Clear all steps"
          >
            <Trash2 size={11} />
          </Button>
        </Tooltip>
      </div>
    </div>
  );

  return (
    <div className="sequencer-wrap daw-compact-instrument-deck">
      {/* Row 1: Single-Row Command Bar */}
      {renderToolbar(true)}

      {/* Row 2: Inline 16-Step Lane Preview + Expand Full Matrix Modal */}
      <div className="daw-instrument-preview-row">
        <Tooltip
          title="Click steps to toggle active voice or click Open Drum Matrix for all voices & QWERTY pads"
          className="daw-preview-grow-wrap"
        >
        <div className="daw-instrument-preview-viz">
          {activePreviewVoice && (
            <Tooltip title={`Audition ${activePreviewVoice.name}`}>
              <button
                type="button"
                className="daw-instrument-preview-badge"
                onClick={() => handleVoiceAudition(safeVoiceIdx)}
              >
                {activePreviewVoice.name.toUpperCase()}
              </button>
            </Tooltip>
          )}

          <div className="daw-instrument-preview-steps">
            {activePreviewVoice
              ? activePreviewVoice.steps.map((isActive, stepIdx) => {
                  const isCurrent = isPlaying && activeStep === stepIdx;
                  const isMeasureStart = stepIdx % 4 === 0;
                  return (
                    <Tooltip
                      key={stepIdx}
                      title={`${activePreviewVoice.name} • Step ${stepIdx + 1}`}
                      className="sequencer-pad-wrap"
                    >
                      <button
                        type="button"
                        className={`sequencer-step-pad ${isActive ? 'active' : ''} ${isMeasureStart ? 'measure-start' : ''} ${isCurrent ? 'playhead-active' : ''}`}
                        onClick={() => handleStepClick(safeVoiceIdx, stepIdx)}
                        aria-pressed={isActive}
                        aria-label={`${activePreviewVoice.name} step ${stepIdx + 1}`}
                      >
                        <div className="sequencer-pad-led" />
                      </button>
                    </Tooltip>
                  );
                })
              : null}
          </div>
        </div>
        </Tooltip>

        <button
          type="button"
          className="daw-expand-modal-btn"
          onClick={() => setIsModalOpen(true)}
        >
          <Maximize2 size={12} />
          <span>OPEN DRUM MATRIX</span>
        </button>
      </div>

      {/* Expanded Full Multi-Voice 16-Step Drum Matrix Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={`16-STEP DRUM MATRIX & QWERTY PADS • ${sequencerTrack.name.toUpperCase()}`}
        size="lg"
      >
        <div className="daw-instrument-modal-body">
          {renderToolbar(false)}

          <div className="sequencer-grid">
            {/* Step Numbers Scale Header */}
            <div className="sequencer-scale-row">
              <div className="sequencer-scale-spacer">VOICE / PAD</div>
              <div className="sequencer-steps-scale">
                {Array.from({ length: DRUM_STEPS }).map((_, stepIdx) => {
                  const isBarBeat = stepIdx % 4 === 0;
                  const isCurrent = (isPlaying && activeStep === stepIdx) || (!isPlaying && isKeyRecEnabled && stepCursor === stepIdx);
                  return (
                    <Tooltip
                      key={stepIdx}
                      title={`Set step cursor to step ${stepIdx + 1}`}
                      className="sequencer-cell-wrap"
                    >
                      <div
                        className={`sequencer-step-num ${isBarBeat ? 'bar-beat' : ''} ${isCurrent ? 'current' : ''}`}
                        onClick={() => setStepCursor(stepIdx)}
                      >
                        {stepIdx + 1}
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
            </div>

            {/* Drum Voice Rows */}
            <div className="sequencer-lanes-list">
              {voices.map((voice, voiceIdx) => {
                const keycap = getDrumKeycap(voiceIdx);
                const isHeld = heldVoices.has(voiceIdx);
                return (
                  <div key={voice.name} className="sequencer-voice-row">
                    <Tooltip
                      title={keycap ? `Audition ${voice.name} (Keys: [${keycap}])` : `Audition ${voice.name}`}
                      className="sequencer-voice-wrap"
                    >
                      <div
                        className={`sequencer-voice-strip ${isHeld ? 'active' : ''}`}
                        onClick={() => handleVoiceAudition(voiceIdx)}
                      >
                        <div className="sequencer-voice-badge-wrap">
                          {keycap && <kbd className="daw-keycap-badge">{keycap}</kbd>}
                          <span className="sequencer-voice-badge">{voice.name}</span>
                        </div>
                        <Volume2 size={11} className="sequencer-voice-icon" />
                      </div>
                    </Tooltip>

                    <div className="sequencer-steps-row">
                      {voice.steps.map((isActive, stepIdx) => {
                        const isMeasureStart = stepIdx % 4 === 0;
                        const isCurrent = isPlaying && activeStep === stepIdx;
                        const isCursor = !isPlaying && isKeyRecEnabled && stepCursor === stepIdx;
                        const measureIdx = Math.floor(stepIdx / 4);
                        const isAlternatingMeasure = measureIdx % 2 === 1;

                        return (
                          <Tooltip
                            key={stepIdx}
                            title={`${voice.name} • Step ${stepIdx + 1} ${isActive ? '(Active)' : '(Empty)'}`}
                            className="sequencer-pad-wrap"
                          >
                            <button
                              type="button"
                              className={`sequencer-step-pad ${isActive ? 'active' : ''} ${isMeasureStart ? 'measure-start' : ''} ${isAlternatingMeasure ? 'alt-measure' : ''} ${isCurrent || isCursor ? 'playhead-active' : ''}`}
                              onClick={() => handleStepClick(voiceIdx, stepIdx)}
                              aria-pressed={isActive}
                              aria-label={`${voice.name} step ${stepIdx + 1}`}
                            >
                              <div className="sequencer-pad-led" />
                            </button>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="sequencer-footer">
            <span className="sequencer-hint">
              <strong>QWERTY PADS:</strong> Keys <kbd>1</kbd>–<kbd>5</kbd> or <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd> <kbd>T</kbd> Trigger &amp; Record Voices
            </span>
            <span className="sequencer-hint">
              <kbd>←</kbd>/<kbd>→</kbd> Move Step Cursor ({stepCursor + 1}/{DRUM_STEPS})
            </span>
          </div>
        </div>
      </Modal>
    </div>
  );
};
