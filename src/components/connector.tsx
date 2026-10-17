import { useEffect, useMemo, useRef, useState } from "react";
import { usePayPalScriptReducer } from '@paypal/react-paypal-js';
import { useSession } from '@/hooks/use-session';
import { creditLabel, creditsApi, DEFAULT_CREDIT_PACKS, purchaseCacheKey, type CheckoutIntent } from '@/lib/credits';
import { Modal } from '@/components/modal';
import { Button } from '@/components/button';
import { useActiveAccount, useActiveWallet, useAutoConnect, useConnectModal } from "thirdweb/react";
import { createWallet, inAppWallet } from "thirdweb/wallets";
import type { SmartWalletOptions, Account, Wallet as ThirdwebWallet } from "thirdweb/wallets";
import { getContract, readContract, prepareContractCall, prepareTransaction, encode, sendAndConfirmTransaction, type Chain, type PreparedTransaction } from "thirdweb";
import { allowance, approve } from "thirdweb/extensions/erc20";
import { createPublicClient, createWalletClient, encodeFunctionData, hexToBytes, http, parseEventLogs, type Transport } from "viem";
import { entryPoint06Abi, getUserOperationHash } from "viem/account-abstraction";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { tempoModerato } from "viem/chains";
import { withRelay } from "viem/tempo";
import { ChevronDown, LogOut, Copy, Check, ExternalLink, Wallet, ShieldCheck, User, CreditCard } from "lucide-react";
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
import { DisclaimerModal } from "@/components/disclaimer";
import { useDisclaimerConsent } from "@/hooks/use-disclaimer";
import { thirdwebCustomTheme } from "@/lib/connector";
import { Tooltip } from "@/components/daw/Tooltip";

const TEMPO_ACCOUNT_FACTORY = "0x85e23b94e7F5E9cC1fF78BCe78cfb15B81f0DF00";
const TEMPO_ENTRY_POINT = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

type TempoAccountInput = {
  chain: Chain; admin: Account; adminWallet: ThirdwebWallet; accountAddress: string;
  assertCurrent: () => void;
};

