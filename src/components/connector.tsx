import { useEffect, useMemo, useState } from "react";
import { ConnectButton, useActiveAccount, useActiveWallet, useAutoConnect } from "thirdweb/react";
import { createWallet, inAppWallet } from "thirdweb/wallets";
import type { SmartWalletOptions, Account, Wallet as ThirdwebWallet } from "thirdweb/wallets";
import { getContract, readContract, prepareContractCall, prepareTransaction, encode, sendAndConfirmTransaction, type Chain, type PreparedTransaction } from "thirdweb";
import { allowance, approve } from "thirdweb/extensions/erc20";
import { createPublicClient, createWalletClient, encodeFunctionData, hexToBytes, http, parseEventLogs, type Transport } from "viem";
import { entryPoint06Abi, getUserOperationHash } from "viem/account-abstraction";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { tempoModerato } from "viem/chains";
import { withRelay } from "viem/tempo";
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
import { DisclaimerModal } from "@/components/disclaimer";
import { useDisclaimerConsent } from "@/hooks/use-disclaimer";
import { thirdwebCustomTheme } from "@/lib/connector";

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
  const account = useActiveAccount();
  const wallet = useActiveWallet();
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
      <ConnectButton
        client={thirdwebClient}
        wallets={wallets}
        chain={connectChain}
        accountAbstraction={accountAbstraction}
        autoConnect={false}
        connectButton={{
          label: (
            <>
              <Wallet className="icon" aria-hidden="true" />
              <span className="connect-address">CONNECT</span>
            </>
          ),
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
    setCachedAccount(null);
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
              {balanceLoading ? "..." : `$${totalBalance}`}
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
