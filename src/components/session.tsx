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

  const effectiveCreditAddr = liveAddress ?? readAddress;
  if (effectiveCreditAddr) {
    setCreditRequestContext({
      userAddress: effectiveCreditAddr,
      authToken: credits.authToken ?? '',
      preferredSource: activeSource,
      usdcActive,
      cardAvailableAtomics: credits.balance.availableAtomics || '0',
      promoAvailableAtomics: credits.balance.promo?.availableAtomics || '0',
    });
  } else {
    setCreditRequestContext(null);
  }

  useEffect(() => {
    return () => setCreditRequestContext(null);
  }, []);

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

export function FundingPanel({ onDone, reason, funding }: FundingPanelProps) {
  const {
    session,
    activeSource,
    setActiveSource,
    isCreating,
    error,
    createSession,
    refreshSession,
    endSession,
    credits,
    creditsLoading,
    creditsError,
    creditsEnabled,
    claimPromoCredits,
  } = useSession();
  const { evmAddress, svmAddress, readAddress, userAddress } = useSelectedUserAddress();
  const { selectedNetwork, getChainByNetworkId } = useChain();
  const { data: balances, isLoading: balanceLoading } = useMultiChainBalance({ evmAddress, svmAddress });

  const initialStep: FundingStep =
    funding === 'card' ? 'card' : funding === 'usdc' ? 'usdc' : 'compartments';
  const [step, setStep] = useState<FundingStep>(initialStep);
  const [claimingPromo, setClaimingPromo] = useState(false);

  const [selectedBudgetPreset, setSelectedBudgetPreset] = useState<string>("10000000");
  const [customBudget, setCustomBudget] = useState<string>("");
  const [duration, setDuration] = useState<number>(24);
  const [isEnding, setIsEnding] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  useEffect(() => {
    if (funding === 'card') setStep('card');
    else if (funding === 'usdc') setStep('usdc');
    else if (funding === 'campaign') setStep('compartments');
  }, [funding]);

  const isUsdcSession = Boolean(session.active && BigInt(session.budgetRemaining || '0') > 0n);

  const displayAddress = userAddress ?? readAddress;
  const promo = credits.promo;
  const promoClaimed = Boolean(promo?.claimed);
  const promoRemaining = promo?.remaining ?? 0;
  const promoMaxClaims = promo?.maxClaims ?? 0;
  const promoAmountAtomics = promo?.amountAtomics ?? '0';
  const promoBadgeLabel = promo ? `${formatCredits(promoAmountAtomics)} CR ($${formatDollars(promoAmountAtomics)})` : 'CHECKING...';
  const promoEligible = Boolean(
    promo &&
    !promoClaimed &&
    promoRemaining > 0 &&
    (Boolean(promo.eligible) || !displayAddress || !creditsEnabled || promo.reason === 'identity_required')
  );
  const totalPromoAtomics = promo?.availableAtomics ?? '0';
  const hasAvailablePromo = BigInt(totalPromoAtomics) > 0n;

  const totalCardAtomics = credits.availableAtomics || '0';
  const hasAvailableCardCredits = BigInt(totalCardAtomics) > 0n;

  const isPromoSelected = hasAvailablePromo && activeSource === 'promo';
  const isCardSelected = hasAvailableCardCredits && activeSource === 'card';
  const isUsdcSelected = isUsdcSession && activeSource === 'usdc';

  const activeNetwork = session.active && session.network ? session.network : selectedNetwork;
  const chainInfo = getChainByNetworkId(activeNetwork);
  const assetSymbol = chainInfo?.asset ?? "USDC";
  const currentBalance = balances?.find((b) => b.network === selectedNetwork)?.formatted ?? "0.00";

  const effectiveBudgetWei = customBudget.trim()
    ? Math.floor(Math.max(0, parseFloat(customBudget) || 0) * 10_000).toString()
    : selectedBudgetPreset;

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
      onDone();
      void openGate({
        steps: ['login', 'terms', 'funding'],
        funding: 'usdc',
        reason: 'Connect your wallet or account to authorize an on-chain USDC Session.',
        force: true,
      });
      return;
    }
    const budgetVal = Number(effectiveBudgetWei) / 1_000_000;
    if (isNaN(budgetVal) || budgetVal <= 0) {
      toast.error("Please enter a valid budget amount");
      return;
    }
    try {
      await createSession(effectiveBudgetWei, duration);
      toast.success("USDC Session activated");
      onDone();
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "Failed to activate session";
      toast.error(msg);
    }
  };

  const handleEndSession = async () => {
    setIsEnding(true);
    try {
      await endSession();
      toast.success("USDC Session ended");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to end session");
    } finally {
      setIsEnding(false);
    }
  };

  const handleSelectSource = (source: FundingSource, label: string) => {
    setActiveSource(source);
    toast.success(`${label} selected`);
    onDone();
  };

  const handleClaimPromo = async () => {
    const promoGateReason = promo
      ? `Sign in with Google, Email, or Passkey to claim your ${formatCredits(promoAmountAtomics)} Free Welcome Credits ($${formatDollars(promoAmountAtomics)}).`
      : 'Sign in with Google, Email, or Passkey to claim your Free Welcome Credits.';
    if (!displayAddress || !creditsEnabled) {
      onDone();
      void openGate({
        steps: ['login', 'terms', 'funding'],
        funding: 'campaign',
        reason: promoGateReason,
        force: true,
      });
      return;
    }
    setClaimingPromo(true);
    try {
      await claimPromoCredits();
      toast.success(promo ? `${formatCredits(promoAmountAtomics)} Campaign Credits claimed!` : "Campaign Credits claimed!");
      onDone();
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "Failed to claim Campaign Credits";
      toast.error(msg);
      if (msg.toLowerCase().includes('verified email or social account')) {
        onDone();
        void openGate({
          steps: ['login', 'terms', 'funding'],
          funding: 'campaign',
          reason: promoGateReason,
          force: true,
        });
      }
    } finally {
      setClaimingPromo(false);
    }
  };

  return (
    <div className="funding-panel">
      <div className="session-modal-content">
        {reason && (
          <div className="session-reason-banner" role="status">
            <Zap size={13} className="session-info-icon" />
            <span>{reason}</span>
          </div>
        )}

        {/* STEP 1: 3 RECTANGULAR COMPARTMENTS */}
        {step === 'compartments' && (
          <div className="session-compartments" role="list" aria-label="Credits and session compartments">
            {/* COMPARTMENT 1: CAMPAIGN */}
            <div
              role="listitem"
              className={cn(
                'session-compartment',
                (promoEligible || hasAvailablePromo) && 'is-promo-live',
                isPromoSelected && 'is-active',
              )}
            >
              <div className="session-compartment-head">
                <div className="session-compartment-title-group">
                  <Sparkles size={14} className="session-promo-sparkle" />
                  <span className="session-compartment-title">CAMPAIGN</span>
                  <span className={cn('session-compartment-badge', (promoEligible || hasAvailablePromo) ? 'live' : 'muted')}>
                    {!promo
                      ? 'CHECKING...'
                      : promoEligible
                        ? promoBadgeLabel
                        : hasAvailablePromo
                          ? `${formatCredits(totalPromoAtomics)} CR`
                          : promoClaimed
                            ? '0 CR LEFT'
                            : promoRemaining <= 0
                              ? 'FULL'
                              : promoBadgeLabel}
                  </span>
                </div>

                <div className="session-compartment-actions">
                  {!promo ? (
                    <span className="session-compartment-status-muted">CHECKING...</span>
                  ) : promoEligible ? (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={claimingPromo || creditsLoading}
                      onClick={() => void handleClaimPromo()}
                    >
                      <Sparkles size={12} />
                      {claimingPromo
                        ? 'CLAIMING...'
                        : !displayAddress || !creditsEnabled
                          ? 'SIGN IN & CLAIM'
                          : `CLAIM ${formatCredits(promoAmountAtomics)} CR`}
                    </Button>
                  ) : isPromoSelected ? (
                    <span className="session-compartment-active-pill">
                      <span className="session-active-indicator" />
                      ACTIVE · {formatCredits(totalPromoAtomics)} CR
                    </span>
                  ) : hasAvailablePromo ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSelectSource('promo', 'Campaign Credits')}
                    >
                      USE ({formatCredits(totalPromoAtomics)} CR)
                    </Button>
                  ) : (
                    <span className="session-compartment-status-muted">
                      {promoClaimed
                        ? 'CLAIMED'
                        : `${(promoMaxClaims - promoRemaining).toLocaleString()} / ${promoMaxClaims.toLocaleString()}`}
                    </span>
                  )}
                </div>
              </div>

              <p className="session-compartment-desc">
                {!promo
                  ? 'Checking welcome campaign availability...'
                  : promoEligible
                    ? `Welcome drop (${promoRemaining.toLocaleString()} / ${promoMaxClaims.toLocaleString()} left): claim ${creditLabel(promoAmountAtomics)} for Studio creation and stem editing with zero wallet popups.`
                    : hasAvailablePromo
                      ? `You have ${creditLabel(totalPromoAtomics)} in Campaign Credits ready for Studio creation and editing.`
                      : promoClaimed
                        ? `All ${formatCredits(promoAmountAtomics)} welcome Campaign Credits have been used.`
                        : `All ${promoMaxClaims.toLocaleString()} welcome Campaign Credit slots have been claimed.`}
              </p>

              <div className="session-compartment-note">
                Promo credits can&apos;t be used for Streaming and Licenses. Use your free credits to generate and edit your songs!
              </div>
            </div>

            {/* COMPARTMENT 2: CREDIT CARD */}
            <div
              role="button"
              tabIndex={0}
              className={cn(
                'session-compartment session-compartment-interactive',
                isCardSelected && 'is-active',
              )}
              onClick={() => setStep('card')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setStep('card');
                }
              }}
            >
              <div className="session-compartment-head">
                <div className="session-compartment-title-group">
                  <CreditCard size={14} className="session-compartment-icon" />
                  <span className="session-compartment-title">CREDIT CARD</span>
                  <span className="session-tab-icons" aria-hidden="true">
                    <span className="session-payment-badge">VISA</span>
                    <img src="/icons/paypal.webp" alt="" className="session-payment-paypal" />
                  </span>
                </div>

                <div className="session-compartment-actions">
                  {isCardSelected ? (
                    <span className="session-compartment-active-pill">
                      <span className="session-active-indicator" />
                      ACTIVE · {formatCredits(totalCardAtomics)} CR
                    </span>
                  ) : hasAvailableCardCredits ? (
                    <span onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSelectSource('card', 'Card Credits')}
                      >
                        USE ({formatCredits(totalCardAtomics)} CR)
                      </Button>
                    </span>
                  ) : null}
                  <span className="session-compartment-cta">
                    {hasAvailableCardCredits ? '+ ADD →' : 'BUY CREDITS →'}
                  </span>
                </div>
              </div>

              <p className="session-compartment-desc">
                Instant prepaid credits for Studio generation, stem edits, streaming, and licenses. Zero wallet popups.
              </p>
            </div>

            {/* COMPARTMENT 3: ON-CHAIN USDC */}
            <div
              role="button"
              tabIndex={0}
              className={cn(
                'session-compartment session-compartment-interactive',
                isUsdcSelected && 'is-active',
              )}
              onClick={() => setStep('usdc')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setStep('usdc');
                }
              }}
            >
              <div className="session-compartment-head">
                <div className="session-compartment-title-group">
                  <CircleDollarSign size={14} className="session-compartment-icon" />
                  <span className="session-compartment-title">ON-CHAIN USDC</span>
                  <span className="session-tab-icons" aria-hidden="true">
                    <img src="/networks/base.png" alt="" className="session-option-net-icon" />
                    <img src="/networks/tempo.png" alt="" className="session-option-net-icon" />
                    <img src="/networks/solana.jpeg" alt="" className="session-option-net-icon" />
                  </span>
                </div>

                <div className="session-compartment-actions">
                  {isUsdcSelected ? (
                    <span className="session-compartment-active-pill">
                      <span className="session-active-indicator" />
                      ACTIVE · {formatCredits(session.budgetRemaining)} CR
                    </span>
                  ) : isUsdcSession ? (
                    <span onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSelectSource('usdc', 'On-Chain USDC Session')}
                      >
                        USE ({formatCredits(session.budgetRemaining)} CR)
                      </Button>
                    </span>
                  ) : null}
                  <span className="session-compartment-cta">
                    {session.active ? 'MANAGE →' : 'START SESSION →'}
                  </span>
                </div>
              </div>

              <p className="session-compartment-desc">
                Authorize a time-boxed x402 spending cap directly from your Base, Tempo, or Solana wallet. Funds stay in your wallet until spent.
              </p>
            </div>

            {creditsError && (
              <div className="session-error-strip" role="alert">
                <span>{creditsError}</span>
              </div>
            )}
          </div>
        )}

        {/* STEP 2A: CREDIT CARD CHECKOUT (pre-mounted so PayPal Hosted Fields iframes warm up immediately) */}
        <div
          className="session-tab-panel"
          aria-hidden={step !== 'card'}
          style={
            step !== 'card'
              ? { position: 'absolute', width: '100%', height: 0, overflow: 'hidden', opacity: 0, pointerEvents: 'none', visibility: 'hidden' }
              : undefined
          }
        >
          <CardCheckout
            compact
            intent={{ kind: 'balance' }}
            cancelLabel="← BACK"
            onComplete={onDone}
            onCancel={() => setStep('compartments')}
          />
        </div>

        {/* STEP 2B: ON-CHAIN USDC SESSION */}
        {step === 'usdc' && (
          session.active ? (
            <div className="session-tab-panel">
              <div className="session-hud-card">
                <div className="session-hud-header">
                  <div className="session-hud-badges">
                    <Badge variant="secondary">
                      <span className="session-active-indicator" /> ACTIVE USDC SESSION
                    </Badge>
                    <Badge variant="outline">
                      <NetworkGlyph network={session.network} name={chainInfo?.name} />
                      <span>{chainInfo?.name || session.network}</span>
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
                    <span>NETWORK</span>
                  </div>
                  <span className="session-grid-item-value">{chainInfo?.name || session.network}</span>
                  <span className="session-grid-item-sub">Scoped to this chain</span>
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
                  <span className="session-grid-item-sub">Compose authorization token</span>
                </div>
              </div>

              <div className="session-actions-footer">
                <Button variant="ghost" size="sm" onClick={() => setStep('compartments')}>
                  ← BACK
                </Button>
                <div className="session-actions-btns">
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
                </div>
              </div>
            </div>
          ) : (
            <div className="session-tab-panel">
              <div className="session-balance-strip">
                <div className="session-balance-chain">
                  <span>CHAIN</span>
                  <NetworkSelector />
                </div>
                <div className="session-balance-val">
                  {balanceLoading ? 'CHECKING...' : `$${currentBalance} ${assetSymbol}`}
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
                        className={cn('session-pill-btn', isSelected && 'active')}
                        onClick={() => {
                          setSelectedBudgetPreset(preset.value);
                          setCustomBudget('');
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
                    placeholder="Custom Credits amount (100 = $1.00)"
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
                      <Tooltip key={dur.hours} title={dur.desc}>
                        <button
                          type="button"
                          className={cn('session-duration-btn', isSelected && 'active')}
                          onClick={() => setDuration(dur.hours)}
                        >
                          {dur.label}
                        </button>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>

              <div className="session-notice-strip">
                <ShieldCheck className="session-notice-icon" size={14} />
                <span>Funds remain in your wallet until spent. Revoke or end the session anytime.</span>
              </div>

              {error && (
                <div className="session-error-strip" role="alert">
                  <span>{error}</span>
                </div>
              )}

              <div className="session-actions-footer">
                <Button variant="ghost" size="sm" onClick={() => setStep('compartments')} disabled={isCreating}>
                  ← BACK
                </Button>
                <div className="session-actions-btns">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={isCreating}
                    onClick={() => void handleStartSession()}
                  >
                    {isCreating ? 'STARTING...' : !displayAddress ? 'LOGIN TO CREATE A SESSION' : 'START SESSION'}
                  </Button>
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

export function Session() {
  const { session, activeSource, hasBudget, hasStreamBudget, credits } = useSession();
  const { userAddress } = useSelectedUserAddress();
  const { hasConsented } = useDisclaimerConsent();
  const gate = useGate();

  const [manualOpen, setManualOpen] = useState(false);
  const [checkout, setCheckout] = useState<{ intent: CheckoutIntent; version: number } | null>(null);

  const promo = credits.promo;
  const promoClaimed = Boolean(promo?.claimed);
  const promoRemaining = promo?.remaining ?? 0;
  const promoAmountAtomics = promo?.amountAtomics ?? '0';
  const promoEligible = Boolean(
    promo &&
    !promoClaimed &&
    promoRemaining > 0 &&
    (Boolean(promo.eligible) || !userAddress || promo.reason === 'identity_required')
  );
  const promoAvailableAtomics = promo?.availableAtomics ?? '0';
  const hasAvailablePromo = BigInt(promoAvailableAtomics) > 0n;
  const hasAvailableCardCredits = BigInt(credits.availableAtomics || '0') > 0n;
  const hasActiveUsdcSession = Boolean(session.active && BigInt(session.budgetRemaining || '0') > 0n);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ intent?: CheckoutIntent }>).detail;
      setCheckout((current) => ({
        intent: detail?.intent ?? { kind: 'balance' },
        version: (current?.version ?? 0) + 1,
      }));
    };
    window.addEventListener('rawchunks:card-checkout', handler);
    return () => window.removeEventListener('rawchunks:card-checkout', handler);
  }, []);

  const gateStep = gate.request
    ? unsatisfiedStep(gate.request, {
      loggedIn: Boolean(userAddress),
      consented: hasConsented,
      funded: gate.request.action === 'stream' ? hasStreamBudget : hasBudget,
    }) ?? (gate.request.force ? 'funding' : null)
    : null;

  const isFundingGate = gateStep === 'funding';
  const modalOpen = manualOpen || isFundingGate || Boolean(checkout);

  const handleCloseModal = () => {
    setManualOpen(false);
    setCheckout(null);
    if (isFundingGate) {
      gate.cancel();
    }
  };

  const handleDone = () => {
    setManualOpen(false);
    setCheckout(null);
    if (isFundingGate) {
      closeGate(true);
      gate.cancel();
    }
  };

  const handlePillClick = () => {
    setManualOpen(true);
  };

  const activeDisplayAtomics =
    activeSource === 'usdc' && hasActiveUsdcSession
      ? session.budgetRemaining
      : activeSource === 'card' && hasAvailableCardCredits
        ? credits.availableAtomics
        : activeSource === 'promo' && hasAvailablePromo
          ? promoAvailableAtomics
          : hasActiveUsdcSession
            ? session.budgetRemaining
            : hasAvailableCardCredits
              ? credits.availableAtomics
              : hasAvailablePromo
                ? promoAvailableAtomics
                : null;

  return (
    <>
      <Tooltip
        title={
          activeDisplayAtomics
            ? `${creditLabel(activeDisplayAtomics)} available (${activeSource.toUpperCase()})`
            : promoEligible
              ? `Claim ${formatCredits(promoAmountAtomics)} Free Welcome Credits ($${formatDollars(promoAmountAtomics)})`
              : 'Manage Studio Credits & Session'
        }
        position="bottom"
      >
        <button
          type="button"
          className={cn(
            'session-trigger-btn',
            Boolean(activeDisplayAtomics) && 'active',
            !activeDisplayAtomics && promoEligible && 'promo',
          )}
          onClick={handlePillClick}
          aria-label="Session and Credits"
        >
          {activeDisplayAtomics ? (
            <>
              <span className="session-active-indicator" />
              <span className="session-trigger-val">{formatCredits(activeDisplayAtomics)} CR</span>
            </>
          ) : promoEligible ? (
            <>
              <Sparkles size={12} className="session-trigger-icon" />
              <span className="session-trigger-val">FREE ${formatDollars(promoAmountAtomics)}</span>
            </>
          ) : (
            <>
              <Zap size={12} className="session-trigger-icon" />
              <span className="session-trigger-val">CREDITS</span>
            </>
          )}
        </button>
      </Tooltip>

      <Modal
        isOpen={modalOpen}
        onClose={handleCloseModal}
        title={checkout ? 'INSTANT CREDIT TOP-UP' : 'CREDITS & SESSION'}
        size="md"
      >
        {checkout ? (
          <CardCheckout
            intent={checkout.intent}
            version={checkout.version}
            cancelLabel="CANCEL"
            onComplete={handleDone}
            onCancel={handleCloseModal}
          />
        ) : (
          <FundingPanel
            onDone={handleDone}
            reason={isFundingGate ? gate.request?.reason ?? null : null}
            funding={isFundingGate ? gate.request?.funding ?? null : null}
          />
        )}
      </Modal>
    </>
  );
}
