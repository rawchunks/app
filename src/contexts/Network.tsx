import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import React from "react";
import { Globe } from "lucide-react";
import { fetchChains, type FacilitatorChainsResponse, type NetworkId } from "@compose-market/sdk/chains";
import {
  evmChainId,
  getModeNetworks,
  getNetworkMode,
  isEvmNetwork,
  setChainRegistry,
  type NetworkMode,
} from "@/lib/chains";
import { COMPOSE_API_URL } from "@/lib/compose";
import { Network, useNetwork, type NetworkValue } from "@/hooks/use-network";
import { cn } from "@/lib/utils";

export const NETWORK_LOGOS: Record<string, string> = {
  "eip155:8453": "/networks/base.png",
  "eip155:84532": "/networks/baseSepolia.png",
  "eip155:42161": "/networks/arbitrum.png",
  "eip155:421614": "/networks/arbitrum.png",
  "eip155:42431": "/networks/tempoModerato.png",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "/networks/solanaDevnet.jpeg",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "/networks/solana.jpeg",
};

export function networkLogo(network: string | undefined | null): string | undefined {
  if (!network) return undefined;
  return NETWORK_LOGOS[network];
}

export function NetworkGlyph({
  network,
  name,
  className,
}: {
  network: string | null | undefined;
  name?: string;
  className?: string;
}): React.ReactElement {
  const logo = network ? networkLogo(network) : undefined;
  if (logo) {
    return React.createElement("img", {
      src: logo,
      alt: "",
      className: cn("glyph", className),
      loading: "lazy",
      decoding: "async",
    });
  }
  return React.createElement(Globe, {
    className: cn("glyph glyph-icon", className),
    "aria-label": name,
  });
}

export { NetworkGlyph as NetworkLogo };
export { useNetwork as useChain };

type RegistryStorage = Pick<Storage, "getItem" | "setItem">;
export const REGISTRY_VERSION = 3;
export const SELECTED_NETWORK_KEY = "selected_network";
export const FETCH_CHAINS_TIMEOUT_MS = 8_000;

export function visibleRegistry(
  registry: FacilitatorChainsResponse,
  mode: NetworkMode = getNetworkMode(),
): FacilitatorChainsResponse {
  const expectTestnet = mode === "testnet";
  const chains = getModeNetworks(mode).flatMap(network =>
    registry.chains.filter(c => c.network === network && c.isTestnet === expectTestnet),
  );
  if (!chains.length) throw new Error(`The facilitator has no supported ${mode} networks`);
  return { chains };
}

export function registryCacheKey(apiUrl: string, mode: NetworkMode = getNetworkMode()): string {
  return `chain-registry:v${REGISTRY_VERSION}:${mode}:${apiUrl.replace(/\/+$/, "")}`;
}

export function validateRegistry(
  value: FacilitatorChainsResponse,
  mode: NetworkMode = getNetworkMode(),
): FacilitatorChainsResponse {
  const allowed = new Set<string>(getModeNetworks(mode));
  const expectTestnet = mode === "testnet";
  if (
    !Array.isArray(value?.chains) || value.chains.length === 0
    || value.chains.some(c => typeof c?.network !== "string" || !c.network)
    || value.chains.filter(c => allowed.has(c.network)).some(c =>
      !c.name || !c.rpcUrl || !c.explorer || !c.assetAddress
      || typeof c.isTestnet !== "boolean" || c.isTestnet !== expectTestnet
      || !Array.isArray(c.schemes) || c.decimals !== 6
      || !c.network.startsWith(`${c.namespace}:`)
      || (c.namespace !== "eip155" && c.namespace !== "solana"),
    )
    || new Set(value.chains.map(c => c.network)).size !== value.chains.length
  ) {
    throw new Error("The facilitator returned an invalid network registry");
  }
  return value;
}

export function readRegistry(
  storage: RegistryStorage | undefined,
  apiUrl: string,
  mode: NetworkMode = getNetworkMode(),
): FacilitatorChainsResponse | null {
  try {
    const raw = storage?.getItem(registryCacheKey(apiUrl, mode));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.version !== REGISTRY_VERSION) return null;
    return validateRegistry({ chains: parsed.chains }, mode);
  } catch { return null; }
}

