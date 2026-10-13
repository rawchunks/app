import {
  useCallback,
  useEffect,
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
  Wallet,
  Copy,
  Check,
} from "lucide-react";
import { toast } from "sonner";
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
import { sdk } from "@/lib/sdk";
import { approveTempoSession } from "@/components/connector";
import { Modal } from "@/components/modal";
import { Button } from "@/components/button";
import { Badge } from "@/components/badge";
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
        return value;
      }
    }
  } catch { /* Invalid or unavailable cache is ignored. */ }
  return null;
}
export function writeSession(storage: Storage, scope: SessionScope, value: SessionState): void {
  try {
    if (sameScope(value, scope) && value.active && value.token) storage.setItem(sessionCacheKey(scope), JSON.stringify(value));
    else storage.removeItem(sessionCacheKey(scope));
  } catch { /* Persistence is optional. */ }
}
export function sessionFromKey(scope: SessionScope, key: KeyCreateResponse): SessionState {
  if (key.network !== scope.network) throw new Error("The session response belongs to another network");
  return { active: true, userAddress: scope.address, network: scope.network, keyId: key.keyId, token: key.token,
    budgetLimit: key.budgetLimit, budgetUsed: key.budgetUsed, budgetLocked: "0", budgetRemaining: key.budgetRemaining, expiresAt: key.expiresAt };
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
  const { userAddress, evmSignerAddress, activate } = useSelectedUserAddress();
  const liveAddress = propUserAddress ?? userAddress;
  const address = liveAddress && (isEvmNetwork(selectedNetwork)
    ? /^0x[0-9a-f]{40}$/i.test(liveAddress) && Boolean(account)
    : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(liveAddress) && Boolean(evmSignerAddress)) ? liveAddress : null;
  const scope: SessionScope | null = address ? { address, network: selectedNetwork } : null;
  const key = scope ? scopeKey(scope) : null;
  const config = chains.find(chain => chain.network === selectedNetwork);
  const identityKey = `${key}:${account?.address}:${evmSignerAddress}:${config?.rpcUrl}:${config?.assetAddress}`;
  const current = useRef({ identityKey, generation: 0 });
  if (current.current.identityKey !== identityKey) current.current = { identityKey, generation: current.current.generation + 1 };
  const generation = current.current.generation;
  const mounted = useRef(true);
  const [storedSession, setSession] = useState<SessionState>(emptySession);
  const session = scope && sameScope(storedSession, scope) ? storedSession : emptySession;
  const sessionRef = useRef(session);
  sessionRef.current = session;
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
      attach(scope);
      if (!status.hasSession) {
        sdk.keys.clearToken();
        setSession(emptySession);
        try { writeSession(localStorage, scope, emptySession); } catch { /* Optional cache. */ }
        return;
      }
      const token = status.token ?? sessionRef.current.token ?? sdk.keys.currentToken();
      if (token) sdk.keys.use(token);
      setSession({
        active: status.status?.isActive ?? true, userAddress: scope.address, network: scope.network,
        keyId: status.keyId ?? sessionRef.current.keyId, token,
        budgetLimit: status.budgetLimit ?? sessionRef.current.budgetLimit, budgetUsed: status.budgetUsed ?? sessionRef.current.budgetUsed,
        budgetLocked: status.budgetLocked ?? sessionRef.current.budgetLocked, budgetRemaining: status.budgetRemaining ?? sessionRef.current.budgetRemaining,
        expiresAt: status.expiresAt ?? sessionRef.current.expiresAt,
      });
    } catch (cause) {
      if (!controller.signal.aborted && current.current.generation === generation) console.warn("[session] refresh failed", cause);
    }
  }, [key, generation, assertCurrent, attach]);

  useEffect(() => {
    refreshController.current?.abort();
    if (!scope) {
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
  }, [key, generation, attach, refreshSession]);

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
        setSession(previous => sameScope(previous, scope) ? { ...previous,
          budgetLimit: event.snapshot.limitWei ?? previous.budgetLimit,
          budgetUsed: event.snapshot.usedWei ?? previous.budgetUsed,
          budgetLocked: event.snapshot.lockedWei ?? previous.budgetLocked,
          budgetRemaining: event.snapshot.remainingWei ?? previous.budgetRemaining,
        } : previous);
      }),
      sdk.events.on("sessionActive", event => {
        if (!matches(event)) return;
        setSession(previous => sameScope(previous, scope) ? { ...previous, active: true,
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
          await approveTempoSession({ chain, admin, adminWallet, accountAddress: scope.address,
            asset: config.assetAddress, spender, amount, assertCurrent });
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
        body: JSON.stringify({ budgetLimit: budgetWei, expiresAt: Date.now() + durationHours * 60 * 60 * 1_000,
          network, purpose: "session", name: `Session ${new Date().toISOString().slice(0, 10)}` }),
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
      return created;
    } catch (cause) {
      if (mounted.current && current.current.generation === generation) setCreation({ key, generation, pending: false, error: cause instanceof Error ? cause.message : "Failed to create session" });
      throw cause;
    } finally {
      creating.current = null;
      if (mounted.current && current.current.generation === generation) setCreation(previous => ({ ...previous, pending: false }));
    }
  }, [key, generation, config, account, adminWallet, evmSignerAddress, activate, assertCurrent, attach]);

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

  return <SessionContext.Provider value={{ session, isCreating: creation.key === key && creation.generation === generation && creation.pending,
    error: creation.key === key && creation.generation === generation ? creation.error : null, createSession, refreshSession, clearSession, endSession }}>{children}</SessionContext.Provider>;
}

