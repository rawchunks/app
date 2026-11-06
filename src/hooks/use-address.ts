import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useActiveAccount, useActiveWallet, useActiveWalletConnectionStatus, useAdminWallet } from "thirdweb/react";
import { useQueryClient } from '@tanstack/react-query';
import { useChain } from "@/contexts/Network";
import { isEvmNetwork } from "@/lib/chains";
import { getSmartAccountAdminWallet, useSolanaSmartAccount } from "@/hooks/use-svm";
import { isSolanaBrowserAccount } from "@/lib/svm/wallet";
import { cachedAddress, clearCachedAccount, purgeUserCaches, readCachedAccount, writeCachedAccount, writeCachedProfile } from '@/lib/cache';
import { api } from '@/lib/api';
import { bus } from '@/lib/bus';
import { store } from '@/lib/store';
import { useDawStore } from '@/lib/daw/store';

const syncedWalletPairs = new Set<string>();

function useOptionalQueryClient() {
    try {
        return useQueryClient();
    } catch {
        return null;
    }
}

function useIdentityState(isRootProvider: boolean) {
    const account = useActiveAccount();
    const activeWallet = useActiveWallet();
    const rawAdminWallet = useAdminWallet();
    const adminWallet = getSmartAccountAdminWallet(activeWallet, account, rawAdminWallet);
    const connectionStatus = useActiveWalletConnectionStatus();
    const queryClient = useOptionalQueryClient();
    const [cached, setCached] = useState(readCachedAccount);
    const [pairedAddresses, setPairedAddresses] = useState<{ evmAddress: string | null; svmAddress: string | null }>({
        evmAddress: null,
        svmAddress: null,
    });
    const {
        paymentNetwork,
        setSelectedNetwork,
        solanaChains,
        evmChains,
        defaultNetwork,
        getChainByNetworkId,
    } = useChain();
    const {
        swigAddress,
        evmSignerAddress,
        isActivated: swigActivated,
        isCreating,
        requiredFundingLamports,
        currentFundingLamports,
        error,
        create,
    } = useSolanaSmartAccount();

    const rawAccountAddress = account?.address?.trim() || null;
    const isAccountSvm = Boolean(rawAccountAddress && !rawAccountAddress.startsWith("0x"));
    const liveEvmAddress = rawAccountAddress && !isAccountSvm ? rawAccountAddress : null;
    const liveSvmAddress = isAccountSvm ? rawAccountAddress : (swigAddress ?? null);
    const isActivated = isAccountSvm ? true : swigActivated;

    useEffect(() => {
        const nextCached = readCachedAccount();
        setCached(nextCached);
        if (!liveEvmAddress && !liveSvmAddress) {
            setPairedAddresses({ evmAddress: null, svmAddress: null });
        }
    }, [liveEvmAddress, liveSvmAddress, connectionStatus]);

    const autoSwitchedIdentityRef = useRef<string | null>(null);
    useEffect(() => {
        if (!liveEvmAddress && !liveSvmAddress) {
            autoSwitchedIdentityRef.current = null;
            return;
        }
        const identityKey = `${liveEvmAddress ?? ""}:${liveSvmAddress ?? ""}:${evmSignerAddress ?? ""}`;
        if (autoSwitchedIdentityRef.current === identityKey) return;
        if (liveSvmAddress && !liveEvmAddress && isEvmNetwork(paymentNetwork)) {
            const targetSolana = (solanaChains?.[0]?.network ?? "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1") as any;
            autoSwitchedIdentityRef.current = identityKey;
            setSelectedNetwork?.(targetSolana);
            return;
        }
        if (liveEvmAddress && !liveSvmAddress && !evmSignerAddress && !isEvmNetwork(paymentNetwork)) {
            const targetEvm = (defaultNetwork && isEvmNetwork(defaultNetwork)
                ? defaultNetwork
                : evmChains?.[0]?.network ?? "eip155:8453") as any;
            autoSwitchedIdentityRef.current = identityKey;
            setSelectedNetwork?.(targetEvm);
        }
    }, [liveEvmAddress, liveSvmAddress, evmSignerAddress, paymentNetwork, solanaChains, evmChains, defaultNetwork, setSelectedNetwork]);

    const isEvm = isEvmNetwork(paymentNetwork);
    const isReconnecting = Boolean(cached) && !liveEvmAddress && !liveSvmAddress && (connectionStatus === 'unknown' || connectionStatus === 'connecting');
    const evmAddress =
        liveEvmAddress ||
        (liveSvmAddress ? pairedAddresses.evmAddress : null) ||
        (isReconnecting && cached?.address ? cached.address : null);
    const cachedMatchingSvm =
        liveEvmAddress && evmSignerAddress && cached?.address && cached.address.toLowerCase() === liveEvmAddress.toLowerCase()
            ? cached.svmAddress ?? null
            : null;
    const svmAddress =
        liveSvmAddress ||
        (liveEvmAddress ? pairedAddresses.svmAddress || cachedMatchingSvm : null) ||
        (isReconnecting && cached?.svmAddress ? cached.svmAddress : null);
    const userAddress = isEvm
        ? (liveEvmAddress ?? (liveSvmAddress ? (pairedAddresses.evmAddress ?? liveSvmAddress) : null))
        : (liveSvmAddress ?? (liveEvmAddress ? (pairedAddresses.svmAddress ?? svmAddress) : null));
    const readAddress = userAddress ?? liveEvmAddress ?? liveSvmAddress ?? cachedAddress(cached, paymentNetwork, isEvm, connectionStatus);
    const accountId = evmAddress ? evmAddress.toLowerCase() : (svmAddress ?? userAddress ?? readAddress ?? null);
    const isResolving = isReconnecting || (Boolean(evmSignerAddress) && !isEvm && (!svmAddress || !isActivated || isCreating));

    // Centralize store.setUserAddress in the root provider
    useEffect(() => {
        if (!isRootProvider) return;
        const activeAddress = userAddress ?? readAddress ?? '';
        store.setUserAddress(activeAddress, evmAddress, svmAddress);
    }, [isRootProvider, userAddress, readAddress, evmAddress, svmAddress]);

    // Sync identity and wallet pair (EVM-only, SVM-only, or dual-wallet) to backend once
    useEffect(() => {
        if (!liveEvmAddress && !liveSvmAddress) return;
        const key = `${(liveEvmAddress ?? '').toLowerCase()}:${liveSvmAddress ?? ''}`;
        if (syncedWalletPairs.has(key)) return;
        syncedWalletPairs.add(key);
        writeCachedAccount(liveEvmAddress ?? '', paymentNetwork, liveSvmAddress, undefined, undefined, undefined, evmSignerAddress);
        const sessionAddr = liveEvmAddress || liveSvmAddress || '';
        api.fetch('/api/user', {
            method: 'PUT',
            headers: {
                'content-type': 'application/json',
                'x-session-user-address': sessionAddr,
            },
            body: JSON.stringify({
                ...(liveEvmAddress ? { evmAddress: liveEvmAddress } : {}),
                ...(liveSvmAddress ? { svmAddress: liveSvmAddress } : {}),
            }),
        })
            .then(async (res) => {
                if (!res.ok) return;
                const data = await res.json();
                const resolvedEvm = typeof data?.evmAddress === 'string' && data.evmAddress ? data.evmAddress : liveEvmAddress;
                const resolvedSvm = typeof data?.svmAddress === 'string' && data.svmAddress ? data.svmAddress : liveSvmAddress;
                if (resolvedEvm || resolvedSvm) {
                    setPairedAddresses({
                        evmAddress: resolvedEvm ?? null,
                        svmAddress: resolvedSvm ?? null,
                    });
                }
                const profile = {
                    nickname: data?.nickname ?? null,
                    avatar: data?.avatar ?? null,
                    bio: data?.bio ?? null,
                };
                if (resolvedEvm) writeCachedProfile(resolvedEvm, profile);
                if (resolvedSvm) writeCachedProfile(resolvedSvm, profile);
                writeCachedAccount(
                    resolvedEvm ?? '',
                    paymentNetwork,
                    resolvedSvm,
                    profile.nickname,
                    profile.avatar,
                    profile.bio,
                    evmSignerAddress,
                );
                setCached(readCachedAccount());
            })
            .catch(() => {
                syncedWalletPairs.delete(key);
            });
    }, [liveEvmAddress, liveSvmAddress, paymentNetwork, evmSignerAddress]);

    // Root identity lifecycle & cross-tab security enforcement
    const canonicalIdentity = (liveEvmAddress || liveSvmAddress || (isReconnecting ? (cached?.address || cached?.svmAddress) : null))?.toLowerCase() ?? null;
    const prevIdentityRef = useRef<string | null>(canonicalIdentity);

    useEffect(() => {
        if (!isRootProvider) return;
        const prev = prevIdentityRef.current;
        if (prev && ((!canonicalIdentity && !isReconnecting) || (canonicalIdentity && prev !== canonicalIdentity))) {
            const isSwitch = Boolean(canonicalIdentity && prev !== canonicalIdentity);
            if (!isSwitch) {
                purgeUserCaches();
                clearCachedAccount();
                setCached(null);
            }
            syncedWalletPairs.clear();
            useDawStore.getState().resetDaw();
            store.clearUserWorkspace(!isSwitch);
            queryClient?.clear();
            try { sessionStorage.removeItem('rawchunks_editing_song'); } catch {}
            if (isSwitch && canonicalIdentity) {
                bus.broadcastAccountSwitch(canonicalIdentity);
            }
        }
        prevIdentityRef.current = canonicalIdentity;
    }, [isRootProvider, canonicalIdentity, isReconnecting, queryClient]);

    useEffect(() => {
        if (!isRootProvider) return;

        const wipeRemoteSession = () => {
            syncedWalletPairs.clear();
            setPairedAddresses({ evmAddress: null, svmAddress: null });
            setCached(readCachedAccount());
            try { void activeWallet?.disconnect(); } catch {}
            try { void rawAdminWallet?.disconnect(); } catch {}
            useDawStore.getState().resetDaw();
            store.clearUserWorkspace(false);
            queryClient?.clear();
            try { sessionStorage.removeItem('rawchunks_editing_song'); } catch {}
        };

        const unsubLogout = bus.onRemoteLogout(() => {
            clearCachedAccount();
            wipeRemoteSession();
        });

        const unsubSwitch = bus.onRemoteAccountSwitch((nextAddress) => {
            const currentEvm = liveEvmAddress?.toLowerCase();
            const currentSvm = liveSvmAddress?.toLowerCase();
            const target = nextAddress.toLowerCase();
            if (target !== currentEvm && target !== currentSvm) {
                wipeRemoteSession();
            }
        });

        const handleStorage = (e: StorageEvent) => {
            if (e.key !== 'last_account') return;
            if (!e.newValue) {
                wipeRemoteSession();
                return;
            }
            try {
                const parsed = JSON.parse(e.newValue) as { address?: string; svmAddress?: string } | null;
                const nextEvm = parsed?.address?.toLowerCase();
                const nextSvm = parsed?.svmAddress?.toLowerCase();
                const currentEvm = liveEvmAddress?.toLowerCase();
                const currentSvm = liveSvmAddress?.toLowerCase();
                if ((currentEvm && nextEvm && currentEvm !== nextEvm) || (currentSvm && nextSvm && currentSvm !== nextSvm)) {
                    wipeRemoteSession();
                }
            } catch {}
        };

        window.addEventListener('storage', handleStorage);
        return () => {
            unsubLogout();
            unsubSwitch();
            window.removeEventListener('storage', handleStorage);
        };
    }, [isRootProvider, activeWallet, rawAdminWallet, liveEvmAddress, liveSvmAddress, queryClient]);

    const disconnect = useCallback(() => {
        syncedWalletPairs.clear();
        setPairedAddresses({ evmAddress: null, svmAddress: null });
        purgeUserCaches();
        clearCachedAccount();
        setCached(null);
        useDawStore.getState().resetDaw();
        store.clearUserWorkspace(true);
        queryClient?.clear();
        try { sessionStorage.removeItem('rawchunks_editing_song'); } catch {}
        try { void activeWallet?.disconnect(); } catch {}
        try { void rawAdminWallet?.disconnect(); } catch {}
    }, [activeWallet, rawAdminWallet, queryClient]);

    const addresses = useMemo(() => {
        const list: string[] = [];
        const candidates = [
            evmAddress,
            svmAddress,
            userAddress,
            readAddress,
        ];
        for (const item of candidates) {
            if (item && !list.some((existing) => existing.toLowerCase() === item.toLowerCase())) {
                list.push(item);
            }
        }
        return list;
    }, [evmAddress, svmAddress, userAddress, readAddress]);

    const matchesIdentity = useCallback(
        (target?: string | null) => {
            if (!target) return false;
            const clean = target.trim().toLowerCase();
            return addresses.some((addr) => addr.toLowerCase() === clean);
        },
        [addresses],
    );
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
        if (isEvm || !chain || !svmAddress) throw new Error("Solana signer or network is not ready");
        if (isAccountSvm && isSolanaBrowserAccount(account) && account.address === svmAddress) {
            const browserAccount = account;
            return {
                chain,
                walletAddress: svmAddress,
                signerAddress: "",
                assertCurrent,
                activate: async () => { assertCurrent(); },
                signMessage: async (message: Uint8Array) => {
                    assertCurrent();
                    if (account?.address !== browserAccount.address) throw new Error("The Solana wallet changed; retry the operation");
                    const signature = await browserAccount.signMessage({ message: { raw: message } });
                    assertCurrent();
                    return signature;
                },
                signTransaction: async (wireTransactionBytes: Uint8Array) => {
                    assertCurrent();
                    if (account?.address !== browserAccount.address) throw new Error("The Solana wallet changed; retry the operation");
                    const signed = await browserAccount.signSolanaTransaction(wireTransactionBytes);
                    assertCurrent();
                    return signed;
                },
            };
        }
        const signer = adminWallet?.getAccount();
        if (!signer || signer.address !== evmSignerAddress) throw new Error("Solana signer or network is not ready");
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
            signTransaction: undefined as ((wireTransactionBytes: Uint8Array) => Promise<Uint8Array>) | undefined,
        };
    };

    return {
        userAddress,
        readAddress,
        accountId,
        isReconnecting,
        evmAddress,
        svmAddress,
        addresses,
        matchesIdentity,
        disconnect,
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

type IdentityContextValue = ReturnType<typeof useIdentityState>;

const IdentityContext = createContext<IdentityContextValue | null>(null);

export function IdentityProvider({ children }: { children: React.ReactNode }) {
    const value = useIdentityState(true);
    return React.createElement(IdentityContext.Provider, { value }, children);
}

export function useSelectedUserAddress(): IdentityContextValue {
    const context = useContext(IdentityContext);
    if (context) return context;
    // Fallback when rendered outside IdentityProvider in isolated unit tests
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useIdentityState(false);
}
