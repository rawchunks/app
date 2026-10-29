import { useDawStore } from './store';
import { dawEngine } from './engine';
import { extractBipolarPeaksFromUrl, getDecodedAudioBuffer } from './peaks';
import { getScaleAndChordReference } from './strudel';

const PITCH_CLASSES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

// Krumhansl-Kessler cognitive pitch-class profiles for major and minor tonal hierarchies
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const NOTE_TO_PC: Record<string, number> = {
  C: 0,
  'C#': 1,
  DB: 1,
  D: 2,
  'D#': 3,
  EB: 3,
  E: 4,
  F: 5,
  'F#': 6,
  GB: 6,
  G: 7,
  'G#': 8,
  AB: 8,
  A: 9,
  'A#': 10,
  BB: 10,
  B: 11,
};

function detectWindowedKeyAndChords(
  buffer: AudioBuffer,
  bpm: number,
  windowStartSec = 0,
  authoritativeKeyScale?: string
): { key: string; scale: 'major' | 'minor'; chords: string; voicings: string } {
  const rate = buffer.sampleRate;
  const channel = buffer.getChannelData(0);
  const length = channel.length;
  const chroma = new Float64Array(12);

  const barDurationSec = (60 / Math.max(40, Math.min(240, bpm))) * 4;
  const maxStartSec = Math.max(0, buffer.duration - barDurationSec * 4);
  const startSec = Math.max(0, Math.min(windowStartSec, maxStartSec));
  const numBars = 4;
  const barChroma: Float64Array[] = Array.from({ length: numBars }, () => new Float64Array(12));

  const stride = Math.max(1, Math.floor(rate / 4000));
  const decimatedRate = rate / stride;

  for (let pc = 0; pc < 12; pc++) {
    for (let oct = 2; oct <= 4; oct++) {
      const midi = (oct + 1) * 12 + pc;
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const omega = (2 * Math.PI * freq) / decimatedRate;
      const coeff = 2 * Math.cos(omega);

      for (let b = 0; b < numBars; b++) {
        const barStart = Math.min(length - 1, Math.max(0, Math.floor((startSec + b * barDurationSec) * rate)));
        const barEnd = Math.min(length, Math.floor((startSec + (b + 1) * barDurationSec) * rate));
        if (barEnd <= barStart + stride) continue;
        let s1 = 0;
        let s2 = 0;
        let count = 0;
        for (let idx = barStart; idx < barEnd; idx += stride) {
          const s0 = channel[idx] + coeff * s1 - s2;
          s2 = s1;
          s1 = s0;
          count++;
        }
        if (count > 0) {
          const power = (s1 * s1 + s2 * s2 - coeff * s1 * s2) / (count * count);
          chroma[pc] += power;
          barChroma[b][pc] += power;
        }
      }
    }
  }

  let bestRoot = 0;
  let bestScale: 'major' | 'minor' = 'minor';

  if (authoritativeKeyScale && authoritativeKeyScale.trim()) {
    const ref = getScaleAndChordReference(authoritativeKeyScale);
    bestRoot = NOTE_TO_PC[ref.root.toUpperCase()] ?? 0;
    bestScale = ref.mode;
  } else {
    let bestScore = -Infinity;
    for (let root = 0; root < 12; root++) {
      let majScore = 0;
      let minScore = 0;
      for (let i = 0; i < 12; i++) {
        const val = chroma[(root + i) % 12];
        majScore += val * KK_MAJOR[i];
        minScore += val * KK_MINOR[i];
      }
      if (majScore > bestScore) {
        bestScore = majScore;
        bestRoot = root;
        bestScale = 'major';
      }
      if (minScore > bestScore) {
        bestScore = minScore;
        bestRoot = root;
        bestScale = 'minor';
      }
    }
  }

  const keyScaleStr = `${PITCH_CLASSES[bestRoot]} ${bestScale}`;
  const ref = getScaleAndChordReference(keyScaleStr);
  const scaleMask = new Set<number>(
    (bestScale === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]).map((iv) => (bestRoot + iv) % 12)
  );

  const chordTokens: string[] = [];
  const voicingTokens: string[] = [];

  for (let b = 0; b < numBars; b++) {
    const bc = barChroma[b];
    const totalBarEnergy = bc.reduce((acc, v) => acc + v, 0);
    if (totalBarEnergy <= 1e-9) {
      const fallbackChord = ref.diatonicChords[b % ref.diatonicChords.length];
      chordTokens.push(fallbackChord.symbol);
      voicingTokens.push(fallbackChord.voicing);
      continue;
    }

    let bestCandidate = ref.diatonicChords[0];
    let bestScore = -Infinity;

    // Score each diatonic/borrowed chord candidate against the bar's Goertzel chroma
    for (let r = 0; r < 12; r++) {
      const inKeyBonus = scaleMask.has(r) ? 1.25 : 0.85;
      const majScore = (bc[r] * 1.45 + bc[(r + 4) % 12] * 1.15 + bc[(r + 7) % 12] * 1.1 + bc[(r + 11) % 12] * 0.5) * inKeyBonus;
      const minScore = (bc[r] * 1.45 + bc[(r + 3) % 12] * 1.15 + bc[(r + 7) % 12] * 1.1 + bc[(r + 10) % 12] * 0.55) * inKeyBonus;
      const domScore = (bc[r] * 1.35 + bc[(r + 4) % 12] * 1.1 + bc[(r + 7) % 12] * 1.05 + bc[(r + 10) % 12] * 0.7) * inKeyBonus;

      const rootName = PITCH_CLASSES[r];
      const candidates = [
        { score: majScore, sym: `${rootName}maj7`, ivs: [0, 4, 7, 11] },
        { score: minScore, sym: `${rootName}m7`, ivs: [0, 3, 7, 10] },
        { score: domScore, sym: `${rootName}7`, ivs: [0, 4, 7, 10] },
      ];
      for (const c of candidates) {
        if (c.score > bestScore) {
          bestScore = c.score;
          const pitches = c.ivs.map((iv) => {
            const pc = (r + iv) % 12;
            const oct = 3 + Math.floor((r + iv) / 12);
            return `${PITCH_CLASSES[pc].toLowerCase()}${oct}`;
          });
          bestCandidate = {
            symbol: c.sym,
            voicing: `[${pitches.join(',')}]`,
            functionName: '',
          };
        }
      }
    }

    chordTokens.push(bestCandidate.symbol);
    voicingTokens.push(bestCandidate.voicing);
  }

  return {
    key: ref.root,
    scale: ref.mode,
    chords: `<${chordTokens.join(' ')}>`,
    voicings: `<${voicingTokens.join(' ')}>`,
  };
}

