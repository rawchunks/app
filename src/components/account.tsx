import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActiveAccount, useActiveWallet, useAutoConnect, useConnectModal } from "thirdweb/react";
import { createWallet, inAppWallet } from "thirdweb/wallets";
import type { SmartWalletOptions } from "thirdweb/wallets";
import { BookOpen, Check, Copy, ExternalLink, LogOut, Pencil, ShieldAlert, ShieldCheck, Wallet } from "lucide-react";
import { useChain } from "@/contexts/Network";
import { useSelectedUserAddress } from "@/hooks/use-address";
import { useProfile } from "@/hooks/use-profile";
import { useSession } from "@/hooks/use-session";
import { useDisclaimerConsent } from "@/hooks/use-disclaimer";
import { useGuide } from "@/components/guide/Tour";
import { GUIDE_FLOWS } from "@/components/guide/Steps";
import { ProfileModal } from "@/components/profile-modal";
import { DisclaimerBody, DISCLAIMER_POLICY_VERSION } from "@/components/disclaimer";
import { Modal } from "@/components/modal";
import { Button } from "@/components/button";
import { Tooltip } from "@/components/daw/Tooltip";
import { thirdwebClient, getChainObject, getChainConfig, getUsdcAddress, getExplorerUrl, isEvmNetwork, evmChainId } from "@/lib/chains";
import { thirdwebCustomTheme } from "@/lib/connector";
import { cn } from "@/lib/utils";
import { unsatisfiedStep, useGate } from "@/lib/gate";

const wallets = [
  inAppWallet({
    auth: {
      options: [
        "google",
        "github",
        "discord",
        "x",
        "farcaster",
        "email",
        "passkey",
        "guest",
      ],
    },
  }),
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
  createWallet("walletConnect"),
  createWallet("io.rabby"),
  createWallet("me.rainbow"),
];

const GATE_TITLES = {
  login: 'SIGN IN',
  terms: 'GENERATION TERMS',
  funding: 'SESSION & CREDITS',
} as const;

export interface AccountChipProps {
  className?: string;
}

