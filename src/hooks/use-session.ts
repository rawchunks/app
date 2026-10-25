import { createContext, useContext } from "react";
import type { KeyCreateResponse } from "@compose-market/sdk";
import type { NetworkId } from "@compose-market/sdk/chains";
import type { CreditBalance } from "../lib/credits";

export interface SessionState {
  fundingSource: 'wallet' | 'prepaid';
  active: boolean;
  userAddress: string | null;
  network: NetworkId | null;
  keyId: string | null;
  token: string | null;
  budgetLimit: string;
  budgetUsed: string;
  budgetLocked: string;
  budgetRemaining: string;
  expiresAt: number | null;
}

export interface SessionContextValue {
  session: SessionState;
  isCreating: boolean;
  error: string | null;
  createSession: (budgetWei: string, durationHours: number) => Promise<KeyCreateResponse>;
  refreshSession: () => Promise<void>;
  clearSession: () => void;
  endSession: () => Promise<void>;
  credits: CreditBalance;
  creditsLoading: boolean;
  creditsError: string | null;
  creditsEnabled: boolean;
  creditOwner: string | null;
  refreshCredits: () => Promise<void>;
  createCreditSession: (budgetAtomics: string, durationHours: number) => Promise<void>;
  claimPromoSession?: (durationHours?: number) => Promise<void>;
  completeCreditPurchase: (operationId: string) => Promise<void>;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export const emptySession: SessionState = {
  fundingSource: 'wallet',
  active: false,
  userAddress: null,
  network: null,
  keyId: null,
  token: null,
  budgetLimit: "0",
  budgetUsed: "0",
  budgetLocked: "0",
  budgetRemaining: "0",
  expiresAt: null,
};

export type SessionModalOption = 'usdc' | 'card' | 'campaign';

export function promptSessionModal(option?: SessionModalOption): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("rawchunks:open-session", { detail: option ?? null }));
  }
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used within a SessionProvider");
  return value;
}

