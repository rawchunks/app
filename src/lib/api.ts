import { ComposeSDK } from "@compose-market/sdk";
import { COMPOSE_API_URL, compose } from "./compose";
import { openGate } from "./gate";
import { store } from "./store";

const env = (import.meta as any).env ?? {};

function trimTrailingSlashes(url: string): string {
  let out = url;
  while (out.endsWith("/")) {
    out = out.slice(0, -1);
  }
  return out;
}

export const RAWCHUNKS_API_URL = trimTrailingSlashes(
  env.VITE_API_URL || "https://api.rawchunks.space"
);

export const API_BASE_URL = RAWCHUNKS_API_URL;

const retry = { maxRetries: 2, initialDelayMs: 400, maxDelayMs: 6_000, jitter: true };

const EVICTABLE_PREFIXES = ["songs:", "project:", "rawchunks:wip:", "waveform:"];

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
const apiStorage = {
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

(compose as any).storage = apiStorage;

const rawchunksTransport = new ComposeSDK({
  baseUrl: RAWCHUNKS_API_URL,
  userAgent: "rawchunks-web",
  retry,
  storage: apiStorage,
});

rawchunksTransport.events.on("budget", (event) => compose.events.emit("budget", event));
rawchunksTransport.events.on("receipt", (event) => compose.events.emit("receipt", event));
rawchunksTransport.events.on("sessionInvalid", (event) => compose.events.emit("sessionInvalid", event));

function normalizePathSegments(pathname: string): string[] {
  const parts = pathname.split("/").filter(Boolean);
  return parts[0] === "api" ? parts.slice(1) : parts;
}

function isCreditsPath(pathname: string): boolean {
  const segs = normalizePathSegments(pathname);
  return segs[0] === "credits";
}

function isStreamCheckpointPath(pathname: string): boolean {
  const segs = normalizePathSegments(pathname);
  if (segs.length === 4 && segs[0] === "songs" && segs[2] === "stream" && segs[3] === "checkpoint") {
    return true;
  }
  if (segs.length === 3 && segs[0] === "stream" && segs[2] === "checkpoint") {
    return true;
  }
  return false;
}

function isStreamAuthPath(pathname: string): boolean {
  const segs = normalizePathSegments(pathname);
  if (segs.length === 3 && segs[0] === "songs" && segs[2] === "stream") {
    return true;
  }
  if (segs.length === 2 && segs[0] === "stream") {
    return true;
  }
  return false;
}

export type FundingSource = 'usdc' | 'card' | 'promo';

export interface CreditRequestContext {
  userAddress: string;
  authToken?: string | null;
  preferredSource?: FundingSource;
  usdcActive?: boolean;
  cardAvailableAtomics?: string;
  promoAvailableAtomics?: string;
  /** Optional explicit override for unit tests */
  creditSource?: 'promo' | 'card' | null;
}

let creditContext: CreditRequestContext | null = null;
export function setCreditRequestContext(value: CreditRequestContext | null): void {
  creditContext = value;
}

function parseAtomics(value?: string | null): bigint {
  if (!value) return 0n;
  const trimmed = value.trim();
  if (!trimmed) return 0n;
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code < 48 || code > 57) return 0n;
  }
  try {
    return BigInt(trimmed);
  } catch {
    return 0n;
  }
}

export function hasStreamBudget(): boolean {
  const hasCard = Boolean(creditContext?.userAddress && parseAtomics(creditContext.cardAvailableAtomics) > 0n);
  const hasUsdc = Boolean(compose.keys.currentToken());
  const hasExplicit = creditContext?.creditSource === 'card';
  return hasCard || hasUsdc || hasExplicit;
}

export function hasStudioBudget(): boolean {
  const hasPromo = Boolean(creditContext?.userAddress && parseAtomics(creditContext.promoAvailableAtomics) > 0n);
  const hasExplicitPromo = creditContext?.creditSource === 'promo';
  return hasPromo || hasExplicitPromo || hasStreamBudget();
}

export function hasPromoCreditsOnly(): boolean {
  const hasPromo = Boolean(creditContext?.userAddress && parseAtomics(creditContext.promoAvailableAtomics) > 0n);
  return hasPromo && !hasStreamBudget();
}

