import { createThirdwebClient, defineChain, getContract } from "thirdweb";
import type { Chain } from "thirdweb";
import type { SmartWalletOptions } from "thirdweb/wallets";
import type { EvmNetworkId, FacilitatorChain, NetworkId } from "@compose-market/sdk/chains";

export { CONTRACT_ADDRESSES, getContractAddress, getContractAddressForChain } from "./performance/chains-data";
export { formatUsdcPrice, weiToUsdc, usdcToWei } from "./performance/chains-data";
export { SOLANA_PROGRAM_IDS, getSolanaProgramId } from "./performance/chains-data";
export type { ContractName, SolanaProgramName } from "./performance/chains-data";

const env = import.meta.env ?? {};

export type NetworkMode = "testnet" | "mainnet";

export const TESTNET_NETWORKS: readonly NetworkId[] = [
  "eip155:84532",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  "eip155:42431",
];

export const MAINNET_NETWORKS: readonly NetworkId[] = [
  "eip155:8453",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
];

export function getNetworkMode(): NetworkMode {
  const metaEnv = import.meta.env ?? {};
  const procEnv = typeof process !== "undefined" ? process.env : undefined;
  const raw = String(metaEnv.NETWORK_MODE ?? metaEnv.VITE_NETWORK_MODE ?? procEnv?.NETWORK_MODE ?? procEnv?.VITE_NETWORK_MODE ?? "testnet").trim().toLowerCase();
  return raw === "mainnet" ? "mainnet" : "testnet";
}

export const NETWORK_MODE: NetworkMode = getNetworkMode();

export function isTestnet(network?: NetworkId | string | null): boolean {
  if (!network) return getNetworkMode() === "testnet";
  return (TESTNET_NETWORKS as readonly string[]).includes(network);
}

export function isMainnet(network?: NetworkId | string | null): boolean {
  if (!network) return getNetworkMode() === "mainnet";
  return (MAINNET_NETWORKS as readonly string[]).includes(network);
}

export function getModeNetworks(mode: NetworkMode = getNetworkMode()): readonly NetworkId[] {
  return mode === "mainnet" ? MAINNET_NETWORKS : TESTNET_NETWORKS;
}

type AppChain = FacilitatorChain & {
  chainId?: number;
  usdcAddress?: `0x${string}`;
  rpcUrl?: string;
  explorerQuery?: string;
};

let resolvedChains: AppChain[] = [];
let resolvedChainObjects = new Map<number, Chain>();
let resolvedDefaultNetwork: NetworkId | undefined;

export function isEvmNetwork(network: NetworkId | string | null | undefined): network is EvmNetworkId {
  return typeof network === "string" && network.startsWith("eip155:");
}

export function isSolanaNetwork(network: NetworkId | string | null | undefined): boolean {
  return typeof network === "string" && network.startsWith("solana:");
}

