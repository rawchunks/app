import { createContext, useContext } from "react";
import type { FacilitatorChain, NetworkId } from "@compose-market/sdk/chains";

export interface NetworkValue {
  selectedNetwork: NetworkId;
  setSelectedNetwork: (network: NetworkId) => void;
  paymentNetwork: NetworkId;
  chains: FacilitatorChain[];
  evmChains: FacilitatorChain[];
  solanaChains: FacilitatorChain[];
  defaultNetwork: NetworkId;
  isLoading: boolean;
  error: Error | null;
  getChainById: (chainId: number) => FacilitatorChain | undefined;
  getChainByNetworkId: (network: string) => FacilitatorChain | undefined;
}

export const Network = createContext<NetworkValue | null>(null);

export function useNetwork(): NetworkValue {
  const value = useContext(Network);
  if (!value) throw new Error("useNetwork must be used within a ChainProvider");
  return value;
}
