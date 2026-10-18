import type { DAWTrack } from './store';
import { parseStrudelPattern } from './strudel';

export const BEAT_STEPS = 4;
export const DRUM_STEPS = 16;
export const PIANO_STEPS = 32;

export interface Note {
  id: string;
  label: string;
  row: number;
  start: number;
  duration: number;
  velocity: number;
  muted: boolean;
}

export function sequence(
  track: Pick<DAWTrack, 'type' | 'pianoRollNotes' | 'sequencerVoices' | 'strudelCode'>,
  bpm: number
) {
  const step = 60 / bpm / BEAT_STEPS;
  if (track.type === 'pianoroll') {
    const notes = track.pianoRollNotes ?? [];
    const pitches = notes.map(note => note.midi);
    const high = Math.max(...pitches);
    return {
      duration: PIANO_STEPS * step,
      rows: notes.length ? high - Math.min(...pitches) + 1 : 1,
      notes: notes.map(note => ({
        id: note.id, label: note.pitch, row: high - note.midi,
        start: note.startTime * step, duration: note.duration * step,
        velocity: note.velocity, muted: false,
      })),
    };
  }
  if (track.type === 'strudel') {
    const parsed = parseStrudelPattern(track.strudelCode || '');
    const rate = Math.max(0.125, parsed.rateModifier || 1.0);
    const cycleDuration = (DRUM_STEPS * step) / rate;
    const uniqueLabels = Array.from(new Set(parsed.events.map(ev => ev.value)));
    return {
      duration: cycleDuration,
      rows: Math.max(1, uniqueLabels.length),
      notes: parsed.events.map((ev, index) => ({
        id: `strudel-${index}-${ev.value}`,
        label: ev.value.toUpperCase(),
        row: Math.max(0, uniqueLabels.indexOf(ev.value)),
        start: ev.time * cycleDuration,
        duration: Math.max(step * 0.25, ev.duration * cycleDuration),
        velocity: Math.min(1, Math.max(0.1, ev.gain ?? 0.85)),
        muted: false,
      })),
    };
  }
  const voices = track.sequencerVoices ?? [];
  return {
    duration: DRUM_STEPS * step,
    rows: Math.max(1, voices.length),
    notes: voices.flatMap((voice, row) => voice.steps.flatMap((active, index) => active ? [{
      id: `${row}-${index}`, label: voice.name, row,
      start: index * step, duration: step,
      velocity: voice.velocity[index] ?? 0.8, muted: voice.muted,
    }] : [])),
  };
}

