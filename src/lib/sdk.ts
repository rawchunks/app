import { ComposeSDK } from "@compose-market/sdk";
import type { NetworkId } from "@compose-market/sdk/chains";
import { promptSessionModal } from "../hooks/use-session";

const env = (import.meta as any).env ?? {};

export const COMPOSE_API_URL = (env.VITE_COMPOSE_API_URL || "https://api.compose.market").replace(/\/+$/, "");
export const RAWCHUNKS_API_URL = (env.VITE_API_URL || "https://api.rawchunks.space").replace(/\/+$/, "");

const retry = { maxRetries: 2, initialDelayMs: 400, maxDelayMs: 6_000, jitter: true };

const EVICTABLE_PREFIXES = ["waveform:", "project:", "songs:", "rawchunks:wip:v1:"];

export function evictNonEssentialLocalStorage(storage: Storage): void {
  try {
    for (const prefix of EVICTABLE_PREFIXES) {
      const toRemove: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(prefix)) toRemove.push(k);
      }
      for (const k of toRemove) storage.removeItem(k);
      if (toRemove.length > 0) return;
    }
  } catch { /* Ignore storage enumeration errors */ }
}

export function setStorageItemWithEviction(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
    return;
  } catch {
    evictNonEssentialLocalStorage(storage);
    storage.setItem(key, value);
  }
}

const memoryFallback = new Map<string, string>();
const sdkStorage = {
  getItem(key: string): string | null {
    try {
      if (typeof localStorage !== "undefined") {
        const val = localStorage.getItem(key);
        if (val !== null) return val;
      }
    } catch { /* Fallback to memory */ }
    return memoryFallback.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    memoryFallback.set(key, value);
    try {
      if (typeof localStorage !== "undefined") {
        setStorageItemWithEviction(localStorage, key, value);
      }
    } catch { /* Memory fallback retains the token for the active session */ }
  },
  removeItem(key: string): void {
    memoryFallback.delete(key);
    try {
      if (typeof localStorage !== "undefined") localStorage.removeItem(key);
    } catch { /* Ignore */ }
  },
};

// ComposeSDK powers the Facilitator SDK (@compose-market)
export const sdk: ComposeSDK = new ComposeSDK({
  baseUrl: COMPOSE_API_URL,
  userAgent: "rawchunks-web",
  retry,
  storage: sdkStorage,
});

export const API_BASE_URL = RAWCHUNKS_API_URL;

// Match endpoints that belong to Rawchunks' backend service
const RAWCHUNKS_PATH_REGEX = /^\/?(?:api\/)?(credits|songs|albums|user|generation|editing|voices?|options|status|sample|format|repaint|layer|extend|remix|separate)(\/|$|\?)/;

interface CreditRequestContext { userAddress: string; authToken: string; sessionToken?: string | null }
let creditContext: CreditRequestContext | null = null;
export function setCreditRequestContext(value: CreditRequestContext | null): void { creditContext = value; }
export function hasCreditSession(): boolean { return Boolean(creditContext?.sessionToken); }

const originalFetch = sdk.fetch.bind(sdk);

// Transparently route Rawchunks API calls to RAWCHUNKS_API_URL while Facilitator/Compose endpoints stay on COMPOSE_API_URL
sdk.fetch = async function patchedFetch(
  input: RequestInfo | URL,
  init?: Parameters<ComposeSDK["fetch"]>[1]
): Promise<Response> {
  let target = input;
  if (typeof target === "string" && !target.startsWith("http://") && !target.startsWith("https://")) {
    const normalized = target.startsWith("/") ? target : `/${target}`;
    if (RAWCHUNKS_PATH_REGEX.test(normalized)) {
      target = `${RAWCHUNKS_API_URL}${normalized}`;
    } else {
      target = `${COMPOSE_API_URL}${normalized}`;
    }
  }
  const headers = new Headers(init?.headers);
  const url = new URL(typeof target === "string" ? target : target instanceof URL ? target.href : target.url);
  const rawchunks = url.origin === new URL(RAWCHUNKS_API_URL).origin;
  const credits = /^\/api\/credits(\/|$)/.test(url.pathname);
  const prepaid = rawchunks && Boolean(creditContext?.sessionToken);
  headers.delete("x-wallet-auth-token");
  headers.delete("x-credit-session-token");
  if (rawchunks && creditContext && (credits || prepaid)) {
    headers.set("x-wallet-auth-token", creditContext.authToken);
    headers.set("x-session-user-address", creditContext.userAddress);
    if (prepaid && !credits) headers.set("x-credit-session-token", creditContext.sessionToken!);
  }
  if (credits || prepaid) {
    for (const name of ["authorization", "payment-signature", "x-x402-max-amount-wei"]) headers.delete(name);
  }
  if (init?.userAddress && !headers.has("x-session-user-address")) {
    headers.set("x-session-user-address", init.userAddress);
  }
  const response = await originalFetch(target, { ...init, headers,
    ...(credits || prepaid ? { key: null, paymentMode: "key", paymentSignature: undefined } : {}) });
  if (response.status === 402) {
    promptSessionModal();
  }
  return response;
};

export function attachWallet(address: string | null, network: NetworkId | null): void {
  if (address && network) {
    sdk.wallets.attach({ address, network });
  } else {
    sdk.wallets.clear();
  }
}

export async function watch(
  path: string,
  signal: AbortSignal,
  receive: (value: any) => boolean | Promise<boolean>,
  options?: Parameters<ComposeSDK["fetch"]>[1]
): Promise<void> {
  for (let attempt = 0; !signal.aborted; attempt++) {
    let response: Response | undefined;
    let disconnected: unknown;
    try {
      response = await sdk.fetch(path, { ...options, signal });
    } catch (error) {
      disconnected = error;
    }
    if (signal.aborted) return;
    if (response && !response.ok) {
      const result = await response.json();
      throw new Error(result.error || "Could not follow generation");
    }
    if (response) {
      if (!response.body) throw new Error("Generation stream is unavailable");
      const reader = response.body.getReader();
      const abort = () => {
        void reader.cancel().catch(() => {});
      };
      signal.addEventListener("abort", abort, { once: true });
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (!signal.aborted) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await reader.read();
          } catch (error) {
            disconnected = error;
            break;
          }
          if (chunk.done) {
            disconnected = new Error("Generation stream interrupted");
            break;
          }
          buffer += decoder.decode(chunk.value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            if (line.trim() && (await receive(JSON.parse(line)))) return;
          }
        }
      } finally {
        signal.removeEventListener("abort", abort);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    if (signal.aborted) return;
    if (attempt >= retry.maxRetries) throw disconnected;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, Math.min(retry.initialDelayMs * 2 ** attempt, retry.maxDelayMs));
      signal.addEventListener("abort", done, { once: true });
    });
  }
}
