import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getContract, readContract } from "thirdweb";
import type { EvmNetworkId, SolanaNetworkId } from "@compose-market/sdk/chains";
import { evmChainId, getChainObject, getUsdcAddress, thirdwebClient } from "@/lib/chains";
import { useChain } from "@/contexts/Network";
import { createSolanaRpcFromNetwork, readSvmTokenBalance } from "@/lib/svm/swig";

export interface BalanceEntry {
  network: string;
  formatted: string;
}

interface BalanceInput {
  evmAddress: string | null | undefined;
  svmAddress: string | null | undefined;
}

interface BalanceOptions {
  enabled?: boolean;
  deferUntilIdle?: boolean;
}

function useDeferred(defer: boolean): boolean {
  const [ready, setReady] = useState(!defer);
  useEffect(() => {
    if (ready) return;
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(() => setReady(true), { timeout: 2000 });
      return () => cancelIdleCallback(id);
    }
    const timer = setTimeout(() => setReady(true), 300);
    return () => clearTimeout(timer);
  }, [ready]);
  return ready;
}

export function useMultiChainBalance(
  input: BalanceInput,
  options: BalanceOptions = {},
) {
  const { enabled = true, deferUntilIdle = false } = options;
  const { evmChains, solanaChains } = useChain();
  const ready = useDeferred(deferUntilIdle);
  const evmKey = evmChains.map((c) => c.network).join(",");
  const solanaKey = solanaChains.map((c) => c.network).join(",");

  const query = useQuery({
    queryKey: [
      "balances",
      input.evmAddress ?? null,
      input.svmAddress ?? null,
      evmKey,
      solanaKey,
    ],
    enabled: enabled && ready && Boolean(input.evmAddress || input.svmAddress),
    refetchInterval: 30_000,
    queryFn: async (): Promise<BalanceEntry[]> => {
      const entries: BalanceEntry[] = [];

      if (input.evmAddress && evmChains.length) {
        await Promise.all(
          evmChains.map(async (chain) => {
            try {
              const chainId = evmChainId(chain.network as EvmNetworkId);
              const chainObject = getChainObject(chainId);
              const tokenAddress = getUsdcAddress(chainId);
              if (!chainObject || !tokenAddress) return;
              const token = getContract({
                client: thirdwebClient,
                chain: chainObject,
                address: tokenAddress,
              });
              const raw = await readContract({
                contract: token,
                method: "function balanceOf(address account) external view returns (uint256)",
                params: [input.evmAddress as `0x${string}`],
              });
              const units = Number(raw) / 1_000_000;
              if (units > 0) {
                entries.push({ network: chain.network, formatted: units.toFixed(2) });
              }
            } catch {
              // a chain being unreachable must not sink the aggregate
            }
          }),
        );
      }

      if (input.svmAddress && solanaChains.length) {
        await Promise.all(
          solanaChains.map(async (solana) => {
            if (!solana?.rpcUrl || !solana.assetAddress) return;
            try {
              const rpc = createSolanaRpcFromNetwork(
                solana.network as SolanaNetworkId,
                solana.rpcUrl,
              );
              const raw = await readSvmTokenBalance({
                owner: input.svmAddress as Parameters<typeof readSvmTokenBalance>[0]["owner"],
                mint: solana.assetAddress as Parameters<typeof readSvmTokenBalance>[0]["mint"],
                rpc,
              });
              const units = Number(raw) / 1_000_000;
              if (units > 0) {
                entries.push({ network: solana.network, formatted: units.toFixed(2) });
              }
            } catch {
              // solana reachability is equally non-fatal
            }
          }),
        );
      }

      return entries;
    },
  });

  return { data: query.data, isLoading: query.isLoading, refetch: query.refetch };
}

export function useTotalBalance(
  input: BalanceInput,
  options: BalanceOptions = {},
) {
  const { data, isLoading } = useMultiChainBalance(input, options);
  const total = (data ?? []).reduce((sum, entry) => sum + Number(entry.formatted), 0);
  return { formatted: total.toFixed(2), isLoading };
}
