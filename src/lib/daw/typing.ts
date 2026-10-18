import { useEffect, useState } from 'react';

const CHROMATIC_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Standard Ableton Live / Logic Pro Chromatic Computer Keyboard Layout (18 semitones)
 * Home row = White keys (C, D, E, F, G, A, B, C+1, D+1, E+1, F+1)
 * Top row  = Black keys (C#, D#, F#, G#, A#, C#+1, D#+1)
 */
export const QWERTY_PIANO_KEYMAP: { key: string; label: string; semitoneOffset: number }[] = [
  { key: 'a', label: 'A', semitoneOffset: 0 },   // C
  { key: 'w', label: 'W', semitoneOffset: 1 },   // C#
  { key: 's', label: 'S', semitoneOffset: 2 },   // D
  { key: 'e', label: 'E', semitoneOffset: 3 },   // D#
  { key: 'd', label: 'D', semitoneOffset: 4 },   // E
  { key: 'f', label: 'F', semitoneOffset: 5 },   // F
  { key: 't', label: 'T', semitoneOffset: 6 },   // F#
  { key: 'g', label: 'G', semitoneOffset: 7 },   // G
  { key: 'y', label: 'Y', semitoneOffset: 8 },   // G#
  { key: 'h', label: 'H', semitoneOffset: 9 },   // A
  { key: 'u', label: 'U', semitoneOffset: 10 },  // A#
  { key: 'j', label: 'J', semitoneOffset: 11 },  // B
  { key: 'k', label: 'K', semitoneOffset: 12 },  // C (+1 oct)
  { key: 'o', label: 'O', semitoneOffset: 13 },  // C# (+1 oct)
  { key: 'l', label: 'L', semitoneOffset: 14 },  // D (+1 oct)
  { key: 'p', label: 'P', semitoneOffset: 15 },  // D# (+1 oct)
  { key: ';', label: ';', semitoneOffset: 16 },  // E (+1 oct)
  { key: "'", label: "'", semitoneOffset: 17 },  // F (+1 oct)
];

export const QWERTY_DRUM_KEYMAP: { keys: string[]; label: string; voiceIdx: number }[] = [
  { keys: ['1', 'q'], label: '1/Q', voiceIdx: 0 }, // KICK
  { keys: ['2', 'w'], label: '2/W', voiceIdx: 1 }, // SNARE
  { keys: ['3', 'e'], label: '3/E', voiceIdx: 2 }, // CLAP
  { keys: ['4', 'r'], label: '4/R', voiceIdx: 3 }, // HI-HAT
  { keys: ['5', 't'], label: '5/T', voiceIdx: 4 }, // PERC
];

export function semitoneOffsetToPitch(baseOctave: number, semitoneOffset: number): string {
  const octaveOffset = Math.floor(semitoneOffset / 12);
  const noteIdx = ((semitoneOffset % 12) + 12) % 12;
  return `${CHROMATIC_NOTES[noteIdx]}${baseOctave + octaveOffset}`;
}

export function getKeycapForPitch(pitch: string, baseOctave: number): string | null {
  for (const mapping of QWERTY_PIANO_KEYMAP) {
    if (semitoneOffsetToPitch(baseOctave, mapping.semitoneOffset) === pitch) {
      return mapping.label;
    }
  }
  return null;
}

export function getDrumKeycap(voiceIdx: number): string | null {
  const found = QWERTY_DRUM_KEYMAP.find((m) => m.voiceIdx === voiceIdx);
  return found ? found.label : null;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

interface UsePianoMusicalTypingOptions {
  enabled: boolean;
  baseOctave: number;
  setBaseOctave: React.Dispatch<React.SetStateAction<number>>;
  velocity: number;
  setVelocity: React.Dispatch<React.SetStateAction<number>>;
  stepCursor: number;
  setStepCursor: React.Dispatch<React.SetStateAction<number>>;
  maxSteps: number;
  stepSize: number;
  onTriggerPitch: (pitch: string, recordStep: boolean) => void;
  recordEnabled: boolean;
}

export function usePianoMusicalTyping({
  enabled,
  baseOctave,
  setBaseOctave,
  setVelocity,
  setStepCursor,
  maxSteps,
  stepSize,
  onTriggerPitch,
  recordEnabled,
}: UsePianoMusicalTypingOptions) {
  const [heldPitches, setHeldPitches] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) {
      setHeldPitches(new Set());
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableElement(e.target)) return;

      const lower = e.key.toLowerCase();

      if (lower === 'z') {
        e.preventDefault();
        setBaseOctave((o) => Math.max(1, o - 1));
        return;
      }
      if (lower === 'x') {
        e.preventDefault();
        setBaseOctave((o) => Math.min(6, o + 1));
        return;
      }
      if (lower === 'c') {
        e.preventDefault();
        setVelocity((v) => Math.max(0.1, Number((v - 0.1).toFixed(2))));
        return;
      }
      if (lower === 'v') {
        e.preventDefault();
        setVelocity((v) => Math.min(1.0, Number((v + 0.1).toFixed(2))));
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setStepCursor((s) => Math.max(0, Math.round(s - stepSize)));
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setStepCursor((s) => Math.min(maxSteps - 1, Math.round(s + stepSize)));
        return;
      }

      if (e.repeat) return;

      const mapping = QWERTY_PIANO_KEYMAP.find((m) => m.key === lower);
      if (mapping) {
        e.preventDefault();
        const pitch = semitoneOffsetToPitch(baseOctave, mapping.semitoneOffset);
        setHeldPitches((prev) => {
          const next = new Set(prev);
          next.add(pitch);
          return next;
        });
        onTriggerPitch(pitch, recordEnabled);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const lower = e.key.toLowerCase();
      const mapping = QWERTY_PIANO_KEYMAP.find((m) => m.key === lower);
      if (mapping) {
        const pitch = semitoneOffsetToPitch(baseOctave, mapping.semitoneOffset);
        setHeldPitches((prev) => {
          if (!prev.has(pitch)) return prev;
          const next = new Set(prev);
          next.delete(pitch);
          return next;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    enabled,
    baseOctave,
    setBaseOctave,
    setVelocity,
    setStepCursor,
    maxSteps,
    stepSize,
    onTriggerPitch,
    recordEnabled,
  ]);

  return { heldPitches };
}

interface UseDrumMusicalTypingOptions {
  enabled: boolean;
  stepCursor: number;
  setStepCursor: React.Dispatch<React.SetStateAction<number>>;
  maxSteps: number;
  recordEnabled: boolean;
  onTriggerVoice: (voiceIdx: number, recordStep: boolean) => void;
}

export function useDrumMusicalTyping({
  enabled,
  setStepCursor,
  maxSteps,
  recordEnabled,
  onTriggerVoice,
}: UseDrumMusicalTypingOptions) {
  const [heldVoices, setHeldVoices] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!enabled) {
      setHeldVoices(new Set());
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableElement(e.target)) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setStepCursor((s) => (s - 1 + maxSteps) % maxSteps);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setStepCursor((s) => (s + 1) % maxSteps);
        return;
      }

      if (e.repeat) return;

      const lower = e.key.toLowerCase();
      const mapping = QWERTY_DRUM_KEYMAP.find((m) => m.keys.includes(lower));
      if (mapping) {
        e.preventDefault();
        setHeldVoices((prev) => {
          const next = new Set(prev);
          next.add(mapping.voiceIdx);
          return next;
        });
        onTriggerVoice(mapping.voiceIdx, recordEnabled);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const lower = e.key.toLowerCase();
      const mapping = QWERTY_DRUM_KEYMAP.find((m) => m.keys.includes(lower));
      if (mapping) {
        setHeldVoices((prev) => {
          if (!prev.has(mapping.voiceIdx)) return prev;
          const next = new Set(prev);
          next.delete(mapping.voiceIdx);
          return next;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [enabled, setStepCursor, maxSteps, recordEnabled, onTriggerVoice]);

  return { heldVoices };
}