function buildCandidateSources(pathname: string, body?: BodyInit | null): FundingSource[] {
  // Stream checkpoints must route to the same billing engine that created the paymentIntentId
  if (isStreamCheckpointPath(pathname)) {
    if (typeof body === "string") {
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed?.paymentIntentId === "string" && parsed.paymentIntentId.startsWith("crd:")) {
          return ['card'];
        }
      } catch { /* Ignore JSON parse error */ }
    }
    return ['usdc'];
  }

  // Explicit test override
  if (creditContext?.creditSource === 'promo' || creditContext?.creditSource === 'card') {
    if (isStreamAuthPath(pathname) && creditContext.creditSource === 'promo') {
      // Never send promo on stream requests even if overridden
    } else {
      return [creditContext.creditSource];
    }
  }

  const hasUser = Boolean(creditContext?.userAddress);
  const promoAvail = hasUser ? parseAtomics(creditContext?.promoAvailableAtomics) > 0n : false;
  const cardAvail = hasUser ? parseAtomics(creditContext?.cardAvailableAtomics) > 0n : false;
  const usdcAvail = Boolean(compose.keys.currentToken());
  const pref = creditContext?.preferredSource;

  const isStream = isStreamAuthPath(pathname);
  const eligibleOrder: FundingSource[] = isStream ? ['card', 'usdc'] : ['promo', 'card', 'usdc'];
  const fundedMap: Record<FundingSource, boolean> = {
    promo: !isStream && promoAvail,
    card: cardAvail,
    usdc: usdcAvail,
  };

  const candidates: FundingSource[] = [];
  if (pref && eligibleOrder.includes(pref) && fundedMap[pref]) {
    candidates.push(pref);
  }
  for (const source of eligibleOrder) {
    if (fundedMap[source] && !candidates.includes(source)) {
      candidates.push(source);
    }
  }
  if (candidates.length === 0) {
    candidates.push('usdc');
  }
  return candidates;
}

export interface StreamBilling {
  source: 'card' | 'usdc';
  token: string | null;
  account: string;
  network: string;
  walletToken: string | null;
}

export function captureStreamBilling(account: string): StreamBilling[] {
  const wallet = compose.wallets.current();
  return buildCandidateSources('/api/songs/playback/stream').map(source => ({
    source: source === 'card' ? 'card' : 'usdc',
    token: compose.keys.currentToken(),
    account: account || creditContext?.userAddress || wallet.address || '',
    network: wallet.network || '',
    walletToken: creditContext?.authToken || null,
  }));
}

export function streamOptions(billing: StreamBilling): Parameters<ComposeSDK['fetch']>[1] {
  const walletToken = billing.walletToken || creditContext?.authToken || null;
  return {
    key: billing.source === 'card' ? null : billing.token,
    paymentMode: 'key',
    userAddress: billing.account,
    network: billing.network as any,
    headers: {
      'x-session-user-address': billing.account,
      'x-network-id': billing.network,
      ...(walletToken ? { 'x-wallet-auth-token': walletToken } : {}),
      ...(billing.source === 'card' ? { 'x-credit-source': 'card' } : {}),
    },
  };
}

