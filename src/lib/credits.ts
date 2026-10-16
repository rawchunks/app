import { sdk } from './sdk';
import type { SessionState } from '../hooks/use-session';

export type CheckoutIntent = { kind: 'balance' } | { kind: 'start'; durationSeconds: number } | { kind: 'topup'; sessionId: string };
export function promptCardCheckout(intent: CheckoutIntent): void {
  window.dispatchEvent(new CustomEvent('rawchunks:card-checkout', { detail: intent }));
}
export interface CreditPack { id: string; amountAtomics: string; usd: string }
export interface CreditBalance {
  availableAtomics: string; allocatedAtomics: string; reservedAtomics: string; spentAtomics: string; suspendedAtomics: string;
  packs: CreditPack[]; paypalClientId: string; environment: 'sandbox' | 'live';
}
export interface CreditSession {
  id: string; budgetAtomics: string; remainingAtomics: string; reservedAtomics: string; spentAtomics: string;
  expiresAt: number; closed: boolean; token?: string; fundingSource: 'prepaid';
}
export const DEFAULT_CREDIT_PACKS: CreditPack[] = [
  { id: 'usd-10', amountAtomics: '10000000', usd: '10.00' },
  { id: 'usd-25', amountAtomics: '25000000', usd: '25.00' },
  { id: 'usd-100', amountAtomics: '100000000', usd: '100.00' },
];
export const DEFAULT_PAYPAL_CLIENT_ID: string =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PAYPAL_CLIENT_ID) || '';
export const zeroCredits: CreditBalance = {
  availableAtomics: '0',
  allocatedAtomics: '0',
  reservedAtomics: '0',
  spentAtomics: '0',
  suspendedAtomics: '0',
  packs: DEFAULT_CREDIT_PACKS,
  paypalClientId: DEFAULT_PAYPAL_CLIENT_ID,
  environment: 'sandbox',
};
export async function creditsApi<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const response = await sdk.fetch(`/api/credits/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : result.message || `Credits request failed (${response.status})`);
  return result;
}
export function prepaidSession(row: CreditSession, userAddress: string, network: SessionState['network'], token = row.token): SessionState {
  return { fundingSource: 'prepaid', active: !row.closed && row.expiresAt > Date.now(), userAddress, network,
    keyId: row.id, token: token ?? null, budgetLimit: row.budgetAtomics, budgetRemaining: row.remainingAtomics,
    budgetLocked: row.reservedAtomics, budgetUsed: row.spentAtomics, expiresAt: row.expiresAt };
}
function compact(value: bigint, unit: bigint, places: number): string {
  const scale = 10n ** BigInt(places);
  const rounded = (value * scale + unit / 2n) / unit;
  return `${rounded / scale}${rounded % scale ? `.${(rounded % scale).toString().padStart(places, '0').replace(/0+$/, '')}` : ''}`;
}
export function formatCredits(atomics: string): string {
  const value = BigInt(atomics || '0');
  return value >= 10000000n ? `${compact(value, 10000000n, 2)}K` : compact(value, 10000n, 2);
}
export function formatDollars(atomics: string): string { return compact(BigInt(atomics || '0'), 1000000n, 2); }
export function creditLabel(atomics: string): string { return `${formatCredits(atomics)} ($${formatDollars(atomics)})`; }
export const purchaseCacheKey = (owner: string) => `rawchunks:credit-purchase:${owner.toLowerCase()}`;
