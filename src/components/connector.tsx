import { useEffect, useMemo, useState } from "react";
import { ConnectButton, useActiveAccount, useActiveWallet, useActiveWalletConnectionStatus, useAutoConnect } from "thirdweb/react";
import { createWallet, inAppWallet } from "thirdweb/wallets";
import type { SmartWalletOptions } from "thirdweb/wallets";
import { ChevronDown, LogOut, Copy, Check, ExternalLink, Wallet, ShieldCheck, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { thirdwebClient, getChainObject, getChainConfig, getUsdcAddress, getExplorerUrl, isEvmNetwork, evmChainId } from "@/lib/chains";
import { useChain } from "@/contexts/Network";
import { useTotalBalance } from "@/hooks/use-multichain";
import { useSelectedUserAddress } from "@/hooks/use-address";
import { useProfile } from "@/hooks/use-profile";
import { ProfileModal } from "@/components/profile-modal";
import { cn } from "@/lib/utils";
import { NetworkGlyph } from "@/contexts/Network";
import { clearCachedAccount, readCachedAccount, writeCachedAccount } from "@/lib/cache";
import type { EvmNetworkId } from "@compose-market/sdk/chains";
import { DisclaimerModal } from "@/components/disclaimer";
import { useDisclaimerConsent } from "@/hooks/use-disclaimer";
import { thirdwebCustomTheme } from "@/lib/connector";

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

interface WalletConnectorProps {
  className?: string;
  compact?: boolean;
}

export function WalletConnector({ className, compact = true }: WalletConnectorProps) {
  const account = useActiveAccount();
  const wallet = useActiveWallet();
  const connectionStatus = useActiveWalletConnectionStatus();
  const { paymentNetwork, getChainByNetworkId, evmChains, defaultNetwork } = useChain();
  const {
    userAddress,
    readAddress,
    isReconnecting: reconnecting,
    evmAddress,
    svmAddress,
    isEvm,
    isResolving: userAddressResolving,
    isActivated: solanaActivated,
    requiredFundingLamports,
    currentFundingLamports,
  } = useSelectedUserAddress();

  const displayAddress = userAddress ?? readAddress;
  const { nickname, avatar } = useProfile(displayAddress);

  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [cachedAccount] = useState(() => readCachedAccount());
  const { hasConsented, isLoading: isConsentLoading } = useDisclaimerConsent();

  const isReconnecting = reconnecting && cachedAccount != null;

  useEffect(() => {
    if (account?.address) {
      writeCachedAccount(account.address, paymentNetwork, svmAddress, nickname, avatar);
    }
  }, [account?.address, paymentNetwork, svmAddress, nickname, avatar]);

  useEffect(() => {
    if (account?.address && !isConsentLoading) {
      setShowDisclaimer(!hasConsented);
    } else {
      setShowDisclaimer(false);
    }
  }, [account?.address, isConsentLoading, hasConsented]);

  useEffect(() => {
    if (connectionStatus === "disconnected") {
      clearCachedAccount();
    }
  }, [connectionStatus]);

  const fallbackEvmNetwork = useMemo((): EvmNetworkId | undefined => {
    if (isEvmNetwork(defaultNetwork)) return defaultNetwork;
    const first = evmChains.find((chain) => isEvmNetwork(chain.network));
    return first?.network as EvmNetworkId | undefined;
  }, [defaultNetwork, evmChains]);

  const thirdwebNetwork = isEvm ? paymentNetwork : fallbackEvmNetwork;
  const thirdwebChainIdValue = thirdwebNetwork && isEvmNetwork(thirdwebNetwork)
    ? evmChainId(thirdwebNetwork)
    : undefined;

  const connectChain = useMemo(() => {
    if (thirdwebChainIdValue == null) return undefined;
    return getChainObject(thirdwebChainIdValue);
  }, [thirdwebChainIdValue]);
  const accountAbstraction = useMemo<SmartWalletOptions | undefined>(() => connectChain
    ? { chain: connectChain, sponsorGas: true } : undefined, [connectChain]);
  useAutoConnect({ client: thirdwebClient, wallets, chain: connectChain, accountAbstraction });

  const chainInfo = getChainByNetworkId(paymentNetwork);

  const selectedPaymentToken = useMemo(() => {
    if (thirdwebChainIdValue == null) return undefined;
    const usdcAddress = getUsdcAddress(thirdwebChainIdValue);
    if (!usdcAddress) return undefined;
    const asset = getChainConfig(thirdwebChainIdValue)?.asset ?? "USDC";
    return {
      address: usdcAddress,
      name: asset === "USDT" ? "USDT" : "USD Coin",
      symbol: asset,
    };
  }, [thirdwebChainIdValue]);

  const displayEvmAddress = evmAddress ?? (isReconnecting ? cachedAccount?.address ?? null : null);
  const displaySvmAddress = svmAddress ?? (isReconnecting ? cachedAccount?.svmAddress ?? null : null);

  const { formatted: totalBalance, isLoading: balanceLoading } = useTotalBalance({
    evmAddress: displayEvmAddress,
    svmAddress: displaySvmAddress,
  }, {
    enabled: !!displayEvmAddress || !!displaySvmAddress,
    deferUntilIdle: !menuOpen,
  });

  if (!account && !isReconnecting) {
    if (!connectChain || !selectedPaymentToken) {
      return (
        <button
          type="button"
          disabled
          className={cn("btn btn-ghost connect", className)}
        >
          <Wallet className="icon" aria-hidden="true" />
          <span>Loading...</span>
        </button>
      );
    }

    return (
      <ConnectButton
        client={thirdwebClient}
        wallets={wallets}
        chain={connectChain}
        accountAbstraction={accountAbstraction}
        autoConnect={false}
        connectButton={{
          label: "CONNECT",
          className: cn("btn btn-solid connect", className),
        }}
        connectModal={{
          size: compact ? "compact" : "wide",
          title: "RAWCHUNKS",
          titleIcon: "/branding/icon.svg",
          showThirdwebBranding: false,
        }}
        detailsButton={{
          displayBalanceToken: {
            [thirdwebChainIdValue!]: selectedPaymentToken.address,
          },
          className: cn("btn btn-ghost connect", className),
        }}
        supportedTokens={{
          [thirdwebChainIdValue!]: [selectedPaymentToken],
        }}
        theme={thirdwebCustomTheme}
      />
    );
  }

  const shortAddress = displayAddress
    ? `${displayAddress.slice(0, 6)}...${displayAddress.slice(-4)}`
    : userAddressResolving || isReconnecting ? "Resolving..." : "Unavailable";
  const displayName = nickname || shortAddress;
  const accountLabel = isEvm ? "Smart account" : "Solana account";
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
    clearCachedAccount();
    wallet?.disconnect();
  };

  return (
    <>
      <DisclaimerModal
        forceOpen={showDisclaimer}
        onOpenChange={setShowDisclaimer}
      />

      <ProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        address={displayAddress}
      />

      <DropdownMenu onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Wallet ${displayName}`}
            data-reconnecting={isReconnecting || undefined}
            className={cn("btn btn-ghost connect", isReconnecting && "connect-dim", className)}
          >
            {avatar ? (
              <img src={avatar} alt="" className="connect-avatar" />
            ) : (
              <Wallet className="icon" aria-hidden="true" />
            )}
            <span className="connect-address">{displayName}</span>
            <ChevronDown className="icon icon-fold" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end">
          <div className="menu-head">
            <span className="menu-chain">
              <NetworkGlyph network={paymentNetwork} name={chainInfo?.name || "Unknown network"} />
              <b>{chainInfo?.name || "Unknown network"}</b>
            </span>
            <span className="menu-total">
              {balanceLoading ? "..." : `$${totalBalance} USDC`}
            </span>
          </div>

          <div className="menu-head">
            <span className="label">{accountLabel}</span>
            <div className="menu-row">
              <span className="menu-address">{shortAddress}</span>
              <div className="menu-actions">
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={!displayAddress}
                  aria-label="Copy address"
                  className="menu-icon-btn"
                >
                  {copied ? <Check className="icon" /> : <Copy className="icon" />}
                </button>
                {selectedExplorerUrl ? (
                  <a
                    href={selectedExplorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="View on explorer"
                    className="menu-icon-btn"
                  >
                    <ExternalLink className="icon" />
                  </a>
                ) : null}
              </div>
            </div>
            {!isEvm && !solanaActivated && requiredActivationSol ? (
              <p className="menu-note">
                {isActivationFunded
                  ? "Ready to activate when you start a session."
                  : `Fund this address with ${requiredActivationSol} SOL or 5 USDC to activate it.`}
              </p>
            ) : null}
            {!isEvm && !solanaActivated && requiredActivationSol && currentActivationSol ? (
              <p className="menu-note">Detected: {currentActivationSol} SOL</p>
            ) : null}
          </div>

          <DropdownMenuItem onClick={() => setShowProfileModal(true)}>
            <User className="icon" />
            Edit Profile
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => setShowDisclaimer(true)}>
            <ShieldCheck className="icon" />
            Disclaimer &amp; terms
          </DropdownMenuItem>

          <DropdownMenuItem onClick={handleDisconnect}>
            <LogOut className="icon" />
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
