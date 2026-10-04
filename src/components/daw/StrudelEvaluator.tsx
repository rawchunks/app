import React from 'react';
import { StrudelEditor } from './StrudelEditor';
import { DAWTrack } from '../../lib/daw/store';

interface StrudelEvaluatorProps {
  track?: DAWTrack;
}

export const StrudelEvaluator: React.FC<StrudelEvaluatorProps> = (props) => {
  return <StrudelEditor {...props} />;
};

export default StrudelEvaluator;