export function writeRegistry(
  storage: RegistryStorage | undefined,
  apiUrl: string,
  registry: FacilitatorChainsResponse,
  mode: NetworkMode = getNetworkMode(),
): void {
  try {
    storage?.setItem(
      registryCacheKey(apiUrl, mode),
      JSON.stringify({ chains: registry.chains, version: REGISTRY_VERSION, fetchedAt: Date.now() }),
    );
  } catch { /* Private mode and quota failures do not prevent discovery. */ }
}

export function selectNetwork(registry: FacilitatorChainsResponse, selected: string | null): NetworkId {
  return registry.chains.find(c => c.network === selected)?.network ?? registry.chains[0].network;
}

export async function discoverRegistry(
  apiUrl: string,
  signal: AbortSignal,
  mode: NetworkMode = getNetworkMode(),
): Promise<FacilitatorChainsResponse> {
  return validateRegistry(await fetchChains({ baseUrl: apiUrl, signal }), mode);
}

function browserStorage(): Storage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; }
  catch { return undefined; }
}

export function ChainProvider({ children }: { children: ReactNode }) {
  const mode = getNetworkMode();
  const [registry, setRegistry] = useState<FacilitatorChainsResponse | null>(() => {
    const fullRegistry = readRegistry(browserStorage(), COMPOSE_API_URL, mode);
    let cached: FacilitatorChainsResponse | null = null;
    try { cached = fullRegistry ? visibleRegistry(fullRegistry, mode) : null; } catch { /* Refetch a cache with no active networks. */ }
    if (cached) setChainRegistry(cached.chains);
    return cached;
  });
  const [savedSelection, setSavedSelection] = useState<string | null>(() => {
    try { return browserStorage()?.getItem(SELECTED_NETWORK_KEY) ?? null; }
    catch { return null; }
  });
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), FETCH_CHAINS_TIMEOUT_MS);
    setError(null);
    discoverRegistry(COMPOSE_API_URL, controller.signal, mode).then(
      result => {
        if (!current) return;
        const visible = visibleRegistry(result, mode);
        setChainRegistry(visible.chains);
        writeRegistry(browserStorage(), COMPOSE_API_URL, visible, mode);
        setRegistry(visible);
        setSavedSelection(prev => selectNetwork(visible, prev));
      },
    ).catch((cause: unknown) => {
      if (!current) return;
      setError(cause instanceof Error ? cause : new Error("Failed to fetch networks"));
    }).finally(() => globalThis.clearTimeout(timeout));
    return () => {
      current = false;
      globalThis.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt, mode]);

  const selectedNetwork = registry ? selectNetwork(registry, savedSelection) : null;
  useEffect(() => {
    if (!selectedNetwork) return;
    try { browserStorage()?.setItem(SELECTED_NETWORK_KEY, selectedNetwork); } catch { /* Optional persistence. */ }
  }, [selectedNetwork]);

  const retry = useCallback(() => {
    setAttempt(value => value + 1);
  }, []);

  const chains = registry?.chains ?? [];
  const evmChains = chains.filter(c => c.namespace === "eip155");
  const solanaChains = chains.filter(c => c.namespace === "solana");
  const value: NetworkValue = {
    selectedNetwork,
    setSelectedNetwork: network => {
      if (!chains.some(c => c.network === network)) throw new Error(`Network is not advertised: ${network}`);
      setSavedSelection(network);
    },
    paymentNetwork: selectedNetwork,
    chains,
    evmChains,
    solanaChains,
    isLoading: !registry && !error,
    error,
    retry,
    getChainById: chainId => evmChains.find(c => isEvmNetwork(c.network) && evmChainId(c.network) === chainId),
    getChainByNetworkId: network => chains.find(c => c.network === network),
  };
  return <Network.Provider value={value}>{children}</Network.Provider>;
}
