import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import React from "react";
import { Globe } from "lucide-react";
import { fetchChains, type FacilitatorChain, type NetworkId } from "@compose-market/sdk/chains";
import { evmChainId, getChainByNetwork, getChains, getConfiguredChains, getDefaultNetwork, isEvmNetwork, setChainRegistry } from "@/lib/chains";
import { Network, useNetwork, type NetworkValue } from "@/hooks/use-network";
import { cn } from "@/lib/utils";

export const NETWORK_LOGOS: Record<string, string> = {
  "eip155:42161": "/networks/arbitrum.png",
  "eip155:421614": "/networks/arbitrum.png",
  "eip155:8453": "/networks/base.png",
  "eip155:84532": "/networks/baseSepolia.png",
  "eip155:4217": "/networks/tempo.png",
  "eip155:42431": "/networks/tempoModerato.png",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "/networks/solanaDevnet.jpeg",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "/networks/solana.jpeg",
};

const ALLOWED: ReadonlySet<string> = new Set(
    [
      "eip155:42161",
      "eip155:421614",
      "eip155:8453",
      "eip155:84532",
      "eip155:4217",
      "eip155:42431",
      "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    ],
);

function allow(chains: FacilitatorChain[]): FacilitatorChain[] {
  return chains.filter((chain) => ALLOWED.has(chain.network));
}

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

const STORAGE_KEY = "selected_network";
const REGISTRY_CACHE_KEY = "chain_registry";
const FETCH_CHAINS_TIMEOUT_MS = 8_000;

interface CachedChainRegistry {
  chains: FacilitatorChain[];
  defaultNetwork: NetworkId;
  fetchedAt: number;
}

function readCachedRegistry(): CachedChainRegistry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(REGISTRY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedChainRegistry;
    if (!Array.isArray(parsed?.chains) || parsed.chains.length === 0) return null;
    if (typeof parsed?.defaultNetwork !== "string" || !parsed.defaultNetwork) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedRegistry(chains: FacilitatorChain[], defaultNetwork: NetworkId): void {
  try {
    localStorage.setItem(
      REGISTRY_CACHE_KEY,
      JSON.stringify({ chains, defaultNetwork, fetchedAt: Date.now() } satisfies CachedChainRegistry),
    );
  } catch {
    // quota or private-mode failures are non-fatal: next reload just refetches
  }
}

function initialNetwork(): NetworkId {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored as NetworkId;
  }
  return getDefaultNetwork();
}

function registry(chains: FacilitatorChain[], defaultNetwork: NetworkId) {
  setChainRegistry(allow(chains), defaultNetwork);
  return { chains: getChains(), defaultNetwork: getDefaultNetwork() };
}

export function ChainProvider({ children }: { children: ReactNode }) {
  const [cachedRegistry] = useState<CachedChainRegistry | null>(() => {
    const cached = readCachedRegistry();
    if (cached) {
      const allowed = allow(cached.chains);
      if (allowed.length > 0) {
        return { ...cached, ...registry(allowed, cached.defaultNetwork) };
      }
    }
    return null;
  });
  const [chains, setChains] = useState<FacilitatorChain[]>(cachedRegistry?.chains ?? getConfiguredChains());
  const [defaultNetwork, setDefaultNetwork] = useState<NetworkId>(
    cachedRegistry?.defaultNetwork ?? getDefaultNetwork(),
  );
  const [isLoading, setIsLoading] = useState(!cachedRegistry);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), FETCH_CHAINS_TIMEOUT_MS);
    fetchChains({ signal: controller.signal }).then(result => registry(result.chains, result.defaultNetwork)).then(
      (result) => {
        if (!current) return;
        writeCachedRegistry(result.chains, result.defaultNetwork);
        setChains(result.chains);
        setDefaultNetwork(result.defaultNetwork);
        setIsLoading(false);
      },
      (err: unknown) => {
        if (!current) return;
        setError(err instanceof Error ? err : new Error("Failed to fetch chains"));
        setIsLoading(false);
      },
    );
    return () => {
      current = false;
      globalThis.clearTimeout(timeout);
      controller.abort();
    };
    // cachedRegistry is the constant mount-time snapshot; revalidation runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const evmChains = chains.filter((c) => c.namespace === "eip155" || (c.network ?? "").startsWith("eip155:"));
  const solanaChains = chains.filter((c) => c.namespace === "solana" || (c.network ?? "").startsWith("solana:"));

  const getChainById = (chainId: number) =>
    evmChains.find((c) => isEvmNetwork(c.network) && evmChainId(c.network) === chainId);

  const getChainByNetworkId = (network: string) =>
    getChainByNetwork(network) ?? chains.find((c) => c.network === network);

  const [selectedNetwork, setSelectedNetworkState] = useState<NetworkId>(initialNetwork);

  useEffect(() => {
    if (!isLoading && chains.length > 0) {
      setSelectedNetworkState((prev) => {
        const chain = getChainByNetworkId(prev);
        if (chain) return prev;
        return defaultNetwork;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, chains.length, defaultNetwork]);

  const setSelectedNetwork = (network: NetworkId) => {
    setSelectedNetworkState(network);
    localStorage.setItem(STORAGE_KEY, network);
  };

  const value: NetworkValue = {
    selectedNetwork,
    setSelectedNetwork,
    paymentNetwork: selectedNetwork,
    chains,
    evmChains,
    solanaChains,
    defaultNetwork,
    isLoading,
    error,
    getChainById,
    getChainByNetworkId,
  };

  return <Network.Provider value={value}>{children}</Network.Provider>;
}