async function prepareTempoAccount(input: TempoAccountInput) {
  const { chain, admin, assertCurrent } = input;
  if (chain.id !== 42431 || !chain.rpc) throw new Error("Tempo Moderato configuration is unavailable");
  const rpc = createPublicClient({ transport: http(chain.rpc) });
  const check = () => {
    assertCurrent();
    if (input.adminWallet.getAccount()?.address.toLowerCase() !== admin.address.toLowerCase()) {
      throw new Error("The admin signer changed; retry session creation");
    }
  };
  const factory = getContract({ client: thirdwebClient, chain, address: TEMPO_ACCOUNT_FACTORY });
  const smart = getContract({ client: thirdwebClient, chain, address: input.accountAddress });
  check();
  if (await rpc.getChainId() !== chain.id) throw new Error("The Tempo RPC returned another network");
  const factoryCode = await rpc.getCode({ address: TEMPO_ACCOUNT_FACTORY });
  check();
  if (!factoryCode || factoryCode === "0x") throw new Error("The canonical Thirdweb account factory is not deployed on Tempo Moderato. It must be deployed before this universal account can be initialized.");
  const predicted = await readContract({ contract: factory, method: "function getAddress(address, bytes) view returns (address)", params: [admin.address, "0x"] });
  check();
  if (predicted.toLowerCase() !== input.accountAddress.toLowerCase()) throw new Error("The derived Tempo smart account differs from the universal EVM address");
  const entryCode = await rpc.getCode({ address: TEMPO_ENTRY_POINT });
  check();
  if (!entryCode || entryCode === "0x") throw new Error("The canonical EntryPoint is not deployed on Tempo Moderato");
  const code = await rpc.getCode({ address: input.accountAddress as `0x${string}` });
  check();
  const deployed = Boolean(code && code !== "0x");
  if (deployed) {
    const isAdmin = await readContract({ contract: smart, method: "function isAdmin(address) view returns (bool)", params: [admin.address] });
    check();
    if (!isAdmin) throw new Error("The signer is not an admin of the Tempo smart account");
  }
  // The admin signs the ERC-4337 operation. An ephemeral broadcaster signs only
  // its Tempo envelope; Tempo's public testnet sponsor pays that envelope's fee.
  const broadcaster = privateKeyToAccount(generatePrivateKey());
  const guarded = (url: string): Transport => options => {
    const transport = http(url, { retryCount: 0 })(options);
    const request: typeof transport.request = async (request, requestOptions) => {
      check();
      const result = await transport.request(request, requestOptions);
      check();
      if (request.method === "eth_fillTransaction") {
        const filled = result as { tx?: { chainId?: string } };
        if (!filled.tx?.chainId || Number(BigInt(filled.tx.chainId)) !== chain.id) {
          throw new Error("The Tempo sponsor returned another network");
        }
      }
      return result as never;
    };
    return { ...transport, request };
  };
  const relay = createWalletClient({ account: broadcaster, chain: tempoModerato,
    transport: withRelay(guarded(chain.rpc), guarded("https://sponsor.moderato.tempo.xyz")) });
  let operationHash: `0x${string}` | undefined;
  const sender: Account = {
    ...admin,
    address: broadcaster.address,
    sendTransaction: async tx => {
      check();
      if (tx.chainId !== chain.id) throw new Error("The Tempo transaction uses another network");
      if (!operationHash || tx.to?.toLowerCase() !== TEMPO_ENTRY_POINT.toLowerCase()) throw new Error("The Tempo smart-account operation is missing");
      const transactionHash = await relay.sendTransaction({ to: TEMPO_ENTRY_POINT, data: tx.data,
        gas: tx.gas, feePayer: true });
      check();
      const receipt = await rpc.waitForTransactionReceipt({ hash: transactionHash, timeout: 120_000 });
      check();
      if (receipt.status !== "success") throw new Error("Tempo smart-account transaction reverted");
      const event = parseEventLogs({ abi: entryPoint06Abi, logs: receipt.logs, eventName: "UserOperationEvent" })
        .find(log => log.address.toLowerCase() === TEMPO_ENTRY_POINT.toLowerCase()
          && log.args.userOpHash === operationHash && log.args.sender.toLowerCase() === input.accountAddress.toLowerCase());
      if (!event?.args.success) throw new Error("Tempo smart-account operation failed");
      return { transactionHash };
    },
  };
  const prepare = async (callData: `0x${string}`) => {
    check();
    const nonce = await rpc.readContract({ address: TEMPO_ENTRY_POINT, abi: entryPoint06Abi,
      functionName: "getNonce", args: [input.accountAddress as `0x${string}`, 0n] });
    const initCode = deployed ? "0x" as const : TEMPO_ACCOUNT_FACTORY + (await encode(prepareContractCall({
      contract: factory, method: "function createAccount(address, bytes) returns (address)", params: [admin.address, "0x"] }))).slice(2);
    check();
    // Native ETH prefunding is unavailable on Tempo. Only the outer Tempo
    // envelope has fees; the EntryPoint operation has zero native gas price.
    const operation = { sender: input.accountAddress as `0x${string}`, nonce, initCode: initCode as `0x${string}`, callData,
      callGasLimit: 3_000_000n, verificationGasLimit: 6_000_000n, preVerificationGas: 100_000n,
      maxFeePerGas: 0n, maxPriorityFeePerGas: 0n, paymasterAndData: "0x" as const, signature: "0x" as `0x${string}` };
    operationHash = getUserOperationHash({ chainId: chain.id, entryPointAddress: TEMPO_ENTRY_POINT,
      entryPointVersion: "0.6", userOperation: operation });
    operation.signature = await admin.signMessage({ message: { raw: hexToBytes(operationHash) }, chainId: chain.id });
    check();
    return prepareTransaction({ client: thirdwebClient, chain, to: TEMPO_ENTRY_POINT,
      data: encodeFunctionData({ abi: entryPoint06Abi, functionName: "handleOps", args: [[operation], broadcaster.address] }) });
  };
  const send = async (transaction: PreparedTransaction) => {
    check();
    const receipt = await sendAndConfirmTransaction({ account: sender, transaction: await prepare(await encode(transaction)) });
    check();
    if (receipt.status !== "success") throw new Error("Tempo account or approval transaction reverted");
  };
  return { sender, smart, check, send, prepare, deployed };
}

