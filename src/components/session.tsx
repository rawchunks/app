import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Clock,
  Zap,
  ShieldCheck,
  Key,
  RefreshCw,
  LogOut,
  Copy,
  Check,
  CreditCard,
  CircleDollarSign,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { PayPalScriptProvider } from '@paypal/react-paypal-js';
import { useActiveAccount, useAdminWallet } from "thirdweb/react";
import { getContract, sendTransaction, waitForReceipt } from "thirdweb";
import { allowance, approve, balanceOf } from "thirdweb/extensions/erc20";
import type {
  ActiveSessionMetadata,
  FacilitatorSupportedResponse,
  KeyCreateResponse,
} from "@compose-market/sdk";
import type { NetworkId } from "@compose-market/sdk/chains";
import { useChain, NetworkGlyph } from "@/contexts/Network";
import { useSelectedUserAddress } from "@/hooks/use-address";
import { useMultiChainBalance } from "@/hooks/use-multichain";
import {
  SessionContext,
  emptySession,
  useSession,
  type FundingSource,
  type SessionModalOption,
  type SessionState,
  type SessionContextValue,
} from "@/hooks/use-session";
import {
  isEvmNetwork,
  isSolanaNetwork,
  thirdwebClient,
  evmChainId,
  getChainObject,
} from "@/lib/chains";
import { sdk, setCreditRequestContext } from "@/lib/sdk";
import { readPreferredFundingSource, writePreferredFundingSource } from "@/lib/cache";
import { approveTempoSession, CardCheckout } from "@/components/connector";
import { useCreditAccount } from "@/hooks/use-credits";
import { creditLabel, formatCredits, formatDollars, type CheckoutIntent } from "@/lib/credits";
import { Button } from "@/components/button";
import { Badge } from "@/components/badge";
import { Modal } from "@/components/modal";
import { NetworkSelector } from "@/components/network";
import { closeGate, openGate, unsatisfiedStep, useGate } from "@/lib/gate";
import { useDisclaimerConsent } from "@/hooks/use-disclaimer";
import { Tooltip } from "@/components/daw/Tooltip";
import { cn } from "@/lib/utils";

export { useSession, emptySession, type SessionState, type SessionContextValue };

export interface SessionScope { address: string; network: NetworkId }
export function scopeKey(scope: SessionScope): string {
  const address = scope.network.startsWith("eip155:") ? scope.address.toLowerCase() : scope.address;
  return `${scope.network}:${address}`;
}
export function sameScope(value: { userAddress?: string | null; network?: string | null }, scope: SessionScope): boolean {
  return Boolean(value.userAddress && value.network === scope.network
    && scopeKey({ address: value.userAddress, network: scope.network }) === scopeKey(scope));
}
export function scopedAddress(network: NetworkId, evm: string | null, svm: string | null): string | null {
  return network.startsWith("eip155:") ? evm : svm;
}
const LEGACY_SESSION_KEY = "rawchunks:session";
export function sessionCacheKey(scope: SessionScope): string { return `rawchunks:session:v2:${scopeKey(scope)}`; }
export function readSession(storage: Storage, scope: SessionScope): SessionState | null {
  try {
    for (const key of [sessionCacheKey(scope), LEGACY_SESSION_KEY]) {
      const raw = storage.getItem(key);
      if (!raw) continue;
      const value = JSON.parse(raw) as SessionState;
      if (sameScope(value, scope) && value.active && value.token && value.expiresAt && value.expiresAt > Date.now()) {
        if (key === LEGACY_SESSION_KEY) {
          storage.setItem(sessionCacheKey(scope), raw);
          storage.removeItem(LEGACY_SESSION_KEY);
        }
        return { ...value, fundingSource: 'wallet' };
      }
    }
  } catch { /* Invalid or unavailable cache is ignored. */ }
  return null;
}
export function writeSession(storage: Storage, scope: SessionScope, value: SessionState): void {
  try {
    if (sameScope(value, scope) && value.active && value.token) {
      const k = sessionCacheKey(scope);
      const raw = JSON.stringify(value);
      try {
        storage.setItem(k, raw);
      } catch {
        for (const prefix of ["waveform:", "project:", "songs:", "rawchunks:wip:"]) {
          const keys: string[] = [];
          for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key && key.startsWith(prefix)) keys.push(key);
          }
          for (const key of keys) storage.removeItem(key);
        }
        storage.setItem(k, raw);
      }
    } else {
      storage.removeItem(sessionCacheKey(scope));
    }
  } catch { /* Persistence is optional. */ }
}
export function sessionFromKey(scope: SessionScope, key: KeyCreateResponse): SessionState {
  if (key.network !== scope.network) throw new Error("The session response belongs to another network");
  return {
    fundingSource: 'wallet', active: true, userAddress: scope.address, network: scope.network, keyId: key.keyId, token: key.token,
    budgetLimit: key.budgetLimit, budgetUsed: key.budgetUsed, budgetLocked: "0", budgetRemaining: key.budgetRemaining, expiresAt: key.expiresAt
  };
}
export function requireSessionSupport(support: FacilitatorSupportedResponse, network: NetworkId) {
  const kind = support.kinds.find(k => k.x402Version === 2 && k.network === network && k.scheme === "upto");
  if (!kind) throw new Error(`Session approval is unavailable for ${network}`);
  return kind;
}

export interface SessionProviderProps {
  children: ReactNode;
  userAddress?: string | null;
}