const formatUsdc = (amount: string) => (Number(amount) / 1_000_000).toFixed(2);
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
  { label: "$1", value: "1000000" },
  { label: "$5", value: "5000000" },
  { label: "$10", value: "10000000" },
  { label: "$25", value: "25000000" },
  { label: "$50", value: "50000000" },
] as const;

const DURATION_PRESETS = [
  { label: "1 HOUR", hours: 1, desc: "Quick session" },
  { label: "6 HOURS", hours: 6, desc: "Extended production" },
  { label: "24 HOURS", hours: 24, desc: "Full day pass" },
  { label: "7 DAYS", hours: 168, desc: "Weekly pass" },
] as const;

export { promptSessionModal } from "../hooks/use-session";

export function SessionControl() {
  const { session, isCreating, error, createSession, refreshSession, endSession } = useSession();
  const { evmAddress, svmAddress, readAddress, userAddress } = useSelectedUserAddress();
  const { selectedNetwork, getChainByNetworkId } = useChain();
  const { data: balances, isLoading: balanceLoading } = useMultiChainBalance({ evmAddress, svmAddress });

  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
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
    ? Math.floor(Math.max(0.1, parseFloat(customBudget) || 0) * 1_000_000).toString()
    : selectedBudgetPreset;
  const effectiveBudgetUsd = (Number(effectiveBudgetWei) / 1_000_000).toFixed(2);

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
      setOpen(false);
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
      setOpen(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to end session");
    } finally {
      setIsEnding(false);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label={
          session.active
            ? `Session active: $${formatUsdc(session.budgetRemaining)} ${assetSymbol}`
            : "Open session controls"
        }
        className={cn(
          "header-session-trigger",
          session.active && "active",
          isCreating && "is-creating",
        )}
        onClick={() => setOpen(true)}
      >
        <Zap className="session-trigger-icon" size={13} />
        {session.active ? (
          <>
            <span className="session-trigger-amount">${formatUsdc(session.budgetRemaining)}</span>
            <span className="session-active-indicator" />
          </>
        ) : (
          <span className="session-trigger-label">SESSION</span>
        )}
      </button>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="SESSION CONTROLS" maxWidth="480px">
        {!displayAddress ? (
          <div className="session-modal-content">
            <div className="session-info-strip">
              <Wallet className="session-info-icon" size={20} />
              <div className="session-info-text">
                <span className="session-info-title">WALLET NOT CONNECTED</span>
                <span className="session-info-desc">
                  Connect your wallet in the header to activate one-click session keys and instant studio workflows.
                </span>
              </div>
            </div>
            <div className="session-actions-footer">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                CLOSE
              </Button>
            </div>
          </div>
        ) : session.active ? (
          <div className="session-modal-content">
            {/* Active Session Card */}
            <div className="session-hud-card">
              <div className="session-hud-header">
                <div className="session-hud-badges">
                  <Badge variant="secondary">
                    <span className="session-active-indicator" /> ACTIVE SESSION
                  </Badge>
                  <Badge variant="outline">
                    <NetworkGlyph network={session.network} name={chainInfo?.name} />
                    <span>{chainInfo?.name || session.network}</span>
                  </Badge>
                </div>
                <button
                  type="button"
                  className="session-hud-refresh-btn"
                  onClick={() => void refreshSession()}
                  title="Refresh live budget"
                  aria-label="Refresh live budget"
                >
                  <RefreshCw size={12} />
                </button>
              </div>

              <div className="session-hud-budget-block">
                <span className="session-hud-label">AVAILABLE SESSION BUDGET</span>
                <div className="session-hud-main-stat">
                  <span className="session-hud-number">${formatUsdc(session.budgetRemaining)}</span>
                  <span className="session-hud-unit">{assetSymbol}</span>
                </div>
                <span className="session-hud-cap">
                  Limit: ${formatUsdc(session.budgetLimit)} {assetSymbol} · Used: ${formatUsdc(session.budgetUsed)} {assetSymbol}
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
                    style={{ width: `${percentRemaining}%` }}
                  />
                </div>
                <div className="session-meter-footer">
                  <span>REMAINING: {percentRemaining}%</span>
                  <span>SPENT: ${(Number(session.budgetUsed) / 1_000_000).toFixed(2)}</span>
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
                <span className="session-grid-item-value" style={{ color: "var(--primary)" }}>
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
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                  <span className="session-grid-item-value" style={{ fontFamily: "var(--font-mono)" }}>
                    {session.keyId ? `${session.keyId.slice(0, 6)}...${session.keyId.slice(-4)}` : "—"}
                  </span>
                  {session.keyId && (
                    <button
                      type="button"
                      className="session-icon-action-btn"
                      onClick={handleCopyKey}
                      title="Copy Key ID"
                      aria-label="Copy Key ID"
                    >
                      {copiedKey ? <Check size={12} color="var(--primary)" /> : <Copy size={12} />}
                    </button>
                  )}
                </div>
                <span className="session-grid-item-sub">Compose authorization token</span>
              </div>
            </div>

            {/* Active Actions Footer */}
            <div className="session-actions-footer">
              <Button
                variant="outline"
                size="sm"
                className="btn-danger"
                disabled={isEnding}
                onClick={() => void handleEndSession()}
              >
                <LogOut size={13} style={{ marginRight: 4 }} />
                {isEnding ? "ENDING..." : "END SESSION"}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setOpen(false)}
              >
                DONE
              </Button>
            </div>
          </div>
        ) : (
          <div className="session-modal-content">
            {/* Explainer strip */}
            <div className="session-info-strip">
              <Zap className="session-info-icon" size={18} />
              <div className="session-info-text">
                <span className="session-info-title">ONE-CLICK CREATIVE WORKFLOW</span>
                <span className="session-info-desc">
                  Pre-authorize a spending budget cap. Song creations, stem branching, and track streaming micropayments execute seamlessly without repetitive wallet popups.
                </span>
              </div>
            </div>

            {/* Current Chain & Balance */}
            <div className="session-balance-strip">
              <div className="session-balance-chain">
                <NetworkGlyph network={selectedNetwork} name={chainInfo?.name} />
                <span>{chainInfo?.name || selectedNetwork}</span>
              </div>
              <div className="session-balance-val">
                {balanceLoading ? "CHECKING..." : `AVAILABLE: $${currentBalance} ${assetSymbol}`}
              </div>
            </div>

            {/* Budget Presets & Custom */}
            <div className="session-section">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="session-section-label">BUDGET CAP</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--primary)", fontWeight: 700 }}>
                  ${effectiveBudgetUsd} {assetSymbol}
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
                <span className="session-custom-prefix">$</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.5"
                  className="cyber-input-field"
                  placeholder="Custom USD amount (e.g. 15.00)..."
                  value={customBudget}
                  onChange={(e) => setCustomBudget(e.target.value)}
                />
              </div>
            </div>

            {/* Duration Selector */}
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

            {/* Notice */}
            <div className="session-notice-strip">
              <ShieldCheck className="session-notice-icon" size={14} />
              <span>Unused funds remain in your wallet and can be revoked at any time.</span>
            </div>

            {/* Error */}
            {error && (
              <div className="session-error-strip" role="alert">
                <span>{error}</span>
              </div>
            )}

            {/* Inactive Actions Footer */}
            <div className="session-actions-footer">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={isCreating}>
                CANCEL
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={isCreating}
                onClick={() => void handleStartSession()}
              >
                {isCreating ? "STARTING SESSION..." : `START SESSION ($${effectiveBudgetUsd})`}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
