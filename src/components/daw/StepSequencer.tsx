import React from 'react';
import { useDawStore, DAWTrack } from '../../lib/daw/store';
import { dawEngine } from '../../lib/daw/engine';
import { DRUM_STEPS } from '../../lib/daw/notes';
import { Button } from '../button';
import { Badge } from '../badge';
import { Drum, Plus, Volume2, Trash2, Shuffle, Play, Square } from 'lucide-react';

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
    bpm,
  } = useDawStore();

  const sequencerTrack =
    (track && track.type === 'sequencer' ? track : null) ||
    tracks.find((t) => t.id === selectedTrackId && t.type === 'sequencer') ||
    tracks.find((t) => t.type === 'sequencer');

  if (!sequencerTrack) {
    return (
      <div className="sequencer-wrap">
        <div className="sequencer-empty-card">
          <Drum size={32} className="sequencer-empty-icon" />
          <h4 className="sequencer-empty-title">NO DRUM SEQUENCER TRACK ACTIVE</h4>
          <p className="sequencer-empty-desc">
            Create a 16-step rhythmic drum machine track to program kicks, snares, claps, and percussion.
          </p>
          <Button
            size="sm"
            variant="default"
            onClick={() => addTrack('sequencer', 'Drum Machine')}
          >
            <Plus size={13} /> CREATE DRUM TRACK
          </Button>
        </div>
      </div>
    );
  }

  const voices = sequencerTrack.sequencerVoices || [];
  const activeStep =
    sequencerSteps && typeof sequencerSteps[sequencerTrack.id] === 'number'
      ? (sequencerSteps[sequencerTrack.id] as number)
      : 0;

  const handleStepClick = (voiceIdx: number, stepIdx: number) => {
    const voice = voices[voiceIdx];
    if (!voice) return;

    toggleSequencerStep(sequencerTrack.id, voiceIdx, stepIdx);

    // Audition sound if turning on
    const willBeActive = !voice.steps[stepIdx];
    if (willBeActive) {
      const voiceKey = voice.name.toLowerCase().replace(/[^a-z]/g, '') as any;
      dawEngine.triggerDrum(sequencerTrack.id, voiceKey, voice.velocity[stepIdx] || 0.85);
    }
  };

  const handleVoiceAudition = (voiceIdx: number) => {
    const voice = voices[voiceIdx];
    if (!voice) return;
    const voiceKey = voice.name.toLowerCase().replace(/[^a-z]/g, '') as any;
    dawEngine.triggerDrum(sequencerTrack.id, voiceKey, 0.9);
  };

  return (
    <div className="sequencer-wrap">
      {/* Top Toolbar */}
      <div className="sequencer-toolbar">
        <div className="sequencer-meta">
          <Drum size={14} className="sequencer-meta-icon" />
          <span className="sequencer-track-name">{sequencerTrack.name}</span>
          <Badge variant="outline">{bpm} BPM</Badge>
          <Badge variant="outline">{DRUM_STEPS} STEPS</Badge>
        </div>

        <div className="sequencer-controls-cluster">
          {/* Transport preview toggle */}
          <Button
            size="sm"
            variant={isPlaying ? 'secondary' : 'default'}
            className="sequencer-action-btn"
            onClick={() => {
              if (isPlaying) {
                dawEngine.pauseTransport();
              } else {
                dawEngine.startTransport();
              }
            }}
          >
            {isPlaying ? <Square size={11} /> : <Play size={11} />}
            {isPlaying ? 'STOP' : 'PLAY'}
          </Button>

          {/* Randomize generator */}
          <Button
            size="sm"
            variant="outline"
            className="sequencer-action-btn"
            onClick={() => randomizeSequencerSteps(sequencerTrack.id, 0.25)}
            title="Randomize pattern"
          >
            <Shuffle size={11} /> RANDOMIZE
          </Button>

          {/* Clear all */}
          <Button
            size="sm"
            variant="outline"
            className="sequencer-action-btn danger"
            onClick={() => clearSequencerSteps(sequencerTrack.id)}
            title="Clear all steps"
          >
            <Trash2 size={11} /> CLEAR
          </Button>
        </div>
      </div>

      {/* Sequencer Grid */}
      <div className="sequencer-grid">
        {/* Step Numbers Scale Header */}
        <div className="sequencer-scale-row">
          <div className="sequencer-scale-spacer">VOICE</div>
          <div className="sequencer-steps-scale">
            {Array.from({ length: DRUM_STEPS }).map((_, stepIdx) => {
              const isBarBeat = stepIdx % 4 === 0;
              const isCurrent = isPlaying && activeStep === stepIdx;
              return (
                <div
                  key={stepIdx}
                  className={`sequencer-step-num ${isBarBeat ? 'bar-beat' : ''} ${isCurrent ? 'current' : ''}`}
                >
                  {stepIdx + 1}
                </div>
              );
            })}
          </div>
        </div>

        {/* Drum Voice Rows */}
        <div className="sequencer-lanes-list">
          {voices.map((voice, voiceIdx) => (
            <div key={voice.name} className="sequencer-voice-row">
              {/* Voice Strip */}
              <div
                className="sequencer-voice-strip"
                onClick={() => handleVoiceAudition(voiceIdx)}
                title={`Click to audition ${voice.name}`}
              >
                <div className="sequencer-voice-badge">{voice.name}</div>
                <Volume2 size={11} className="sequencer-voice-icon" />
              </div>

              {/* 16 Step Buttons */}
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
          ))}
        </div>
      </div>

      {/* Footer Info */}
      <div className="sequencer-footer">
        <span className="sequencer-hint">
          Click any pad to toggle beat • Click voice title to audition sound • 4-step measure accenting
        </span>
      </div>
    </div>
  );
};
