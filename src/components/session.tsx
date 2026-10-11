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
import { useActiveAccount } from "thirdweb/react";
import { getContract, sendTransaction } from "thirdweb";
import { allowance, approve, balanceOf } from "thirdweb/extensions/erc20";
import type {
  BudgetEvent,
  KeyCreateResponse,
  SessionActiveEvent,
} from "@compose-market/sdk";
import type { NetworkId } from "@compose-market/sdk/chains";
import { useNetwork } from "@/hooks/use-network";
import { useChain, NetworkGlyph } from "@/contexts/Network";
import { useSelectedUserAddress } from "@/hooks/use-address";
import { useWalletPair } from "@/hooks/use-pair";
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
import { Modal } from "@/components/modal";
import { Button } from "@/components/button";
import { Badge } from "@/components/badge";
import { cn } from "@/lib/utils";

export { useSession, emptySession, type SessionState, type SessionContextValue };

const SESSION_CACHE_KEY = "rawchunks:session";

function readCachedSession(): SessionState {
  if (typeof window === "undefined") return emptySession;
  try {
    const raw = localStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return emptySession;
    const parsed = JSON.parse(raw) as SessionState;
    if (parsed && parsed.active && parsed.expiresAt && parsed.expiresAt > Date.now()) {
      return parsed;
    }
  } catch {
    // non-fatal
  }
  return emptySession;
}

function storeCachedSession(session: SessionState | null) {
  if (typeof window === "undefined") return;
  try {
    if (session && session.active && session.token) {
      localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(session));
    } else if (!session || (!session.active && (!session.expiresAt || session.expiresAt <= Date.now()))) {
      localStorage.removeItem(SESSION_CACHE_KEY);
    }
  } catch {
    // non-fatal
  }
}

function mergeActiveEvent(previous: SessionState, event: SessionActiveEvent): SessionState {
  return {
    ...previous,
    active: true,
    network: event.network,
    budgetLimit: event.budgetLimit ?? previous.budgetLimit,
    budgetUsed: event.budgetUsed ?? previous.budgetUsed,
    budgetLocked: event.budgetLocked ?? previous.budgetLocked,
    budgetRemaining: event.budgetRemaining ?? previous.budgetRemaining,
    expiresAt: event.expiresAt ?? previous.expiresAt,
  };
}

export interface SessionProviderProps {
  children: ReactNode;
  userAddress?: string | null;
}

