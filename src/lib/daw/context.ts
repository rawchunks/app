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
function extractBarGrooveFromBuffer(
  buffer: AudioBuffer,
  bpm: number,
  barStartSec: number
): { grooveLow: string; grooveMid: string; grooveHigh: string; openSpectrum: string } | null {
  const rate = buffer.sampleRate;
  const channel = buffer.getChannelData(0);
  const barSec = (60 / Math.max(40, Math.min(240, bpm))) * 4;
  const maxStart = Math.max(0, buffer.duration - barSec);
  const startSec = Math.max(0, Math.min(barStartSec, maxStart));
  const startSample = Math.floor(startSec * rate);
  const barSamples = Math.floor(barSec * rate);
  if (startSample + 16 >= channel.length || barSamples < 16) return null;

  const stepSamples = Math.max(1, Math.floor(barSamples / 16));
  const lowEnergy = new Float64Array(16);
  const midEnergy = new Float64Array(16);
  const highEnergy = new Float64Array(16);

  // One-pole crossover filters at ~180Hz and ~2400Hz (strided to ~11kHz effective rate to reduce main-thread cost by 75%)
  const stride = Math.max(1, Math.floor(rate / 11025));
  const effectiveRate = rate / stride;
  const alphaLow = Math.min(0.99, (2 * Math.PI * 180) / effectiveRate);
  const alphaMid = Math.min(0.99, (2 * Math.PI * 2400) / effectiveRate);
  let lp180 = 0;
  let lp2400 = 0;

  for (let s = 0; s < 16; s++) {
    const sStart = startSample + s * stepSamples;
    const sEnd = Math.min(channel.length, sStart + stepSamples);
    if (sEnd <= sStart) continue;
    let sumL = 0;
    let sumM = 0;
    let sumH = 0;
    let count = 0;
    for (let i = sStart; i < sEnd; i += stride) {
      const x = channel[i];
      lp180 += alphaLow * (x - lp180);
      lp2400 += alphaMid * (x - lp2400);
      const low = lp180;
      const mid = lp2400 - lp180;
      const high = x - lp2400;
      sumL += low * low;
      sumM += mid * mid;
      sumH += high * high;
      count++;
    }
    const n = Math.max(1, count);
    lowEnergy[s] = Math.sqrt(sumL / n);
    midEnergy[s] = Math.sqrt(sumM / n);
    highEnergy[s] = Math.sqrt(sumH / n);
  }

  const meanL = lowEnergy.reduce((a, b) => a + b, 0) / 16;
  const meanM = midEnergy.reduce((a, b) => a + b, 0) / 16;
  const meanH = highEnergy.reduce((a, b) => a + b, 0) / 16;

  const lowChars: string[] = [];
  const midChars: string[] = [];
  const highChars: string[] = [];

  for (let s = 0; s < 16; s++) {
    lowChars.push(meanL > 1e-4 && lowEnergy[s] > meanL * 1.05 ? 'x' : '.');
    midChars.push(meanM > 1e-4 && midEnergy[s] > meanM * 1.08 ? 'x' : '.');
    highChars.push(meanH > 1e-4 && highEnergy[s] > meanH * 1.02 ? 'x' : '.');
  }

  const totalBand = meanL + meanM + meanH + 1e-9;
  const normL = meanL / totalBand;
  const normM = meanM / totalBand;
  const normH = meanH / totalBand;
  const openBands: string[] = [];
  if (normL < 0.32) openBands.push('sub-bass');
  if (normM < 0.34) openBands.push('warm-mids');
  if (normH < 0.25) openBands.push('high-air');
  if (openBands.length === 0) openBands.push('syncopated-mid-high');

  return {
    grooveLow: lowChars.join(''),
    grooveMid: midChars.join(''),
    grooveHigh: highChars.join(''),
    openSpectrum: openBands.join(','),
  };
}

function inferTrackRole(name?: string, id?: string): string {
  const s = `${name || ''} ${id || ''}`.toLowerCase();
  if (s.includes('drum') || s.includes('perc') || s.includes('beat')) return 'drums';
  if (s.includes('bass') || s.includes('sub') || s.includes('808')) return 'bass';
  if (s.includes('vocal') || s.includes('vox') || s.includes('sing')) return 'vocals';
  if (s.includes('guitar') || s.includes('gtr')) return 'guitar';
  if (s.includes('key') || s.includes('piano') || s.includes('synth') || s.includes('pad')) return 'keys';
  return 'master';
}

/**
 * Extracts a deterministic, high-resolution `[SONG_CTX v2]` musical descriptor
 * from the current DAW session:
 * - Authoritative Key & Scale from song DB provenance (`state.keyScale` / `takes`)
 * - Windowed 4-bar chord progression + explicit Strudel voicings around `selection.start` or `playhead`
 * - True 16th-note 3-band onset groove masks (`L`, `M`, `H`) without whole-song aliasing
 * - Target reference track role (`drums`, `bass`, `vocals`, `guitar`, `keys`, `master`)
 * - Timestamped structural section (`[Intro]`, `[Verse]`, `[Chorus]`, `[Bridge]`) & active lyrics from `lyricsAlignment`
 */
