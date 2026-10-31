import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { Board } from '../src/components/daw/Board.js';
import { useDawStore, type Take, type DAWTrack } from '../src/lib/daw/store.js';

const require = createRequire(new URL('../package.json', import.meta.url));
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const initial = { ...useDawStore.getInitialState() };
const takes: Take[] = [
  { id: 'original', song_id: 'song', take_number: 1, model: 'base', task: 'text2music', url: 'original.wav', is_active: true, created_at: '2026-10-09T00:00:00Z' },
  { id: 'earlier', song_id: 'song', take_number: 2, model: 'base', task: 'extract', url: 'earlier.wav', is_active: false, created_at: '2026-10-09T00:00:01Z', repainting_start: 10, repainting_end: 15 },
  { id: 'later', song_id: 'song', take_number: 3, model: 'base', task: 'extract', url: 'later.wav', is_active: false, created_at: '2026-10-09T00:00:02Z', repainting_start: 20, repainting_end: 30 },
];

function render(selectedTrackId: string, tracks: DAWTrack[] = [], versions = takes) {
  Object.assign(useDawStore.getInitialState(), { takes: versions, tracks, duration: 60, selectedTrackId });
  return renderToStaticMarkup(createElement(Board, {
    song: { id: 'song', title: 'Song' }, selectedTrackId,
  }));
}

afterEach(() => Object.assign(useDawStore.getInitialState(), initial));