export function evmChainId(network: EvmNetworkId): number {
  const value = Number.parseInt(network.slice("eip155:".length), 10);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid EVM network: ${network}`);
  return value;
}

export function requireEvmNetwork(network: NetworkId, action = "This action"): EvmNetworkId {
  if (!isEvmNetwork(network)) {
    throw new Error(`${action} is only available on EVM networks`);
  }
  return network;
}

function normalizeChain(chain: FacilitatorChain): AppChain {
  const chainId = isEvmNetwork(chain.network) ? evmChainId(chain.network) : undefined;
  return {
    ...chain,
    ...(chainId ? { chainId } : {}),
    usdcAddress: chain.assetAddress as `0x${string}`,
  };
}

function getConfiguredEnvChains(): { chains: FacilitatorChain[]; defaultNetwork?: NetworkId } {
  const metaEnv = import.meta.env ?? {};
  const procEnv = typeof process !== "undefined" ? process.env : undefined;
  const rawNetworks = metaEnv.VITE_NETWORKS ?? procEnv?.VITE_NETWORKS;
  const rawDefault = (metaEnv.VITE_DEFAULT_NETWORK ?? procEnv?.VITE_DEFAULT_NETWORK) as NetworkId | undefined;
  let chains: FacilitatorChain[] = [];
  if (typeof rawNetworks === "string" && rawNetworks.trim()) {
    try {
      const parsed = JSON.parse(rawNetworks);
      if (Array.isArray(parsed)) chains = parsed as FacilitatorChain[];
    } catch {
      chains = [];
    }
  }
  return { chains, ...(rawDefault ? { defaultNetwork: rawDefault } : {}) };
}

export function setChainRegistry(chains: FacilitatorChain[], defaultNetwork: NetworkId): void {
  const configured = getConfiguredEnvChains();
  const merged = [...chains];
  for (const cfg of configured.chains) {
    if (!merged.some((c) => c.network === cfg.network)) {
      merged.push(cfg);
    }
  }
  const nextChains = merged.map(normalizeChain);
  const resolvedDefault = nextChains.some((chain) => chain.network === defaultNetwork)
    ? defaultNetwork
    : configured.defaultNetwork && nextChains.some((chain) => chain.network === configured.defaultNetwork)
      ? configured.defaultNetwork
      : undefined;
  if (!resolvedDefault) throw new Error('The default network is not advertised');
  const nextObjects = new Map<number, Chain>();
  for (const c of nextChains) {
    if (c.chainId == null) continue;
    const isEvm = c.namespace === "eip155" || (c.network ?? "").startsWith("eip155:");
    if (!isEvm) continue;
    if (!c.rpcUrl) throw new Error(`RPC URL is unavailable for ${c.network}`);
    nextObjects.set(c.chainId, defineChain({
        id: c.chainId,
        rpc: c.rpcUrl,
        name: c.name,
        ...(c.isTestnet ? { testnet: true as const } : {}),
        blockExplorers: [{ name: "Explorer", url: c.explorer }],
      }));
  }
  resolvedChains = nextChains;
  resolvedChainObjects = nextObjects;
  resolvedDefaultNetwork = resolvedDefault;
}

{
  const initial = getConfiguredEnvChains();
  if (initial.chains.length > 0) {
    const initialDefault = initial.defaultNetwork ?? initial.chains[0].network;
    if (initialDefault) setChainRegistry(initial.chains, initialDefault);
  }
}

export function getChains(): AppChain[] {
  return resolvedChains;
}

export function getEvmChains(): AppChain[] {
  return resolvedChains.filter((c) => c.namespace === "eip155" || (c.network ?? "").startsWith("eip155:"));
}

export function getDefaultNetwork(): NetworkId {
  if (!resolvedDefaultNetwork) throw new Error('The default network is not configured');
  return resolvedDefaultNetwork;
}

export function getDefaultEvmNetwork(): EvmNetworkId {
  return requireEvmNetwork(getDefaultNetwork(), "Default EVM network");
}

export function getDefaultChainId(): number {
  return evmChainId(getDefaultEvmNetwork());
}

export function getChainByNetwork(network: NetworkId | string): AppChain | undefined {
  return resolvedChains.find((c) => c.network === network);
}

export function getNetworkRpcUrl(network: NetworkId | string): string {
  const chain = getChainByNetwork(network);
  if (chain?.rpcUrl) return chain.rpcUrl;
  throw new Error(`RPC URL not configured for network: ${network}`);
}

export function networkFromChainId(chainId: number): EvmNetworkId {
  return `eip155:${chainId}` as EvmNetworkId;
}

export function getChainIds(): number[] {
  return getEvmChains().map((c) => c.chainId!).filter(Boolean);
}

export function getUsdcAddress(chainId: number): `0x${string}` | undefined {
  const chain = resolvedChains.find((c) => c.chainId === chainId);
  return chain?.usdcAddress ?? (chain?.assetAddress as `0x${string}` | undefined);
}

export function getChainConfig(chainId: number) {
  return resolvedChains.find((c) => c.chainId === chainId);
}

export const CHAIN_OBJECTS = new Proxy({} as Record<number, Chain>, {
  get(_target, prop: string) {
    const id = Number(prop);
    return resolvedChainObjects.get(id);
  },
  ownKeys() {
    return Array.from(resolvedChainObjects.keys()).map(String);
  },
  getOwnPropertyDescriptor() {
    return { enumerable: true, configurable: true };
  },
});

export function getChainObject(chainId: number): Chain | undefined {
  return resolvedChainObjects.get(chainId);
}

export function getEvmChainObject(network: EvmNetworkId): Chain | undefined {
  return getChainObject(evmChainId(network));
}

export function getChainConfigByNetwork(network: NetworkId | string) {
  return getChainByNetwork(network);
}

export function getSupportedChains(): Array<{ id: number; chain: Chain }> {
  return getEvmChains()
    .filter((c) => c.chainId != null)
    .map((c) => ({ id: c.chainId!, chain: resolvedChainObjects.get(c.chainId!)! }))
    .filter((entry) => entry.chain);
}

export const SUPPORTED_CHAINS = new Proxy([] as Array<{ id: number; chain: Chain }>, {
  get(_target, prop) {
    const arr = getSupportedChains();
    if (prop === "length") return arr.length;
    if (prop === "map") return arr.map.bind(arr);
    if (prop === "filter") return arr.filter.bind(arr);
    if (prop === "forEach") return arr.forEach.bind(arr);
    if (prop === Symbol.iterator) return arr[Symbol.iterator].bind(arr);
    if (prop === "find") return arr.find.bind(arr);
    if (prop === "some") return arr.some.bind(arr);
    if (prop === "every") return arr.every.bind(arr);
    if (typeof prop === "string" && /^\d+$/.test(prop)) return arr[Number(prop)];
    return undefined;
  },
});

export const CHAIN_CONFIG = new Proxy({} as Record<number, {
  name: string;
  isTestnet: boolean;
  explorer: string;
  color: string;
}>, {
  get(_target, prop: string) {
    const id = Number(prop);
    const chain = resolvedChains.find((c) => c.chainId === id);
    if (!chain) return undefined;
    return {
      name: chain.name,
      isTestnet: chain.isTestnet,
      explorer: chain.explorer,
      color: chain.isTestnet ? "gold" : "champagne",
    };
  },
  ownKeys() {
    return getEvmChains().map((c) => String(c.chainId));
  },
  getOwnPropertyDescriptor() {
    return { enumerable: true, configurable: true };
  },
});

export const USDC_ADDRESSES = new Proxy({} as Record<number, `0x${string}`>, {
  get(_target, prop: string) {
    const id = Number(prop);
    return getUsdcAddress(id);
  },
  ownKeys() {
    return getEvmChains().map((c) => String(c.chainId));
  },
  getOwnPropertyDescriptor() {
    return { enumerable: true, configurable: true };
  },
});

export const CHAIN_IDS = new Proxy({} as Record<string, number>, {
  get(_target, prop: string) {
    const chain = getEvmChains().find((c) => c.shortName?.replace(/-/g, "") === prop || c.name.replace(/\s/g, "") === prop);
    return chain?.chainId;
  },
  ownKeys() {
    return getEvmChains().map((c) => c.shortName ?? c.name);
  },
  getOwnPropertyDescriptor() {
    return { enumerable: true, configurable: true };
  },
});

export type ChainId = number;
export const SUPPORTED_CHAIN_IDS = new Proxy([] as readonly number[], {
  get(_target, prop) {
    const arr = getEvmChains().map((c) => c.chainId!).filter(Boolean);
    if (prop === "length") return arr.length;
    if (prop === "includes") return arr.includes.bind(arr);
    if (prop === Symbol.iterator) return arr[Symbol.iterator].bind(arr);
    if (prop === "indexOf") return arr.indexOf.bind(arr);
    if (typeof prop === "string" && /^\d+$/.test(prop)) return arr[Number(prop)];
    return undefined;
  },
});

const clientId = env.VITE_THIRDWEB_CLIENT_ID;

if (!clientId) {
  console.error("[chains] VITE_THIRDWEB_CLIENT_ID is missing. Create one at https://thirdweb.com/create-api-key");
}

export const thirdwebClient = createThirdwebClient({
  clientId: clientId || "placeholder",
});

export function getPaymentChain(): Chain {
  const chain = resolvedChainObjects.get(getDefaultChainId());
  if (!chain) throw new Error("Chains not loaded yet — ensure ChainProvider has resolved");
  return chain;
}

export function getPaymentToken() {
  const config = getChainConfig(getDefaultChainId());
  const usdcAddress = getUsdcAddress(getDefaultChainId());
  if (!usdcAddress) throw new Error("USDC address not available for default chain");
  return {
    address: usdcAddress,
    symbol: config!.asset,
    decimals: config!.decimals,
    name: config!.asset,
  };
}

export const accountAbstraction: SmartWalletOptions = {
  get chain() {
    return getPaymentChain();
  },
  sponsorGas: true,
} as SmartWalletOptions;

export const paymentChain = new Proxy({} as Chain, {
  get() {
    return getPaymentChain();
  },
});

export const paymentToken = new Proxy({} as { address: `0x${string}`; symbol: string; decimals: number; name: string }, {
  get(_target, prop: string) {
    const token = getPaymentToken();
    return (token as Record<string, unknown>)[prop];
  },
});

export function getUsdcContractForChain(chainId: number) {
  const chain = getChainObject(chainId);
  const address = getUsdcAddress(chainId);

  if (!chain || !address) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  return getContract({
    address,
    chain,
    client: thirdwebClient,
  });
}

export function getUsdcAddressForNetwork(network: EvmNetworkId): `0x${string}` | undefined {
  return getUsdcAddress(evmChainId(network));
}

export function getUsdcContractForNetwork(network: EvmNetworkId) {
  return getUsdcContractForChain(evmChainId(network));
}

export type ExplorerItemType = "tx" | "address" | "block" | "token";

export function getExplorerUrl(network: NetworkId, type: ExplorerItemType, value: string): string {
  const chain = getChainByNetwork(network);
  if (!chain?.explorer) return "#";
  const baseUrl = chain.explorer.replace(/\/$/, "");
  const query = chain.explorerQuery;
  return `${baseUrl}/${type}/${value}${query ? `?${query}` : ""}`;
}

export function getExplorerTxUrl(network: NetworkId, txHash: string): string {
  return getExplorerUrl(network, "tx", txHash);
}