export async function prepareTempoTransaction(input: TempoAccountInput, transaction: PreparedTransaction<any>): Promise<{ account: Account; transaction: PreparedTransaction<any> }> {
  input.assertCurrent();
  if (transaction.chain.id !== input.chain.id || transaction.chain.rpc !== input.chain.rpc) throw new Error("The contract transaction uses another network configuration");
  const { sender, smart, check, prepare } = await prepareTempoAccount(input);
  const [data, to, value] = await Promise.all([
    encode(transaction),
    typeof transaction.to === "function" ? transaction.to() : transaction.to,
    typeof transaction.value === "function" ? transaction.value() : transaction.value,
  ]);
  check();
  if (!to) throw new Error("The contract transaction target is missing");
  return { account: sender, transaction: await prepare(await encode(prepareContractCall({ contract: smart,
    method: "function execute(address, uint256, bytes)", params: [to, value ?? 0n, data] }))) };
}

export async function approveTempoSession(input: TempoAccountInput & { asset: string; spender: string; amount: bigint }): Promise<void> {
  const { smart, check, send, deployed } = await prepareTempoAccount(input);
  const token = getContract({ client: thirdwebClient, chain: input.chain, address: input.asset });
  const approved = deployed ? await allowance({ contract: token, owner: input.accountAddress, spender: input.spender }) : 0n;
  check();
  if (approved < input.amount) {
    const data = await encode(approve({ contract: token, spender: input.spender, amountWei: input.amount }));
    check();
    await send(prepareContractCall({ contract: smart, method: "function execute(address, uint256, bytes)", params: [input.asset, 0n, data] }));
    if (await allowance({ contract: token, owner: input.accountAddress, spender: input.spender }) < input.amount) throw new Error("Tempo session spending approval was not applied onchain");
  }
  check();
}

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
  const { credits, creditsEnabled, creditsLoading, creditsError } = useSession();
  const [buyCredits, setBuyCredits] = useState(false);
  const [checkoutIntent, setCheckoutIntent] = useState<CheckoutIntent>({ kind: 'balance' });
  const [checkoutVersion, setCheckoutVersion] = useState(0);
  useEffect(() => {
    const open = (event: Event) => {
      setCheckoutIntent((event as CustomEvent<CheckoutIntent>).detail);
      setCheckoutVersion(value => value + 1);
      setBuyCredits(true);
    };
    window.addEventListener('rawchunks:card-checkout', open);
    return () => window.removeEventListener('rawchunks:card-checkout', open);
  }, []);
  const account = useActiveAccount();
  const wallet = useActiveWallet();
  const { connect: openConnectModal, isConnecting: isModalConnecting } = useConnectModal();
  const { paymentNetwork, getChainByNetworkId, chains, defaultNetwork } = useChain();
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
  const [cachedAccount, setCachedAccount] = useState(() => readCachedAccount());
  const { hasConsented, isLoading: isConsentLoading } = useDisclaimerConsent();

  useEffect(() => {
    if (account?.address) {
      writeCachedAccount(account.address, paymentNetwork, svmAddress, nickname, avatar);
      setCachedAccount(readCachedAccount());
    }
  }, [account?.address, paymentNetwork, svmAddress, nickname, avatar]);

  useEffect(() => {
    if (account?.address && !isConsentLoading) {
      setShowDisclaimer(!hasConsented);
    } else {
      setShowDisclaimer(false);
    }
  }, [account?.address, isConsentLoading, hasConsented]);

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
  const isReconnecting = (reconnecting || Boolean(autoConnect?.isLoading)) && cachedAccount != null;

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
        onClick={() => {
          void openConnectModal({
            client: thirdwebClient,
            wallets,
            chain: connectChain,
            accountAbstraction,
            size: compact ? "compact" : "wide",
            title: "RAWCHUNKS",
            titleIcon: "/branding/icon.svg",
            showThirdwebBranding: false,
            theme: thirdwebCustomTheme,
          }).catch(() => {});
        }}
        className={cn("btn btn-solid connect", className)}
      >
        <Wallet className="icon" aria-hidden="true" />
        <span className="connect-address">CONNECT</span>
      </button>
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
    setCachedAccount(null);
    wallet?.disconnect();
  };

  return (
    <>
      <Modal isOpen={buyCredits} onClose={() => setBuyCredits(false)} title="BUY WITH CARD" size="md" keepMounted={Boolean(account && creditsEnabled)}>
        <CardCheckout intent={checkoutIntent} version={checkoutVersion} onComplete={() => setBuyCredits(false)} onCancel={() => setBuyCredits(false)} />
      </Modal>
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
        <Tooltip
          title={displayName}
          description={`${chainInfo?.name || "Unknown network"} • ${balanceLoading ? "..." : `$${totalBalance}`}`}
          position="bottom"
        >
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
        </Tooltip>

        <DropdownMenuContent align="end">
          <div className="menu-head">
            <span className="label">CREDITS</span>
            <span className="menu-total">{creditsLoading ? '...' : creditLabel(credits.availableAtomics)}</span>
          </div>
          {creditsEnabled && !creditsError && <DropdownMenuItem onClick={() => { setCheckoutIntent({ kind: 'balance' }); setCheckoutVersion(value => value + 1); setBuyCredits(true); }}>BUY WITH CARD</DropdownMenuItem>}
          {creditsError && <div className="menu-head" role="alert">{creditsError}</div>}
          <div className="menu-head">
            <span className="menu-chain">
              <NetworkGlyph network={paymentNetwork} name={chainInfo?.name || "Unknown network"} />
              <b>{chainInfo?.name || "Unknown network"}</b>
            </span>
            <span className="menu-total">
              {balanceLoading ? "..." : `$${totalBalance}`}
            </span>
          </div>

          <div className="menu-head">
            <span className="label">{accountLabel}</span>
            <div className="menu-row">
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

function formatPayPalError(error: unknown, fallback = 'Card payment failed'): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return fallback;
}

