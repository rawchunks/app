import {
  address as solanaAddress,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
  type SignatureBytes,
} from "@solana/kit";
import type { Account, Wallet } from "thirdweb/wallets";
import type { Chain } from "thirdweb/chains";

export type SolanaWalletId = "app.phantom" | "com.solflare" | "app.backpack";

export interface SolanaBrowserAccount extends Account {
  readonly isSolanaBrowserAccount: true;
  signSolanaTransaction: (wireTransactionBytes: Uint8Array) => Promise<Uint8Array>;
}

export function isSolanaBrowserAccount(account: unknown): account is SolanaBrowserAccount {
  return Boolean(
    account &&
    typeof account === "object" &&
    (account as { isSolanaBrowserAccount?: unknown }).isSolanaBrowserAccount === true &&
    typeof (account as { signSolanaTransaction?: unknown }).signSolanaTransaction === "function",
  );
}

interface SolanaPublicKeyLike {
  toBase58?: () => string;
  toString: () => string;
  toBytes?: () => Uint8Array;
}

interface InjectedSolanaProvider {
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBackpack?: boolean;
  isConnected?: boolean;
  publicKey?: SolanaPublicKeyLike | null;
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: SolanaPublicKeyLike } | void>;
  disconnect?: () => Promise<void> | void;
  signMessage?: (message: Uint8Array, display?: "utf8" | "hex") => Promise<{ signature: Uint8Array } | Uint8Array>;
  signTransaction?: (transaction: any) => Promise<any>;
  on?: (event: string, listener: (...args: any[]) => void) => void;
  off?: (event: string, listener: (...args: any[]) => void) => void;
  removeListener?: (event: string, listener: (...args: any[]) => void) => void;
}

interface WalletStandardAccount {
  address: string;
  publicKey: Uint8Array;
  chains?: readonly string[];
  features?: readonly string[];
}

interface WalletStandardWallet {
  name: string;
  icon?: string;
  accounts: readonly WalletStandardAccount[];
  features: {
    "standard:connect"?: {
      connect: (input?: { silent?: boolean }) => Promise<{ accounts: readonly WalletStandardAccount[] }>;
    };
    "standard:disconnect"?: {
      disconnect: () => Promise<void>;
    };
    "standard:events"?: {
      on: (
        event: "change",
        listener: (properties: { accounts?: readonly WalletStandardAccount[] }) => void,
      ) => () => void;
    };
    "solana:signMessage"?: {
      signMessage: (
        ...inputs: { account: WalletStandardAccount; message: Uint8Array }[]
      ) => Promise<readonly { signedMessage: Uint8Array; signature: Uint8Array }[]>;
    };
    "solana:signTransaction"?: {
      signTransaction: (
        ...inputs: { account: WalletStandardAccount; transaction: Uint8Array; chain?: string }[]
      ) => Promise<readonly { signedTransaction: Uint8Array }[]>;
    };
  };
}

const WALLET_META: Record<SolanaWalletId, { name: string; standardName: string; icon: string }> = {
  "app.phantom": {
    name: "Phantom",
    standardName: "phantom",
    icon: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%23AB9FF2'/></svg>",
  },
  "com.solflare": {
    name: "Solflare",
    standardName: "solflare",
    icon: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%23FC7227'/></svg>",
  },
  "app.backpack": {
    name: "Backpack",
    standardName: "backpack",
    icon: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%23E33E3F'/></svg>",
  },
};

const standardWallets = new Set<WalletStandardWallet>();
let standardInitialized = false;
const announcedRdns = new Set<string>();

function initWalletStandardDiscovery(): void {
  if (standardInitialized || typeof window === "undefined") return;
  standardInitialized = true;

  const register = (wallet: WalletStandardWallet) => {
    if (wallet && typeof wallet.name === "string" && wallet.features) {
      standardWallets.add(wallet);
      announceInstalledSolanaWallets();
    }
  };

  window.addEventListener("wallet-standard:register-wallet" as any, (event: CustomEvent) => {
    try {
      if (typeof event.detail === "function") {
        event.detail({ register });
      }
    } catch {
      // Ignore malformed standard events
    }
  });

  try {
    window.dispatchEvent(
      new CustomEvent("wallet-standard:app-ready", {
        detail: { register },
      }),
    );
  } catch {
    // Ignore in environments without CustomEvent
  }
}

function getStandardWallet(id: SolanaWalletId): WalletStandardWallet | undefined {
  initWalletStandardDiscovery();
  const target = WALLET_META[id].standardName;
  for (const wallet of standardWallets) {
    if (wallet.name.toLowerCase().includes(target)) {
      return wallet;
    }
  }
  return undefined;
}