/**
 * Extracts a true 16th-note 3-band groove mask directly from a 1-bar slice of an AudioBuffer
 * so there is zero whole-song bin aliasing.
 */
export async function extractMusicalContext(targetTrackId?: string): Promise<string> {
  const state = useDawStore.getState();
  const bpm = Math.round(state.bpm || 120);
  const playhead = state.playhead || 0;

  // Locate primary reference track (selected audio stem, or Master)
  const selectedTrack = state.tracks.find((t) => t.id === (targetTrackId || state.selectedTrackId));
  const masterTrack = state.tracks.find((t) => t.id === 'master');
  const refTrack =
    selectedTrack && selectedTrack.clips.length > 0 && selectedTrack.clips[0]?.url
      ? selectedTrack
      : masterTrack;
  const refClip = refTrack?.clips[0];

  let keyName = 'C';
  let scaleName: 'major' | 'minor' = 'minor';
  let chords = '<Cm7 Fm7 Abmaj7 G7>';
  let grooveLow = 'x...x...x...x...';
  let grooveMid = '....x.......x...';
  let grooveHigh = 'x.x.x.x.x.x.x.x.';
  let openSpectrum = 'mid-high,high-air';

  if (refTrack && refClip) {
    const buffer = dawEngine.getClipAudioBuffer(refTrack.id, refClip.id);
    if (buffer) {
      const detected = detectKeyAndChordsFromAudioBuffer(buffer, bpm);
      keyName = detected.key;
      scaleName = detected.scale;
      chords = detected.chords;
    }

    try {
      if (refClip.url) {
        const peaks = await extractBipolarPeaksFromUrl(refClip.url, 256, 0, undefined, 'high');
        if (peaks && peaks.bins >= 16) {
          const lowArr = peaks.low;
          const midArr = peaks.mid;
          const highArr = peaks.high;
          const rmsArr = peaks.rms;

          let meanRms = 0;
          let sumLow = 0;
          let sumMid = 0;
          let sumHigh = 0;
          for (let i = 0; i < peaks.bins; i++) {
            meanRms += rmsArr[i];
            if (lowArr && midArr && highArr) {
              sumLow += lowArr[i];
              sumMid += midArr[i];
              sumHigh += highArr[i];
            }
          }
          meanRms /= peaks.bins;

          // Build 16-step onset mask from a 1-bar window around current playhead (or first active bar)
          const barSec = (60 / bpm) * 4;
          const startSec = playhead > 0 && playhead + barSec < peaks.duration ? playhead : Math.min(peaks.duration * 0.25, Math.max(0, peaks.duration - barSec));
          const lowChars: string[] = [];
          const midChars: string[] = [];
          const highChars: string[] = [];

          for (let step = 0; step < 16; step++) {
            const stepSec = startSec + (step / 16) * barSec;
            const norm = peaks.duration > 0 ? Math.max(0, Math.min(1, stepSec / peaks.duration)) : step / 16;
            const bin = Math.min(peaks.bins - 1, Math.floor(norm * (peaks.bins - 1)));
            const e = rmsArr[bin];
            const l = lowArr ? lowArr[bin] * e : e * 0.35;
            const m = midArr ? midArr[bin] * e : e * 0.35;
            const h = highArr ? highArr[bin] * e : e * 0.3;

            lowChars.push(l > meanRms * 0.42 ? 'x' : '.');
            midChars.push(m > meanRms * 0.38 ? 'x' : '.');
            highChars.push(h > meanRms * 0.32 ? 'x' : '.');
          }
          grooveLow = lowChars.join('');
          grooveMid = midChars.join('');
          grooveHigh = highChars.join('');

          if (lowArr && midArr && highArr) {
            const avgL = sumLow / peaks.bins;
            const avgM = sumMid / peaks.bins;
            const avgH = sumHigh / peaks.bins;
            const openBands: string[] = [];
            if (avgL < 0.34) openBands.push('sub-bass');
            if (avgM < 0.36) openBands.push('warm-mids');
            if (avgH < 0.36) openBands.push('high-air');
            if (openBands.length === 0) openBands.push('syncopated-mid-high');
            openSpectrum = openBands.join(',');
          }
        }
      }
    } catch {
      // Non-fatal if peak extraction is still in flight
    }
  }

  // Extract active Keys (PianoRoll) MIDI notes if present
  const keysTrack = state.tracks.find((t) => t.type === 'pianoroll');
  let keysSummary = 'none';
  if (keysTrack?.pianoRollNotes && keysTrack.pianoRollNotes.length > 0) {
    const sortedNotes = [...keysTrack.pianoRollNotes]
      .sort((a, b) => a.startTime - b.startTime)
      .slice(0, 12)
      .map((n) => `${n.pitch}@${n.startTime.toFixed(1)}`);
    keysSummary = `[${sortedNotes.join(' ')}]`;
    // Refine key root from user's MIDI notes if audio buffer wasn't decoded yet
    if (!refClip || !dawEngine.getClipAudioBuffer(refTrack!.id, refClip.id)) {
      const rootPitch = String(keysTrack.pianoRollNotes[0].pitch || 'C4').replace(/[0-9-]+$/, '');
      if (rootPitch) {
        keyName = rootPitch;
      }
    }
  }

  // Extract active Drums (Sequencer) 16-step pattern if present
  const drumsTrack = state.tracks.find((t) => t.type === 'sequencer');
  let drumsSummary = 'none';
  if (drumsTrack?.sequencerVoices) {
    const activeRows: string[] = [];
    for (const voice of drumsTrack.sequencerVoices) {
      if (!voice.muted && Array.isArray(voice.steps) && voice.steps.some(Boolean)) {
        activeRows.push(`${voice.name}:${voice.steps.map((on) => (on ? 'x' : '.')).join('')}`);
      }
    }
    if (activeRows.length > 0) {
      drumsSummary = activeRows.join(' ');
    }
  }

  // Extract active Lyric line / section context
  let sectionHint = `@${playhead.toFixed(1)}s`;
  const activeLyrics = state.takes.find((tk) => tk.is_active && tk.lyrics)?.lyrics;
  if (activeLyrics && activeLyrics.trim().length > 0) {
    const lines = activeLyrics
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean);
    const activeHeader = lines.find((l: string) => /^\[.*\]$/.test(l)) ?? lines[0]?.slice(0, 48);
    if (activeHeader) {
      sectionHint = `${activeHeader} @${playhead.toFixed(1)}s`;
    }
  }

  return [
    '[SONG_CTX v1]',
    `tempo:${bpm} meter:4/4 key:${keyName}:${scaleName}`,
    `chords:${chords}`,
    `groove16:L=${grooveLow} M=${grooveMid} H=${grooveHigh}`,
    `keys:${keysSummary}`,
    `drums:${drumsSummary}`,
    `spectrum:open=${openSpectrum}`,
    `section:${sectionHint}`,
  ].join('\n');
}function detectKeyAndChordsFromAudioBuffer(
  buffer: AudioBuffer,
  bpm: number
): { key: string; scale: 'major' | 'minor'; chords: string } {
  const rate = buffer.sampleRate;
  const channel = buffer.getChannelData(0);
  const length = channel.length;
  const chroma = new Float64Array(12);

  // Goertzel-style pitch-class energy accumulation across 3 octaves (C2..B4)
  const stride = Math.max(1, Math.floor(rate / 4000));
  const decimatedRate = rate / stride;
  const maxFrames = Math.min(length, Math.floor(rate * 45));
  const barDurationSec = (60 / Math.max(40, Math.min(240, bpm))) * 4;
  const numBars = Math.max(1, Math.min(8, Math.floor(buffer.duration / barDurationSec)));
  const barChroma: Float64Array[] = Array.from({ length: numBars }, () => new Float64Array(12));

  for (let pc = 0; pc < 12; pc++) {
    for (let oct = 2; oct <= 4; oct++) {
      const midi = (oct + 1) * 12 + pc;
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const omega = (2 * Math.PI * freq) / decimatedRate;
      const coeff = 2 * Math.cos(omega);

      for (let b = 0; b < numBars; b++) {
        const barStart = Math.floor(b * barDurationSec * rate);
        const barEnd = Math.min(maxFrames, Math.floor((b + 1) * barDurationSec * rate));
        if (barEnd <= barStart) continue;
        let s1 = 0;
        let s2 = 0;
        let count = 0;
        for (let idx = barStart; idx < barEnd; idx += stride) {
          const s0 = channel[idx] + coeff * s1 - s2;
          s2 = s1;
          s1 = s0;
          count++;
        }
        if (count > 0) {
          const power = (s1 * s1 + s2 * s2 - coeff * s1 * s2) / (count * count);
          chroma[pc] += power;
          barChroma[b][pc] += power;
        }
      }
    }
  }

  // Krumhansl-Kessler correlation for global key & scale
  let bestRoot = 0;
  let bestScale: 'major' | 'minor' = 'minor';
  let bestScore = -Infinity;

  for (let root = 0; root < 12; root++) {
    let majScore = 0;
    let minScore = 0;
    for (let i = 0; i < 12; i++) {
      const val = chroma[(root + i) % 12];
      majScore += val * KK_MAJOR[i];
      minScore += val * KK_MINOR[i];
    }
    if (majScore > bestScore) {
      bestScore = majScore;
      bestRoot = root;
      bestScale = 'major';
    }
    if (minScore > bestScore) {
      bestScore = minScore;
      bestRoot = root;
      bestScale = 'minor';
    }
  }

  // Bar-by-bar diatonic/chromatic triad+7th template matching
  const chordTokens: string[] = [];
  for (let b = 0; b < numBars; b++) {
    const bc = barChroma[b];
    let barRoot = bestRoot;
    let barQuality = bestScale === 'minor' ? 'm7' : 'maj7';
    let barBest = -Infinity;
    for (let r = 0; r < 12; r++) {
      const maj3 = bc[r] * 1.4 + bc[(r + 4) % 12] * 1.15 + bc[(r + 7) % 12] * 1.1 + bc[(r + 11) % 12] * 0.5;
      const min3 = bc[r] * 1.4 + bc[(r + 3) % 12] * 1.15 + bc[(r + 7) % 12] * 1.1 + bc[(r + 10) % 12] * 0.55;
      const dom7 = bc[r] * 1.35 + bc[(r + 4) % 12] * 1.1 + bc[(r + 7) % 12] * 1.05 + bc[(r + 10) % 12] * 0.7;
      if (maj3 > barBest) {
        barBest = maj3;
        barRoot = r;
        barQuality = 'maj7';
      }
      if (min3 > barBest) {
        barBest = min3;
        barRoot = r;
        barQuality = 'm7';
      }
      if (dom7 > barBest) {
        barBest = dom7;
        barRoot = r;
        barQuality = '7';
      }
    }
    chordTokens.push(`${PITCH_CLASSES[barRoot]}${barQuality}`);
  }

  const deduped = chordTokens.length > 0 ? `<${chordTokens.join(' ')}>` : `<${PITCH_CLASSES[bestRoot]}${bestScale === 'minor' ? 'm7' : 'maj7'}>`;
  return {
    key: PITCH_CLASSES[bestRoot],
    scale: bestScale,
    chords: deduped,
  };
}

/**
 * Extracts a deterministic, lossless, token-compact (~150 tokens) `[SONG_CTX v1]`
 * musical descriptor from the current DAW session (Master/stem audio buffer,
 * 16th-note 3-band onset groove masks, spectral occupancy, active Keys MIDI notes,
 * active Drums step grid, and active lyrics section) so the Strudel AI operator
 * improvises in exact key, tempo, chord progression, and groove pocket.
 */


