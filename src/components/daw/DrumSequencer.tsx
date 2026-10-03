import React from 'react';
import { StepSequencer } from './StepSequencer';
import { DAWTrack } from '../../lib/daw/store';

interface DrumSequencerProps {
  track?: DAWTrack;
}

export const DrumSequencer: React.FC<DrumSequencerProps> = (props) => {
  return <StepSequencer {...props} />;
};

export default DrumSequencer;
