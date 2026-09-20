import { ComposeSDK } from "@compose-market/sdk";
import type { NetworkId } from "@compose-market/sdk/chains";

const env = import.meta.env ?? {};
const baseUrl = (
  typeof window !== "undefined"
    ? window.location.origin
    : (env.VITE_API_URL ?? "http://api.rawchunks.space")
).replace(/\/+$/, "");

const retry = { maxRetries: 2, initialDelayMs: 400, maxDelayMs: 6_000, jitter: true };

export const sdk: ComposeSDK = new ComposeSDK({
  baseUrl,
  userAgent: "rawchunks-web",
  retry,
});

export const API_BASE_URL = sdk.baseUrl;

export function attachWallet(address: string | null, network: NetworkId | null): void {
  if (address && network) {
    sdk.wallets.attach({ address, network });
  } else {
    sdk.wallets.clear();
  }
}


export async function watch(path: string, signal: AbortSignal, receive: (value: any) => boolean | Promise<boolean>, options?: Parameters<ComposeSDK['fetch']>[1]): Promise<void> {
  for (let attempt = 0; !signal.aborted; attempt++) {
    let response: Response | undefined;
    let disconnected: unknown;
    try { response = await sdk.fetch(path, { ...options, signal }); }
    catch (error) { disconnected = error; }
    if (signal.aborted) return;
    if (response && !response.ok) {
      const result = await response.json();
      throw new Error(result.error || 'Could not follow generation');
    }
    if (response) {
      if (!response.body) throw new Error('Generation stream is unavailable');
      const reader = response.body.getReader();
      const abort = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', abort, { once: true });
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (!signal.aborted) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try { chunk = await reader.read(); }
          catch (error) { disconnected = error; break; }
          if (chunk.done) { disconnected = new Error('Generation stream interrupted'); break; }
          buffer += decoder.decode(chunk.value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
            if (line.trim() && await receive(JSON.parse(line))) return;
          }
        }
      } finally {
        signal.removeEventListener('abort', abort);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    if (signal.aborted) return;
    if (attempt >= retry.maxRetries) throw disconnected;
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, Math.min(retry.initialDelayMs * 2 ** attempt, retry.maxDelayMs));
      signal.addEventListener('abort', done, { once: true });
    });
  }
}
