import { useSelectedUserAddress } from "@/hooks/use-address";

export interface WalletPair {
  evmAddress?: string;
  svmAddress?: string;
}

export function useWalletPair() {
  const { evmAddress, svmAddress } = useSelectedUserAddress();
  const pair: WalletPair | null =
    evmAddress || svmAddress
      ? {
        ...(evmAddress ? { evmAddress } : {}),
        ...(svmAddress ? { svmAddress: svmAddress } : {}),
      }
      : null;
  return { pair };
}