const PAYPAL_STYLE_VARS: Record<string, Record<string, string>> = {
  body: {
    padding: '--paypal-card-body-padding',
    background: '--paypal-card-bg',
  },
  input: {
    background: '--paypal-card-bg',
    color: '--paypal-card-color',
    border: '--paypal-card-border',
    'border-radius': '--paypal-card-radius',
    'box-shadow': '--paypal-card-shadow-none',
    outline: '--paypal-card-outline-none',
    'font-family': '--paypal-card-font-family',
    'font-size': '--paypal-card-font-size',
    'font-weight': '--paypal-card-font-weight',
    'line-height': '--paypal-card-line-height',
    'letter-spacing': '--paypal-card-letter-spacing',
    padding: '--paypal-card-padding',
    height: '--paypal-card-height',
    transition: '--paypal-card-transition',
  },
  'input.card-field-number.display-icon': {
    'padding-left': '--paypal-card-icon-padding-left',
  },
  '::placeholder': {
    color: '--paypal-card-placeholder-color',
    opacity: '--paypal-card-placeholder-opacity',
  },
  ':hover': {
    border: '--paypal-card-border-hover',
  },
  ':focus': {
    background: '--paypal-card-bg',
    color: '--paypal-card-color',
    border: '--paypal-card-border-focus',
    'box-shadow': '--paypal-card-shadow-focus',
    outline: '--paypal-card-outline-none',
  },
  '.valid': {
    color: '--paypal-card-color',
  },
  '.invalid': {
    color: '--paypal-card-color-invalid',
    border: '--paypal-card-border-invalid',
    'box-shadow': '--paypal-card-shadow-none',
  },
  ':focus.invalid': {
    color: '--paypal-card-color',
    border: '--paypal-card-border-invalid',
    'box-shadow': '--paypal-card-shadow-invalid',
    outline: '--paypal-card-outline-none',
  },
};

function readPayPalCardStyle(element: HTMLElement): Record<string, Record<string, string>> {
  const computed = window.getComputedStyle(element);
  const style: Record<string, Record<string, string>> = {};
  for (const [selector, rules] of Object.entries(PAYPAL_STYLE_VARS)) {
    const resolved: Record<string, string> = {};
    for (const [prop, variable] of Object.entries(rules)) {
      const value = computed.getPropertyValue(variable).trim();
      if (value) resolved[prop] = value;
    }
    if (Object.keys(resolved).length > 0) style[selector] = resolved;
  }
  return style;
}

