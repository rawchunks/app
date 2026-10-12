# Rawchunks app

The Rawchunks music workstation. Generate tracks in Studio, edit audio on a multitrack timeline, organize songs and voices, and publish or license music in the Market.

The editor combines Rework, Layer, Extract, Separate, Extend and Restyle with Keys, Drums, Live Code, a Sampler, Mixer, FX Rack and project history. You can compare takes, mount them on Master and merge the sections you choose.

[Launch app](https://app.rawchunks.space) · [App guides](https://docs.rawchunks.space/app/overview) · [API integration](https://docs.rawchunks.space/dev/overview)

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
