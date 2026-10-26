import type { Song, Stem, Voice } from './schema';
import type { Take, Commit, DAWState } from './daw/store';
import type { CreditBalance } from './credits';

// Cached addresses support display and project reads. Signing requires the live account.

const LAST_ACCOUNT_KEY = "last_account";
const PAYPAL_CONFIG_KEY = "rawchunks:paypal-config";

export type FundingSource = 'usdc' | 'card' | 'promo';

export interface CachedCreditsSnapshot {
    balance: CreditBalance;
    updatedAt: number;
}

export function readCachedCredits(address?: string | null): CachedCreditsSnapshot | null {
    if (typeof window === "undefined" || !address) return null;
    try {
        const raw = localStorage.getItem(`credits:${address.toLowerCase()}`);
        if (!raw) return null;
        return JSON.parse(raw) as CachedCreditsSnapshot;
    } catch {
        return null;
    }
}

export function writeCachedCredits(address: string, balance: CreditBalance): void {
    if (typeof window === "undefined" || !address) return;
    try {
        localStorage.setItem(`credits:${address.toLowerCase()}`, JSON.stringify({
            balance,
            updatedAt: Date.now(),
        } satisfies CachedCreditsSnapshot));
        if (balance.paypalClientId) {
            writeCachedPayPalClientId(balance.paypalClientId, balance.environment);
        }
    } catch { }
}

export function readPreferredFundingSource(owner?: string | null): FundingSource | null {
    if (typeof window === "undefined" || !owner) return null;
    try {
        const val = localStorage.getItem(`rawchunks:funding-source:${owner.toLowerCase()}`);
        return val === 'usdc' || val === 'card' || val === 'promo' ? val : null;
    } catch {
        return null;
    }
}

export function writePreferredFundingSource(owner: string | null | undefined, source: FundingSource): void {
    if (typeof window === "undefined" || !owner) return;
    try {
        localStorage.setItem(`rawchunks:funding-source:${owner.toLowerCase()}`, source);
    } catch { }
}

export function readCachedPayPalClientId(): { paypalClientId: string; environment: 'sandbox' | 'live' } | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = localStorage.getItem(PAYPAL_CONFIG_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed?.paypalClientId === "string" && parsed.paypalClientId.length > 0) {
            return {
                paypalClientId: parsed.paypalClientId,
                environment: parsed.environment === "live" ? "live" : "sandbox",
            };
        }
        return null;
    } catch {
        return null;
    }
}

export function writeCachedPayPalClientId(paypalClientId: string, environment: 'sandbox' | 'live' = 'sandbox'): void {
    if (typeof window === "undefined" || !paypalClientId) return;
    try {
        localStorage.setItem(PAYPAL_CONFIG_KEY, JSON.stringify({ paypalClientId, environment }));
    } catch { }
}

export interface CachedAccount {
    /** EVM smart account address (useActiveAccount().address). */
    address: string;
    /** Underlying admin signer address (useAdminWallet().getAccount().address). */
    adminAddress?: string;
    /** Solana Swig wallet PDA, if it had resolved in a previous session. */
    svmAddress?: string;
    /** Payment network selected when the cache was written. */
    network: string;
    updatedAt: number;
    nickname?: string | null;
    avatar?: string | null;
    bio?: string | null;
}

export interface CachedProfile {
    nickname?: string | null;
    avatar?: string | null;
    bio?: string | null;
    updatedAt: number;
}

export function readCachedProfile(address?: string | null): CachedProfile | null {
    if (typeof window === "undefined" || !address) return null;
    try {
        const raw = localStorage.getItem(`profile:${address.toLowerCase()}`);
        if (!raw) return null;
        return JSON.parse(raw) as CachedProfile;
    } catch {
        return null;
    }
}

export function writeCachedProfile(address: string, profile: { nickname?: string | null; avatar?: string | null }): void {
    if (typeof window === "undefined" || !address) return;
    try {
        localStorage.setItem(`profile:${address.toLowerCase()}`, JSON.stringify({
            nickname: profile.nickname ?? null,
            avatar: profile.avatar ?? null,
            updatedAt: Date.now(),
        }));
    } catch {}
}

