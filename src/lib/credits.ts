import { sdk } from './sdk';

export type CheckoutIntent = { kind: 'balance' };
export function promptCardCheckout(intent: CheckoutIntent = { kind: 'balance' }): void {
  window.dispatchEvent(new CustomEvent('rawchunks:card-checkout', { detail: { intent } }));
}
export interface CreditPack { id: string; amountAtomics: string; usd: string }
export interface CreditPromoStatus {
  eligible: boolean;
  claimed: boolean;
  remaining: number;
  maxClaims: number;
  amountAtomics: string;
  availableAtomics?: string;
  allocatedAtomics?: string;
  reservedAtomics?: string;
  spentAtomics?: string;
  reason?: 'claimed' | 'identity_required' | 'exhausted';
}
export interface CreditBalance {
  availableAtomics: string;
  allocatedAtomics: string;
  reservedAtomics: string;
  spentAtomics: string;
  suspendedAtomics: string;
  packs: CreditPack[];
  paypalClientId: string;
  environment: 'sandbox' | 'live';
  promo?: CreditPromoStatus;
}
export const DEFAULT_PAYPAL_CLIENT_ID: string =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PAYPAL_CLIENT_ID) || '';
export const zeroCredits: CreditBalance = {
  availableAtomics: '0',
  allocatedAtomics: '0',
  reservedAtomics: '0',
  spentAtomics: '0',
  suspendedAtomics: '0',
  packs: [],
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
