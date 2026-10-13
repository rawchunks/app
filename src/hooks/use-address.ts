import { useEffect, useRef, useState } from 'react';
import { useActiveAccount, useActiveWalletConnectionStatus, useAdminWallet } from "thirdweb/react";
import { useChain } from "@/contexts/Network";
import { isEvmNetwork } from "@/lib/chains";
import { useSolanaSmartAccount } from "@/hooks/use-svm";
import { cachedAddress, readCachedAccount } from '@/lib/cache';

export function useSelectedUserAddress() {
    const account = useActiveAccount();
    const adminWallet = useAdminWallet();
    const connectionStatus = useActiveWalletConnectionStatus();
    const [cached, setCached] = useState(readCachedAccount);
    const { paymentNetwork, getChainByNetworkId } = useChain();
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
    useEffect(() => {
        setCached(readCachedAccount());
    }, [account?.address, swigAddress, connectionStatus]);
    const isEvm = isEvmNetwork(paymentNetwork);
    const evmAddress = account?.address ?? null;
    const svmAddress = swigAddress ?? null;
    const userAddress = isEvm ? evmAddress : svmAddress;
    const readAddress = userAddress ?? cachedAddress(cached, paymentNetwork, isEvm, connectionStatus);
    const isReconnecting = !account && (connectionStatus === 'unknown' || connectionStatus === 'connecting');
    const isResolving = isReconnecting || (Boolean(evmAddress) && !isEvm && (!svmAddress || !isActivated || isCreating));
    const chain = getChainByNetworkId(paymentNetwork);
    const operationKey = `${paymentNetwork}:${evmAddress}:${evmSignerAddress}:${svmAddress}:${chain?.rpcUrl}:${chain?.assetAddress}`;
    const current = useRef({ key: operationKey, generation: 0 });
    if (current.current.key !== operationKey) current.current = { key: operationKey, generation: current.current.generation + 1 };
    const generation = current.current.generation;
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const assertCurrent = () => {
        if (!mounted.current || current.current.generation !== generation || current.current.key !== operationKey) {
            throw new Error("The signer or selected network changed; retry the operation");
        }
    };

    const captureSolanaOperation = () => {
        assertCurrent();
        const signer = adminWallet?.getAccount();
        if (isEvm || !chain || !svmAddress || !signer || signer.address !== evmSignerAddress) throw new Error("Solana signer or network is not ready");
        return {
            chain,
            walletAddress: svmAddress,
            signerAddress: signer.address,
            assertCurrent,
            activate: async () => { assertCurrent(); await create(); assertCurrent(); },
            signMessage: async (message: Uint8Array) => {
                assertCurrent();
                if (adminWallet?.getAccount()?.address !== signer.address) throw new Error("The admin signer changed; retry the operation");
                const signature = await signer.signMessage({ message: { raw: message } });
                assertCurrent();
                return signature;
            },
        };
    };

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
        assertCurrent,
        captureSolanaOperation,
    };
}
