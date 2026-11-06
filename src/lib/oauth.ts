import { RAWCHUNKS_API_URL } from './api';

export type RawchunksOAuthProvider = 'google' | 'github' | 'discord' | 'x' | 'telegram';

export interface VerifiedOAuthProfile {
  platform: RawchunksOAuthProvider;
  providerId: string;
  providerUserId: string;
  handle: string;
  url: string;
  email?: string | null;
  name?: string | null;
  avatar?: string | null;
  authIdentifier?: string | null;
}

const STORAGE_KEY = 'rawchunks:oauth-profiles';
const THIRDWEB_LOGIN_REGEX =
  /^https:\/\/embedded-wallet\.thirdweb\.com\/api\/[^/]+\/login\/(google|github|discord|x|telegram)(?:\?|$)/i;

const memoryProfiles = new Map<string, VerifiedOAuthProfile>();
let bridgeInstalled = false;

function loadProfilesFromStorage(): Record<string, VerifiedOAuthProfile> {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveProfilesToStorage(map: Record<string, VerifiedOAuthProfile>): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

export function storeVerifiedOAuthProfile(profile: VerifiedOAuthProfile): void {
  if (!profile || !profile.platform) return;
  const key = profile.platform.toLowerCase();
  memoryProfiles.set(key, profile);
  const current = loadProfilesFromStorage();
  current[key] = profile;
  saveProfilesToStorage(current);
}

export function getStoredOAuthProfile(platform: string): VerifiedOAuthProfile | null {
  const key = platform.toLowerCase();
  const mem = memoryProfiles.get(key);
  if (mem) return mem;
  const current = loadProfilesFromStorage();
  return current[key] || null;
}

export function clearStoredOAuthProfile(platform: string): void {
  const key = platform.toLowerCase();
  memoryProfiles.delete(key);
  const current = loadProfilesFromStorage();
  if (key in current) {
    delete current[key];
    saveProfilesToStorage(current);
  }
}

export function rewriteThirdwebOAuthUrl(rawUrl?: string | URL): string | URL | undefined {
  if (!rawUrl) return rawUrl;
  const str = typeof rawUrl === 'string' ? rawUrl : rawUrl.toString();
  const match = str.match(THIRDWEB_LOGIN_REGEX);
  if (!match) return rawUrl;

  const provider = match[1].toLowerCase();
  try {
    const parsed = new URL(str);
    const clientId = parsed.searchParams.get('clientId') || '';
    const target = new URL(`${RAWCHUNKS_API_URL}/api/oauth/${provider}/start`);
    if (clientId) {
      target.searchParams.set('clientId', clientId);
    }
    if (typeof window !== 'undefined' && window.location?.origin) {
      target.searchParams.set('origin', window.location.origin);
    }
    return target.toString();
  } catch {
    return rawUrl;
  }
}

export function rawchunksOAuthBridge(): void {
  if (bridgeInstalled || typeof window === 'undefined') return;
  bridgeInstalled = true;

  const originalOpen = window.open.bind(window);
  window.open = function (
    url?: string | URL,
    target?: string,
    features?: string
  ): WindowProxy | null {
    const rewritten = rewriteThirdwebOAuthUrl(url);
    return originalOpen(rewritten, target, features);
  };

  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== 'object' || data.source !== 'rawchunks-oauth') {
      return;
    }

    if (data.socialProfile) {
      storeVerifiedOAuthProfile(data.socialProfile as VerifiedOAuthProfile);
    }

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://embedded-wallet.thirdweb.com',
        data: {
          eventType: data.eventType,
          authResult: data.authResult,
          errorString: data.errorString,
        },
      })
    );
  });
}