export function SessionProvider({ children, userAddress: propUserAddress }: SessionProviderProps) {
  const account = useActiveAccount();
  const { chains, selectedNetwork } = useNetwork();
  const { setSelectedNetwork } = useChain();
  const { userAddress, readAddress, isReconnecting } = useSelectedUserAddress();
  const { pair } = useWalletPair();
  const [session, setSession] = useState<SessionState>(readCachedSession);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attachedRef = useRef<string | null>(null);

  const resolveCurrentAddress = useCallback((): string | null => {
    if (propUserAddress) return propUserAddress;
    return userAddress ?? readAddress ?? account?.address ?? null;
  }, [account?.address, propUserAddress, readAddress, userAddress]);

  const attach = useCallback((address: string, network: NetworkId, token?: string | null) => {
    const normalized = isEvmNetwork(network) ? address.toLowerCase() : address;
    const key = `${normalized}:${network}`;
    if (attachedRef.current !== key) {
      sdk.wallets.attach({ address, network });
      attachedRef.current = key;
    }
    if (token) sdk.keys.use(token);
  }, []);

  const refreshSession = useCallback(async () => {
    const targetNetwork = session.network ?? selectedNetwork;
    const isTargetEvm = isEvmNetwork(targetNetwork);
    const address = (isTargetEvm ? pair?.evmAddress : pair?.svmAddress)
      ?? session.userAddress
      ?? resolveCurrentAddress();

    if (!address || !targetNetwork) return;

    attach(address, targetNetwork, session.token);

    try {
      const status = await sdk.keys.getActive({ network: targetNetwork });

      if (!status.hasSession) {
        if (session.expiresAt && Date.now() > session.expiresAt) {
          sdk.keys.clearToken();
          setSession((prev) => ({ ...prev, active: false }));
        }
        return;
      }

      const activeNetwork = (status.network ?? targetNetwork) as NetworkId;
      const activeAddress = address;
      const token = status.token ?? sdk.keys.currentToken() ?? session.token;

      if (token) {
        sdk.keys.use(token);
      }
      attach(activeAddress, activeNetwork, token);

      setSession((previous) => ({
        ...previous,
        active: status.status?.isActive ?? true,
        userAddress: activeAddress,
        network: activeNetwork,
        keyId: status.keyId ?? previous.keyId,
        token: token ?? previous.token,
        budgetLimit: status.budgetLimit ?? previous.budgetLimit,
        budgetUsed: status.budgetUsed ?? previous.budgetUsed,
        budgetLocked: status.budgetLocked ?? previous.budgetLocked,
        budgetRemaining: status.budgetRemaining ?? previous.budgetRemaining,
        expiresAt: status.expiresAt ?? previous.expiresAt,
      }));

      if (activeNetwork && activeNetwork !== selectedNetwork) {
        setSelectedNetwork(activeNetwork);
      }
    } catch (err) {
      console.warn("[session] refreshSession failed", err);
    }
  }, [attach, pair?.evmAddress, pair?.svmAddress, resolveCurrentAddress, selectedNetwork, session.expiresAt, session.network, session.token, session.userAddress, setSelectedNetwork]);

  useEffect(() => {
    storeCachedSession(session);
  }, [session]);

  useEffect(() => {
    const currentAddress = resolveCurrentAddress() ?? pair?.evmAddress ?? pair?.svmAddress;
    if (!currentAddress) {
      if (!isReconnecting && !session.active) {
        sdk.wallets.clear();
        attachedRef.current = null;
        setSession(emptySession);
      }
      return;
    }
    const targetNetwork = session.network ?? selectedNetwork;
    attach(currentAddress, targetNetwork, session.token);
    setSession((previous) => ({
      ...previous,
      userAddress: previous.userAddress ?? currentAddress,
      network: previous.network ?? targetNetwork,
    }));
  }, [attach, isReconnecting, pair?.evmAddress, pair?.svmAddress, resolveCurrentAddress, selectedNetwork, session.active, session.network, session.token]);

  useEffect(() => {
    const address = session.userAddress ?? resolveCurrentAddress() ?? pair?.evmAddress ?? pair?.svmAddress;
    if (!address) return;
    void refreshSession().catch((cause) => {
      console.warn("[session] refresh failed", cause);
    });
  }, [pair?.evmAddress, pair?.svmAddress, refreshSession, resolveCurrentAddress, session.userAddress]);

  useEffect(() => {
    const disposers = [
      sdk.events.on("budget", (event: BudgetEvent) => {
        setSession((previous) => ({
          ...previous,
          budgetLimit: event.snapshot.limitWei ?? previous.budgetLimit,
          budgetUsed: event.snapshot.usedWei ?? previous.budgetUsed,
          budgetLocked: event.snapshot.lockedWei ?? previous.budgetLocked,
          budgetRemaining: event.snapshot.remainingWei ?? previous.budgetRemaining,
        }));
      }),
      sdk.events.on("sessionActive", (event) => setSession((previous) => mergeActiveEvent(previous, event))),
      sdk.events.on("sessionExpired", () => {
        sdk.keys.clearToken();
        setSession((previous) => ({
          ...previous,
          active: false,
          token: null,
          budgetRemaining: "0",
        }));
      }),
      sdk.events.on("sessionInvalid", () => void refreshSession()),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [refreshSession]);

  useEffect(() => {
    if (!session.active || !session.userAddress || !session.network) return;
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const _event of sdk.session.subscribe({
          userAddress: session.userAddress!,
          network: session.network!,
          signal: controller.signal,
        })) {
          void _event;
        }
      } catch (cause) {
        if (!controller.signal.aborted) console.warn("[session] events stream ended", cause);
      }
    })();
    return () => controller.abort();
  }, [session.active, session.network, session.userAddress]);

  const createSession = useCallback(async (budgetWei: string, durationHours: number): Promise<KeyCreateResponse> => {
    const address = resolveCurrentAddress();
    if (!address) throw new Error("Connect your account first");
    const network = selectedNetwork;

    setIsCreating(true);
    setError(null);
    try {
      attach(address, network);

      if (isEvmNetwork(network)) {
        if (!account) {
          throw new Error("Connect your account first");
        }
        const chain = getChainObject(evmChainId(network));
        const config = chains.find((item) => item.network === network);
        const support = await sdk.x402.facilitator.supported();
        const kind = support.kinds.find((item) => item.network === network && item.scheme === "upto");
        const spender = kind?.extra?.facilitatorAddress;
        if (!chain || !config || typeof spender !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(spender)) {
          throw new Error(`Session approval is unavailable for ${network}`);
        }

        const contract = getContract({
          client: thirdwebClient,
          chain,
          address: config.assetAddress as `0x${string}`,
        });
        const amount = BigInt(budgetWei);
        const [funds, approved] = await Promise.all([
          balanceOf({ contract, address: account.address }),
          allowance({ contract, owner: account.address, spender: spender as `0x${string}` }),
        ]);
        if (funds < amount) {
          throw new Error(`Insufficient USDC balance. Available: ${(Number(funds) / 1_000_000).toFixed(2)} USDC`);
        }
        if (approved < amount) {
          await sendTransaction({
            account,
            transaction: approve({
              contract,
              spender: spender as `0x${string}`,
              amountWei: amount,
            }),
          });
        }
      } else if (isSolanaNetwork(network)) {
        const config = chains.find((item) => item.network === network);
        const support = await sdk.x402.facilitator.supported();
        const kind = support.kinds.find((item) => item.network === network && item.scheme === "upto");
        let spender = (kind?.extra as any)?.feePayer || kind?.extra?.facilitatorAddress;
        if (!spender) {
          const feePayerRes = await sdk.svm.feePayer().catch(() => null);
          spender = feePayerRes?.feePayer;
        }
        if (typeof spender !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(spender)) {
          throw new Error(`Session approval is unavailable for ${network}`);
        }

        const usdcMint = config?.assetAddress;
        const rpcUrl = config?.rpcUrl;
        if (!usdcMint || !rpcUrl) {
          throw new Error(`Chain configuration is incomplete for ${network}`);
        }

        const {
          createSolanaRpcFromNetwork,
          readSvmTokenBalance,
          buildSwigApproveTransaction,
        } = await import("@/lib/svm/swig");
        const { deriveSwigConfigAddress } = await import("@/lib/svm/account");

        const rpc = createSolanaRpcFromNetwork(network, rpcUrl);
        const balance = await readSvmTokenBalance({
          owner: address as any,
          mint: usdcMint,
          rpc,
        });

        const amount = BigInt(budgetWei);
        if (balance < amount) {
          throw new Error(`Insufficient USDC balance. Available: ${(Number(balance) / 1_000_000).toFixed(2)} USDC`);
        }

        if (!account) {
          throw new Error("Connect your account first");
        }

        const swigConfigAddress = await deriveSwigConfigAddress(account.address);
        const unsignedTransaction = await buildSwigApproveTransaction({
          swigConfigAddress,
          expectedWalletAddress: address,
          evmSignerAddress: account.address,
          usdcMint,
          amount,
          feePayer: spender as any,
          network,
          rpcUrl,
          signMessage: async (bytes: Uint8Array) => {
            return account.signMessage({ message: { raw: bytes } });
          },
        });

        await sdk.svm.relay({ unsignedTransaction, network });
      } else {
        throw new Error(`Unsupported network: ${network}`);
      }

      const response = await sdk.fetch("/api/keys", {
        method: "POST",
        key: sdk.keys.currentToken(),
        userAddress: address,
        network,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          budgetLimit: budgetWei,
          expiresAt: Date.now() + durationHours * 60 * 60 * 1_000,
          network,
          purpose: "session",
          name: `Session ${new Date().toISOString().slice(0, 10)}`,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string | { message?: string }; message?: string } | null;
        const message = typeof body?.error === "string"
          ? body.error
          : body?.error?.message ?? body?.message ?? `Session creation failed (${response.status})`;
        throw new Error(message);
      }
      const created = await response.json() as KeyCreateResponse;
      sdk.keys.use(created.token);
      const next: SessionState = {
        active: true,
        userAddress: address,
        network: created.network,
        keyId: created.keyId,
        token: created.token,
        budgetLimit: created.budgetLimit,
        budgetUsed: created.budgetUsed,
        budgetLocked: "0",
        budgetRemaining: created.budgetRemaining,
        expiresAt: created.expiresAt,
      };
      setSession(next);
      await refreshSession();
      return created;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to create session";
      setError(message);
      throw cause;
    } finally {
      setIsCreating(false);
    }
  }, [account, attach, chains, refreshSession, resolveCurrentAddress, selectedNetwork]);

  const clearSession = useCallback(() => {
    sdk.keys.clearToken();
    sdk.wallets.clear();
    attachedRef.current = null;
    setSession(emptySession);
  }, []);

  const endSession = useCallback(async () => {
    try {
      if (session.keyId) {
        await sdk.keys.revoke(session.keyId).catch((cause) => {
          console.warn("[session] revoke failed", cause);
        });
      }
    } finally {
      clearSession();
    }
  }, [clearSession, session.keyId]);

  return (
    <SessionContext.Provider value={{
      session,
      isCreating,
      error,
      createSession,
      refreshSession,
      clearSession,
      endSession,
    }}>
      {children}
    </SessionContext.Provider>
  );
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