export function AccountChip({ className }: AccountChipProps) {
  const { hasBudget, hasStreamBudget } = useSession();
  const account = useActiveAccount();
  const wallet = useActiveWallet();
  const { connect: openConnectModal, isConnecting: isModalConnecting } = useConnectModal();
  const { paymentNetwork, getChainByNetworkId, chains, defaultNetwork } = useChain();
  const {
    userAddress,
    readAddress,
    isReconnecting: reconnecting,
    isEvm,
    isResolving: userAddressResolving,
    isActivated: solanaActivated,
    requiredFundingLamports,
    currentFundingLamports,
    disconnect,
  } = useSelectedUserAddress();
  const { hasConsented, isLoading: isConsentLoading } = useDisclaimerConsent();
  const gate = useGate();
  const { activePage, startFlow } = useGuide();

  const displayAddress = userAddress ?? readAddress;
  const { nickname, avatar, bio } = useProfile(displayAddress);

  const [copied, setCopied] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [view, setView] = useState<'status' | 'terms'>('status');
  const [showProfileModal, setShowProfileModal] = useState(false);

  // Payment selection cannot change the chain used to restore the login identity.
  const [thirdwebNetwork] = useState(() => {
    const evmChains = chains.filter(chain => isEvmNetwork(chain.network));
    return evmChains.find(chain => chain.network === defaultNetwork)?.network ?? evmChains[0]?.network;
  });
  const thirdwebChainIdValue = thirdwebNetwork && isEvmNetwork(thirdwebNetwork)
    ? evmChainId(thirdwebNetwork)
    : undefined;

  const connectChain = useMemo(() => {
    if (thirdwebChainIdValue == null) return undefined;
    return getChainObject(thirdwebChainIdValue);
  }, [thirdwebChainIdValue, chains]);
  const accountAbstraction = useMemo<SmartWalletOptions | undefined>(() => connectChain
    ? { chain: connectChain, sponsorGas: true } : undefined, [connectChain]);
  const autoConnect = useAutoConnect({ client: thirdwebClient, wallets, chain: connectChain, accountAbstraction, timeout: 30000 });
  const isReconnecting = Boolean(reconnecting || (autoConnect?.isLoading && readAddress));

  const chainInfo = getChainByNetworkId(paymentNetwork);

  const selectedPaymentToken = useMemo(() => {
    if (thirdwebChainIdValue == null) return undefined;
    const usdcAddress = getUsdcAddress(thirdwebChainIdValue);
    if (!usdcAddress) return undefined;
    const asset = getChainConfig(thirdwebChainIdValue)?.asset ?? "USDC";
    return {
      address: usdcAddress,
      name: asset,
      symbol: asset,
    };
  }, [thirdwebChainIdValue, chains]);

  const gateStep = gate.request
    ? unsatisfiedStep(gate.request, {
        loggedIn: Boolean(userAddress),
        consented: hasConsented,
        funded: gate.request.action === 'stream' ? hasStreamBudget : hasBudget,
      })
    ?? (gate.request.force ? 'funding' : null)
    : null;

  // 1-Click Direct Login when gate requires 'login' (no redundant wrapper modal)
  const loginGateFiredRef = useRef(false);
  useEffect(() => {
    if (gateStep !== 'login') {
      loginGateFiredRef.current = false;
      return;
    }
    if (loginGateFiredRef.current || !connectChain || isModalConnecting) return;
    loginGateFiredRef.current = true;
    openConnectModal({
      client: thirdwebClient,
      wallets,
      chain: connectChain,
      accountAbstraction,
      size: "compact",
      title: "RAWCHUNKS",
      titleIcon: "/branding/icon.svg",
      showThirdwebBranding: false,
      theme: thirdwebCustomTheme,
    }).catch(() => {
      gate.cancel();
    });
  }, [gateStep, connectChain, isModalConnecting, openConnectModal, accountAbstraction, gate]);

  const sheetOpen = userOpen || gateStep === 'terms';

  const connect = useCallback(() => {
    if (!connectChain) return;
    void openConnectModal({
      client: thirdwebClient,
      wallets,
      chain: connectChain,
      accountAbstraction,
      size: "compact",
      title: "RAWCHUNKS",
      titleIcon: "/branding/icon.svg",
      showThirdwebBranding: false,
      theme: thirdwebCustomTheme,
    }).catch(() => { });
  }, [openConnectModal, connectChain, accountAbstraction]);

  const close = useCallback(() => {
    setUserOpen(false);
    setView('status');
    if (gateStep === 'terms') {
      gate.cancel();
    }
  }, [gate, gateStep]);

  if (!account && !isReconnecting) {
    if (!connectChain || !selectedPaymentToken) {
      return (
        <button
          type="button"
          disabled
          aria-label="Loading wallet"
          className={cn("btn btn-ghost connect", className)}
        >
          <Wallet className="icon" aria-hidden="true" />
          <span className="connect-address">Loading...</span>
        </button>
      );
    }

    return (
      <button
        type="button"
        disabled={isModalConnecting}
        data-guide="account"
        onClick={connect}
        className={cn("btn btn-solid connect", className)}
      >
        <Wallet className="icon" aria-hidden="true" />
        <span className="connect-address">LOGIN</span>
      </button>
    );
  }

  const shortAddress = displayAddress
    ? `${displayAddress.slice(0, 6)}...${displayAddress.slice(-4)}`
    : userAddressResolving || isReconnecting ? "Resolving..." : "Unavailable";
  const displayName = nickname || shortAddress;
  const requiredActivationSol = requiredFundingLamports == null
    ? null
    : (Number(requiredFundingLamports) / 1_000_000_000).toFixed(9).replace(/0+$/, "").replace(/\.$/, "");
  const currentActivationSol = currentFundingLamports == null
    ? null
    : (Number(currentFundingLamports) / 1_000_000_000).toFixed(9).replace(/0+$/, "").replace(/\.$/, "");
  const isActivationFunded = requiredFundingLamports != null
    && currentFundingLamports != null
    && currentFundingLamports >= requiredFundingLamports;
  const selectedExplorerUrl = (() => {
    if (!displayAddress) return null;
    const url = getExplorerUrl(paymentNetwork, "address", displayAddress);
    return url === "#" ? null : url;
  })();

  const handleCopy = async () => {
    if (!displayAddress) return;
    await navigator.clipboard.writeText(displayAddress);
    setCopied(true);
    globalThis.setTimeout(() => setCopied(false), 2_000);
  };

  const handleDisconnect = () => {
    close();
    disconnect?.();
    wallet?.disconnect();
  };

  const chipDescription = [
    chainInfo?.name || "Connected",
    shortAddress,
  ].filter(Boolean).join(" • ");

  const pageFlow = GUIDE_FLOWS[activePage];
  const sheetTitle = gateStep === 'terms' || view === 'terms' ? GATE_TITLES.terms : 'ACCOUNT';

  return (
    <>
      <Tooltip title={displayName} description={chipDescription} position="bottom">
        <button
          type="button"
          aria-label={`Account ${displayName}`}
          data-guide="account"
          data-reconnecting={isReconnecting || undefined}
          className={cn("btn btn-ghost connect", isReconnecting && "connect-dim", className)}
          onClick={() => setUserOpen(true)}
        >
          {avatar ? (
            <img src={avatar} alt="" className="connect-avatar" />
          ) : (
            <Wallet className="icon" aria-hidden="true" />
          )}
          <span className="connect-address">{displayName}</span>
          {account && !hasConsented && !isConsentLoading ? (
            <span className="account-chip-flag" />
          ) : null}
        </button>
      </Tooltip>

      <ProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        address={displayAddress}
      />

      <Modal
        isOpen={sheetOpen}
        onClose={close}
        title={sheetTitle}
        size="md"
        className="session-modal account-modal"
      >
        {gateStep === 'terms' || view === 'terms' ? (
          <DisclaimerBody
            readOnly={hasConsented && gateStep !== 'terms'}
            onSigned={gateStep === 'terms' ? () => { } : () => setView('status')}
            onCancel={gateStep === 'terms' ? close : () => setView('status')}
          />
        ) : (
          <div className="session-modal-content">
            <div className="account-sheet-account">
              {avatar ? (
                <img src={avatar} alt="" className="account-sheet-avatar" />
              ) : (
                <Wallet className="account-sheet-avatar-icon" aria-hidden="true" />
              )}
              <div className="account-sheet-identity">
                <div className="account-sheet-name-row">
                  <span className="account-sheet-name">{nickname || 'YOUR ACCOUNT'}</span>
                  <Tooltip title="EDIT PROFILE" description="Update nickname, bio, and avatar" position="top">
                    <button
                      type="button"
                      onClick={() => { close(); setShowProfileModal(true); }}
                      aria-label="Edit profile"
                      className="account-edit-trigger"
                    >
                      <Pencil size={12} />
                    </button>
                  </Tooltip>
                </div>
                {bio ? (
                  <p className="account-sheet-bio">{bio}</p>
                ) : (
                  <p
                    className="account-sheet-bio empty"
                    onClick={() => { close(); setShowProfileModal(true); }}
                  >
                    Add a creator bio...
                  </p>
                )}
              </div>
            </div>

            {!isEvm && !solanaActivated && requiredActivationSol ? (
              <p className="menu-note">
                {isActivationFunded
                  ? "Ready to activate when you start a session."
                  : paymentNetwork === "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
                    ? `Fund this address with ${requiredActivationSol} SOL or USDC to activate it.`
                    : `Fund this address with ${requiredActivationSol} SOL to activate it.`}
              </p>
            ) : null}
            {!isEvm && !solanaActivated && requiredActivationSol && currentActivationSol ? (
              <p className="menu-note">Detected: {currentActivationSol} SOL</p>
            ) : null}

            <div className="account-sheet-row">
              <span className="label account-row-label">
                <Wallet size={12} aria-hidden="true" />
                <span>WALLET</span>
              </span>
              <div className="account-wallet-controls">
                <span className="menu-address">{shortAddress}</span>
                <div className="menu-actions">
                  <Tooltip title={copied ? "COPIED" : "COPY ADDRESS"} description="Copy wallet address to clipboard" position="top">
                    <button
                      type="button"
                      onClick={handleCopy}
                      disabled={!displayAddress}
                      aria-label="Copy address"
                      className="menu-icon-btn"
                    >
                      {copied ? <Check className="icon" /> : <Copy className="icon" />}
                    </button>
                  </Tooltip>
                  {selectedExplorerUrl ? (
                    <Tooltip title="VIEW ON EXPLORER" description="Open wallet address in block explorer" position="top">
                      <a
                        href={selectedExplorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="View on explorer"
                        className="menu-icon-btn"
                      >
                        <ExternalLink className="icon" />
                      </a>
                    </Tooltip>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="account-sheet-row">
              <span className="label account-row-label">
                <BookOpen size={12} aria-hidden="true" />
                <span>GUIDES</span>
              </span>
              <div className="account-sheet-guides">
                <button
                  type="button"
                  className="account-guide-pill"
                  onClick={() => { close(); startFlow(activePage); }}
                >
                  {pageFlow.label}
                </button>
                <button
                  type="button"
                  className="account-guide-pill"
                  onClick={() => { close(); startFlow('welcome'); }}
                >
                  {GUIDE_FLOWS.welcome.label}
                </button>
              </div>
            </div>

            <div className="account-sheet-footer">
              <button
                type="button"
                className={cn("account-tos-footer-link", !hasConsented && "unsigned")}
                onClick={() => setView('terms')}
              >
                {hasConsented ? (
                  <>
                    <ShieldCheck size={11} className="session-grid-item-value-primary" />
                    <span><span className="account-tos-footer-link-action">TOS</span> signed (v{DISCLAIMER_POLICY_VERSION})</span>
                  </>
                ) : (
                  <>
                    <ShieldAlert size={11} />
                    <span className="account-tos-footer-link-action">Review &amp; sign TOS</span>
                  </>
                )}
              </button>
              <Button variant="outline" size="sm" className="btn-danger" onClick={handleDisconnect}>
                <LogOut size={13} />
                DISCONNECT
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
