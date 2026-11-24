import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isVoice, readVoices, writeVoices } from '../src/lib/cache';
import type { Voice } from '../src/lib/schema';
import { voiceAvailability, voiceReady, voiceStatus, voiceUpdate } from '../src/hooks/use-voices';

vi.mock('../../../app/src/lib/sdk', () => ({ sdk: { fetch: vi.fn() }, watch: vi.fn() }));

const evm = `0x${'a'.repeat(40)}`;
const other = `0x${'b'.repeat(40)}`;
const solana = 'So11111111111111111111111111111111111111112';

function voice(creator = evm): Voice {
  return {
    id: 'voice-1', name: 'My voice', creator, created_at: '2026-10-10T10:00:00Z',
    sample_url: 'https://fixture.invalid/sample.wav', status: 'training',
    availability: {
      sft: { model: 'acestep-v15-xl-sft', status: 'training', step: 3, total_steps: 20, adapter: { id: 'adapter-master', model: 'acestep-v15-xl-sft', status: 'training' } },
    },
  };
}

describe('account-scoped voices cache', () => {
  let storage: Map<string, string>;
  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reads the current account immediately without sharing entries with another account', () => {
    writeVoices([voice()], evm);
    expect(readVoices(evm)).toEqual([voice()]);
    expect(readVoices(other)).toBeNull();
  });

  it('matches EVM case while preserving case-sensitive Solana identities', () => {
    writeVoices([voice()], evm.toUpperCase());
    expect(readVoices(evm)).toEqual([voice()]);
    writeVoices([voice(solana)], solana);
    expect(readVoices(solana)).toEqual([voice(solana)]);
    expect(readVoices(solana.toLowerCase())).toBeNull();
    expect(isVoice(voice(solana), solana.toLowerCase())).toBe(false);
  });

  it('rejects a mixed-owner collection and prevents writing foreign voices', () => {
    storage.set(`voices:${evm}`, JSON.stringify([voice(), voice(other)]));
    expect(readVoices(evm)).toBeNull();
    writeVoices([voice(other)], evm);
    expect(storage.get(`voices:${evm}`)).toEqual(JSON.stringify([voice(), voice(other)]));
  });

  it.each([
    { ...voice(), status: 'complete' },
    { ...voice(), sample_url: 9 },
    { ...voice(), availability: undefined },
    { ...voice(), availability: { sft: { model: 'acestep-v15-xl-turbo', status: 'ready' } } },
    { ...voice(), availability: { sft: { model: 'acestep-v15-xl-sft', status: 'training', step: '3' } } },
  ])('rejects malformed voice metadata %j', invalid => {
    storage.set(`voices:${evm}`, JSON.stringify([invalid]));
    expect(readVoices(evm)).toBeNull();
  });

  it('preserves pending voices and confirmed empty lists as different cache results', () => {
    writeVoices([voice()], evm);
    expect(readVoices(evm)?.[0].availability.sft).toMatchObject({ status: 'training', step: 3, total_steps: 20 });
    writeVoices([], evm);
    expect(readVoices(evm)).toEqual([]);
    storage.set(`voices:${evm}`, 'not json');
    expect(readVoices(evm)).toBeNull();
  });

  it('retains distinct source conditioning and readiness for voices sharing one canonical sample', () => {
    const canonical: Voice = {
      ...voice(),
      metadata: { source: 'upload' },
      availability: {
        sft: { model: 'acestep-v15-xl-sft', status: 'ready', adapter: { id: 'adapter-master', model: 'acestep-v15-xl-sft', status: 'ready' } },
      },
    };
    const source: Voice = {
      ...voice(), id: 'source-variant', name: 'Source variant',
      metadata: { lyrics: '[Verse]\r\nExact words', bpm: 100, keyscale: 'C major' },
      availability: {
        sft: { model: 'acestep-v15-xl-sft', status: 'queued' },
      },
    };
    writeVoices([canonical, source], evm);
    const cached = readVoices(evm)!;
    expect(cached.map(v => v.id)).toEqual([canonical.id, source.id]);
    expect(cached[1].metadata).toEqual(source.metadata);
    expect(cached[1].sample_url).toBe(cached[0].sample_url);
    expect(voiceReady(cached[0], 'sft')).toBe(true);
    expect(voiceReady(cached[1], 'sft')).toBe(false);
    expect(voiceReady(cached[1], 'turbo')).toBe(true);
    expect(voiceUpdate({ voice: cached[1] }, evm, source.id)).toEqual(cached[1]);
    expect(() => voiceUpdate({ voice: cached[0] }, evm, source.id)).toThrow('Invalid voice update');
  });
});

describe('saved voice output availability', () => {
  it('ignores stream heartbeats while retaining real errors and validating updates', () => {
    expect(voiceUpdate({}, evm, 'voice-1')).toBeNull();
    expect(voiceUpdate({ voice: voice(), status: 'training' }, evm, 'voice-1')).toEqual(voice());
    expect(() => voiceUpdate({ status: 'error', error: 'Voice lookup failed' }, evm, 'voice-1')).toThrow('Voice lookup failed');
    expect(() => voiceUpdate({ voice: voice(other) }, evm, 'voice-1')).toThrow('Invalid voice update');
  });
  it('permits Fast via isolated vocal sample while Studio Master SFT LoRA is training', () => {
    const saved = voice();
    expect(voiceReady(saved, 'turbo')).toBe(true);
    expect(voiceReady(saved, 'sft')).toBe(false);
    expect(voiceAvailability(saved, 'turbo')).toBe('Ready');
    expect(voiceAvailability(saved, 'sft')).toBe('Training');
    expect(voiceStatus(saved)).toBe('Training');
  });

  it('requires a ready SFT adapter for Studio Master and sample_url for Fast', () => {
    const saved = voice();
    saved.availability.sft.status = 'ready';
    saved.availability.sft.adapter = { id: 'a', model: 'acestep-v15-xl-turbo' as any, status: 'ready' };
    expect(voiceReady(saved, 'sft')).toBe(false);
    saved.availability.sft.adapter = undefined;
    expect(voiceReady(saved, 'sft')).toBe(false);
    saved.sample_url = null;
    expect(voiceReady(saved, 'turbo')).toBe(false);
  });

  it('retains actual errors and reports saved registration before preparation completes', () => {
    const saved = voice();
    saved.status = 'saved';
    expect(voiceStatus(saved)).toBe('Saved');
    saved.availability.sft.status = 'error';
    saved.availability.sft.error = 'Preparation interrupted';
    expect(voiceAvailability(saved, 'sft')).toBe('Error');
    expect(saved.availability.sft.error).toBe('Preparation interrupted');
    expect(voiceReady(saved, 'sft')).toBe(false);
  });
});