export function SessionControl() {
  const { session, isCreating, error, createSession, refreshSession, endSession } = useSession();
  const { evmAddress, svmAddress, readAddress, userAddress } = useSelectedUserAddress();
  const { selectedNetwork, getChainByNetworkId } = useChain();
  const { data: balances, isLoading: balanceLoading } = useMultiChainBalance({ evmAddress, svmAddress });

  const [open, setOpen] = useState(false);
  const [selectedBudgetPreset, setSelectedBudgetPreset] = useState<string>("10000000");
  const [customBudget, setCustomBudget] = useState<string>("");
  const [duration, setDuration] = useState<number>(24);
  const [isEnding, setIsEnding] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  const displayAddress = userAddress ?? readAddress;
  const activeNetwork = session.active && session.network ? session.network : selectedNetwork;
  const chainInfo = getChainByNetworkId(activeNetwork);
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
            ? `Session active: $${formatUsdc(session.budgetRemaining)} USDC`
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
                  <span className="session-hud-unit">USDC</span>
                </div>
                <span className="session-hud-cap">
                  Limit: ${formatUsdc(session.budgetLimit)} USDC · Used: ${formatUsdc(session.budgetUsed)} USDC
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
                {balanceLoading ? "CHECKING..." : `AVAILABLE: $${currentBalance} USDC`}
              </div>
            </div>

            {/* Budget Presets & Custom */}
            <div className="session-section">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="session-section-label">BUDGET CAP</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--primary)", fontWeight: 700 }}>
                  ${effectiveBudgetUsd} USDC
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
