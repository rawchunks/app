import { useState } from 'react';
import { useActiveAccount, useActiveWalletConnectionStatus } from "thirdweb/react";
import { useChain } from "@/contexts/Network";
import { isEvmNetwork } from "@/lib/chains";
import { useSolanaSmartAccount } from "@/hooks/use-svm";
import { cachedAddress, readCachedAccount } from '@/lib/cache';

export function useSelectedUserAddress() {
    const account = useActiveAccount();
    const connectionStatus = useActiveWalletConnectionStatus();
    const [cached] = useState(readCachedAccount);
    const { paymentNetwork } = useChain();
    const {
        swigAddress,
        evmSignerAddress,
        isActivated,
        isCreating,
        requiredFundingLamports,
        currentFundingLamports,
        error,
        create,
    } = useSolanaSmartAccount();
    const isEvm = isEvmNetwork(paymentNetwork);
    const evmAddress = account?.address ?? null;
    const svmAddress = swigAddress ?? null;
    const userAddress = isEvm ? evmAddress : svmAddress;
    const readAddress = userAddress ?? cachedAddress(cached, paymentNetwork, isEvm, connectionStatus);
    const isReconnecting = !account && (connectionStatus === 'unknown' || connectionStatus === 'connecting');
    const isResolving = isReconnecting || (Boolean(evmAddress) && !isEvm && (!svmAddress || !isActivated || isCreating));

    return {
        userAddress,
        readAddress,
        isReconnecting,
        evmAddress,
        svmAddress,
        evmSignerAddress,
        isActivated,
        isActivating: isCreating,
        activate: create,
        requiredFundingLamports,
        currentFundingLamports,
        paymentNetwork,
        isEvm,
        isResolving,
        error,
    };
}