describe('SoundCloud-like Master dents & On-Selector 3-Icon HUD', () => {
  it('renders SoundCloud-like dents on Master stage and shows the 3-icon HUD ON THE SELECTOR when Master is selected', () => {
    const mountedTake: DAWTrack = {
      id: 'earlier',
      activeTakeId: 'earlier',
      name: 'Take #2',
      type: 'sample',
      muted: false,
      clips: [{ id: 'segment', name: 'Take #2', url: 'earlier.wav', startTime: 10, offset: 0, duration: 5 }],
    };
    const html = render('master', [mountedTake]);
    expect(html).toContain('class="board-sc-dents is-stage"');
    expect(html).toContain('aria-label="Select Take #2 section"');
    expect(html).toContain('aria-label="Select Take #3 section"');

    // Region selector & 3-Icon HUD on the selector when Master is selected
    expect(html).toContain('class="board-sc-selector is-colored"');
    expect(html).toContain('aria-label="Region selector for Take #2" aria-pressed="true"');
    expect(html).toContain('aria-label="Take #2 region controls"');
    expect(html).toContain('aria-label="Play selected audio for Take #2"');
    expect(html).toContain('aria-label="Merge Take #2"');
    expect(html).toContain('aria-label="Discard Take #2"');
    expect(html).not.toContain('Color onto Master');
    expect(html).not.toContain('board-master-badges');
  });

  it('renders SoundCloud-like dents on the dimmed Master horizon when Master is unselected, and hides the Master selector HUD', () => {
    const codeLane: DAWTrack = {
      id: 'synth-strudel',
      name: 'Code',
      type: 'strudel',
      color: '#00ff66',
      volume: 0.9,
      pan: 0,
      muted: false,
      solo: false,
      mounted: true,
      clips: [],
      strudelCode: 'note("c3 e3 g3").s("sawtooth")',
    };
    const html = render('synth-strudel', [codeLane]);
    // Embedded Master horizon at bottom of focused lane has SoundCloud dents
    expect(html).toContain('class="board-sc-dents is-horizon"');
    expect(html).toContain('aria-label="Focus Take #2 marker on Master"');
    expect(html).toContain('aria-label="Focus Take #3 marker on Master"');
    // The Master region selector HUD is ONLY rendered when Master is selected
    expect(html).not.toContain('class="board-sc-selector-hud');
  });

  it('shows the regular section selector HUD (AUDITION, EXTRACT, REWORK) on Master when selection is active even if extracted takes exist', () => {
    Object.assign(useDawStore.getInitialState(), {
      takes,
      tracks: [],
      duration: 60,
      selectedTrackId: 'master',
      selection: { start: 5, end: 20 },
    });
    const html = renderToStaticMarkup(
      createElement(Board, {
        song: { id: 'song', title: 'Song' },
        selectedTrackId: 'master',
      })
    );
    expect(html).toContain('class="board-segment-hud"');
    expect(html).toContain('aria-label="Audition Section"');
    expect(html).toContain('aria-label="Extract Section"');
    expect(html).not.toContain('class="board-sc-selector-hud');
  });

  it('exposes clean controls (PLAY, M, S, MERGE into Master, DELETE) on CODE, KEYS, DRUMS, and stem lanes without Color onto Master clutter', () => {
    const codeLane: DAWTrack = {
      id: 'synth-strudel',
      name: 'Code',
      type: 'strudel',
      color: '#00ff66',
      volume: 0.9,
      pan: 0,
      muted: false,
      solo: false,
      mounted: true,
      clips: [],
      strudelCode: 'note("c3 e3 g3").s("sawtooth")',
    };
    const keysLane: DAWTrack = {
      id: 'synth-pianoroll',
      name: 'Keys',
      type: 'pianoroll',
      color: '#a855f7',
      volume: 0.9,
      pan: 0,
      muted: true,
      solo: false,
      mounted: false,
      clips: [],
      pianoRollNotes: [{ id: 'n1', pitch: 'C4', midi: 60, startTime: 0, duration: 1, velocity: 0.8 }],
    };
    const drumsLane: DAWTrack = {
      id: 'synth-sequencer',
      name: 'Drums',
      type: 'sequencer',
      color: '#ff0055',
      volume: 0.9,
      pan: 0,
      muted: false,
      solo: false,
      mounted: true,
      clips: [],
      sequencerVoices: [{ name: 'KICK', steps: [true, false], velocity: [0.8, 0.8], muted: false }],
    };

    const codeHtml = render('synth-strudel', [codeLane, keysLane, drumsLane]);
    expect(codeHtml).toContain('aria-label="Play Code"');
    expect(codeHtml).toContain('aria-label="Merge Code into Master"');
    expect(codeHtml).toContain('aria-label="Delete Code lane"');
    expect(codeHtml).not.toContain('Color onto Master');

    const keysHtml = render('synth-pianoroll', [codeLane, keysLane, drumsLane]);
    expect(keysHtml).toContain('aria-label="Play Keys"');
    expect(keysHtml).toContain('aria-label="Merge Keys into Master"');
    expect(keysHtml).toContain('aria-label="Delete Keys lane"');
    expect(keysHtml).not.toContain('Color onto Master');

    const drumsHtml = render('synth-sequencer', [codeLane, keysLane, drumsLane]);
    expect(drumsHtml).toContain('aria-label="Play Drums"');
    expect(drumsHtml).toContain('aria-label="Merge Drums into Master"');
    expect(drumsHtml).toContain('aria-label="Delete Drums lane"');
    expect(drumsHtml).not.toContain('Color onto Master');
  });

  it('removes committed sections from Extracted while retaining pending takes', () => {
    const committed = { ...takes[1], is_active: true, provenance: { target: 'master', region: { start: 0, end: 5 } } };
    const consumed = { ...takes[0], is_active: false, provenance: { mergedInto: 'merged' } };
    const baseline = { ...takes[0], id: 'merged', task: 'merge', is_active: true };
    const master = { id: 'master', type: 'audio', clips: [{ url: committed.url }] } as DAWTrack;
    const html = render('master', [master], [committed, consumed, baseline, takes[2]]);
    expect(html).not.toContain('aria-label="Select Take #2 section"');
    expect(html).toContain('aria-label="Select Take #3 section"');
  });

  it('expands Master duration when an extend take is mounted and shows its dent and selector at the extended interval', () => {
    const extendTake: Take = {
      id: 'ext-take', song_id: 'song', take_number: 4, model: 'base', task: 'extend',
      url: 'ext.wav', is_active: false, created_at: '2026-10-09T00:00:03Z',
      repainting_start: 60, repainting_end: 90,
      provenance: { target: 'master', region: { start: 60, end: 90 }, outputDuration: 90 },
    };
    const mountedTrack = {
      id: 'ext-take', activeTakeId: 'ext-take', name: 'Take #4', type: 'sample', muted: false,
      clips: [{ id: 'ext-clip', name: 'Take #4', url: 'ext.wav', startTime: 60, offset: 60, duration: 30 }],
    } as DAWTrack;
    const html = render('master', [mountedTrack], [takes[0], extendTake]);
    expect(html).toContain('aria-label="Select Take #4 section"');
    expect(html).toContain('left:66.66666666666666%;width:33.33333333333333%');
    expect(html).toContain('aria-label="Merge Take #4"');
    expect(html).toContain('aria-label="Discard Take #4"');
  });

  it('keeps the Extracted take selector and ORG/TK# mix controls visible when selection matches the take interval (no ghost selector)', () => {
    const mountedTake: DAWTrack = {
      id: 'earlier',
      activeTakeId: 'earlier',
      name: 'Take #2',
      type: 'sample',
      muted: false,
      clips: [{ id: 'segment', name: 'Take #2', url: 'earlier.wav', startTime: 10, offset: 0, duration: 5 }],
    };
    Object.assign(useDawStore.getInitialState(), {
      takes,
      tracks: [mountedTake],
      duration: 60,
      selectedTrackId: 'master',
      // toggleTake / moveTake sets selection to match the take interval [10, 15]
      selection: { start: 10, end: 15 },
    });
    const html = renderToStaticMarkup(
      createElement(Board, {
        song: { id: 'song', title: 'Song' },
        selectedTrackId: 'master',
      })
    );
    expect(html).toContain('class="board-sc-selector is-colored"');
    expect(html).toContain('class="board-overlay-wave"');
    expect(html).toContain('aria-label="Original audio for Take #2"');
    expect(html).toContain('aria-label="Take #2 audio"');
    expect(html).not.toContain('class="board-segment-hud"');
  });

  it('never renders Merge into Master on native stem lanes (which are already part of Master), while allowing Merge Layer into stem when a layer take is active', () => {
    const vocalsStem: DAWTrack = {
      id: 'stem-vocals',
      name: 'Vocals',
      type: 'stem',
      hasOriginalStem: true,
      color: '#ff0055',
      volume: 1,
      pan: 0,
      muted: false,
      solo: false,
      mounted: true,
      clips: [{ id: 'c-vocals', name: 'Vocals', url: 'vocals.wav', startTime: 0, offset: 0, duration: 60 }],
    };
    const nativeStemHtml = render('stem-vocals', [vocalsStem]);
    expect(nativeStemHtml).toContain('aria-label="Play Vocals"');
    expect(nativeStemHtml).not.toContain('aria-label="Merge Vocals into Master"');
    expect(nativeStemHtml).not.toContain('data-guide="board.lane-merge"');
    expect(nativeStemHtml).not.toContain('aria-label="Delete Vocals lane"');

    const layerTake: Take = {
      id: 'layer-voc-1',
      song_id: 'song',
      take_number: 4,
      model: 'base',
      task: 'lego',
      url: 'layer-voc.wav',
      is_active: false,
      created_at: '2026-10-09T00:00:04Z',
      provenance: { trackName: 'vocals' },
    };
    const vocalsWithActiveLayer: DAWTrack = {
      ...vocalsStem,
      activeVersionTakeId: 'layer-voc-1',
    };
    const layerActiveHtml = render('stem-vocals', [vocalsWithActiveLayer], [...takes, layerTake]);
    expect(layerActiveHtml).toContain('aria-label="Merge Layer into Vocals"');
    expect(layerActiveHtml).toContain('data-guide="board.layer-merge"');
    expect(layerActiveHtml).not.toContain('aria-label="Merge Vocals into Master"');
  });
});