export function SessionProvider({ children, userAddress: propUserAddress }: SessionProviderProps) {
  const account = useActiveAccount();
  const adminWallet = useAdminWallet();
  const currentAdminWallet = useRef(adminWallet);
  currentAdminWallet.current = adminWallet;
  const { chains, selectedNetwork } = useChain();
  const { userAddress, readAddress, isReconnecting, evmSignerAddress, activate } = useSelectedUserAddress();
  const liveAddress = propUserAddress ?? userAddress;
  const address = liveAddress && (isEvmNetwork(selectedNetwork)
    ? /^0x[0-9a-f]{40}$/i.test(liveAddress) && Boolean(account)
    : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(liveAddress) && Boolean(evmSignerAddress)) ? liveAddress : null;
  const scope: SessionScope | null = address ? { address, network: selectedNetwork } : null;
  const displayAddress = address ?? (isReconnecting ? readAddress : null);
  const displayScope: SessionScope | null = displayAddress ? { address: displayAddress, network: selectedNetwork } : null;
  const key = scope ? scopeKey(scope) : null;
  const config = chains.find(chain => chain.network === selectedNetwork);
  const identityKey = `${key}:${account?.address}:${evmSignerAddress}:${config?.rpcUrl}:${config?.assetAddress}`;
  const current = useRef({ identityKey, generation: 0 });
  if (current.current.identityKey !== identityKey) current.current = { identityKey, generation: current.current.generation + 1 };
  const generation = current.current.generation;
  const mounted = useRef(true);
  const [storedSession, setSession] = useState<SessionState>(() => {
    if (typeof window === 'undefined' || !displayScope) return emptySession;
    try { return readSession(localStorage, displayScope) ?? emptySession; } catch { return emptySession; }
  });
  const credits = useCreditAccount();
  const session = displayScope && sameScope(storedSession, displayScope)
    ? storedSession
    : (displayScope && typeof window !== 'undefined' ? (readSession(localStorage, displayScope) ?? emptySession) : emptySession);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const [preferredSource, setPreferredSourceState] = useState<FundingSource | null>(() => readPreferredFundingSource(credits.owner));
  useEffect(() => {
    setPreferredSourceState(readPreferredFundingSource(credits.owner));
  }, [credits.owner]);

  const setActiveSource = useCallback((source: FundingSource) => {
    setPreferredSourceState(source);
    writePreferredFundingSource(credits.owner, source);
  }, [credits.owner]);

  const usdcActive = Boolean(session.active && BigInt(session.budgetRemaining || '0') > 0n);
  const cardAvailable = BigInt(credits.balance.availableAtomics || '0') > 0n;
  const promoAvailable = BigInt(credits.balance.promo?.availableAtomics || '0') > 0n;
  const hasStreamBudget = usdcActive || cardAvailable;
  const hasBudget = hasStreamBudget || promoAvailable;

  const activeSource: FundingSource = useMemo(() => {
    if (preferredSource === 'usdc' && usdcActive) return 'usdc';
    if (preferredSource === 'card' && cardAvailable) return 'card';
    if (preferredSource === 'promo' && promoAvailable) return 'promo';
    if (usdcActive) return 'usdc';
    if (cardAvailable) return 'card';
    if (promoAvailable) return 'promo';
    return preferredSource ?? 'usdc';
  }, [preferredSource, usdcActive, cardAvailable, promoAvailable]);

  useEffect(() => {
    const effectiveAddr = liveAddress ?? readAddress;
    if (effectiveAddr) {
      setCreditRequestContext({
        userAddress: effectiveAddr,
        authToken: credits.authToken ?? '',
        preferredSource: activeSource,
        usdcActive,
        cardAvailableAtomics: credits.balance.availableAtomics || '0',
        promoAvailableAtomics: credits.balance.promo?.availableAtomics || '0',
      });
    } else {
      setCreditRequestContext(null);
    }
    return () => setCreditRequestContext(null);
  }, [
    liveAddress,
    readAddress,
    credits.authToken,
    activeSource,
    usdcActive,
    credits.balance.availableAtomics,
    credits.balance.promo?.availableAtomics,
  ]);

  const [creation, setCreation] = useState<{ key: string | null; generation: number; pending: boolean; error: string | null }>({ key: null, generation: 0, pending: false, error: null });
  const creating = useRef<number | null>(null);
  const refreshController = useRef<AbortController | null>(null);
  const attachedRef = useRef<string | null>(null);

  const assertCurrent = useCallback(() => {
    if (!mounted.current || current.current.generation !== generation || current.current.identityKey !== identityKey
      || (evmSignerAddress && currentAdminWallet.current?.getAccount()?.address !== evmSignerAddress)) {
      throw new Error("The signer or selected network changed; retry the operation");
    }
  }, [generation, identityKey, evmSignerAddress]);

  const attach = useCallback((target: SessionScope, token?: string | null) => {
    const targetKey = scopeKey(target);
    if (attachedRef.current !== targetKey || scopeKey({ address: sdk.wallets.current().address ?? "", network: target.network }) !== targetKey
      || sdk.wallets.current().network !== target.network) {
      sdk.wallets.attach(target);
      attachedRef.current = targetKey;
    }
    if (token) sdk.keys.use(token);
  }, []);

  const refreshSession = useCallback(async () => {
    if (!scope || creating.current === generation) return;
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    try {
      // Explicit context prevents an old session token from accompanying a new scope.
      const response = await sdk.fetch("/api/session", {
        method: "GET", userAddress: scope.address, network: scope.network,
        key: null, paymentMode: "key", signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Session refresh failed (${response.status})`);
      const status = await response.json() as ActiveSessionMetadata;
      if (controller.signal.aborted) return;
      assertCurrent();
      if (status.network && status.network !== scope.network) throw new Error("The session response belongs to another network");
      let cached: SessionState | null = null;
      try { cached = readSession(localStorage, scope); } catch { /* Optional cache. */ }
      const prevWalletSession = sameScope(sessionRef.current, scope) ? sessionRef.current : null;
      const token = status.token ?? prevWalletSession?.token ?? cached?.token ?? sdk.keys.currentToken();
      attach(scope, token);
      if (!status.hasSession) {
        sdk.keys.clearToken();
        setSession(emptySession);
        try { writeSession(localStorage, scope, emptySession); } catch { /* Optional cache. */ }
        return;
      }
      setSession({
        fundingSource: 'wallet',
        active: status.status?.isActive ?? true, userAddress: scope.address, network: scope.network,
        keyId: status.keyId ?? prevWalletSession?.keyId ?? cached?.keyId ?? null, token,
        budgetLimit: status.budgetLimit ?? prevWalletSession?.budgetLimit ?? cached?.budgetLimit ?? "0",
        budgetUsed: status.budgetUsed ?? prevWalletSession?.budgetUsed ?? cached?.budgetUsed ?? "0",
        budgetLocked: status.budgetLocked ?? prevWalletSession?.budgetLocked ?? cached?.budgetLocked ?? "0",
        budgetRemaining: status.budgetRemaining ?? prevWalletSession?.budgetRemaining ?? cached?.budgetRemaining ?? "0",
        expiresAt: status.expiresAt ?? prevWalletSession?.expiresAt ?? cached?.expiresAt ?? null,
      });
    } catch (cause) {
      if (!controller.signal.aborted && current.current.generation === generation) console.warn("[session] refresh failed", cause);
    }
  }, [key, generation, assertCurrent, attach]);

  useEffect(() => {
    refreshController.current?.abort();
    if (!scope) {
      if (isReconnecting && displayScope) return;
      sdk.wallets.clear();
      attachedRef.current = null;
      setSession(emptySession);
      return;
    }
    let cached: SessionState | null = null;
    try { cached = readSession(localStorage, scope); } catch { /* Storage may be unavailable. */ }
    attach(scope, cached?.token);
    setSession(cached ?? emptySession);
    void refreshSession();
    return () => { refreshController.current?.abort(); };
  }, [key, isReconnecting, generation, attach, refreshSession]);

  useEffect(() => {
    if (!scope || !sameScope(storedSession, scope)) return;
    try { writeSession(localStorage, scope, storedSession); } catch { /* Storage may be unavailable. */ }
  }, [storedSession, key]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; refreshController.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!scope) return;
    const matches = (value: { userAddress?: string | null; network?: string | null }) =>
      current.current.generation === generation && sameScope(value, scope);
    const disposers = [
      sdk.events.on("budget", event => {
        if (!matches(event)) return;
        setSession(previous => sameScope(previous, scope) ? {
          ...previous,
          budgetLimit: event.snapshot.limitWei ?? previous.budgetLimit,
          budgetUsed: event.snapshot.usedWei ?? previous.budgetUsed,
          budgetLocked: event.snapshot.lockedWei ?? previous.budgetLocked,
          budgetRemaining: event.snapshot.remainingWei ?? previous.budgetRemaining,
        } : previous);
      }),
      sdk.events.on("sessionActive", event => {
        if (!matches(event)) return;
        setSession(previous => sameScope(previous, scope) ? {
          ...previous, active: true,
          budgetLimit: event.budgetLimit ?? previous.budgetLimit, budgetUsed: event.budgetUsed ?? previous.budgetUsed,
          budgetLocked: event.budgetLocked ?? previous.budgetLocked, budgetRemaining: event.budgetRemaining ?? previous.budgetRemaining,
          expiresAt: event.expiresAt ?? previous.expiresAt,
        } : previous);
      }),
      sdk.events.on("sessionExpired", event => {
        if (!matches(event)) return;
        sdk.keys.clearToken();
        setSession(previous => sameScope(previous, scope) ? { ...previous, active: false, token: null, budgetRemaining: "0" } : previous);
      }),
      sdk.events.on("sessionInvalid", event => { if (matches(event)) void refreshSession(); }),
    ];
    return () => disposers.forEach(dispose => dispose());
  }, [key, generation, refreshSession]);

  useEffect(() => {
    if (!scope || !session.active) return;
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const event of sdk.session.subscribe({ userAddress: scope.address, network: scope.network, signal: controller.signal })) void event;
      } catch (cause) {
        if (!controller.signal.aborted) console.warn("[session] events stream ended", cause);
      }
    })();
    return () => controller.abort();
  }, [key, generation, session.active]);

  const createSession = useCallback(async (budgetWei: string, durationHours: number): Promise<KeyCreateResponse> => {
    if (!scope || !config) throw new Error("Connect your account first");
    if (creating.current !== null) throw new Error("Session creation is already in progress");
    if (!/^\d+$/.test(budgetWei) || BigInt(budgetWei) <= 0n || !Number.isFinite(durationHours) || durationHours <= 0) {
      throw new Error("Enter a positive session budget and duration");
    }
    const network = scope.network;
    const amount = BigInt(budgetWei);
    creating.current = generation;
    setCreation({ key, generation, pending: true, error: null });
    try {
      assertCurrent();
      refreshController.current?.abort();
      attach(scope);
      const support = await sdk.x402.facilitator.supported();
      assertCurrent();
      const kind = requireSessionSupport(support, network);
      if (isEvmNetwork(network)) {
        if (!account || account.address.toLowerCase() !== scope.address.toLowerCase()) throw new Error("The EVM payment account is not ready");
        const chain = getChainObject(evmChainId(network));
        const spender = kind.extra?.facilitatorAddress;
        if (!chain || typeof spender !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(spender)) throw new Error(`Session approval is unavailable for ${network}`);
        const contract = getContract({ client: thirdwebClient, chain, address: config.assetAddress as `0x${string}` });
        const [funds, approved] = await Promise.all([
          balanceOf({ contract, address: account.address }),
          allowance({ contract, owner: account.address, spender: spender as `0x${string}` }),
        ]);
        assertCurrent();
        if (funds < amount) throw new Error(`Insufficient ${config.asset} balance. Available: ${(Number(funds) / 1_000_000).toFixed(2)} ${config.asset}`);
        if (network === "eip155:42431") {
          const admin = adminWallet?.getAccount();
          if (!adminWallet || !admin || admin.address !== evmSignerAddress) throw new Error("The admin signer is not ready");
          await approveTempoSession({
            chain, admin, adminWallet, accountAddress: scope.address,
            asset: config.assetAddress, spender, amount, assertCurrent
          });
          assertCurrent();
        } else if (approved < amount) {
          const result = await sendTransaction({ account, transaction: approve({ contract, spender: spender as `0x${string}`, amountWei: amount }) });
          assertCurrent();
          const receipt = await waitForReceipt({ client: thirdwebClient, chain, transactionHash: result.transactionHash });
          assertCurrent();
          if (receipt.status !== "success") throw new Error("Session spending approval failed");
        }
      } else if (isSolanaNetwork(network)) {
        const signer = adminWallet?.getAccount();
        if (!signer || signer.address !== evmSignerAddress) throw new Error("EVM signer account not available");
        const spender = kind.extra?.feePayer;
        if (typeof spender !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(spender)) throw new Error(`Session approval is unavailable for ${network}`);
        await activate();
        assertCurrent();
        const { createSolanaRpcFromNetwork, readSvmTokenBalance, buildSwigApproveTransaction } = await import("@/lib/svm/swig");
        const { deriveSwigConfigAddress } = await import("@/lib/svm/account");
        assertCurrent();
        const rpc = createSolanaRpcFromNetwork(network, config.rpcUrl);
        const balance = await readSvmTokenBalance({ owner: scope.address as any, mint: config.assetAddress, rpc });
        assertCurrent();
        if (balance < amount) throw new Error(`Insufficient ${config.asset} balance. Available: ${(Number(balance) / 1_000_000).toFixed(2)} ${config.asset}`);
        const swigConfigAddress = await deriveSwigConfigAddress(signer.address);
        assertCurrent();
        const unsignedTransaction = await buildSwigApproveTransaction({
          swigConfigAddress, expectedWalletAddress: scope.address, evmSignerAddress: signer.address,
          usdcMint: config.assetAddress, amount, feePayer: spender as any, network, rpcUrl: config.rpcUrl,
          signMessage: async bytes => {
            assertCurrent();
            const signed = await signer.signMessage({ message: { raw: bytes } });
            assertCurrent();
            return signed;
          },
        });
        assertCurrent();
        const approved = await sdk.svm.relay({ unsignedTransaction, network });
        assertCurrent();
        if (!approved.confirmed) throw new Error("Session approval is awaiting confirmation");
      } else throw new Error(`Unsupported network: ${network}`);

      assertCurrent();
      attach(scope);
      const response = await sdk.fetch("/api/keys", {
        method: "POST", key: null, userAddress: scope.address, network,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          budgetLimit: budgetWei, expiresAt: Date.now() + durationHours * 60 * 60 * 1_000,
          network, purpose: "session", name: `Session ${new Date().toISOString().slice(0, 10)}`
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.error === "string" ? body.error : body?.error?.message ?? body?.message ?? `Session creation failed (${response.status})`);
      }
      const created = await response.json() as KeyCreateResponse;
      const next = sessionFromKey(scope, created);
      try { writeSession(localStorage, scope, next); } catch { /* Store only the operation's own scope. */ }
      assertCurrent();
      refreshController.current?.abort();
      attach(scope, created.token);
      setSession(next);
      setActiveSource('usdc');
      return created;
    } catch (cause) {
      if (mounted.current && current.current.generation === generation) setCreation({ key, generation, pending: false, error: cause instanceof Error ? cause.message : "Failed to create session" });
      throw cause;
    } finally {
      creating.current = null;
      if (mounted.current && current.current.generation === generation) setCreation(previous => ({ ...previous, pending: false }));
    }
  }, [key, generation, config, account, adminWallet, evmSignerAddress, activate, assertCurrent, attach, setActiveSource]);

  const clearSession = useCallback(() => {
    if (!scope) return;
    assertCurrent();
    attach(scope);
    sdk.keys.clearToken();
    try { writeSession(localStorage, scope, emptySession); } catch { /* Optional cache. */ }
    setSession(emptySession);
  }, [key, assertCurrent, attach]);

  const endSession = useCallback(async () => {
    assertCurrent();
    if (!scope) return;
    attach(scope, session.token);
    if (session.keyId) await sdk.keys.revoke(session.keyId);
    assertCurrent();
    clearSession();
  }, [key, session.keyId, session.token, assertCurrent, attach, clearSession]);

  const handleClaimPromoCredits = useCallback(async () => {
    await credits.claimPromo();
    setActiveSource('promo');
  }, [credits.claimPromo, setActiveSource]);

  const handleCompleteCreditPurchase = useCallback(async (operationId: string) => {
    await credits.completePurchase(operationId);
    setActiveSource('card');
  }, [credits.completePurchase, setActiveSource]);

  const paypalClientId = import.meta.env.VITE_PAYPAL_CLIENT_ID || credits.balance.paypalClientId || "";
  const paypalOptions = useMemo(
    () => ({
      clientId: paypalClientId || "test",
      components: "card-fields",
      currency: "USD",
      intent: "capture",
    }),
    [paypalClientId],
  );

  return <SessionContext.Provider value={{
    session, activeSource, setActiveSource, hasBudget, hasStreamBudget,
    isCreating: creation.key === key && creation.generation === generation && creation.pending,
    error: creation.key === key && creation.generation === generation ? creation.error : null,
    createSession, refreshSession, clearSession, endSession,
    credits: credits.balance, creditsLoading: credits.loading, creditsError: credits.error, creditsEnabled: credits.enabled, creditOwner: credits.owner,
    refreshCredits: credits.refresh, claimPromoCredits: handleClaimPromoCredits, completeCreditPurchase: handleCompleteCreditPurchase,
  }}>
    <PayPalScriptProvider key={paypalClientId || "pending"} options={paypalOptions} deferLoading={!paypalClientId}>{children}</PayPalScriptProvider>
  </SessionContext.Provider>;
}

const formatExpiry = (expiresAt: number | null) =>
  expiresAt ? new Date(expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

const formatTimeRemaining = (expiresAt: number | null): string => {
  if (!expiresAt) return "—";
  const diffMs = expiresAt - Date.now();
  if (diffMs <= 0) return "Expired";
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h remaining`;
  }
  if (hours > 0) return `${hours}h ${mins}m remaining`;
  return `${mins}m remaining`;
};

const BUDGET_PRESETS = [
  { label: "100 ($1)", value: "1000000" },
  { label: "500 ($5)", value: "5000000" },
  { label: "1K ($10)", value: "10000000" },
  { label: "2.5K ($25)", value: "25000000" },
  { label: "5K ($50)", value: "50000000" },
] as const;

const DURATION_PRESETS = [
  { label: "1 HOUR", hours: 1, desc: "Quick session" },
  { label: "6 HOURS", hours: 6, desc: "Extended production" },
  { label: "24 HOURS", hours: 24, desc: "Full day pass" },
  { label: "7 DAYS", hours: 168, desc: "Weekly pass" },
] as const;

export interface FundingPanelProps {
  onDone: () => void;
  reason?: string | null;
  funding?: SessionModalOption | null;
}

type FundingStep = 'compartments' | 'card' | 'usdc';

export function SessionControl() {
  const { session, isCreating, error, createSession, refreshSession, endSession, credits, creditsLoading, creditsError, creditsEnabled, createCreditSession, claimPromoSession } = useSession();
  const { evmAddress, svmAddress, readAddress, userAddress } = useSelectedUserAddress();
  const { selectedNetwork, getChainByNetworkId } = useChain();
  const { data: balances, isLoading: balanceLoading } = useMultiChainBalance({ evmAddress, svmAddress });

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'select' | 'usdc' | 'card'>('select');
  const [campaignExpanded, setCampaignExpanded] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const [usingCredits, setUsingCredits] = useState(false);
  const [claimingPromo, setClaimingPromo] = useState(false);

  const promoClaimed = Boolean(credits.promo?.claimed);
  const promoRemaining = credits.promo?.remaining ?? 1000;
  const promoEligible = creditsEnabled && !promoClaimed && promoRemaining > 0;

  const closeModal = () => {
    setOpen(false);
    setTopupOpen(false);
    setStep('select');
    setCampaignExpanded(false);
  };

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ option?: 'usdc' | 'card' | 'campaign' } | undefined>).detail;
      if (detail?.option === 'usdc' || detail?.option === 'card') {
        setStep(detail.option);
        setCampaignExpanded(false);
      } else if (detail?.option === 'campaign') {
        setStep('select');
        setCampaignExpanded(true);
      } else {
        setStep('select');
        setCampaignExpanded(false);
      }
      setOpen(true);
    };
    window.addEventListener("rawchunks:open-session", handleOpen);
    return () => window.removeEventListener("rawchunks:open-session", handleOpen);
  }, []);

  const [selectedBudgetPreset, setSelectedBudgetPreset] = useState<string>("10000000");
  const [customBudget, setCustomBudget] = useState<string>("");
  const [duration, setDuration] = useState<number>(24);
  const [isEnding, setIsEnding] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  const displayAddress = userAddress ?? readAddress;
  const activeNetwork = session.active && session.network ? session.network : selectedNetwork;
  const chainInfo = getChainByNetworkId(activeNetwork);
  const assetSymbol = chainInfo?.asset ?? "stablecoin";
  const currentBalance = balances?.find((b) => b.network === selectedNetwork)?.formatted ?? "0.00";

  const effectiveBudgetWei = customBudget.trim()
    ? Math.floor(Math.max(0, parseFloat(customBudget) || 0) * 10_000).toString()
    : selectedBudgetPreset;
  const prepaid = session.fundingSource === 'prepaid';
  const hasAvailableCredits = BigInt(credits.availableAtomics || '0') > 0n;

  const remainingNum = Number(session.budgetRemaining || 0);
  const limitNum = Number(session.budgetLimit || 1);
  const percentRemaining = limitNum > 0
    ? Math.max(0, Math.min(100, Math.round((remainingNum / limitNum) * 100)))
    : 0;

  const handleCopyKey = async () => {
    if (!session.keyId) return;
    try {
      await navigator.clipboard.writeText(session.keyId);
      setCopiedKey(true);
      toast.success("Session Key ID copied");
      setTimeout(() => setCopiedKey(false), 2000);
    } catch {
      toast.error("Failed to copy key");
    }
  };

  const handleStartSession = async () => {
    if (!displayAddress) {
      toast.error("Connect wallet first");
      return;
    }
    const budgetVal = Number(effectiveBudgetWei) / 1_000_000;
    if (isNaN(budgetVal) || budgetVal <= 0) {
      toast.error("Please enter a valid budget amount");
      return;
    }
    try {
      await createSession(effectiveBudgetWei, duration);
      toast.success("Session activated successfully");
      closeModal();
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "Failed to activate session";
      toast.error(msg);
    }
  };

  const handleEndSession = async () => {
    setIsEnding(true);
    try {
      await endSession();
      toast.success("Session ended");
      closeModal();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to end session");
    } finally {
      setIsEnding(false);
    }
  };

  const handleUseCredits = async () => {
    setUsingCredits(true);
    try {
      await createCreditSession(credits.availableAtomics, duration);
      toast.success("Credit session activated");
      closeModal();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not start session');
    } finally {
      setUsingCredits(false);
    }
  };

  const handleClaimPromo = async () => {
    if (!claimPromoSession) return;
    setClaimingPromo(true);
    try {
      await claimPromoSession();
      toast.success("100 Campaign Credits claimed & session activated!");
      closeModal();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to claim Campaign Credits");
    } finally {
      setClaimingPromo(false);
    }
  };

  return (
    <>
      <Tooltip
        title={
          session.active
            ? `SESSION ACTIVE // ${creditLabel(session.budgetRemaining)}`
            : promoEligible
              ? "CLAIM 100 FREE CREDITS!"
              : "SESSION CONTROLS"
        }
        description={
          session.active
            ? `${percentRemaining}% budget remaining · Click to manage`
            : promoEligible
              ? `Limited welcome campaign (${promoRemaining.toLocaleString()} / 1,000 left) · Click to claim`
              : "Enable one-click micropayments & Credits"
        }
        position="bottom"
      >
        <button
          type="button"
          data-guide="session"
          aria-label={
            session.active
              ? `Session active: ${creditLabel(session.budgetRemaining)}`
              : "Open session controls"
          }
          className={cn(
            "header-session-trigger",
            session.active && "active",
            isCreating && "is-creating",
            !session.active && promoEligible && "session-trigger-promo-flicker",
          )}
          onClick={() => setOpen(true)}
        >
          <Zap className="session-trigger-icon" size={13} />
          {session.active ? (
            <>
              <span className="session-trigger-amount">{formatCredits(session.budgetRemaining)}</span>
              <span className="session-active-indicator" />
            </>
          ) : (
            <span className="session-trigger-label">SESSION</span>
          )}
        </button>
      </Tooltip>

      <Modal
        isOpen={open}
        onClose={closeModal}
        title="SESSION CONTROLS"
        size="md"
        className="session-modal"
      >
        {!displayAddress ? (
          <div className="session-modal-content">
            <div className="session-info-strip">
              <Wallet className="session-info-icon" size={20} />
              <div className="session-info-text">
                <span className="session-info-title">WALLET NOT CONNECTED</span>
                <span className="session-info-desc">
                  Connect your wallet in the header to activate one-click session keys, purchase Credits, or claim 100 free Campaign Credits.
                </span>
              </div>
            </div>
            <div className="session-actions-footer">
              <Button variant="ghost" size="sm" onClick={closeModal}>
                CLOSE
              </Button>
            </div>
          </div>
        ) : session.active ? (
          topupOpen && session.keyId ? (
            <CardCheckout
              intent={{ kind: 'topup', sessionId: session.keyId }}
              cancelLabel="BACK"
              onComplete={closeModal}
              onCancel={() => setTopupOpen(false)}
            />
          ) : (
            <div className="session-modal-content">
              {/* Active Session Card */}
              <div className="session-hud-card">
                <div className="session-hud-header">
                  <div className="session-hud-badges">
                    <Badge variant="secondary">
                      <span className="session-active-indicator" /> ACTIVE SESSION
                    </Badge>
                    <Badge variant="outline">
                      {!prepaid && <NetworkGlyph network={session.network} name={chainInfo?.name} />}
                      <span>{prepaid ? 'CREDITS' : chainInfo?.name || session.network}</span>
                    </Badge>
                  </div>
                  <Tooltip title="Refresh Budget" position="bottom">
                    <button
                      type="button"
                      className="session-hud-refresh-btn"
                      onClick={() => void refreshSession()}
                      aria-label="Refresh live budget"
                    >
                      <RefreshCw size={12} />
                    </button>
                  </Tooltip>
                </div>

                <div className="session-hud-budget-block">
                  <span className="session-hud-label">AVAILABLE SESSION BUDGET</span>
                  <div className="session-hud-main-stat">
                    <span className="session-hud-number">{formatCredits(session.budgetRemaining)}</span>
                    <span className="session-hud-unit">CREDITS</span>
                  </div>
                  <span className="session-hud-cap">
                    Limit: {creditLabel(session.budgetLimit)} · Used: {formatCredits(session.budgetUsed)} · Reserved: {formatCredits(session.budgetLocked)}
                  </span>
                </div>

                {/* Meter Bar */}
                <div className="session-meter-container">
                  <div
                    className="session-meter-track"
                    role="progressbar"
                    aria-valuenow={percentRemaining}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="session-meter-fill"
                      style={{ "--meter-pct": `${percentRemaining}%` } as React.CSSProperties}
                    />
                  </div>
                  <div className="session-meter-footer">
                    <span>REMAINING: {percentRemaining}%</span>
                    <span>SPENT: {formatCredits(session.budgetUsed)}</span>
                  </div>
                </div>
              </div>

              {/* Session Metadata Grid */}
              <div className="session-grid">
                <div className="session-grid-item">
                  <div className="session-grid-item-head">
                    <Clock className="session-grid-item-icon" size={12} />
                    <span>EXPIRATION</span>
                  </div>
                  <span className="session-grid-item-value">{formatExpiry(session.expiresAt)}</span>
                  <span className="session-grid-item-sub">{formatTimeRemaining(session.expiresAt)}</span>
                </div>

                <div className="session-grid-item">
                  <div className="session-grid-item-head">
                    <Zap className="session-grid-item-icon" size={12} />
                    <span>ONE-CLICK FLOW</span>
                  </div>
                  <span className="session-grid-item-value session-grid-item-value-primary">
                    ENABLED
                  </span>
                  <span className="session-grid-item-sub">Zero wallet signature prompts</span>
                </div>

                <div className="session-grid-item">
                  <div className="session-grid-item-head">
                    <ShieldCheck className="session-grid-item-icon" size={12} />
                    <span>{prepaid ? 'AVAILABLE CREDITS' : 'NETWORK'}</span>
                  </div>
                  <span className="session-grid-item-value">{prepaid ? creditLabel(credits.availableAtomics) : chainInfo?.name || session.network}</span>
                  <span className="session-grid-item-sub">{prepaid ? '1 Credit = $0.01' : 'Scoped to this chain'}</span>
                </div>

                <div className="session-grid-item">
                  <div className="session-grid-item-head">
                    <Key className="session-grid-item-icon" size={12} />
                    <span>SESSION KEY ID</span>
                  </div>
                  <div className="session-key-row">
                    <span className="session-grid-item-value">
                      {session.keyId ? `${session.keyId.slice(0, 6)}...${session.keyId.slice(-4)}` : "—"}
                    </span>
                    {session.keyId && (
                      <Tooltip title="Copy Key ID" position="top">
                        <button
                          type="button"
                          className="session-icon-action-btn"
                          onClick={handleCopyKey}
                          aria-label="Copy Key ID"
                        >
                          {copiedKey ? <Check size={12} className="session-grid-item-value-primary" /> : <Copy size={12} />}
                        </button>
                      </Tooltip>
                    )}
                  </div>
                  <span className="session-grid-item-sub">{prepaid ? 'Credit session' : 'Compose authorization token'}</span>
                </div>
              </div>

              {/* Active Actions Footer */}
              <div className="session-actions-footer">
                {prepaid && (
                  <Button variant="outline" size="sm" onClick={() => setTopupOpen(true)}>
                    TOP UP
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="btn-danger"
                  disabled={isEnding}
                  onClick={() => void handleEndSession()}
                >
                  <LogOut size={13} />
                  {isEnding ? "ENDING..." : "END SESSION"}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={closeModal}
                >
                  DONE
                </Button>
              </div>
            </div>
          )
        ) : step === 'card' ? (
          <CardCheckout
            intent={{ kind: 'start', durationSeconds: duration * 3600 }}
            cancelLabel="BACK"
            onComplete={closeModal}
            onCancel={() => setStep('select')}
          />
        ) : step === 'usdc' ? (
          <div className="session-modal-content">
            <div className="session-info-strip">
              <CircleDollarSign className="session-info-icon" size={18} />
              <div className="session-info-text">
                <span className="session-info-title">ON-CHAIN USDC SESSION</span>
                <span className="session-info-desc">
                  Authorize a temporary spending cap so you can generate songs, separate stems, and stream tracks without signing every transaction.
                </span>
              </div>
            </div>

            <div className="session-balance-strip">
              <div className="session-balance-chain">
                <NetworkGlyph network={selectedNetwork} name={chainInfo?.name} />
                <span>{chainInfo?.name || selectedNetwork}</span>
              </div>
              <div className="session-balance-val">
                {balanceLoading ? "CHECKING..." : `AVAILABLE: $${currentBalance} ${assetSymbol}`}
              </div>
            </div>

            <div className="session-section">
              <div className="session-section-head">
                <span className="session-section-label">BUDGET CAP</span>
                <span className="session-section-val">
                  {creditLabel(effectiveBudgetWei)}
                </span>
              </div>
              <div className="session-pills-row">
                {BUDGET_PRESETS.map((preset) => {
                  const isSelected = !customBudget.trim() && selectedBudgetPreset === preset.value;
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      className={cn("session-pill-btn", isSelected && "active")}
                      onClick={() => {
                        setSelectedBudgetPreset(preset.value);
                        setCustomBudget("");
                      }}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <div className="session-custom-row">
                <span className="session-custom-prefix">#</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="cyber-input-field"
                  placeholder="Custom Credits amount"
                  value={customBudget}
                  onChange={(e) => setCustomBudget(e.target.value)}
                />
              </div>
            </div>

            <div className="session-section">
              <span className="session-section-label">SESSION DURATION</span>
              <div className="session-duration-pills">
                {DURATION_PRESETS.map((dur) => {
                  const isSelected = duration === dur.hours;
                  return (
                    <button
                      key={dur.hours}
                      type="button"
                      className={cn("session-duration-btn", isSelected && "active")}
                      onClick={() => setDuration(dur.hours)}
                      title={dur.desc}
                    >
                      {dur.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="session-notice-strip">
              <ShieldCheck className="session-notice-icon" size={14} />
              <span>Your funds remain in your wallet. You can revoke or end the session at any time.</span>
            </div>

            {error && (
              <div className="session-error-strip" role="alert">
                <span>{error}</span>
              </div>
            )}

            <div className="session-actions-footer">
              <Button variant="ghost" size="sm" onClick={() => setStep('select')} disabled={isCreating}>
                BACK
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={isCreating}
                onClick={() => void handleStartSession()}
              >
                {isCreating ? "STARTING SESSION..." : "START SESSION"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="session-modal-content">
            {/* Explainer strip */}
            <div className="session-info-strip">
              <Zap className="session-info-icon" size={18} />
              <div className="session-info-text">
                <span className="session-info-title">ONE-STOP SESSION & CREDITS</span>
                <span className="session-info-desc">
                  Choose a funding method below to activate one-click AI generation, stem editing, and streaming without wallet popups.
                </span>
              </div>
            </div>

            {/* Available Credits Strip (with 1-click resume if user already has unspent Credits) */}
            {creditsEnabled && (
              <div className="session-balance-strip">
                <span className="session-balance-chain">AVAILABLE CREDITS</span>
                <div className="session-balance-actions">
                  <span className="session-balance-val">
                    {creditsLoading ? 'CHECKING...' : creditLabel(credits.availableAtomics)}
                  </span>
                  {hasAvailableCredits && (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={usingCredits || creditsLoading}
                      onClick={() => void handleUseCredits()}
                    >
                      {usingCredits ? 'STARTING...' : 'USE CREDITS'}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* 3 Unified Options: (i) USDC -> step 2, (ii) CREDIT CARD -> step 2, (iii) CAMPAIGN -> inline extension */}
            <div className="session-options-list">
              {/* Option (i): USDC */}
              <div className="session-option-card">
                <button
                  type="button"
                  className="session-option-header"
                  onClick={() => setStep('usdc')}
                >
                  <div className="session-option-main">
                    <div className="session-option-title-row">
                      <CircleDollarSign size={14} className="session-option-lead-icon" />
                      <span className="session-option-title">USDC</span>
                      <div className="session-option-icons" aria-label="Supported networks: Base, Tempo, Solana">
                        <img src="/networks/base.png" alt="Base" className="session-option-net-icon" />
                        <img src="/networks/tempo.png" alt="Tempo" className="session-option-net-icon" />
                        <img src="/networks/solana.jpeg" alt="Solana" className="session-option-net-icon" />
                      </div>
                    </div>
                    <span className="session-option-desc">
                      Authorize an on-chain stablecoin spending cap on Base, Tempo, or Solana.
                    </span>
                  </div>
                  <ChevronRight className="session-option-chevron" size={15} />
                </button>
              </div>

              {/* Option (ii): CREDIT CARD */}
              <div className="session-option-card">
                <button
                  type="button"
                  className="session-option-header"
                  onClick={() => setStep('card')}
                >
                  <div className="session-option-main">
                    <div className="session-option-title-row">
                      <CreditCard size={14} className="session-option-lead-icon" />
                      <span className="session-option-title">CREDIT CARD</span>
                      <div className="session-option-icons" aria-label="Supported payment methods: Visa, Mastercard, PayPal">
                        <span className="session-payment-badge">VISA</span>
                        <span className="session-payment-badge session-payment-badge-mc" title="Mastercard">
                          <span className="mc-dot mc-dot-red" />
                          <span className="mc-dot mc-dot-amber" />
                        </span>
                        <span className="session-payment-badge">
                          <img src="/icons/paypal.webp" alt="PayPal" className="session-payment-paypal" />
                        </span>
                      </div>
                    </div>
                    <span className="session-option-desc">
                      Instant prepaid Credits checkout via Visa, Mastercard, or PayPal. No crypto needed.
                    </span>
                  </div>
                  <ChevronRight className="session-option-chevron" size={15} />
                </button>
              </div>

              {/* Option (iii): CAMPAIGN */}
              <div
                className={cn(
                  "session-option-card",
                  campaignExpanded && "expanded",
                  promoEligible && "session-option-card-promo-flicker",
                  !promoEligible && "session-option-card-disabled",
                )}
              >
                <button
                  type="button"
                  className="session-option-header"
                  disabled={!promoEligible}
                  onClick={() => promoEligible && setCampaignExpanded((prev) => !prev)}
                  aria-expanded={campaignExpanded}
                >
                  <div className="session-option-main">
                    <div className="session-option-title-row">
                      <Sparkles size={14} className="session-option-lead-icon session-promo-sparkle" />
                      <span className="session-option-title">CAMPAIGN</span>
                      <span className={cn("session-promo-pill", promoEligible ? "live" : "done")}>
                        {promoClaimed
                          ? "CLAIMED"
                          : promoRemaining <= 0
                            ? "1,000 / 1,000 CLAIMED"
                            : `100 FREE CREDITS · ${promoRemaining.toLocaleString()} LEFT`}
                      </span>
                    </div>
                    <span className="session-option-desc">
                      {promoClaimed
                        ? "You have already claimed your 100 welcome Campaign Credits."
                        : promoRemaining <= 0
                          ? "All 1,000 welcome packs have been claimed."
                          : "First 1,000 new users get 100 free Credits ($1.00) for AI song generation & stem editing."}
                    </span>
                  </div>
                  {promoEligible && (
                    <ChevronDown className={cn("session-option-chevron", campaignExpanded && "rotated")} size={15} />
                  )}
                </button>

                {campaignExpanded && promoEligible && (
                  <div className="session-option-body">
                    <div className="session-notice-strip">
                      <ShieldCheck className="session-notice-icon" size={14} />
                      <span>
                        Campaign Credits apply to bilateral studio actions (AI song generation & stem editing). Requires a verified social, email, or passkey login.
                      </span>
                    </div>

                    {creditsError && (
                      <div className="session-error-strip" role="alert">
                        <span>{creditsError}</span>
                      </div>
                    )}

                    <div className="session-campaign-cta-row">
                      <Button
                        variant="primary"
                        size="sm"
                        className="session-promo-claim-btn"
                        disabled={claimingPromo || creditsLoading}
                        onClick={() => void handleClaimPromo()}
                      >
                        <Sparkles size={13} />
                        {claimingPromo ? "CLAIMING..." : "CLAIM 100 CREDITS!"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Notice */}
            <div className="session-notice-strip">
              <ShieldCheck className="session-notice-icon" size={14} />
              <span>1 Credit = $0.01. Unspent prepaid Credits return to your balance when the session ends.</span>
            </div>

            {/* First Screen Footer: CANCEL only */}
            <div className="session-actions-footer">
              <Button variant="ghost" size="sm" onClick={closeModal}>
                CANCEL
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

