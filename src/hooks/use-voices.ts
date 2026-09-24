import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { isVoice, readVoices, writeVoices } from '@/lib/cache';
import type { Voice } from '@/lib/schema';
import { sdk, watch } from '@/lib/sdk';

function identity(address: string): string {
  return /^0x[0-9a-f]{40}$/i.test(address) ? address.toLowerCase() : address;
}

function key(address: string) { return ['voices', identity(address)] as const; }

export function voiceStatus(voice: Voice): string {
  if (voice.status === 'ready') return 'Ready';
  if (voice.status === 'error') return 'Error';
  return voice.status === 'saved' ? 'Saved' : 'Preparing';
}

export function voiceAvailability(voice: Voice, mode: 'turbo' | 'sft'): string {
  const output = voice.availability[mode];
  if (voiceReady(voice, mode)) return 'Ready';
  if (output.status === 'error') return 'Error';
  return output.status === 'unavailable' ? 'Not ready' : 'Preparing';
}

export function voiceReady(voice: Voice, mode: 'turbo' | 'sft'): boolean {
  const output = voice.availability[mode];
  return output.status === 'ready' && output.adapter?.status === 'ready' && output.adapter.model === `acestep-v15-xl-${mode}`;
}

function pending(voice: Voice): boolean {
  return ['saved', 'extracting', 'queued', 'training'].includes(voice.status) ||
    Object.values(voice.availability).some(output => output.status === 'queued' || output.status === 'training');
}

export function voiceUpdate(result: unknown, address: string, id: string): Voice | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid voice update');
  const event = result as Record<string, unknown>;
  if (Object.keys(event).length === 0) return null;
  if (!isVoice(event.voice, address) || event.voice.id !== id) {
    throw new Error(typeof event.error === 'string' ? event.error : 'Invalid voice update');
  }
  return event.voice;
}

interface Observation {
  users: number;
  controllers: Map<string, AbortController>;
  errors: Map<string, string>;
  listeners: Set<(message: string | null) => void>;
  unsubscribe: () => void;
}

const observations = new WeakMap<QueryClient, Map<string, Observation>>();

function observe(client: QueryClient, address: string, listener: (message: string | null) => void): () => void {
  let accounts = observations.get(client);
  if (!accounts) { accounts = new Map(); observations.set(client, accounts); }
  const owner = identity(address);
  let observation = accounts.get(owner);
  if (!observation) {
    observation = { users: 0, controllers: new Map(), errors: new Map(), listeners: new Set(), unsubscribe: () => {} };
    const current = observation;
    const sync = () => {
      const voices = client.getQueryData<Voice[]>(key(address)) ?? [];
      const active = new Set(voices.filter(pending).map(voice => voice.id));
      current.controllers.forEach((controller, id) => { if (!active.has(id)) { controller.abort(); current.controllers.delete(id); } });
      current.errors.forEach((_, id) => { if (!active.has(id)) current.errors.delete(id); });
      for (const id of active) {
        if (current.controllers.has(id) || current.errors.has(id)) continue;
        const controller = new AbortController();
        current.controllers.set(id, controller);
        void watch(`/api/voices/${encodeURIComponent(id)}/events`, controller.signal, result => {
          if (controller.signal.aborted) return true;
          const updated = voiceUpdate(result, address, id);
          if (!updated) return false;
          client.setQueryData<Voice[]>(key(address), previous => {
            const next = [updated, ...(previous ?? []).filter(voice => voice.id !== id)];
            writeVoices(next, address);
            return next;
          });
          current.listeners.forEach(notify => notify(current.errors.values().next().value ?? null));
          return !pending(updated);
        }, { userAddress: address }).catch(error => {
          if (controller.signal.aborted) return;
          current.errors.set(id, error instanceof Error ? error.message : 'Could not follow voice preparation');
          current.listeners.forEach(notify => notify(current.errors.values().next().value ?? null));
        }).finally(() => { if (current.controllers.get(id) === controller) current.controllers.delete(id); });
      }
    };
    current.unsubscribe = client.getQueryCache().subscribe(event => {
      if (event.query.queryKey[0] === 'voices' && event.query.queryKey[1] === owner) {
        if (event.type === 'updated' && event.action.type === 'success' && !event.action.manual) current.errors.clear();
        sync();
        current.listeners.forEach(notify => notify(current.errors.values().next().value ?? null));
      }
    });
    accounts.set(owner, current);
    sync();
  }
  observation.users++;
  observation.listeners.add(listener);
  listener(observation.errors.values().next().value ?? null);
  return () => {
    observation.listeners.delete(listener);
    if (--observation.users > 0) return;
    observation.unsubscribe();
    observation.controllers.forEach(controller => controller.abort());
    accounts.delete(owner);
  };
}

export function useVoices(address: string | null) {
  const client = useQueryClient();
  const [streamError, setStreamError] = useState<{ address: string; message: string } | null>(null);
  const query = useQuery({
    queryKey: address ? key(address) : ['voices', null],
    enabled: Boolean(address),
    initialData: () => address ? readVoices(address) ?? undefined : undefined,
    initialDataUpdatedAt: 0,
    queryFn: async ({ signal }): Promise<Voice[]> => {
      if (!address) return [];
      const response = await sdk.fetch(`/api/voices?creator=${encodeURIComponent(address)}`, { signal, userAddress: address });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Could not load your voices');
      const voices: unknown = result.voices;
      if (!Array.isArray(voices) || !voices.every(voice => isVoice(voice, address))) throw new Error('Invalid voice collection');
      writeVoices(voices, address);
      return voices;
    },
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!address) return;
    return observe(client, address, message => setStreamError(message ? { address, message } : null));
  }, [client, address]);

  const remember = useCallback((voice: unknown): Voice => {
    if (!address || !isVoice(voice, address)) throw new Error('Invalid saved voice');
    client.setQueryData<Voice[]>(key(address), previous => {
      const next = [voice, ...(previous ?? []).filter(saved => saved.id !== voice.id)];
      writeVoices(next, address);
      return next;
    });
    return voice;
  }, [address, client]);

  const refresh = useCallback(async () => {
    setStreamError(null);
    await query.refetch();
  }, [query.refetch]);

  return {
    voices: query.data ?? [],
    loading: Boolean(address) && query.data === undefined && query.isPending,
    error: query.error?.message ?? (streamError?.address === address ? streamError.message : null),
    refresh,
    remember,
  };
}