export interface PayPalCardFieldsProps {
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID: string; liabilityShift?: string }) => Promise<void> | void;
  onError: (message: string | null) => void;
  onCancel: () => void;
  cancelLabel?: string;
  submitLabel: string;
  submitVariant?: 'primary' | 'accent';
  disabled?: boolean;
  error?: string | null;
  notice?: string;
  showBrand?: boolean;
}

export function PayPalCardFields({
  createOrder,
  onApprove,
  onError,
  onCancel,
  cancelLabel = 'CANCEL',
  submitLabel,
  submitVariant = 'primary',
  disabled = false,
  error = null,
  notice = '1 Credit = $0.01 USD. Encrypted card checkout settles directly to your account.',
  showBrand = true,
}: PayPalCardFieldsProps) {
  const [{ isPending, isResolved, isRejected }] = usePayPalScriptReducer();
  const formRef = useRef<HTMLDivElement | null>(null);
  const nameSlotRef = useRef<HTMLDivElement | null>(null);
  const numberSlotRef = useRef<HTMLDivElement | null>(null);
  const expirySlotRef = useRef<HTMLDivElement | null>(null);
  const cvvSlotRef = useRef<HTMLDivElement | null>(null);
  const cardFieldsRef = useRef< NonNullable<NonNullable<Window['paypal']>['CardFields']> extends (...args: any[]) => infer R ? R | null : null >(null);
  const [fieldsReady, setFieldsReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const callbacksRef = useRef({ createOrder, onApprove, onError });
  callbacksRef.current = { createOrder, onApprove, onError };

  useEffect(() => {
    if (!isResolved) {
      setFieldsReady(false);
      return;
    }
    const formEl = formRef.current;
    const nameSlot = nameSlotRef.current;
    const numberSlot = numberSlotRef.current;
    const expirySlot = expirySlotRef.current;
    const cvvSlot = cvvSlotRef.current;
    if (!formEl || !nameSlot || !numberSlot || !expirySlot || !cvvSlot) return;

    let cancelled = false;
    let pollTimer: number | undefined;
    const renderedFields: Array<{ close: () => Promise<void> }> = [];

    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const cardFieldsFactory = window.paypal?.CardFields;
      if (!cardFieldsFactory) {
        callbacksRef.current.onError('PayPal card checkout could not load.');
        return;
      }
      try {
        const instance = cardFieldsFactory({
          style: readPayPalCardStyle(formEl),
          inputEvents: {
            onChange: () => {
              callbacksRef.current.onError(null);
            },
          },
          createOrder: () => callbacksRef.current.createOrder(),
          onApprove: async (data) => {
            try {
              await callbacksRef.current.onApprove(data);
            } catch (cause) {
              callbacksRef.current.onError(formatPayPalError(cause));
            }
          },
          onError: (cause) => {
            callbacksRef.current.onError(formatPayPalError(cause));
          },
        });

        if (!instance.isEligible()) {
          callbacksRef.current.onError('Card fields are not eligible for this merchant configuration.');
          return;
        }

        cardFieldsRef.current = instance;

        const nameHost = document.createElement('div');
        const numberHost = document.createElement('div');
        const expiryHost = document.createElement('div');
        const cvvHost = document.createElement('div');

        nameSlot.replaceChildren(nameHost);
        numberSlot.replaceChildren(numberHost);
        expirySlot.replaceChildren(expiryHost);
        cvvSlot.replaceChildren(cvvHost);

        const fieldStyleOptions = { disablePrerender: true };
        const nameField = instance.NameField({
          placeholder: 'CARDHOLDER NAME',
          styleOptions: fieldStyleOptions,
        } as Parameters<typeof instance.NameField>[0]);
        const numberField = instance.NumberField({
          placeholder: '0000 0000 0000 0000',
          styleOptions: fieldStyleOptions,
        } as Parameters<typeof instance.NumberField>[0]);
        const expiryField = instance.ExpiryField({
          placeholder: 'MM / YY',
          styleOptions: fieldStyleOptions,
        } as Parameters<typeof instance.ExpiryField>[0]);
        const cvvField = instance.CVVField({
          placeholder: 'CVV',
          styleOptions: fieldStyleOptions,
        } as Parameters<typeof instance.CVVField>[0]);

        renderedFields.push(nameField, numberField, expiryField, cvvField);

        const waitForMountedInputs = async () => {
          if (typeof instance.getState !== 'function') {
            if (!cancelled) setFieldsReady(true);
            return;
          }
          const deadline = Date.now() + 4_000;
          const check = async () => {
            if (cancelled) return;
            const state = await instance.getState().catch(() => null);
            if (cancelled) return;
            const mounted = state != null && (
              !('fields' in state) ||
              Object.keys((state as { fields?: Record<string, unknown> }).fields ?? {}).length >= 4
            );
            if (mounted || Date.now() >= deadline) {
              setFieldsReady(true);
              return;
            }
            pollTimer = window.setTimeout(() => void check(), 40);
          };
          await check();
        };

        void Promise.all([
          nameField.render(nameHost),
          numberField.render(numberHost),
          expiryField.render(expiryHost),
          cvvField.render(cvvHost),
        ])
          .then(() => waitForMountedInputs())
          .catch((cause) => {
            if (!cancelled) callbacksRef.current.onError(formatPayPalError(cause, 'Failed to initialize card fields'));
          });
      } catch (cause) {
        if (!cancelled) callbacksRef.current.onError(formatPayPalError(cause, 'Failed to initialize card checkout'));
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
      cardFieldsRef.current = null;
      setFieldsReady(false);
      for (const field of renderedFields) {
        void field.close().catch(() => {});
      }
      nameSlot.replaceChildren();
      numberSlot.replaceChildren();
      expirySlot.replaceChildren();
      cvvSlot.replaceChildren();
    };
  }, [isResolved]);

  const handleSubmit = async () => {
    const form = cardFieldsRef.current;
    if (!form || submitting || disabled) return;
    callbacksRef.current.onError(null);
    setSubmitting(true);
    try {
      const state = await form.getState().catch(() => null);
      if (state && !state.isFormValid) {
        callbacksRef.current.onError('Enter a valid card number, expiration date, and security code.');
        return;
      }
      await form.submit();
    } catch (cause) {
      callbacksRef.current.onError(formatPayPalError(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="connector-card-form" ref={formRef} data-ready={fieldsReady || undefined}>
        <div className="connector-card-field-group">
          <span className="connector-card-field-label">CARDHOLDER NAME</span>
          <div className="connector-card-field-slot" data-placeholder="CARDHOLDER NAME" ref={nameSlotRef} />
        </div>
        <div className="connector-card-field-group">
          <span className="connector-card-field-label">CARD NUMBER</span>
          <div className="connector-card-field-slot" data-placeholder="0000 0000 0000 0000" ref={numberSlotRef} />
        </div>
        <div className="connector-card-field-row">
          <div className="connector-card-field-group">
            <span className="connector-card-field-label">EXPIRATION</span>
            <div className="connector-card-field-slot" data-placeholder="MM / YY" ref={expirySlotRef} />
          </div>
          <div className="connector-card-field-group">
            <span className="connector-card-field-label">SECURITY CODE (CVV)</span>
            <div className="connector-card-field-slot" data-placeholder="CVV" ref={cvvSlotRef} />
          </div>
        </div>
        {(isPending || (!fieldsReady && !isRejected && !error)) && (
          <div className="connector-card-status" role="status">
            INITIALIZING SECURE CARD TERMINAL...
          </div>
        )}
      </div>
      {notice && (
        <div className="session-notice-strip">
          <ShieldCheck className="session-notice-icon" size={14} />
          <span>{notice}</span>
        </div>
      )}
      {isRejected && (
        <div className="session-error-strip" role="alert">
          PayPal card checkout could not load.
        </div>
      )}
      {error && (
        <div className="session-error-strip" role="alert">
          {error}
        </div>
      )}
      <div className="session-actions-footer">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting || disabled}>
          {cancelLabel}
        </Button>
        <Button
          variant={submitVariant}
          size="sm"
          disabled={!fieldsReady || submitting || disabled}
          onClick={() => void handleSubmit()}
        >
          {submitting ? 'PROCESSING...' : submitLabel}
        </Button>
      </div>
      {showBrand && (
        <div className="connector-paypal-brand">
          <span>Powered by</span>
          <img src="https://www.paypalobjects.com/digitalassets/c/website/logo/full-text/pp_fc_hl.svg" alt="PayPal" />
        </div>
      )}
    </>
  );
}

export function CardCheckout({ intent, version = 0, onComplete, onCancel }: { intent: CheckoutIntent; version?: number; onComplete: () => void; onCancel: () => void }) {
  const { credits, creditsLoading, creditOwner, completeCreditPurchase } = useSession();
  const packs = credits.packs.length > 0 ? credits.packs : DEFAULT_CREDIT_PACKS;
  const [packId, setPackId] = useState(packs[0]?.id ?? 'usd-10');
  const pack = packs.find(value => value.id === packId) ?? packs[0];
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<{ operationId: string; orderId: string } | null>(null);
  const requestKey = useRef(crypto.randomUUID());
  const orderParamsRef = useRef({ packId: pack?.id ?? 'usd-10', intent, creditOwner });
  orderParamsRef.current = { packId: pack?.id ?? 'usd-10', intent, creditOwner };

  useEffect(() => {
    operation.current = null;
    requestKey.current = crypto.randomUUID();
    setError(null);
  }, [version]);

  return (
    <div className="session-modal-content">
      <div className="session-info-strip">
        <CreditCard className="session-info-icon" size={18} />
        <div className="session-info-text">
          <span className="session-info-title">INSTANT CREDIT TOP-UP</span>
          <span className="session-info-desc">
            Prepaid Credits fund AI studio generation, stem separation, and track streaming across any network without wallet popups.
          </span>
        </div>
      </div>
      <div className="session-balance-strip">
        <span className="session-balance-chain">AVAILABLE CREDITS</span>
        <span className="session-balance-val">
          {creditsLoading ? 'CHECKING...' : creditLabel(credits.availableAtomics)}
        </span>
      </div>
      <div className="session-section">
        <div className="session-section-head">
          <span className="session-section-label">SELECT CREDIT PACK</span>
          {pack && <span className="session-section-val">${Number(pack.usd)} USD • {creditLabel(pack.amountAtomics)}</span>}
        </div>
        <div className="session-pills-row">
          {packs.map(value => (
            <button
              type="button"
              key={value.id}
              className={cn('session-pill-btn', pack?.id === value.id && 'active')}
              disabled={Boolean(operation.current)}
              onClick={() => {
                if (pack?.id === value.id) return;
                setPackId(value.id);
                operation.current = null;
                requestKey.current = crypto.randomUUID();
                setError(null);
              }}
            >
              {creditLabel(value.amountAtomics)}
            </button>
          ))}
        </div>
      </div>
      {pack && creditOwner ? (
        <PayPalCardFields
          createOrder={async () => {
            setError(null);
            const current = orderParamsRef.current;
            if (!current.creditOwner) throw new Error('Connect your account first');
            const result = await creditsApi<{ operationId: string; orderId: string }>(
              'paypal/create-order',
              { packId: current.packId, checkout: current.intent },
              requestKey.current,
            );
            operation.current = result;
            localStorage.setItem(purchaseCacheKey(current.creditOwner), result.operationId);
            return result.orderId;
          }}
          onApprove={async data => {
            if (!operation.current || data.orderID !== operation.current.orderId) {
              throw new Error('Checkout order mismatch');
            }
            await creditsApi('paypal/capture-order', operation.current);
            await completeCreditPurchase(operation.current.operationId);
            onComplete();
          }}
          onError={setError}
          onCancel={onCancel}
          submitLabel={`PAY $${Number(pack.usd)}`}
          error={error}
        />
      ) : (
        <>
          {error ? (
            <div className="session-error-strip" role="alert">{error}</div>
          ) : (
            <div className="connector-card-status" role="status">CONNECT WALLET TO PURCHASE CREDITS...</div>
          )}
          <div className="session-actions-footer">
            <Button variant="ghost" size="sm" onClick={onCancel}>CANCEL</Button>
          </div>
        </>
      )}
    </div>
  );
}