export function getInjectedSolanaProvider(id: SolanaWalletId): InjectedSolanaProvider | undefined {
  if (typeof window === "undefined") return undefined;
  const win = window as unknown as {
    phantom?: { solana?: InjectedSolanaProvider };
    solflare?: InjectedSolanaProvider;
    backpack?: { solana?: InjectedSolanaProvider } & InjectedSolanaProvider;
    solana?: InjectedSolanaProvider;
  };

  if (id === "app.phantom") {
    if (win.phantom?.solana) return win.phantom.solana;
    if (win.solana?.isPhantom) return win.solana;
    return undefined;
  }
  if (id === "com.solflare") {
    if (win.solflare) return win.solflare;
    if (win.solana?.isSolflare) return win.solana;
    return undefined;
  }
  if (id === "app.backpack") {
    if (win.backpack?.solana) return win.backpack.solana;
    if (win.backpack && typeof win.backpack.connect === "function") return win.backpack;
    if (win.solana?.isBackpack) return win.solana;
    return undefined;
  }
  return undefined;
}

export function isSolanaWalletInstalled(id: SolanaWalletId): boolean {
  return Boolean(getInjectedSolanaProvider(id) || getStandardWallet(id));
}

export function announceInstalledSolanaWallets(): void {
  if (typeof window === "undefined") return;
  initWalletStandardDiscovery();

  const announce = (id: SolanaWalletId) => {
    if (!isSolanaWalletInstalled(id)) return;
    const meta = WALLET_META[id];
    const detail = {
      info: {
        uuid: `solana-${id}`,
        name: meta.name,
        icon: meta.icon,
        rdns: id,
      },
      provider: {},
    };
    try {
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
    } catch {
      // Ignore if CustomEvent dispatch fails
    }
    if (!announcedRdns.has(id)) {
      announcedRdns.add(id);
    }
  };

  for (const id of Object.keys(WALLET_META) as SolanaWalletId[]) {
    announce(id);
  }
}