export function readCachedGuides(address?: string | null): string[] | null {
    if (typeof window === "undefined" || !address) return null;
    try {
        const raw = localStorage.getItem(`guides:${address.toLowerCase()}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) && parsed.every((id): id is string => typeof id === "string") ? parsed : null;
    } catch {
        return null;
    }
}

export function writeCachedGuides(address: string, guides: string[]): void {
    if (typeof window === "undefined" || !address) return;
    try {
        const unique = Array.from(new Set(guides.filter((id): id is string => typeof id === "string" && id.trim().length > 0)));
        localStorage.setItem(`guides:${address.toLowerCase()}`, JSON.stringify(unique));
    } catch {}
}

export function cachedAddress(account: CachedAccount | null, network: string, isEvm: boolean, status: string): string | null {
    if (!account || account.network !== network || (status !== 'unknown' && status !== 'connecting')) return null;
    return isEvm ? account.address : account.svmAddress ?? null;
}

export interface Project {
    song: Song;
    stems: Stem[];
    takes: Take[];
    commits: Commit[];
    session?: Pick<DAWState, 'tracks' | 'originals' | 'operations' | 'bpm'>;
}

export function readProject(songId: string, address: string): Project | null {
    try {
        const raw = localStorage.getItem(`project:${address}:${songId}`);
        if (!raw) return null;
        const project = JSON.parse(raw) as Project;
        if (!(project.song?.id === songId && Array.isArray(project.stems) && Array.isArray(project.takes) && Array.isArray(project.commits))) return null;
        if (project.session?.operations) {
            project.session.operations = project.session.operations.filter(op => op.status !== 'error');
        }
        return project;
    } catch { return null; }
}

export function writeProject(project: Project, address: string): void {
    try {
        const sanitized: Project = project.session?.operations
            ? {
                ...project,
                session: {
                    ...project.session,
                    operations: project.session.operations.filter(op => op.status !== 'error'),
                },
            }
            : project;
        localStorage.setItem(`project:${address}:${project.song.id}`, JSON.stringify(sanitized));
    }
    catch { /* Storage may be unavailable or full. */ }
}

export function readSongs(address = 'public'): Song[] | null {
    try {
        const raw = localStorage.getItem(`songs:${address}`);
        if (!raw) return null;
        const songs = JSON.parse(raw);
        return Array.isArray(songs) && songs.every(song => typeof song.id === 'string') ? songs : null;
    } catch { return null; }
}

export function writeSongs(songs: Song[], address = 'public'): void {
    try { localStorage.setItem(`songs:${address}`, JSON.stringify(songs)); }
    catch { /* Storage may be unavailable or full. */ }
}

function voiceOwner(address: string): string {
    return /^0x[0-9a-f]{40}$/i.test(address) ? address.toLowerCase() : address;
}

export function isVoice(value: unknown, _address?: string): value is Voice {
    if (!value || typeof value !== 'object') return false;
    const voice = value as Record<string, unknown>;
    if (typeof voice.id !== 'string' || !voice.id || typeof voice.name !== 'string' ||
        typeof voice.creator !== 'string' || !voice.creator ||
        typeof voice.created_at !== 'string' ||
        !['saved', 'extracting', 'queued', 'training', 'ready', 'error'].includes(String(voice.status)) ||
        (voice.sample_url != null && typeof voice.sample_url !== 'string') ||
        (voice.error != null && typeof voice.error !== 'string') ||
        !voice.availability || typeof voice.availability !== 'object') return false;
    const availability = voice.availability as Record<string, unknown>;
    return (['turbo', 'sft'] as const).every(mode => {
        const entry = availability[mode];
        if (!entry || typeof entry !== 'object') return false;
        const output = entry as Record<string, unknown>;
        if (output.model !== `acestep-v15-xl-${mode}` ||
            !['unavailable', 'queued', 'training', 'ready', 'error'].includes(String(output.status)) ||
            (output.stage != null && typeof output.stage !== 'string') ||
            (output.error != null && typeof output.error !== 'string') ||
            ['step', 'total_steps'].some(key => output[key] != null && (typeof output[key] !== 'number' || !Number.isFinite(output[key])))) return false;
        if (output.adapter == null) return true;
        if (typeof output.adapter !== 'object') return false;
        const adapter = output.adapter as Record<string, unknown>;
        return typeof adapter.id === 'string' && adapter.model === output.model &&
            ['queued', 'training', 'ready', 'error'].includes(String(adapter.status));
    });
}

export function readVoices(address: string): Voice[] | null {
    if (typeof window === 'undefined' || !address) return null;
    try {
        const raw = localStorage.getItem(`voices:${voiceOwner(address)}`);
        if (!raw) return null;
        const voices: unknown = JSON.parse(raw);
        return Array.isArray(voices) && voices.every(voice => isVoice(voice, address)) ? voices : null;
    } catch { return null; }
}

export function writeVoices(voices: Voice[], address: string): void {
    if (typeof window === 'undefined' || !address || !voices.every(voice => isVoice(voice, address))) return;
    try { localStorage.setItem(`voices:${voiceOwner(address)}`, JSON.stringify(voices)); }
    catch { /* Storage may be unavailable or full. */ }
}

export function readCachedAccount(): CachedAccount | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = localStorage.getItem(LAST_ACCOUNT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CachedAccount;
        if (typeof parsed?.address !== "string" || !parsed.address) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function writeCachedAccount(address: string, network: string, svmAddress?: string | null, nickname?: string | null, avatar?: string | null): void {
    try {
        const existing = readCachedAccount();
        const profile = readCachedProfile(address);
        const resolvedNickname = nickname !== undefined ? nickname : (profile?.nickname ?? (existing?.address.toLowerCase() === address.toLowerCase() ? existing.nickname : null));
        const resolvedAvatar = avatar !== undefined ? avatar : (profile?.avatar ?? (existing?.address.toLowerCase() === address.toLowerCase() ? existing.avatar : null));
        localStorage.setItem(
            LAST_ACCOUNT_KEY,
            JSON.stringify({
                address,
                network,
                updatedAt: Date.now(),
                ...(svmAddress ? { svmAddress } : {}),
                ...(resolvedNickname ? { nickname: resolvedNickname } : {}),
                ...(resolvedAvatar ? { avatar: resolvedAvatar } : {}),
            } satisfies CachedAccount),
        );
    } catch {
        // Quota / private-mode failures are non-fatal: next reload just reconnects blind.
    }
}

export function clearCachedAccount(): void {
    try {
        localStorage.removeItem(LAST_ACCOUNT_KEY);
    } catch {
        // Ignore — nothing else to do.
    }
}

// =============================================================================
// SVM — Swig account existence cache
// =============================================================================

/**
 * The Swig account is permanent once created on-chain (the authority lives in
 * the account data forever). A cache hit therefore means "verified to exist in
 * a previous session" — callers may skip the blocking existence-check RPC on
 * reload and revalidate in the background instead. Keyed per (admin, network)
 * so switching wallets or clusters never collides.
 */

const SWIG_CREATED_PREFIX = "swig_created";

function swigCreatedKey(adminAddress: string, network: string): string {
    return `${SWIG_CREATED_PREFIX}:${adminAddress.toLowerCase()}:${network}`;
}

export function readSwigCreated(adminAddress: string, network: string): boolean {
    if (typeof window === "undefined") return false;
    try {
        return localStorage.getItem(swigCreatedKey(adminAddress, network)) === "1";
    } catch {
        return false;
    }
}

export function writeSwigCreated(adminAddress: string, network: string): void {
    try {
        localStorage.setItem(swigCreatedKey(adminAddress, network), "1");
    } catch {
        // Quota / private-mode failures are non-fatal: next reload rechecks on-chain.
    }
}

export function clearSwigCreated(adminAddress: string, network: string): void {
    try {
        localStorage.removeItem(swigCreatedKey(adminAddress, network));
    } catch {
        // Ignore — nothing else to do.
    }
}
