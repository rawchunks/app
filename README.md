# Rawchunks app

The Rawchunks music workstation. Generate tracks in Studio, edit audio on a multitrack timeline, organize songs and voices, and publish or license music in the Market.

The editor combines Rework, Layer, Extract, Separate, Extend and Restyle with Keys, Drums, Live Code, a Sampler, Mixer, FX Rack and project history. You can compare takes, mount them on Master and merge the sections you choose.

[Launch app](https://app.rawchunks.space) · [App guides](https://docs.rawchunks.space/app/overview) · [API integration](https://docs.rawchunks.space/dev/overview)

## PayPal, AI and AG Grid

PayPal funds reusable Credits for music creation and metered listening. `@paypal/react-paypal-js` loads the SDK; Card Fields hosts card entry inside the app's checkout. The backend uses OAuth and Orders v2 to create, validate and capture orders, verify webhook signatures and recover interrupted purchases. The $10/$25/$100 packs provide 1,000/2,500/10,000 Credits. One card capture funds many sub-cent usage payments through x402, avoiding a separate card-processing fee and checkout for each charge. Rawchunks records creator listening and license earnings. See the [checkout UI](https://github.com/rawchunks/app/blob/main/src/components/connector.tsx), [PayPal service](https://github.com/rawchunks/backend/blob/main/credits/paypal.ts) and [payment guide](https://docs.rawchunks.space/dev/guides/paypal-x402).

AI supports both drafting and production. ACE-Step 1.5 XL models generate and edit audio. Nemotron powers Songwriter, which fills an editable Studio draft from text, an image or a recording, and Algorithmic Composer, which writes Strudel parts using the project tempo, key and selected section. Nebius Token Factory streams agent results; Cartesia and ElevenLabs transcribe recordings, and Nano Banana creates cover art. The backend implementations are in [Songwriter](https://github.com/rawchunks/backend/tree/main/agents/vibe), [Composer](https://github.com/rawchunks/backend/tree/main/agents/strudel) and [generation](https://github.com/rawchunks/backend/tree/main/generation).

AG Grid React powers EARN's song, genre and activity tables; AG Charts supplies its timeline views. Custom cells show covers, listening ratios and royalty receipts. Stable row IDs preserve live updates, while expandable blocks, search and filters let creators compare releases and inspect earnings. Developers can fetch the same metrics through the earnings API. See the [dashboard components](https://github.com/rawchunks/app/tree/main/src/components/ag) and [creator analytics guide](https://docs.rawchunks.space/app/dashboard).

## Stack

React, TypeScript and Vite. Web Audio and Tone.js handle playback and instruments; Zustand and TanStack Query manage client state and requests. Publishing and license purchases use a connected wallet.

## Local development

Run from this repository:

```sh
npm ci
npm run dev
```

Vite serves the app at `http://localhost:3001`. `VITE_API_URL` selects the Rawchunks API; the default is `https://api.rawchunks.space`. Paid music operations require a Rawchunks session.

```sh
npm run build
npm run test:payments
```

For controls and workflows, use the [editor guide](https://docs.rawchunks.space/app/editor). For third-party projects, use the [developer guides](https://docs.rawchunks.space/dev/guides/connect).
