import { createThirdwebClient, defineChain } from "thirdweb";
import type { Chain } from "thirdweb";
import {
  isTestnet as sdkIsTestnet,
  type EvmNetworkId,
  type FacilitatorChain,
  type NetworkId,
  type SolanaNetworkId,
} from "@compose-market/sdk/chains";
import { getNetworkMode, type NetworkMode } from "./performance/chains-data";

export { getNetworkMode, NETWORK_MODE, type NetworkMode } from "./performance/chains-data";
export { CONTRACT_ADDRESSES, getContractAddress, getContractAddressForChain } from "./performance/chains-data";
export { formatUsdcPrice, weiToUsdc, usdcToWei } from "./performance/chains-data";
export { SOLANA_PROGRAM_IDS, getSolanaProgramId } from "./performance/chains-data";
export type { ContractName, SolanaProgramName } from "./performance/chains-data";

const env = import.meta.env ?? {};

export const TESTNET_NETWORKS: readonly NetworkId[] = [
  "eip155:84532",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  "eip155:42431",
];

export const MAINNET_NETWORKS: readonly NetworkId[] = [
  "eip155:8453",
];

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

export function isTestnet(network?: NetworkId | FacilitatorChain | string | null): boolean {
  if (!network) return getNetworkMode() === "testnet";
  if (typeof network === "object") return sdkIsTestnet(network);
  const registered = resolvedChains.find((c) => c.network === network);
  if (registered) return registered.isTestnet;
  return sdkIsTestnet(network);
}

export function isMainnet(network?: NetworkId | FacilitatorChain | string | null): boolean {
  if (!network) return getNetworkMode() === "mainnet";
  return !isTestnet(network);
}

export function isEvmNetwork(network: NetworkId | string | null | undefined): network is EvmNetworkId {
  return typeof network === "string" && network.startsWith("eip155:");
}

export function isSolanaNetwork(network: NetworkId | string | null | undefined): network is SolanaNetworkId {
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

export function setChainRegistry(chains: FacilitatorChain[]): void {
  if (!Array.isArray(chains) || chains.length === 0) {
    throw new Error("The facilitator returned no supported networks");
  }
  const nextChains = chains.map(normalizeChain);
  const nextObjects = new Map<number, Chain>();
  for (const c of nextChains) {
    if (c.chainId == null) continue;
    const isEvm = c.namespace === "eip155" || (c.network ?? "").startsWith("eip155:");
    if (!isEvm) continue;
    if (!c.rpcUrl) throw new Error(`RPC URL is unavailable for ${c.network}`);
    nextObjects.set(
      c.chainId,
      defineChain({
        id: c.chainId,
        rpc: c.rpcUrl,
        name: c.name,
        ...(c.isTestnet ? { testnet: true as const } : {}),
        blockExplorers: [{ name: "Explorer", url: c.explorer }],
      }),
    );
  }
  resolvedChains = nextChains;
  resolvedChainObjects = nextObjects;
}

export function getChains(): AppChain[] {
  return resolvedChains;
}

export function getEvmChains(): AppChain[] {
  return resolvedChains.filter((c) => c.namespace === "eip155" || (c.network ?? "").startsWith("eip155:"));
}

export function getChainByNetwork(network: NetworkId | string): AppChain | undefined {
  return resolvedChains.find((c) => c.network === network);
}

export function getNetworkRpcUrl(network: NetworkId | string): string {
  const chain = getChainByNetwork(network);
  if (chain?.rpcUrl) return chain.rpcUrl;
  throw new Error(`RPC URL not configured for network: ${network}`);
}

export function getUsdcAddress(chainId: number): `0x${string}` | undefined {
  const chain = resolvedChains.find((c) => c.chainId === chainId);
  return chain?.usdcAddress ?? (chain?.assetAddress as `0x${string}` | undefined);
}

export function getChainConfig(chainId: number) {
  return resolvedChains.find((c) => c.chainId === chainId);
}

export function getChainObject(chainId: number): Chain | undefined {
  return resolvedChainObjects.get(chainId);
}

export function getEvmChainObject(network: EvmNetworkId): Chain | undefined {
  return getChainObject(evmChainId(network));
}

const clientId = env.VITE_THIRDWEB_CLIENT_ID;

if (!clientId) {
  console.error("[chains] VITE_THIRDWEB_CLIENT_ID is missing. Create one at https://thirdweb.com/create-api-key");
}

export const thirdwebClient = createThirdwebClient({
  clientId: clientId || "placeholder",
});

export type ExplorerItemType = "tx" | "address" | "block" | "token";

export function getExplorerUrl(network: NetworkId | string, type: ExplorerItemType, value: string): string {
  const chain = getChainByNetwork(network);
  if (!chain?.explorer) return "#";
  const baseUrl = chain.explorer.replace(/\/$/, "");
  const query = chain.explorerQuery;
  return `${baseUrl}/${type}/${value}${query ? `?${query}` : ""}`;
}

export function getExplorerTxUrl(network: NetworkId | string, txHash: string): string {
  return getExplorerUrl(network, "tx", txHash);
}
