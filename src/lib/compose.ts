import { ComposeSDK } from "@compose-market/sdk";

const env = (import.meta as any).env ?? {};

function trimTrailingSlashes(url: string): string {
  let out = url;
  while (out.endsWith("/")) {
    out = out.slice(0, -1);
  }
  return out;
}

export const COMPOSE_API_URL = trimTrailingSlashes(
  env.VITE_COMPOSE_API_URL || "https://api.compose.market"
);

export const compose: ComposeSDK = new ComposeSDK({
  baseUrl: COMPOSE_API_URL,
  userAgent: "rawchunks-web",
  retry: { maxRetries: 2, initialDelayMs: 400, maxDelayMs: 6_000, jitter: true },
});

const baseFetch = compose.fetch.bind(compose);

// Requests to Compose Market (e.g. /api/session, /api/keys) must never carry Rawchunks-only headers
compose.fetch = async function composeFetch(
  input: RequestInfo | URL,
  init?: Parameters<ComposeSDK["fetch"]>[1]
): Promise<Response> {
  let target = input;
  if (typeof target === "string" && !target.startsWith("http://") && !target.startsWith("https://")) {
    const normalized = target.startsWith("/") ? target : `/${target}`;
    target = `${COMPOSE_API_URL}${normalized}`;
  }
  const cleanHeaders = new Headers(init?.headers);
  cleanHeaders.delete("x-wallet-auth-token");
  cleanHeaders.delete("x-credit-source");
  return baseFetch(target, { ...init, headers: cleanHeaders });
};
