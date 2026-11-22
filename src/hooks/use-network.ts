import { createContext, useContext } from "react";
import type { FacilitatorChain, NetworkId } from "@compose-market/sdk/chains";

export interface NetworkValue {
  selectedNetwork: NetworkId | null;
  setSelectedNetwork: (network: NetworkId) => void;
  paymentNetwork: NetworkId | null;
  chains: FacilitatorChain[];
  evmChains: FacilitatorChain[];
  solanaChains: FacilitatorChain[];
  isLoading: boolean;
  error: Error | null;
  retry: () => void;
  getChainById: (chainId: number) => FacilitatorChain | undefined;
  getChainByNetworkId: (network: string) => FacilitatorChain | undefined;
}

export const Network = createContext<NetworkValue | null>(null);

export function useNetwork(): NetworkValue {
  const value = useContext(Network);
  if (!value) throw new Error("useNetwork must be used within a ChainProvider");
  return value;
}
