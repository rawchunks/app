import type { NetworkId } from "@compose-market/sdk/chains";

export interface MintShareData {
  type: "rawchunks";
  name: string;
  walletAddress: string;
  network: NetworkId;
}

const STORAGE_KEY = "mint_share";

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const WEB_APP_URL = (env.VITE_WEB_APP_URL ?? "").replace(/\/$/, "");

export function saveMintSuccessForShare(data: MintShareData): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("Failed to save mint share data:", e);
  }
}

export function getMintSuccessForShare(): MintShareData | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as MintShareData;
    }
  } catch (e) {
    console.warn("Failed to retrieve mint share data:", e);
  }
  return null;
}

export function clearMintSuccessShare(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn("Failed to clear mint share data:", e);
  }
}

export function buildShareIntentUrl(_name: string, songId: string): string {
  const text = `You can now stream my song on Rawchunks! Listen now!`;
  const url = `${WEB_APP_URL}/songs/${songId}`;
  const params = new URLSearchParams({
    text,
    url,
  });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}