if (typeof window !== "undefined") {
  announceInstalledSolanaWallets();
  window.addEventListener("eip6963:requestProvider", () => {
    announceInstalledSolanaWallets();
  });
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  let hex = "0x";
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex as `0x${string}`;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function toMessageBytes(message: string | { raw: string | Uint8Array }): Uint8Array {
  if (typeof message === "string") {
    return new TextEncoder().encode(message);
  }
  if (message.raw instanceof Uint8Array) {
    return message.raw;
  }
  if (typeof message.raw === "string") {
    return message.raw.startsWith("0x")
      ? hexToBytes(message.raw)
      : new TextEncoder().encode(message.raw);
  }
  throw new Error("Unsupported Solana signMessage payload");
}

function normalizePubkeyString(pk: SolanaPublicKeyLike | string | null | undefined): string | null {
  if (!pk) return null;
  if (typeof pk === "string") return pk.trim() || null;
  if (typeof pk.toBase58 === "function") return pk.toBase58();
  if (typeof pk.toString === "function") {
    const str = pk.toString();
    return str && str !== "[object Object]" ? str : null;
  }
  return null;
}

function createVersionedTransactionShim(wireTransactionBytes: Uint8Array) {
  const txDecoder = getTransactionDecoder();
  const txEncoder = getTransactionEncoder();
  const msgDecoder = getCompiledTransactionMessageDecoder();
  const decoded = txDecoder.decode(wireTransactionBytes);
  const compiledMsg = msgDecoder.decode(decoded.messageBytes);
  const signerAddresses = Object.keys(decoded.signatures);
  const mutableSignatures: Record<string, SignatureBytes | null> = { ...decoded.signatures };

  const shim = {
    version: "version" in compiledMsg ? compiledMsg.version : 0,
    get signatures(): Uint8Array[] {
      return signerAddresses.map((addr) => {
        const sig = mutableSignatures[addr];
        return sig ? new Uint8Array(sig) : new Uint8Array(64);
      });
    },
    message: {
      header: compiledMsg.header,
      staticAccountKeys: compiledMsg.staticAccounts.map((addr) => ({
        toBase58: () => String(addr),
        toString: () => String(addr),
        equals: (other: unknown) => normalizePubkeyString(other as any) === String(addr),
      })),
      compiledInstructions: "instructions" in compiledMsg ? compiledMsg.instructions : [],
      addressTableLookups: "addressTableLookups" in compiledMsg ? compiledMsg.addressTableLookups : [],
      serialize: () => new Uint8Array(decoded.messageBytes),
    },
    serialize(): Uint8Array {
      return new Uint8Array(
        txEncoder.encode({
          messageBytes: decoded.messageBytes,
          signatures: mutableSignatures as typeof decoded.signatures,
        }),
      );
    },
    addSignature(publicKey: SolanaPublicKeyLike | string, signature: Uint8Array): void {
      const addr = normalizePubkeyString(publicKey);
      if (!addr) return;
      if (signature.byteLength !== 64) {
        throw new Error(`Invalid Ed25519 signature length: ${signature.byteLength}`);
      }
      mutableSignatures[solanaAddress(addr)] = signature as SignatureBytes;
    },
  };

  return shim;
}

export function createSolanaBrowserWallet(id: SolanaWalletId): Wallet {
  type EventMap = {
    accountChanged: (account: Account) => void;
    chainChanged: (chain: Chain) => void;
    disconnect: () => void;
    onConnect: (account: Account) => void;
  };
  const listeners = new Map<keyof EventMap, Set<(...args: any[]) => void>>();
  let currentAccount: SolanaBrowserAccount | undefined;
  let currentChain: Chain | undefined;
  let cleanupProviderListeners: (() => void) | undefined;

  const emit = <K extends keyof EventMap>(event: K, ...args: Parameters<EventMap[K]>) => {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(...args);
      } catch {
        // Ignore subscriber errors
      }
    }
  };

  const buildAccount = (
    base58Address: string,
    provider?: InjectedSolanaProvider,
    standardWallet?: WalletStandardWallet,
    standardAccount?: WalletStandardAccount,
  ): SolanaBrowserAccount => {
    return {
      address: base58Address,
      isSolanaBrowserAccount: true,
      sendTransaction: async () => {
        throw new Error("Use Solana relay or signSolanaTransaction for Solana accounts");
      },
      signMessage: async ({ message }) => {
        const messageBytes = toMessageBytes(message as string | { raw: string | Uint8Array });
        if (provider && typeof provider.signMessage === "function") {
          const signed = await provider.signMessage(messageBytes, "utf8");
          const sigBytes = signed instanceof Uint8Array ? signed : signed?.signature;
          if (!sigBytes || !(sigBytes instanceof Uint8Array)) {
            throw new Error("Solana wallet did not return a valid message signature");
          }
          return bytesToHex(sigBytes);
        }
        const stdSignMessage = standardWallet?.features["solana:signMessage"];
        const acct =
          standardAccount ??
          standardWallet?.accounts.find((a) => a.address === base58Address) ??
          standardWallet?.accounts[0];
        if (stdSignMessage && acct) {
          const [res] = await stdSignMessage.signMessage({ account: acct, message: messageBytes });
          if (!res?.signature) {
            throw new Error("Solana wallet did not return a valid message signature");
          }
          return bytesToHex(new Uint8Array(res.signature));
        }
        throw new Error(`${WALLET_META[id].name} does not support Solana message signing`);
      },
      signTypedData: async () => {
        throw new Error("EIP-712 signTypedData is not supported on Solana wallets");
      },
      signSolanaTransaction: async (wireTransactionBytes: Uint8Array) => {
        const stdSignTx = standardWallet?.features["solana:signTransaction"];
        const acct =
          standardAccount ??
          standardWallet?.accounts.find((a) => a.address === base58Address) ??
          standardWallet?.accounts[0];
        if (stdSignTx && acct) {
          const [res] = await stdSignTx.signTransaction({
            account: acct,
            transaction: new Uint8Array(wireTransactionBytes),
          });
          if (res?.signedTransaction) {
            return new Uint8Array(res.signedTransaction);
          }
        }
        if (provider && typeof provider.signTransaction === "function") {
          const shim = createVersionedTransactionShim(wireTransactionBytes);
          const result = await provider.signTransaction(shim);
          if (result instanceof Uint8Array) {
            return result;
          }
          if (result?.signedTransaction instanceof Uint8Array) {
            return result.signedTransaction;
          }
          if (result && typeof result.serialize === "function") {
            const serialized = result.serialize({ requireAllSignatures: false, verifySignatures: false });
            if (serialized instanceof Uint8Array) {
              return serialized;
            }
          }
          return shim.serialize();
        }
        throw new Error(`${WALLET_META[id].name} does not support Solana transaction signing`);
      },
    };
  };

  const attachProviderListeners = (
    provider?: InjectedSolanaProvider,
    standardWallet?: WalletStandardWallet,
  ) => {
    cleanupProviderListeners?.();
    const cleanups: Array<() => void> = [];

    if (provider && typeof provider.on === "function") {
      const onAccountChanged = (nextPk: SolanaPublicKeyLike | null | undefined) => {
        const nextAddr = normalizePubkeyString(nextPk ?? provider.publicKey);
        if (!nextAddr) {
          currentAccount = undefined;
          emit("disconnect");
          return;
        }
        currentAccount = buildAccount(nextAddr, provider, standardWallet);
        emit("accountChanged", currentAccount);
      };
      const onDisconnect = () => {
        currentAccount = undefined;
        emit("disconnect");
      };
      provider.on("accountChanged", onAccountChanged);
      provider.on("disconnect", onDisconnect);
      cleanups.push(() => {
        provider.off?.("accountChanged", onAccountChanged);
        provider.removeListener?.("accountChanged", onAccountChanged);
        provider.off?.("disconnect", onDisconnect);
        provider.removeListener?.("disconnect", onDisconnect);
      });
    }

    const stdEvents = standardWallet?.features["standard:events"];
    if (stdEvents) {
      const off = stdEvents.on("change", ({ accounts }) => {
        if (!accounts) return;
        const first = accounts[0];
        if (!first?.address) {
          currentAccount = undefined;
          emit("disconnect");
          return;
        }
        currentAccount = buildAccount(first.address, provider, standardWallet, first);
        emit("accountChanged", currentAccount);
      });
      cleanups.push(off);
    }

    cleanupProviderListeners = () => {
      for (const fn of cleanups) {
        try {
          fn();
        } catch {
          // Ignore cleanup errors
        }
      }
    };
  };

  const connectInternal = async (silent: boolean, chain?: Chain): Promise<Account> => {
    announceInstalledSolanaWallets();
    if (chain) currentChain = chain;

    const provider = getInjectedSolanaProvider(id);
    const standardWallet = getStandardWallet(id);

    if (provider) {
      if (silent && provider.isConnected && provider.publicKey) {
        const existingAddr = normalizePubkeyString(provider.publicKey);
        if (existingAddr) {
          currentAccount = buildAccount(existingAddr, provider, standardWallet);
          attachProviderListeners(provider, standardWallet);
          emit("onConnect", currentAccount);
          return currentAccount;
        }
      }
      const response = await provider.connect(silent ? { onlyIfTrusted: true } : undefined);
      const connectedAddress = normalizePubkeyString(response?.publicKey ?? provider.publicKey);
      if (!connectedAddress) {
        throw new Error(`Failed to connect ${WALLET_META[id].name} Solana account`);
      }
      currentAccount = buildAccount(connectedAddress, provider, standardWallet);
      attachProviderListeners(provider, standardWallet);
      emit("onConnect", currentAccount);
      return currentAccount;
    }

    const stdConnect = standardWallet?.features["standard:connect"];
    if (standardWallet && stdConnect) {
      const { accounts } = await stdConnect.connect(silent ? { silent: true } : undefined);
      const first = accounts?.[0] ?? standardWallet.accounts?.[0];
      if (!first?.address) {
        throw new Error(`Failed to connect ${WALLET_META[id].name} Solana account`);
      }
      currentAccount = buildAccount(first.address, undefined, standardWallet, first);
      attachProviderListeners(undefined, standardWallet);
      emit("onConnect", currentAccount);
      return currentAccount;
    }

    throw new Error(`${WALLET_META[id].name} Solana extension is not installed`);
  };

  const wallet: Wallet = {
    id: id as Wallet["id"],
    getConfig: () => undefined as any,
    getChain: () => currentChain,
    getAccount: () => currentAccount,
    autoConnect: async (options) => connectInternal(true, options?.chain),
    connect: async (options) => connectInternal(false, options?.chain),
    disconnect: async () => {
      cleanupProviderListeners?.();
      cleanupProviderListeners = undefined;
      currentAccount = undefined;
      const provider = getInjectedSolanaProvider(id);
      const standardWallet = getStandardWallet(id);
      try {
        await provider?.disconnect?.();
      } catch {
        // Ignore provider disconnect errors
      }
      try {
        await standardWallet?.features["standard:disconnect"]?.disconnect();
      } catch {
        // Ignore standard disconnect errors
      }
      emit("disconnect");
    },
    switchChain: async (chain: Chain) => {
      currentChain = chain;
      emit("chainChanged", chain);
    },
    subscribe: (event, listener) => {
      const key = event as keyof EventMap;
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(listener as any);
      return () => {
        set?.delete(listener as any);
      };
    },
  };

  return wallet;
}
