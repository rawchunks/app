export type GuideFlowId = 'welcome' | 'studio' | 'mypage' | 'market' | 'editor';

export interface GuideStepAction {
  type: 'studio-section' | 'editor-focus';
  section?: 'core' | 'params' | 'financials';
  editorFocus?: 'studio' | 'toolbox';
}

export interface GuideStep {
  id: string;
  title: string;
  badge?: string;
  description: string;
  bullets?: string[];
  selector: string;
  placement?: 'bottom' | 'top' | 'left' | 'right';
  action?: GuideStepAction;
}

export interface GuideFlow {
  id: GuideFlowId;
  label: string;
  subtitle: string;
  steps: GuideStep[];
}

export const GUIDE_FLOWS: Record<GuideFlowId, GuideFlow> = {
  welcome: {
    id: 'welcome',
    label: 'Account, Session & Credits',
    subtitle: 'Getting started',
    steps: [
      {
        id: 'welcome-account',
        title: '1-Click Login & Account',
        badge: 'ACCOUNT',
        description:
          'Sign in with Google, Discord, Email, Passkey, Guest mode, or an external wallet. We create an embedded smart account for you automatically—no browser extension required.',
        selector: '[data-guide="account"], .btn.connect',
        placement: 'bottom',
      },
      {
        id: 'welcome-session',
        title: 'Session & Credits Deck',
        badge: '1 CREDIT = $0.01',
        description:
          'Open the Session pill anytime to fund studio tasks and streaming with zero wallet popups:',
        bullets: [
          'FREE $1: Claim 100 Free Welcome Credits (~20 AI songs) on your first login.',
          'CARD: Top up instantly with Visa, Mastercard, or PayPal ($10, $25, $100).',
          'USDC: Authorize an on-chain spending cap on Base, Tempo, or Solana.',
        ],
        selector: '.session-trigger-btn, [data-guide="account"], .btn.connect',
        placement: 'bottom',
      },
      {
        id: 'welcome-profile',
        title: 'Profile, Terms & Guides',
        badge: 'PROFILE',
        description:
          'Once signed in, click your Account chip to set your public artist Nickname and Avatar, review the generation terms, replay any interactive guide, or disconnect.',
        selector: '[data-guide="account"], .btn.connect',
        placement: 'bottom',
      },
    ],
  },

  studio: {
    id: 'studio',
    label: 'Studio Guide',
    subtitle: 'Creating songs',
    steps: [
      {
        id: 'studio-modes',
        title: 'Fast vs. Master Mode',
        badge: '5 OR 10 CREDITS',
        description:
          'Pick your generation engine before creating a song. Every run generates 2 playable variations:',
        bullets: [
          'FAST (5 Credits / $0.05): Rapid 8-step generation for quick ideas and demos.',
          'MASTER (10 Credits / $0.10): 50-step studio model for richer vocals, tighter structure, and release-ready mixes.',
        ],
        selector: '[data-guide="studio-modes"], .studio-mode-badge-switch',
        placement: 'bottom',
        action: { type: 'studio-section', section: 'core' },
      },
      {
        id: 'studio-core',
        title: 'Core Details & Prompt',
        badge: 'DETAILS',
        description:
          'Set your track title, assign an album, add cover art (upload or generate with AI for free), and describe the sound you want in the Prompt box. Click ✨ to auto-format your prompt and tags for free.',
        selector: '[data-guide="studio-core"], .studio-card-section.details',
        placement: 'right',
        action: { type: 'studio-section', section: 'core' },
      },
      {
        id: 'studio-lyrics',
        title: 'Vocal Language & Lyrics Canvas',
        badge: 'LYRICS & TAGS',
        description:
          'Pick a Vocal Language (or INSTRUMENTAL). Click the expand icon on LYRICS to open the Lyrics Canvas, where you can insert structure tags ([Intro], [Verse], [Chorus], [Drop]) and vocal cues ([raspy vocal], [harmonies]) with one click.',
        selector: '[data-guide="studio-lyrics"], .studio-field-group-lyrics',
        placement: 'right',
        action: { type: 'studio-section', section: 'core' },
      },
      {
        id: 'studio-params',
        title: 'Global Parameters',
        badge: 'PARAMETERS',
        description:
          'Fine-tune your arrangement before generating:',
        bullets: [
          'Style Tags: Add genre, mood, and instrument tags.',
          'Duration, Tempo (BPM), Key & Scale: Lock in track length, speed, and harmony.',
          'Voice: Apply any custom AI voice model you have saved.',
        ],
        selector: '[data-guide="studio-params"], .studio-card-section.params',
        placement: 'right',
        action: { type: 'studio-section', section: 'params' },
      },
      {
        id: 'studio-financials',
        title: 'Financials: Stream & Licenses',
        badge: 'PRICING',
        description:
          'Set your track terms (editable anytime while private):',
        bullets: [
          'Stream ($/min): What listeners pay per minute to stream your song on the Market.',
          'License ($) & Licenses: Price per remix license and total number of licenses available to buy.',
        ],
        selector: '[data-guide="studio-financials"], .studio-card-section.financials',
        placement: 'top',
        action: { type: 'studio-section', section: 'financials' },
      },
      {
        id: 'studio-create',
        title: 'Create & Audition Variations',
        badge: 'GENERATE',
        description:
          'Click CREATE (or press ⌘+Enter) to generate 2 variations in the right-hand feed. Play them back, download the audio, or open any variation directly in the Audio Editor.',
        selector: '[data-guide="studio-create"], .studio-generate-btn',
        placement: 'top',
        action: { type: 'studio-section', section: 'core' },
      },
    ],
  },

  mypage: {
    id: 'mypage',
    label: 'Workspace',
    subtitle: 'Catalog, editing & publishing',
    steps: [
      {
        id: 'mypage-sections',
        title: 'Your Workspace',
        badge: 'SECTIONS',
        description:
          'Your catalog is organized into four collapsible sections:',
        bullets: [
          'MY SONGS: Every track you have generated or edited (we pre-loaded "Playground" so you can experiment right away).',
          'MY LICENSES: Remix licenses you purchased from other artists.',
          'MY ALBUMS & MY VOICES: Group tracks into albums and manage reusable AI voice models (5 Credits per voice).',
        ],
        selector: '[data-guide="mypage-sections"], .mypage-section',
        placement: 'bottom',
      },
      {
        id: 'mypage-details',
        title: 'Edit Song Details & Pricing',
        badge: 'SONG DETAILS',
        description:
          'Click ••• on any song card and select SONG DETAILS to update its title, cover art, album assignment, stream rate ($/min), license price ($), and license supply before publishing.',
        selector: '[data-guide="mypage-card-details"], [data-guide="mypage-card-menu"], .mypage-card-more-btn',
        placement: 'right',
      },
      {
        id: 'mypage-editor',
        title: 'Access the Audio Editor',
        badge: 'AUDIO EDITOR',
        description:
          'Select AUDIO EDITOR from the ••• menu to open your track in the multi-stem workstation. If a song is already published, opening the editor automatically creates a new editable version (v2, v3…) while keeping earlier versions live.',
        selector: '[data-guide="mypage-card-editor"], [data-guide="mypage-card-menu"], .mypage-card-more-btn',
        placement: 'right',
      },
      {
        id: 'mypage-publish',
        title: 'Publish & Mint Onchain',
        badge: 'ONCHAIN RELEASE',
        description:
          'Ready to release? Click the Publish button at the bottom right of your song card. Your audio and metadata are pinned to IPFS and minted onchain on your active network so anyone can stream or license your track on the Market.',
        selector: '[data-guide="mypage-card-publish"], .mypage-publish-icon-btn',
        placement: 'top',
      },
    ],
  },

  market: {
    id: 'market',
    label: 'Market Guide',
    subtitle: 'Streaming & remix licensing',
    steps: [
      {
        id: 'market-toolbar',
        title: 'Search, Filter & Sort',
        badge: 'DISCOVERY',
        description:
          'Search tracks by title, creator, or style tag, filter by CREATORS or GENRES, and toggle Latest or Oldest order to explore the catalog.',
        selector: '[data-guide="market-toolbar"], .market-filter-bar',
        placement: 'bottom',
      },
      {
        id: 'market-stream',
        title: 'Stream & Switch Versions',
        badge: 'METERED STREAMING',
        description:
          'Click any cover art to stream the track in the bottom player. Streaming is metered per second from your Session or Credits at the artist’s Stream ($/min) rate—streaming your own songs is always free. Click the v1 / v2 badge on a cover to switch versions.',
        selector: '[data-guide="market-card-play"], .market-card-cover-wrap, .market-grid',
        placement: 'right',
      },
      {
        id: 'market-license',
        title: 'Buy a Remix License',
        badge: 'REMIX RIGHTS',
        description:
          'Click BUY LICENSE to purchase an onchain remix token in USDC. You immediately receive a private, editable copy of the song under MY LICENSES that you can open in the Audio Editor, rework, and publish as a new release.',
        selector: '[data-guide="market-card-license"], .market-card-footer, .market-grid',
        placement: 'top',
      },
    ],
  },

  editor: {
    id: 'editor',
    label: 'Audio Editor Guide',
    subtitle: 'DAW, smart gestures & AI tools',
    steps: [
      {
        id: 'editor-transport',
        title: 'Transport Deck & Tempo',
        badge: 'WORKSTATION',
        description:
          'We pre-loaded "Playground" so you can test every control right away. Use the top bar for Play/Pause (Space), Loop (L), Return-to-Zero (0), and Audition Selection (Shift+Space). Click BPM to adjust tempo, or click the song title to switch tracks.',
        selector: '[data-guide="editor-transport"], .editor-transport-row, .editor-header-bar',
        placement: 'bottom',
        action: { type: 'editor-focus', editorFocus: 'toolbox' },
      },
      {
        id: 'editor-master',
        title: 'Master Reference & Stem Separation',
        badge: '2 CREDITS TO SEPARATE',
        description:
          'The top MASTER strip lets you compare your original track (ORG) against any generated take (TK#). Starting from a single stereo mix? Click SPLIT STEMS / SEPARATE (2 Credits) to split your song into isolated Vocals, Drums, Bass, and Instruments.',
        selector: '[data-guide="editor-master"], .board-master-horizon, .board-stage-focus .board-lane-controller-row',
        placement: 'bottom',
        action: { type: 'editor-focus', editorFocus: 'toolbox' },
      },
      {
        id: 'editor-waveform',
        title: 'Waveform Cursor & Smart Touch Controls',
        badge: 'GESTURES',
        description:
          'Interact directly with the focused waveform canvas using your mouse or finger:',
        bullets: [
          'Play / Seek: Click or tap ABOVE or BELOW the waveform bars to jump the playhead and play.',
          'Select Region: Drag horizontally OUTSIDE the waveform bars to draw a time selection (start ➔ end). Drag inside the box to move it, or drag its edges to resize.',
          'Peak & Wave Sculpting: Drag directly ON the waveform bars—vertically for PEAK (transients & drive) or horizontally for WAVE (timing & sustain).',
        ],
        selector: '[data-guide="editor-waveform"], .board-stage-focus .board-lane-waveform-row, .board-stage-focus',
        placement: 'bottom',
        action: { type: 'editor-focus', editorFocus: 'toolbox' },
      },
      {
        id: 'editor-lyrics',
        title: 'Selection Actions & Synced Lyrics',
        badge: 'FREE AI SCRIBE',
        description:
          'When a region is selected, use its floating pill to Audition, REWORK, or CUT that slice. On vocal lanes, click LYRICS to transcribe vocals automatically with AI Scribe and align words to the timeline—for free.',
        selector: '[data-guide="editor-lyrics"], .board-stage-focus .board-lane-controller-row, .board-stage-focus',
        placement: 'bottom',
        action: { type: 'editor-focus', editorFocus: 'toolbox' },
      },
      {
        id: 'editor-lanes',
        title: 'Stems Matrix & Takes Vault',
        badge: 'STEMS & TAKES',
        description:
          'Switch active lanes, Mute (M) or Solo (S) stems, and click + to add custom KEYS, DRUMS, CODE, or SAMPLE tracks. Expand TAKES on any lane to audition edits, mount a take as your working BASE, or MERGE mounted takes into the Master mix (free).',
        selector: '[data-guide="editor-lanes"], .board-stems-card',
        placement: 'right',
        action: { type: 'editor-focus', editorFocus: 'toolbox' },
      },
      {
        id: 'editor-studio',
        title: 'AI Studio Operations',
        badge: '2 CREDITS EACH',
        description:
          'Run any AI audio transformation for 2 Credits ($0.02) per operation:',
        bullets: [
          'Rework: Regenerate a selected time region (start ➔ end) with new lyrics or style.',
          'Layer: Generate a new instrument stem around the lanes you have active.',
          'Extend & Accompany: Add bars to the intro/outro, or build a full band around a stem.',
          'Restyle & Extract: Transform genre/timbre while keeping melody, or isolate stems.',
        ],
        selector: '[data-guide="editor-studio"], .studio-bento-row',
        placement: 'top',
        action: { type: 'editor-focus', editorFocus: 'studio' },
      },
      {
        id: 'editor-toolbox',
        title: 'Manual Editing Toolbox',
        badge: '100% FREE',
        description:
          'Every manual DAW tool in the bottom dock is completely free (0 Credits):',
        bullets: [
          'FX & MIXER: Shape Peak/Wave envelopes, 3-band EQ, Compressor, Reverb, Delay, faders, and pan.',
          'KEYS, DRUMS & SAMPLE: Draw MIDI notes, sequence 16-step drum patterns, or record/slice audio samples.',
          'CODE (Strudel): Live-code patterns or generate playable synth/drum code from a text prompt.',
          'HISTORY: Save manual Snapshot commits and restore any previous project state anytime.',
        ],
        selector: '[data-guide="editor-toolbox"], .toolbox-bento-card',
        placement: 'top',
        action: { type: 'editor-focus', editorFocus: 'toolbox' },
      },
    ],
  },
};
