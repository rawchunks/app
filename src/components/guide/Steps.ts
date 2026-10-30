// Shared step copy. Preparation lives with the component that owns each control.
import type { GuideOwnerId } from "./registry";
export type GuidePageId = "studio" | "mypage" | "market" | "editor";
export type GuideFlowId = "welcome" | "studio" | "mypage" | "market" | "editor" | "funding" | "studio-vibe" | "studio-settings" | "studio-lyrics" | "studio-voice" | "studio-release-details" | "catalog" | "editor-selection" | "editor-ai" | "editor-takes" | "editor-keys" | "editor-drums" | "editor-code" | "editor-samples" | "editor-effects" | "editor-history";
export interface GuideStep { id: string; title: string; description: string; target: string; owner: GuideOwnerId; alternate?: string[] }
export interface GuideFlow { id: GuideFlowId; label: string; version: number; pages: GuidePageId[]; steps: GuideStep[] }
export const GUIDE_STEPS: Record<string, GuideStep> = {
  "A1": {
    "id": "A1",
    "title": "Your account",
    "description": "Open Account to check your connection and profile.",
    "target": "account.panel",
    "owner": "account",
    "alternate": [
      "Sign in to keep your songs, voices and licenses in your workspace."
    ]
  },
  "A2": {
    "id": "A2",
    "title": "Credits and Session",
    "description": "Open Credits & Session to choose how you pay for Studio tasks and streaming.",
    "target": "funding.compartments",
    "owner": "account"
  },
  "A3": {
    "id": "A3",
    "title": "Profile and guides",
    "description": "Set your artist name and avatar from Profile. Use Guides to replay the current page or Account tour.",
    "target": "account.profile-guides",
    "owner": "account"
  },
  "A4": {
    "id": "A4",
    "title": "Edit your profile",
    "description": "Set your public nickname, bio and avatar here. SAVE PROFILE updates your profile.",
    "target": "account.profile-form",
    "owner": "account"
  },
  "A5": {
    "id": "A5",
    "title": "Review generation terms",
    "description": "Review the generation terms here.",
    "target": "account.terms",
    "owner": "account"
  },
  "A6": {
    "id": "A6",
    "title": "Move between pages",
    "description": "Use STUDIO to create tracks, WORKSPACE for your catalog, and MARKET to listen or buy licenses.",
    "target": "app.navigation",
    "owner": "navigation"
  },
  "S1": {
    "id": "S1",
    "title": "Start from a vibe or your own settings",
    "description": "VIBE helps prepare the song. CONTROL lets you fill and edit the form yourself.",
    "target": "studio.workflow",
    "owner": "studio"
  },
  "S2": {
    "id": "S2",
    "title": "Give Songwriter a starting point",
    "description": "Describe the song, attach an image, or hum or speak your idea.",
    "target": "studio.vibe-prompt",
    "owner": "studio"
  },
  "S3": {
    "id": "S3",
    "title": "Review the song",
    "description": "In CONTROL, check the title, prompt and lyrics before generating audio.",
    "target": "studio.details",
    "owner": "studio"
  },
  "S4": {
    "id": "S4",
    "title": "Edit the lyrics",
    "description": "Open Lyrics Canvas to arrange sections and add tags.",
    "target": "lyrics.canvas",
    "owner": "studio"
  },
  "S5": {
    "id": "S5",
    "title": "Set the music options",
    "description": "More Options holds tags, duration, tempo, key, collection and voice.",
    "target": "studio.options",
    "owner": "studio"
  },
  "S6": {
    "id": "S6",
    "title": "Choose Fast or Master",
    "description": "Choose a generation mode. Its price is shown beside the name.",
    "target": "studio.model-menu",
    "owner": "studio"
  },
  "S7": {
    "id": "S7",
    "title": "Generate the audio",
    "description": "Select GENERATE when the form is ready. This uses the price shown for your mode.",
    "target": "studio.generate",
    "owner": "studio"
  },
  "S8": {
    "id": "S8",
    "title": "Listen and keep working",
    "description": "Use PLAY to listen, EDIT to open the Editor, or SAVE VOICE to keep the vocals as a voice.",
    "target": "studio.feed-actions",
    "owner": "studio"
  },
  "W1": {
    "id": "W1",
    "title": "Your songs",
    "description": "Open MY SONGS for your tracks. Licenses, albums and voices have their own sections below.",
    "target": "workspace.songs-heading",
    "owner": "workspace"
  },
  "W2": {
    "id": "W2",
    "title": "Change song details",
    "description": "Edit the title, genre, artwork and selling terms here. Save when you are ready.",
    "target": "song-details.form",
    "owner": "workspace"
  },
  "W3": {
    "id": "W3",
    "title": "Open the Editor",
    "description": "Choose AUDIO EDITOR to work on this track. Editing a published version starts a new editable version.",
    "target": "card.editor-item",
    "owner": "workspace"
  },
  "W4": {
    "id": "W4",
    "title": "Review publication",
    "description": "Check the track and selling terms. CONFIRM & PUBLISH mints it and lists it on Market.",
    "target": "publish.review",
    "owner": "workspace"
  },
  "M1": {
    "id": "M1",
    "title": "Find a track",
    "description": "Search by title, creator or tag. Use Latest or Oldest to change the order.",
    "target": "market.search",
    "owner": "market"
  },
  "M2": {
    "id": "M2",
    "title": "Filter by creator",
    "description": "Search the creator list and choose whose tracks to show.",
    "target": "market.creator-menu",
    "owner": "market"
  },
  "M3": {
    "id": "M3",
    "title": "Filter by genre",
    "description": "Choose the genres you want. Clear the filters to see the full list again.",
    "target": "market.genre-menu",
    "owner": "market"
  },
  "M4": {
    "id": "M4",
    "title": "Listen to a track",
    "description": "Use Stream to listen. The card shows the track's price per minute.",
    "target": "card.stream",
    "owner": "market"
  },
  "M5": {
    "id": "M5",
    "title": "Review a license",
    "description": "A commercial license gives you stem access and remix rights. Choose your payment method here.",
    "target": "license.review",
    "owner": "market"
  },
  "E1": {
    "id": "E1",
    "title": "Play the arrangement",
    "description": "Play or pause here. Loop repeats the selection, or the whole song when nothing is selected.",
    "target": "editor.playback",
    "owner": "editor"
  },
  "E2": {
    "id": "E2",
    "title": "Focus a lane",
    "description": "Select a lane to work on its waveform. MST brings you back to Master.",
    "target": "board.master-focus",
    "owner": "editor"
  },
  "E3": {
    "id": "E3",
    "title": "Add a part",
    "description": "Add opens AI Layer, Keys, Drums, Sampler and Live Code.",
    "target": "board.add-menu",
    "owner": "editor"
  },
  "E4": {
    "id": "E4",
    "title": "Choose an AI edit",
    "description": "Choose an operation, check its target and open its settings before running it.",
    "target": "ai.operations",
    "owner": "editor"
  },
  "E5": {
    "id": "E5",
    "title": "Open a manual tool",
    "description": "Use the dock for effects, Mixer, instruments, Code, samples and History.",
    "target": "toolbox.overflow",
    "owner": "editor"
  },
  "E6": {
    "id": "E6",
    "title": "Keep an edit",
    "description": "Use Takes to compare edits and Merge to keep them in the audio. COMMIT saves a project snapshot.",
    "target": "board.commit",
    "owner": "editor"
  },
  "F1": {
    "id": "F1",
    "title": "Choose a funding source",
    "description": "Campaign Credits, Card Credits and On-Chain USDC have separate compartments. The active source is marked here.",
    "target": "funding.compartments",
    "owner": "funding"
  },
  "F2": {
    "id": "F2",
    "title": "Campaign Credits",
    "description": "Check the offer and your balance here. Claim or USE appears when it is available to your account.",
    "target": "funding.campaign",
    "owner": "funding"
  },
  "F3": {
    "id": "F3",
    "title": "Add Card Credits",
    "description": "Choose the amount you want to buy. Check the total before paying.",
    "target": "funding.card-amount",
    "owner": "funding"
  },
  "F4": {
    "id": "F4",
    "title": "Manage a USDC session",
    "description": "Set a spending limit and duration, then START SESSION when you are ready.",
    "target": "funding.usdc-setup",
    "owner": "funding",
    "alternate": [
      "Check the remaining budget here. END SESSION closes this session."
    ]
  },
  "F5": {
    "id": "F5",
    "title": "Choose the payment network",
    "description": "Choose the network before starting a USDC session.",
    "target": "funding.network-menu",
    "owner": "funding"
  },
  "V1": {
    "id": "V1",
    "title": "Describe the song",
    "description": "Write the sound, mood or story you have in mind.",
    "target": "studio.vibe-prompt",
    "owner": "studio"
  },
  "V2": {
    "id": "V2",
    "title": "Add an image",
    "description": "Upload or drop an image for the song idea. Use its remove button to leave it out.",
    "target": "studio.vibe-image",
    "owner": "studio"
  },
  "V3": {
    "id": "V3",
    "title": "Hum or speak",
    "description": "Use HUM / SPEAK to record your idea, then STOP. You can preview, re-record or remove it.",
    "target": "studio.vibe-audio",
    "owner": "studio"
  },
  "V4": {
    "id": "V4",
    "title": "Prepare the draft",
    "description": "VIBE asks Songwriter to fill the Studio form from your inputs.",
    "target": "studio.vibe-submit",
    "owner": "studio"
  },
  "V5": {
    "id": "V5",
    "title": "Review Songwriter's draft",
    "description": "Check the title, prompt, lyrics and music settings in CONTROL. Edit anything you want before GENERATE.",
    "target": "studio.songwriter-progress",
    "owner": "studio"
  },
  "P1": {
    "id": "P1",
    "title": "Instrumental or vocals",
    "description": "INSTRUMENTAL makes a track without vocals. Leave it off to use lyrics and a vocal language.",
    "target": "studio.instrumental",
    "owner": "studio"
  },
  "P2": {
    "id": "P2",
    "title": "Vocal language",
    "description": "Choose the language for the vocals, or keep AUTO.",
    "target": "studio.language-list",
    "owner": "studio"
  },
  "P3": {
    "id": "P3",
    "title": "Track duration",
    "description": "Choose a duration preset or adjust the seconds yourself.",
    "target": "studio.duration-editor",
    "owner": "studio"
  },
  "P4": {
    "id": "P4",
    "title": "Tempo",
    "description": "Choose a tempo preset or adjust the BPM value.",
    "target": "studio.tempo-editor",
    "owner": "studio"
  },
  "P5": {
    "id": "P5",
    "title": "Key and scale",
    "description": "Choose a root note and scale for the track.",
    "target": "studio.key-editor",
    "owner": "studio"
  },
  "P6": {
    "id": "P6",
    "title": "Style tags",
    "description": "Search and choose tags for the genre, mood or instruments.",
    "target": "studio.tags-editor",
    "owner": "studio"
  },
  "L1": {
    "id": "L1",
    "title": "Canvas or raw text",
    "description": "Use CANVAS for separate sections, or RAW [TAGS] to edit the whole sheet.",
    "target": "lyrics.mode-switch",
    "owner": "studio"
  },
  "L2": {
    "id": "L2",
    "title": "Add a section",
    "description": "Use ADD SECTION and choose a tag, then enter the lyrics for that section.",
    "target": "lyrics.section-tray",
    "owner": "studio"
  },
  "L3": {
    "id": "L3",
    "title": "Browse the tag palette",
    "description": "Open a category to see its tags. Choosing one adds a new section at the end.",
    "target": "lyrics.category-palette",
    "owner": "studio"
  },
  "L4": {
    "id": "L4",
    "title": "Add a direction",
    "description": "Use + TAG for structure, intensity, instrumental or vocal directions.",
    "target": "lyrics.tag-tray",
    "owner": "studio"
  },
  "L5": {
    "id": "L5",
    "title": "Arrange the sections",
    "description": "Use the arrows to move a section. Remove a tag or delete a section from its own controls.",
    "target": "lyrics.section-controls",
    "owner": "studio"
  },
  "L6": {
    "id": "L6",
    "title": "Edit the whole sheet",
    "description": "RAW [TAGS] lets you type lyrics and bracketed tags together.",
    "target": "lyrics.raw-editor",
    "owner": "studio"
  },
  "L7": {
    "id": "L7",
    "title": "Apply or discard the draft",
    "description": "DONE applies the lyrics to Studio. CANCEL discards edits from this dialog.",
    "target": "lyrics.footer",
    "owner": "studio"
  },
  "O1": {
    "id": "O1",
    "title": "Use a saved voice",
    "description": "SAVED lists your voices. Choose one that is ready for the current generation mode.",
    "target": "voice.saved-list",
    "owner": "studio"
  },
  "O2": {
    "id": "O2",
    "title": "Use a reference recording",
    "description": "UPLOAD lets you attach a vocal recording. Replace or remove it here.",
    "target": "voice.upload",
    "owner": "studio"
  },
  "O3": {
    "id": "O3",
    "title": "Set resemblance",
    "description": "Adjust RESEMBLANCE to control how closely the voice follows your reference.",
    "target": "voice.resemblance",
    "owner": "studio"
  },
  "O4": {
    "id": "O4",
    "title": "Save vocals as a voice",
    "description": "SAVE VOICE prepares a reusable vocal profile from this track. Find it in SAVED and MY VOICES.",
    "target": "studio.feed-save-voice",
    "owner": "studio"
  },
  "C1": {
    "id": "C1",
    "title": "Choose cover artwork",
    "description": "Upload a cover, or use the sparkle to generate one from the song details.",
    "target": "studio.artwork-actions",
    "owner": "studio"
  },
  "C2": {
    "id": "C2",
    "title": "Choose a collection",
    "description": "COLLECTION assigns the track to an album. Use NEW ALBUM to create one.",
    "target": "studio.collection-list",
    "owner": "studio"
  },
  "C3": {
    "id": "C3",
    "title": "Create an album",
    "description": "Enter the album title here. CREATE saves it; CANCEL returns without creating it.",
    "target": "studio.new-album",
    "owner": "studio"
  },
  "C4": {
    "id": "C4",
    "title": "Set selling terms",
    "description": "STREAM sets the price per minute. LICENSE sets the remix price, and LICENSES sets the available quantity.",
    "target": "studio.financials",
    "owner": "studio"
  },
  "C5": {
    "id": "C5",
    "title": "View the cover",
    "description": "Select the cover to view it at a larger size.",
    "target": "studio.cover-preview",
    "owner": "studio"
  },
  "C6": {
    "id": "C6",
    "title": "Change a feed track's visibility",
    "description": "MAKE PUBLIC mints the track if needed and lists it on Market.",
    "target": "studio.feed-visibility",
    "owner": "studio",
    "alternate": [
      "MAKE PRIVATE hides the track's Market listing."
    ]
  },
  "K1": {
    "id": "K1",
    "title": "Your songs",
    "description": "Open MY SONGS for your tracks. Licenses, albums and voices have their own sections below.",
    "target": "workspace.songs-heading",
    "owner": "workspace"
  },
  "K2": {
    "id": "K2",
    "title": "Your licenses",
    "description": "MY LICENSES holds tracks you licensed. Use AUDIO EDITOR on a licensed copy to make your remix.",
    "target": "workspace.licenses-heading",
    "owner": "workspace"
  },
  "K3": {
    "id": "K3",
    "title": "Your albums",
    "description": "MY ALBUMS lists your albums, covers and publication status.",
    "target": "workspace.albums-heading",
    "owner": "workspace"
  },
  "K4": {
    "id": "K4",
    "title": "Your voices",
    "description": "MY VOICES shows saved voices and their preparation status. Use the sample button to preview one.",
    "target": "workspace.voices-heading",
    "owner": "workspace"
  },
  "K5": {
    "id": "K5",
    "title": "Choose a song version",
    "description": "Use the numbered version pills to choose the version you want to hear or work on.",
    "target": "card.version-menu",
    "owner": "card"
  },
  "K6": {
    "id": "K6",
    "title": "Edit your profile",
    "description": "Set your public nickname, bio and avatar here. SAVE PROFILE updates your profile.",
    "target": "account.profile-form",
    "owner": "profile"
  },
  "K7": {
    "id": "K7",
    "title": "Listen to your track",
    "description": "Use the play button to listen to this version.",
    "target": "card.stream",
    "owner": "workspace"
  },
  "R1": {
    "id": "R1",
    "title": "Set project tempo",
    "description": "Enter BPM, choose a preset, nudge the value or tap a tempo.",
    "target": "editor.tempo-dialog",
    "owner": "editor"
  },
  "R2": {
    "id": "R2",
    "title": "Select a section",
    "description": "On desktop, drag sideways across the waveform. SECTION places a range at the playhead, including on a phone.",
    "target": "board.section",
    "owner": "board"
  },
  "R3": {
    "id": "R3",
    "title": "Work on the selection",
    "description": "Move or resize the range with its handles. AUDITION plays it; EXTRACT and REWORK open the matching AI edit.",
    "target": "board.selection-actions",
    "owner": "board"
  },
  "R4": {
    "id": "R4",
    "title": "Shape the waveform",
    "description": "Drag vertically to shape PEAK. For WAVE, hold before dragging sideways on desktop; drag sideways on the wave on a phone.",
    "target": "board.waveform",
    "owner": "board"
  },
  "R5": {
    "id": "R5",
    "title": "Fades and a closer view",
    "description": "Use the top edge handles for fades in Smooth mode. On desktop, Ctrl/Cmd + wheel zooms; pan sideways when zoomed.",
    "target": "board.waveform-view",
    "owner": "board"
  },
  "I1": {
    "id": "I1",
    "title": "Describe the edit",
    "description": "Expand Prompt to write the change you want. Check the target lane and range before running it.",
    "target": "ai.prompt-dialog",
    "owner": "ai"
  },
  "I2": {
    "id": "I2",
    "title": "Write or sync vocal lyrics",
    "description": "Open Lyrics to edit words and section tags. Extract Lyrics transcribes the vocals; the synced view follows their timing.",
    "target": "editor.lyrics-editor",
    "owner": "ai"
  },
  "I3": {
    "id": "I3",
    "title": "Rework a section",
    "description": "Choose how much to change the selected section. Crossfade controls its join with the surrounding audio.",
    "target": "ai.rework-parameters",
    "owner": "ai"
  },
  "I4": {
    "id": "I4",
    "title": "Layer a new part",
    "description": "Choose an instrument or enter your own. Layer adds a part around the current audio and selected range.",
    "target": "ai.layer-parameters",
    "owner": "ai"
  },
  "I5": {
    "id": "I5",
    "title": "Extend the track",
    "description": "Choose how much time to add. Check the new total length before EXTEND.",
    "target": "ai.extend-parameters",
    "owner": "ai"
  },
  "I6": {
    "id": "I6",
    "title": "Build an accompaniment",
    "description": "Choose an arrangement focus and the parts you want around the source.",
    "target": "ai.accompany-parameters",
    "owner": "ai"
  },
  "I7": {
    "id": "I7",
    "title": "Restyle the audio",
    "description": "Describe the new sound and adjust the blend with the source.",
    "target": "ai.restyle-parameters",
    "owner": "ai"
  },
  "I8": {
    "id": "I8",
    "title": "Extract a stem",
    "description": "Choose the instrument or vocal part to isolate, then EXTRACT when you are ready.",
    "target": "ai.extract-parameters",
    "owner": "ai"
  },
  "I9": {
    "id": "I9",
    "title": "Separate the mix",
    "description": "Extract stems from Master to work on vocals, drums, bass and instruments separately.",
    "target": "board.separate",
    "owner": "board"
  },
  "I10": {
    "id": "I10",
    "title": "Open the song's lyrics",
    "description": "The document button opens the song's lyric sheet beside the waveform.",
    "target": "board.lyrics-document",
    "owner": "board"
  },
  "T1": {
    "id": "T1",
    "title": "Find a take",
    "description": "Open the takes list and choose an edit to compare. Category and version pills help you find it.",
    "target": "board.take-vault",
    "owner": "board"
  },
  "T2": {
    "id": "T2",
    "title": "Compare original and take",
    "description": "ORG controls the original audio in this section. TK controls the take on Master.",
    "target": "board.take-comparison",
    "owner": "board"
  },
  "T3": {
    "id": "T3",
    "title": "Mount a take",
    "description": "MOUNT puts the take into the working arrangement. BASE marks a mounted take; select it again to unmount.",
    "target": "history.take-mount",
    "owner": "toolbox"
  },
  "T4": {
    "id": "T4",
    "title": "Merge a section into Master",
    "description": "Use this section's Merge control to keep its take in Master.",
    "target": "board.section-merge",
    "owner": "board"
  },
  "T5": {
    "id": "T5",
    "title": "Keep a generated layer in its lane",
    "description": "This Merge keeps the selected generated layer in its instrument lane.",
    "target": "board.layer-merge",
    "owner": "board"
  },
  "T6": {
    "id": "T6",
    "title": "Merge a lane into Master",
    "description": "This Merge bakes the lane into Master. With a range selected, it uses that range.",
    "target": "board.lane-merge",
    "owner": "board"
  },
  "T7": {
    "id": "T7",
    "title": "Merge the arrangement",
    "description": "Merge all includes the enabled sections and populated lanes in the arrangement.",
    "target": "board.merge-all",
    "owner": "board"
  },
  "T8": {
    "id": "T8",
    "title": "Keep or discard a Restyle",
    "description": "Merge Restyle makes this version the new Master. Discard Restyle removes it and returns to Master.",
    "target": "board.restyle-actions",
    "owner": "board"
  },
  "J1": {
    "id": "J1",
    "title": "Open the piano roll",
    "description": "Open the full piano roll to write notes and play the keyboard.",
    "target": "keys.roll",
    "owner": "keys",
    "alternate": [
      "Use CREATE KEYS TRACK to add a Keys lane."
    ]
  },
  "J2": {
    "id": "J2",
    "title": "Add or remove notes",
    "description": "Select an empty grid cell to add a note. Select a note to remove it.",
    "target": "keys.note-grid",
    "owner": "keys"
  },
  "J3": {
    "id": "J3",
    "title": "Note length and velocity",
    "description": "Division sets the length of new notes and the quantize grid. Velocity sets how hard new notes play.",
    "target": "keys.note-options",
    "owner": "keys"
  },
  "J4": {
    "id": "J4",
    "title": "Record with your keyboard",
    "description": "Enable KEY to record at the step cursor. Use the displayed keys to play, and the octave controls to change register.",
    "target": "keys.keyboard-record",
    "owner": "keys"
  },
  "J5": {
    "id": "J5",
    "title": "Quantize or clear",
    "description": "QUANTIZE moves notes to the chosen division. Clear removes the lane's notes.",
    "target": "keys.edit-actions",
    "owner": "keys"
  },
  "J6": {
    "id": "J6",
    "title": "Keep pattern versions",
    "description": "Numbered pills choose a version. + creates another version on this lane.",
    "target": "keys.versions",
    "owner": "keys"
  },
  "D1": {
    "id": "D1",
    "title": "Open the drum matrix",
    "description": "Open the full matrix to sequence each drum voice.",
    "target": "drums.matrix",
    "owner": "drums",
    "alternate": [
      "Use CREATE DRUMS TRACK to add a drum lane."
    ]
  },
  "D2": {
    "id": "D2",
    "title": "Choose a voice and steps",
    "description": "Each row is a drum voice. Select a step to turn that hit on or off.",
    "target": "drums.steps",
    "owner": "drums"
  },
  "D3": {
    "id": "D3",
    "title": "Record with pads",
    "description": "Use PAD REC to enter drum hits with the displayed keys.",
    "target": "drums.pad-record",
    "owner": "drums"
  },
  "D4": {
    "id": "D4",
    "title": "Randomize or clear",
    "description": "RANDOMIZE replaces the pattern with new hits. Clear removes its steps.",
    "target": "drums.edit-actions",
    "owner": "drums"
  },
  "D5": {
    "id": "D5",
    "title": "Keep drum versions",
    "description": "Numbered pills choose a pattern version. + creates another version.",
    "target": "drums.versions",
    "owner": "drums"
  },
  "N1": {
    "id": "N1",
    "title": "Open Code",
    "description": "Open the full REPL to write a Strudel pattern.",
    "target": "code.repl",
    "owner": "code",
    "alternate": [
      "Create a Code track to write a pattern."
    ]
  },
  "N2": {
    "id": "N2",
    "title": "Write or load a pattern",
    "description": "Type your pattern, or choose TECHNO, BREAKS or ACID. A starter replaces the text and runs it.",
    "target": "code.starters",
    "owner": "code"
  },
  "N3": {
    "id": "N3",
    "title": "Run the code",
    "description": "RUN evaluates the pattern. Shift+Enter does the same while you are in the code editor.",
    "target": "code.run",
    "owner": "code"
  },
  "N4": {
    "id": "N4",
    "title": "Ask the Composer",
    "description": "Describe a part or a change to the current pattern. The sparkle asks the Composer to write and run it.",
    "target": "code.ai-prompt",
    "owner": "code"
  },
  "N5": {
    "id": "N5",
    "title": "Choose a reference",
    "description": "REF chooses the audio the Composer works from. Select a timeline range to focus the request on a section.",
    "target": "code.reference",
    "owner": "code"
  },
  "N6": {
    "id": "N6",
    "title": "Adjust the pattern's sound",
    "description": "SPEED, LPF, REVERB and DELAY change the current pattern.",
    "target": "code.macros",
    "owner": "code"
  },
  "N7": {
    "id": "N7",
    "title": "Versions and progress",
    "description": "Use numbered pills for Code versions and + for a new one. LOG shows Composer progress and errors.",
    "target": "code.versions",
    "owner": "code"
  },
  "Q1": {
    "id": "Q1",
    "title": "Add a sample",
    "description": "Upload or drop audio, or use RECORD and STOP. REPLACE clears the current sample so you can choose another file.",
    "target": "sample.source",
    "owner": "sample"
  },
  "Q2": {
    "id": "Q2",
    "title": "Choose a slice",
    "description": "Choose the number of slices, then preview a slice to select it.",
    "target": "sample.slices",
    "owner": "sample"
  },
  "Q3": {
    "id": "Q3",
    "title": "Import to the arrangement",
    "description": "IMPORT adds the selected slice to a sample lane. With no slice selected, it imports the whole sample.",
    "target": "sample.import",
    "owner": "sample"
  },
  "X1": {
    "id": "X1",
    "title": "Balance the lane",
    "description": "Volume sets the level and PAN places the lane left or right. Mute and Solo are on its controller.",
    "target": "mixer.level-pan",
    "owner": "mixer"
  },
  "X2": {
    "id": "X2",
    "title": "Tone and section trim",
    "description": "BASS, MID and HIGH shape the balance. FILTER lowers the cutoff; TRIM adjusts a mounted section.",
    "target": "mixer.tone",
    "owner": "mixer"
  },
  "X3": {
    "id": "X3",
    "title": "Choose an effect",
    "description": "Select an FX module to open its controls. Its power button enables or bypasses it.",
    "target": "fx.modules",
    "owner": "fx"
  },
  "X4": {
    "id": "X4",
    "title": "Adjust the effect",
    "description": "Open the selected effect to adjust its controls.",
    "target": "fx.module.<key>",
    "owner": "fx"
  },
  "X5": {
    "id": "X5",
    "title": "Reset an adjustment",
    "description": "Double-click a Mixer control to reset it. WAV's reset button clears the lane's wave sculpting.",
    "target": "fx.wave-reset",
    "owner": "fx"
  },
  "H1": {
    "id": "H1",
    "title": "Undo or redo",
    "description": "Undo steps back through your edits. Redo brings an undone edit back.",
    "target": "board.undo-redo",
    "owner": "toolbox"
  },
  "H2": {
    "id": "H2",
    "title": "Save a snapshot",
    "description": "COMMIT opens a snapshot note. Enter a description, then SAVE to keep the project state.",
    "target": "history.snapshot-note",
    "owner": "editor"
  },
  "H3": {
    "id": "H3",
    "title": "Return to a snapshot",
    "description": "Choose a snapshot to reveal Restore. AUDITION appears when it has audio to preview.",
    "target": "history.snapshot-actions",
    "owner": "toolbox"
  }
};
const definitions: Array<Omit<GuideFlow, "steps"> & { stepIds: string[] }> = [
  {
    "id": "welcome",
    "label": "Account",
    "version": 2,
    "pages": [
      "studio",
      "mypage",
      "market",
      "editor"
    ],
    "stepIds": [
      "A1",
      "A2",
      "A3",
      "A4",
      "A5",
      "A6"
    ]
  },
  {
    "id": "studio",
    "label": "Studio",
    "version": 2,
    "pages": [
      "studio"
    ],
    "stepIds": [
      "S1",
      "S2",
      "S3",
      "S4",
      "S5",
      "S6",
      "S7",
      "S8"
    ]
  },
  {
    "id": "mypage",
    "label": "Workspace",
    "version": 2,
    "pages": [
      "mypage"
    ],
    "stepIds": [
      "W1",
      "W2",
      "W3",
      "W4"
    ]
  },
  {
    "id": "market",
    "label": "Market",
    "version": 2,
    "pages": [
      "market"
    ],
    "stepIds": [
      "M1",
      "M2",
      "M3",
      "M4",
      "M5"
    ]
  },
  {
    "id": "editor",
    "label": "Editor",
    "version": 2,
    "pages": [
      "editor"
    ],
    "stepIds": [
      "E1",
      "E2",
      "E3",
      "E4",
      "E5",
      "E6"
    ]
  },
  {
    "id": "funding",
    "label": "Credits and Session",
    "version": 2,
    "pages": [
      "studio",
      "mypage",
      "market",
      "editor"
    ],
    "stepIds": [
      "F1",
      "F2",
      "F3",
      "F4",
      "F5"
    ]
  },
  {
    "id": "studio-vibe",
    "label": "Start from a vibe",
    "version": 2,
    "pages": [
      "studio"
    ],
    "stepIds": [
      "V1",
      "V2",
      "V3",
      "V4",
      "V5"
    ]
  },
  {
    "id": "studio-settings",
    "label": "Music settings",
    "version": 2,
    "pages": [
      "studio"
    ],
    "stepIds": [
      "P1",
      "P2",
      "P3",
      "P4",
      "P5",
      "P6"
    ]
  },
  {
    "id": "studio-lyrics",
    "label": "Lyrics Canvas",
    "version": 2,
    "pages": [
      "studio"
    ],
    "stepIds": [
      "L1",
      "L2",
      "L3",
      "L4",
      "L5",
      "L6",
      "L7"
    ]
  },
  {
    "id": "studio-voice",
    "label": "Voice",
    "version": 2,
    "pages": [
      "studio"
    ],
    "stepIds": [
      "O1",
      "O2",
      "O3",
      "O4"
    ]
  },
  {
    "id": "studio-release-details",
    "label": "Artwork and selling terms",
    "version": 2,
    "pages": [
      "studio"
    ],
    "stepIds": [
      "C1",
      "C2",
      "C3",
      "C4",
      "C5",
      "C6"
    ]
  },
  {
    "id": "catalog",
    "label": "Catalog and versions",
    "version": 2,
    "pages": [
      "mypage",
      "market"
    ],
    "stepIds": [
      "K1",
      "K2",
      "K3",
      "K4",
      "K5",
      "K6",
      "K7"
    ]
  },
  {
    "id": "editor-selection",
    "label": "Transport, selection and waveform",
    "version": 2,
    "pages": [
      "editor"
    ],
    "stepIds": [
      "R1",
      "R2",
      "R3",
      "R4",
      "R5"
    ]
  },
  {
    "id": "editor-ai",
    "label": "AI edits and lyrics",
    "version": 2,
    "pages": [
      "editor"
    ],
    "stepIds": [
      "I1",
      "I2",
      "I3",
      "I4",
      "I5",
      "I6",
      "I7",
      "I8",
      "I9",
      "I10"
    ]
  },
  {
    "id": "editor-takes",
    "label": "Takes, comparison and merging",
    "version": 2,
    "pages": [
      "editor"
    ],
    "stepIds": [
      "T1",
      "T2",
      "T3",
      "T4",
      "T5",
      "T6",
      "T7",
      "T8"
    ]
  },
  {
    "id": "editor-keys",
    "label": "Keys",
    "version": 2,
    "pages": [
      "editor"
    ],
    "stepIds": [
      "J1",
      "J2",
      "J3",
      "J4",
      "J5",
      "J6"
    ]
  },
  {
    "id": "editor-drums",
    "label": "Drums",
    "version": 2,
    "pages": [
      "editor"
    ],
    "stepIds": [
      "D1",
      "D2",
      "D3",
      "D4",
      "D5"
    ]
  },
  {
    "id": "editor-code",
    "label": "Code and Algorithmic Composer",
    "version": 2,
    "pages": [
      "editor"
    ],
    "stepIds": [
      "N1",
      "N2",
      "N3",
      "N4",
      "N5",
      "N6",
      "N7"
    ]
  },
  {
    "id": "editor-samples",
    "label": "Sampler",
    "version": 2,
    "pages": [
      "editor"
    ],
    "stepIds": [
      "Q1",
      "Q2",
      "Q3"
    ]
  },
  {
    "id": "editor-effects",
    "label": "Mixer and effects",
    "version": 2,
    "pages": [
      "editor"
    ],
    "stepIds": [
      "X1",
      "X2",
      "X3",
      "X4",
      "X5"
    ]
  },
  {
    "id": "editor-history",
    "label": "History and snapshots",
    "version": 2,
    "pages": [
      "editor"
    ],
    "stepIds": [
      "H1",
      "H2",
      "H3"
    ]
  }
];
export const GUIDE_FLOWS = definitions.reduce((flows, flow) => { flows[flow.id] = { ...flow, steps: flow.stepIds.map(id => GUIDE_STEPS[id]) }; return flows; }, {} as Record<GuideFlowId, GuideFlow>);
export const FX_STEPS = {
  "sculpt": {
    "title": "Shape peaks and waves",
    "description": "Use the peak and wave controls to shape the selected lane or region.",
    "target": "fx.module.sculpt"
  },
  "eq": {
    "title": "Equalizer",
    "description": "Adjust Low, Mid and High to change the frequency balance.",
    "target": "fx.module.eq"
  },
  "filter": {
    "title": "Filter",
    "description": "Choose the filter type, then adjust cutoff and resonance.",
    "target": "fx.module.filter"
  },
  "distortion": {
    "title": "Drive",
    "description": "Adjust drive and mix to add distortion.",
    "target": "fx.module.distortion"
  },
  "chorus": {
    "title": "Chorus",
    "description": "Adjust the chorus controls to widen and modulate the sound.",
    "target": "fx.module.chorus"
  },
  "delay": {
    "title": "Delay",
    "description": "Set the delay timing, feedback and mix.",
    "target": "fx.module.delay"
  },
  "reverb": {
    "title": "Reverb",
    "description": "Adjust decay and mix to add space.",
    "target": "fx.module.reverb"
  },
  "compressor": {
    "title": "Compressor",
    "description": "Set threshold and ratio, then adjust attack and release.",
    "target": "fx.module.compressor"
  },
  "spatial": {
    "title": "Place the sound",
    "description": "Use azimuth, elevation and distance to position the sound.",
    "target": "fx.module.spatial"
  }
};
export function pageGuides(page: GuidePageId) { return Object.values(GUIDE_FLOWS).filter(flow => flow.pages.includes(page)); }