export async function extractMusicalContext(targetTrackId?: string): Promise<string> {
  const state = useDawStore.getState();
  const bpm = Math.round(state.bpm || 120);
  const barSec = (60 / Math.max(40, Math.min(240, bpm))) * 4;
  const rawFocusTime = state.selection ? state.selection.start : (state.playhead || 0);
  // Quantize analysis window start to bar boundary
  const windowStartSec = Math.max(0, Math.floor(rawFocusTime / barSec) * barSec);
  const windowEndSec = state.selection && state.selection.end > state.selection.start
    ? state.selection.end
    : windowStartSec + barSec * 4;

  // Locate primary reference track:
  // 1. Explicit targetTrackId if it has audio clips (never pick the empty strudel track itself!)
  // 2. Currently selected track in DAW if it has audio clips
  // 3. Any soloed audio stem track
  // 4. Master track
  const masterTrack = state.tracks.find((t) => t.id === 'master');
  const explicitTrack = targetTrackId ? state.tracks.find((t) => t.id === targetTrackId) : undefined;
  const selectedTrack = state.tracks.find((t) => t.id === state.selectedTrackId);
  const soloAudioTrack = state.tracks.find((t) => t.solo && t.type !== 'strudel' && t.clips.length > 0 && t.clips[0]?.url);

  const refTrack =
    explicitTrack && explicitTrack.type !== 'strudel' && explicitTrack.clips.length > 0 && explicitTrack.clips[0]?.url
      ? explicitTrack
      : selectedTrack && selectedTrack.type !== 'strudel' && selectedTrack.clips.length > 0 && selectedTrack.clips[0]?.url
        ? selectedTrack
        : soloAudioTrack || masterTrack;

  const refClip = refTrack?.clips[0];
  const targetRole = inferTrackRole(refTrack?.name, refTrack?.id);

  // Resolve authoritative keyScale & stylePrompt from store or base take provenance
  const baseTake = state.takes.find((t) => t.task === 'text2music') ?? state.takes.find((t) => t.is_active);
  const baseParams = baseTake?.provenance?.parameters;
  const authoritativeKeyScale =
    state.keyScale ||
    baseParams?.submitted?.keyScale ||
    baseParams?.submitted?.keyscale ||
    baseParams?.resolved?.keyscale;
  const stylePrompt =
    state.stylePrompt ||
    baseTake?.prompt ||
    baseParams?.submitted?.prompt ||
    baseParams?.submitted?.tags ||
    baseParams?.resolved?.caption ||
    '';

  const scaleRef = getScaleAndChordReference(authoritativeKeyScale || 'C minor');
  let keyName = scaleRef.root;
  let scaleName: 'major' | 'minor' = scaleRef.mode;
  let chords = `<${scaleRef.defaultProgression.join(' ')}>`;
  let voicings = `<${scaleRef.diatonicChords.slice(0, 4).map((c) => c.voicing).join(' ')}>`;
  let grooveLow = 'x...x...x...x...';
  let grooveMid = '....x.......x...';
  let grooveHigh = 'x.x.x.x.x.x.x.x.';
  let openSpectrum = 'mid-high,high-air';

  if (refTrack && refClip?.url) {
    let buffer = dawEngine.getClipAudioBuffer(refTrack.id, refClip.id);
    if (!buffer) {
      try {
        buffer = await getDecodedAudioBuffer(refClip.url, 'high');
      } catch {
        // If decoding fails in headless test environment, fall back to windowed peaks below
      }
    }

    if (buffer) {
      // Pick the active window, or if the intro at 0s is silent, advance to the first active bar
      const probeSec =
        windowStartSec === 0 && buffer.duration > barSec * 4
          ? Math.min(barSec * 2, buffer.duration - barSec * 4)
          : windowStartSec;
      const detected = detectWindowedKeyAndChords(buffer, bpm, probeSec, authoritativeKeyScale);
      keyName = detected.key;
      scaleName = detected.scale;
      chords = detected.chords;
      voicings = detected.voicings;

      const barGroove = extractBarGrooveFromBuffer(buffer, bpm, probeSec);
      if (barGroove) {
        grooveLow = barGroove.grooveLow;
        grooveMid = barGroove.grooveMid;
        grooveHigh = barGroove.grooveHigh;
        openSpectrum = barGroove.openSpectrum;
      }
    } else {
      try {
        // Extract 64 bins over a 1-bar window (4 bins per 16th-note step — no whole-song aliasing!)
        const peaks = await extractBipolarPeaksFromUrl(refClip.url, 64, windowStartSec, barSec, 'high');
        if (peaks && peaks.bins >= 16) {
          const lowArr = peaks.low;
          const midArr = peaks.mid;
          const highArr = peaks.high;
          const rmsArr = peaks.rms;

          let meanRms = 0;
          for (let i = 0; i < peaks.bins; i++) meanRms += rmsArr[i];
          meanRms /= peaks.bins;

          const lowChars: string[] = [];
          const midChars: string[] = [];
          const highChars: string[] = [];

          for (let step = 0; step < 16; step++) {
            const bin = Math.min(peaks.bins - 1, Math.floor((step / 16) * peaks.bins));
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
        }
      } catch {
        // Non-fatal
      }
    }
  }

  const finalScaleRef = getScaleAndChordReference(`${keyName} ${scaleName}`);

  // Extract active Keys (PianoRoll) MIDI notes if present
  const keysTrack = state.tracks.find((t) => t.type === 'pianoroll');
  let keysSummary = 'none';
  if (keysTrack?.pianoRollNotes && keysTrack.pianoRollNotes.length > 0) {
    const sortedNotes = [...keysTrack.pianoRollNotes]
      .sort((a, b) => a.startTime - b.startTime)
      .slice(0, 12)
      .map((n) => `${n.pitch}@${n.startTime.toFixed(1)}`);
    keysSummary = `[${sortedNotes.join(' ')}]`;
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

  // Extract timestamped structural section & active vocal lyric line at rawFocusTime
  let sectionName = 'Main Groove';
  let activeLyricSnippet = '';
  const alignment =
    state.lyricsAlignment ??
    state.takes
      .map((t) => (t.provenance?.parameters as any)?.lyricsAlignment)
      .find((a) => a && Array.isArray(a.lines) && a.lines.some((l: any) => typeof l?.start === 'number'));

  if (alignment && Array.isArray(alignment.lines) && alignment.lines.length > 0) {
    let currentTag = '[Intro]';
    const matchingLines: string[] = [];
    for (const line of alignment.lines) {
      const txt = String(line.text || '').trim();
      if (!txt) continue;
      if (line.isTag || /^\[.*\]$/.test(txt)) {
        if (line.start === null || line.start === undefined || line.start <= rawFocusTime + barSec) {
          currentTag = txt;
        }
        continue;
      }
      if (typeof line.start === 'number' && typeof line.end === 'number') {
        if (line.start <= rawFocusTime + 0.5 && currentTag === '[Intro]') {
          // Keep advancing tag context
        }
        if (line.end >= windowStartSec && line.start <= windowEndSec) {
          matchingLines.push(txt);
        }
      }
    }
    sectionName = currentTag;
    if (matchingLines.length > 0) {
      activeLyricSnippet = matchingLines.slice(0, 2).join(' / ').slice(0, 90);
    }
  } else {
    const activeLyrics =
      state.lyrics ||
      state.takes.find((tk) => tk.is_active && tk.lyrics)?.lyrics ||
      state.takes.find((tk) => tk.task === 'text2music' && tk.lyrics)?.lyrics;
    if (activeLyrics && activeLyrics.trim().length > 0 && activeLyrics.trim() !== '[Instrumental]') {
      const lines = activeLyrics
        .split('\n')
        .map((l: string) => l.trim())
        .filter(Boolean);
      const tags = lines.filter((l: string) => /^\[.*\]$/.test(l));
      if (tags.length > 0) {
        const progress = state.duration > 0 ? Math.max(0, Math.min(0.99, rawFocusTime / state.duration)) : 0;
        const tagIdx = Math.min(tags.length - 1, Math.floor(progress * tags.length));
        sectionName = tags[tagIdx];
      }
    }
  }

  const sectionHint = `${sectionName} @${windowStartSec.toFixed(1)}s..${windowEndSec.toFixed(1)}s${activeLyricSnippet ? ` | vocals="${activeLyricSnippet}"` : ''}`;
  const timeSig = Array.isArray(state.timeSignature) ? `${state.timeSignature[0]}/${state.timeSignature[1]}` : '4/4';
  const syncSlots: number[] = [];
  for (let i = 0; i < 16; i++) {
    if (grooveLow[i] === '.' && grooveMid[i] === '.') {
      syncSlots.push(i + 1);
    }
  }

  return [
    '[SONG_CTX v2]',
    `tempo:${bpm} meter:${timeSig} key:${keyName}:${scaleName}`,
    ...(stylePrompt ? [`style:${String(stylePrompt).slice(0, 180)}`] : []),
    `target_track:${refTrack?.name || 'Master'} role:${targetRole}`,
    `scale_notes:${finalScaleRef.scaleNotes.join(' ')} bass_roots:${finalScaleRef.bassRoots.join(' ')}`,
    `chords:${chords}`,
    `voicings:${voicings}`,
    `groove16:L=${grooveLow} M=${grooveMid} H=${grooveHigh}`,
    `sync_slots:${syncSlots.length > 0 ? syncSlots.join(',') : '2,4,6,8,10,12,14,16'}`,
    `keys:${keysSummary}`,
    `drums:${drumsSummary}`,
    `spectrum:open=${openSpectrum}`,
    `section:${sectionHint}`,
  ].join('\n');
}