async function rawchunksFetch(
  input: RequestInfo | URL,
  init?: Parameters<ComposeSDK["fetch"]>[1]
): Promise<Response> {
  let target = input;
  if (typeof target === "string" && !target.startsWith("http://") && !target.startsWith("https://")) {
    const normalized = target.startsWith("/") ? target : `/${target}`;
    target = `${RAWCHUNKS_API_URL}${normalized}`;
  }

  const url = new URL(typeof target === "string" ? target : target instanceof URL ? target.href : target.url);
  const isRawchunksOrigin = url.origin === new URL(RAWCHUNKS_API_URL).origin;

  if (!isRawchunksOrigin) {
    return compose.fetch(target, init);
  }

  const currentWallet = compose.wallets.current();
  const currentToken = compose.keys.currentToken();

  if (init && 'key' in init && (isStreamAuthPath(url.pathname) || isStreamCheckpointPath(url.pathname))) {
    const playback = new ComposeSDK({
      baseUrl: COMPOSE_API_URL,
      userAgent: 'rawchunks-web',
      key: init.key ?? undefined,
      userAddress: init.userAddress,
      network: init.network,
      storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    const disposers = [
      playback.events.on('budget', event => compose.events.emit('budget', event)),
      playback.events.on('receipt', event => compose.events.emit('receipt', event)),
      playback.events.on('sessionInvalid', event => compose.events.emit('sessionInvalid', event)),
    ];
    try {
      return await playback.fetch(target, init);
    } finally {
      disposers.forEach(dispose => dispose());
    }
  }

  const effectiveUserAddress = init?.userAddress || creditContext?.userAddress || store.getState().userAddress || currentWallet.address || "";
  const effectiveNetwork = init?.network ?? (currentWallet.network as any) ?? undefined;

  if (isCreditsPath(url.pathname)) {
    const headers = new Headers(init?.headers);
    headers.delete("x-credit-source");
    for (const name of ["authorization", "payment-signature", "x-x402-max-amount-wei"]) {
      headers.delete(name);
    }
    if (creditContext?.authToken && !headers.has("x-wallet-auth-token")) {
      headers.set("x-wallet-auth-token", creditContext.authToken);
    }
    if (creditContext?.userAddress && !headers.has("x-session-user-address")) {
      headers.set("x-session-user-address", creditContext.userAddress);
    }
    if (effectiveUserAddress && !headers.has("x-session-user-address")) {
      headers.set("x-session-user-address", effectiveUserAddress);
    }
    return rawchunksTransport.fetch(target, {
      ...init,
      headers,
      userAddress: effectiveUserAddress || undefined,
      network: effectiveNetwork,
      key: null,
      paymentMode: "key",
      paymentSignature: undefined,
    });
  }

  const candidates = buildCandidateSources(url.pathname, init?.body);
  let lastResponse: Response | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const source = candidates[i];
    const usePrepaidCredits = (source === 'promo' || source === 'card') && Boolean(effectiveUserAddress);
    const headers = new Headers(init?.headers);
    headers.delete("x-wallet-auth-token");
    headers.delete("x-credit-source");

    if (creditContext?.authToken) {
      headers.set("x-wallet-auth-token", creditContext.authToken);
    }
    if (creditContext?.userAddress) {
      headers.set("x-session-user-address", creditContext.userAddress);
    }
    if (effectiveUserAddress && !headers.has("x-session-user-address")) {
      headers.set("x-session-user-address", effectiveUserAddress);
    }

    if (usePrepaidCredits) {
      headers.set("x-credit-source", source);
      for (const name of ["authorization", "payment-signature", "x-x402-max-amount-wei"]) {
        headers.delete(name);
      }
    }

    const activeKey = init && 'key' in init ? init.key : currentToken;

    const response = await rawchunksTransport.fetch(target, {
      ...init,
      headers,
      userAddress: effectiveUserAddress || undefined,
      network: effectiveNetwork,
      ...(usePrepaidCredits
        ? { key: null, paymentMode: "key", paymentSignature: undefined }
        : { key: activeKey }),
    });

    lastResponse = response;
    if (response.status !== 402 || i === candidates.length - 1) {
      break;
    }
  }

  if (lastResponse && lastResponse.status === 402) {
    const isStream = isStreamAuthPath(url.pathname) || isStreamCheckpointPath(url.pathname);
    void openGate({
      steps: ['login', 'funding'],
      action: isStream ? 'stream' : 'studio',
      reason: isStream && hasPromoCreditsOnly()
        ? 'Promo credits cannot be used for streaming. Add Card Credits or start an On-Chain USDC Session.'
        : 'Session or credit budget exhausted',
      force: true,
    });
  }

  return lastResponse!;
}

export const api = {
  baseUrl: RAWCHUNKS_API_URL,
  fetch: rawchunksFetch,
};

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
      response = await api.fetch(path, { ...options, signal });
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
        void reader.cancel().catch(() => { });
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
        await reader.cancel().catch(() => { });
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
