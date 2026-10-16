import React, { useState, useEffect, useCallback } from 'react';
import { useDawStore, DAWTrack } from '../../lib/daw/store';
import { dawEngine } from '../../lib/daw/engine';
import { DRUM_STEPS } from '../../lib/daw/notes';
import { Button } from '../button';
import { Badge } from '../badge';
import { Modal } from '../modal';
import { Tooltip } from './Tooltip';
import { Drum, Plus, Volume2, Trash2, Shuffle, Maximize2 } from 'lucide-react';

interface StepSequencerProps {
  track?: DAWTrack;
}

export const StepSequencer: React.FC<StepSequencerProps> = ({ track }) => {
  const {
    tracks,
    selectedTrackId,
    addTrack,
    toggleSequencerStep,
    clearSequencerSteps,
    randomizeSequencerSteps,
    isPlaying,
    sequencerSteps,
    pendingModalTrackId,
    clearPendingModalTrackId,
  } = useDawStore();

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [previewVoiceIdx, setPreviewVoiceIdx] = useState<number>(0);

  const sequencerTrack =
    (track && track.type === 'sequencer' ? track : null) ||
    tracks.find((t) => t.id === selectedTrackId && t.type === 'sequencer') ||
    tracks.find((t) => t.type === 'sequencer');

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

      toggleSequencerStep(sequencerTrack.id, voiceIdx, stepIdx);

      const willBeActive = !voice.steps[stepIdx];
      if (willBeActive) {
        const voiceKey = voice.name.toLowerCase().replace(/[^a-z]/g, '') as any;
        dawEngine.triggerDrum(sequencerTrack.id, voiceKey, voice.velocity[stepIdx] || 0.85);
      }
    },
    [sequencerTrack, voices, toggleSequencerStep]
  );

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

  const renderToolbar = (showVoiceSelect: boolean) => (
    <div className="sequencer-toolbar daw-ui-toolbar">
      <div className="sequencer-meta">
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
        <div
          className="daw-instrument-preview-viz"
          title="Click steps to toggle active voice or click Open Drum Matrix for all voices & QWERTY pads"
        >
          {activePreviewVoice && (
            <button
              type="button"
              className="daw-instrument-preview-badge"
              onClick={() => handleVoiceAudition(safeVoiceIdx)}
              title={`Audition ${activePreviewVoice.name}`}
            >
              {activePreviewVoice.name.toUpperCase()}
            </button>
          )}

          <div className="daw-instrument-preview-steps">
            {activePreviewVoice
              ? activePreviewVoice.steps.map((isActive, stepIdx) => {
                  const isCurrent = isPlaying && activeStep === stepIdx;
                  const isMeasureStart = stepIdx % 4 === 0;
                  return (
                    <button
                      key={stepIdx}
                      type="button"
                      className={`sequencer-step-pad ${isActive ? 'active' : ''} ${isMeasureStart ? 'measure-start' : ''} ${isCurrent ? 'playhead-active' : ''}`}
                      onClick={() => handleStepClick(safeVoiceIdx, stepIdx)}
                      aria-pressed={isActive}
                      aria-label={`${activePreviewVoice.name} step ${stepIdx + 1}`}
                      title={`${activePreviewVoice.name} • Step ${stepIdx + 1}`}
                    >
                      <div className="sequencer-pad-led" />
                    </button>
                  );
                })
              : null}
          </div>
        </div>

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
                  const isCurrent = (isPlaying && activeStep === stepIdx);
                  return (
                    <div
                      key={stepIdx}
                      className={`sequencer-step-num ${isBarBeat ? 'bar-beat' : ''} ${isCurrent ? 'current' : ''}`}
                      title={`Set step cursor to step ${stepIdx + 1}`}
                    >
                      {stepIdx + 1}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Drum Voice Rows */}
            <div className="sequencer-lanes-list">
              {voices.map((voice, voiceIdx) => {
                return (
                  <div key={voice.name} className="sequencer-voice-row">
                    <div
                      className="sequencer-voice-strip"
                      onClick={() => handleVoiceAudition(voiceIdx)}
                      title={`Audition ${voice.name}`}
                    >
                      <div className="sequencer-voice-badge-wrap">
                        <span className="sequencer-voice-badge">{voice.name}</span>
                      </div>
                      <Volume2 size={11} className="sequencer-voice-icon" />
                    </div>

                    <div className="sequencer-steps-row">
                      {voice.steps.map((isActive, stepIdx) => {
                        const isMeasureStart = stepIdx % 4 === 0;
                        const isCurrent = isPlaying && activeStep === stepIdx;
                        const measureIdx = Math.floor(stepIdx / 4);
                        const isAlternatingMeasure = measureIdx % 2 === 1;

                        return (
                          <button
                            key={stepIdx}
                            type="button"
                            className={`sequencer-step-pad ${isActive ? 'active' : ''} ${isMeasureStart ? 'measure-start' : ''} ${isAlternatingMeasure ? 'alt-measure' : ''} ${isCurrent ? 'playhead-active' : ''}`}
                            onClick={() => handleStepClick(voiceIdx, stepIdx)}
                            aria-pressed={isActive}
                            aria-label={`${voice.name} step ${stepIdx + 1}`}
                            title={`${voice.name} • Step ${stepIdx + 1} ${isActive ? '(Active)' : '(Empty)'}`}
                          >
                            <div className="sequencer-pad-led" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </Modal>
    </div>
  );
};
