/**
 * Lazy-context Tone.js entrypoint.
 *
 * `tone/build/esm/index.js` evaluates deprecated top-level singletons
 * (`export const Transport = getContext().transport`, `Destination`, `Master`, etc.)
 * at module evaluation time, which forces a browser `AudioContext` to be created
 * before any user gesture and triggers Chrome's autoplay `AudioContext` warnings.
 *
 * By re-exporting `classes.js` and `core/Global.js` directly without those
 * deprecated top-level evaluations, `globalContext` remains Tone's inert
 * `DummyContext` until `getContext()` / `start()` is explicitly called on a
 * user gesture.
 */
export { getContext, setContext, start } from 'tone/build/esm/core/Global.js';
export * from 'tone/build/esm/classes.js';
export * from 'tone/build/esm/version.js';
import { getContext } from 'tone/build/esm/core/Global.js';
import { ToneAudioBuffer } from 'tone/build/esm/core/context/ToneAudioBuffer.js';
export { supported } from 'tone/build/esm/core/context/AudioContext.js';

export function now() {
  return getContext().now();
}

export function immediate() {
  return getContext().immediate();
}

export function getTransport() {
  return getContext().transport;
}

export function getDestination() {
  return getContext().destination;
}

export function getListener() {
  return getContext().listener;
}

export function getDraw() {
  return getContext().draw;
}

export function loaded() {
  return ToneAudioBuffer.loaded();
}
