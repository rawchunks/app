/**
 * useSolanaSmartAccount — deterministic Solana Swig smart account per
 * Thirdweb smart-account admin signer.
 *
 * One Thirdweb admin signer ↔ one Solana smart account, forever.
 *
 * This hook mirrors the EVM pattern exactly:
 *   EVM:  useActiveAccount() → smart account address (instant, client-side)
 *   SVM:  this hook → wallet PDA address (instant, client-side)
 *
 * The admin wallet returned by Thirdweb's useAdminWallet() is the signer
 * behind the visible EVM smart account. It is the Swig authority and the
 * deterministic seed source. The visible EVM smart account remains the EVM
 * userAddress; the walletPda below is the SVM userAddress.
 *
 * The walletPda is what the user sees, funds, and what balance/settlement use.
 * The configPda is internal — only for fetchSwigAccount + instruction building.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAdminWallet } from "thirdweb/react";
import { sdk } from "@/lib/sdk";
import { useChain } from "@/contexts/Network";
import { isEvmNetwork } from "@/lib/chains";
import { clearSwigCreated, readSwigCreated, writeSwigCreated } from "@/lib/cache";
import {
    deriveSwigId,
    deriveSwigConfigAddress,
    deriveSwigWalletAddress,
    recoverEvmSecp256k1Pubkey,
    SWIG_AUTH_SIGN_MESSAGE,
} from "@/lib/svm/account";
import {
    createSolanaRpcFromNetwork,
    fetchSwigAccount,
    buildSelfFundedCreateSwigTransaction,
    buildUsdcFundedCreateSwigTransaction,
    readSvmTokenBalance,
    SVM_ACTIVATION_MINIMUM_LAMPORTS,
} from "@/lib/svm/swig";

const ACTIVATION_POLL_MS = 5_000;
const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

export interface SolanaActivationResult {
    signature: string;
    confirmed: boolean;
    reimbursementLamports: bigint;
}

const activationPromises = new Map<string, Promise<SolanaActivationResult>>();

export interface SolanaSmartAccountState {
    swigAddress: string | null;
    evmSignerAddress: string | null;
    isActivated: boolean;
    isCreating: boolean;
    requiredFundingLamports: bigint | null;
    currentFundingLamports: bigint | null;
    error: string | null;
}

export function useSolanaSmartAccount(): SolanaSmartAccountState & {
    create: () => Promise<SolanaActivationResult | null>;
} {
    const adminWallet = useAdminWallet();
    const { paymentNetwork, solanaChains } = useChain();
    const [swigAddress, setSwigAddress] = useState<string | null>(null);
    const [evmSignerAddress, setEvmSignerAddress] = useState<string | null>(null);
    const [isActivated, setIsActivated] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [requiredFundingLamports, setRequiredFundingLamports] = useState<bigint | null>(null);
    const [currentFundingLamports, setCurrentFundingLamports] = useState<bigint | null>(null);
    const [error, setError] = useState<string | null>(null);
    const creatingRef = useRef(false);
    const checkedKeyRef = useRef<string | null>(null);

    const selectedSolanaChain = useMemo(() => {
        const defaultSolanaChain = solanaChains.at(0) ?? null;
        if (!isEvmNetwork(paymentNetwork)) {
            return solanaChains.find((chain) => chain.network === paymentNetwork) ?? defaultSolanaChain;
        }
        return defaultSolanaChain;
    }, [paymentNetwork, solanaChains]);

    const selectedSolanaNetwork = selectedSolanaChain?.network ?? null;
    const selectedSolanaRpcUrl = selectedSolanaChain?.rpcUrl ?? null;

    const adminAddress = adminWallet?.getAccount?.()?.address ?? null;

    const create = useCallback(async () => {
        if (!adminAddress) throw new Error("EVM signer account not available");
        if (!swigAddress) throw new Error("Solana account address is still resolving");
        if (!selectedSolanaNetwork || !selectedSolanaRpcUrl || !selectedSolanaChain) {
            throw new Error("Solana network configuration is not available");
        }

        const swigId = deriveSwigId(adminAddress);
        const configPda = await deriveSwigConfigAddress(adminAddress);
        const checkedKey = `${adminAddress.toLowerCase()}:${selectedSolanaNetwork}:${configPda}`;
        const sharedActivation = activationPromises.get(checkedKey);
        if (sharedActivation) {
            setIsCreating(true);
            try {
                const activationResult = await sharedActivation;
                setIsActivated(true);
                setRequiredFundingLamports(null);
                setCurrentFundingLamports(null);
                setError(null);
                return activationResult;
            } catch (err) {
                const failure = err instanceof Error ? err : new Error(String(err));
                setError(failure.message);
                throw failure;
            } finally {
                setIsCreating(false);
            }
        }
        if (creatingRef.current) {
            throw new Error("Solana account activation is already in progress");
        }

        creatingRef.current = true;
        setIsCreating(true);
        setError(null);
        try {
            const rpc = createSolanaRpcFromNetwork(selectedSolanaNetwork, selectedSolanaRpcUrl);

            const existing = await fetchSwigAccount(rpc, configPda);
            if (existing) {
                writeSwigCreated(adminAddress, selectedSolanaNetwork);
                checkedKeyRef.current = checkedKey;
                setIsActivated(true);
                setRequiredFundingLamports(null);
                setCurrentFundingLamports(null);
                return null;
            }

            setIsActivated(false);

            const walletBalance = await rpc.getBalance(swigAddress as any).send();
            setRequiredFundingLamports(SVM_ACTIVATION_MINIMUM_LAMPORTS);
            setCurrentFundingLamports(walletBalance.value);
            const useUsdcFallback = walletBalance.value < SVM_ACTIVATION_MINIMUM_LAMPORTS
                && selectedSolanaNetwork === SOLANA_MAINNET;
            const availableUsdc = useUsdcFallback
                ? await readSvmTokenBalance({
                    owner: swigAddress as any,
                    mint: selectedSolanaChain.assetAddress,
                    rpc,
                })
                : 0n;
            if (walletBalance.value < SVM_ACTIVATION_MINIMUM_LAMPORTS && availableUsdc === 0n) {
                throw new Error(
                    `Fund Solana account ${swigAddress} with at least ${SVM_ACTIVATION_MINIMUM_LAMPORTS} lamports before activation`,
                );
            }

            const activationPromise = (async () => {
                const account = adminWallet?.getAccount?.();
                if (!account) throw new Error("EVM account not available for signing");

                const { feePayer } = await sdk.svm.feePayer();
                const signature = await account.signMessage({
                    message: SWIG_AUTH_SIGN_MESSAGE,
                });
                const evmPubkey = await recoverEvmSecp256k1Pubkey(signature, SWIG_AUTH_SIGN_MESSAGE);
                const signMessage = async (message: Uint8Array) => {
                    return account.signMessage({ message: { raw: message } as any });
                };
                const activation = useUsdcFallback
                    ? await buildUsdcFundedCreateSwigTransaction({
                        swigId,
                        evmPubkey,
                        feePayer: feePayer as any,
                        usdcMint: selectedSolanaChain.assetAddress,
                        availableUsdc,
                        network: selectedSolanaNetwork,
                        rpc,
                        signMessage,
                    })
                    : await buildSelfFundedCreateSwigTransaction({
                        swigId,
                        evmPubkey,
                        feePayer: feePayer as any,
                        usdcMint: selectedSolanaChain.assetAddress,
                        rpc,
                        signMessage,
                    });
                const relayed = await sdk.svm.relay({
                    unsignedTransaction: activation.unsignedTransaction,
                    network: selectedSolanaNetwork,
                });
                return {
                    ...relayed,
                    reimbursementLamports: activation.reimbursementLamports,
                };
            })();
            activationPromises.set(checkedKey, activationPromise);
            void activationPromise.finally(() => {
                if (activationPromises.get(checkedKey) === activationPromise) {
                    activationPromises.delete(checkedKey);
                }
            }).catch(() => undefined);
            const activationResult = await activationPromise;

            const created = await fetchSwigAccount(rpc, configPda);
            if (!created) {
                throw new Error("Solana account creation relayed but Swig account was not found");
            }
            writeSwigCreated(adminAddress, selectedSolanaNetwork);
            checkedKeyRef.current = checkedKey;
            setIsActivated(true);
            setRequiredFundingLamports(null);
            setCurrentFundingLamports(null);
            return activationResult;
        } catch (err) {
            const failure = err instanceof Error ? err : new Error(String(err));
            console.error("[useSolanaSmartAccount] Failed:", failure.message);
            setError(failure.message);
            throw failure;
        } finally {
            creatingRef.current = false;
            setIsCreating(false);
        }
    }, [adminAddress, adminWallet, selectedSolanaChain, selectedSolanaNetwork, selectedSolanaRpcUrl, swigAddress]);

    useEffect(() => {
        checkedKeyRef.current = null;
        setIsActivated(false);
        setRequiredFundingLamports(null);
        setCurrentFundingLamports(null);
        setError(null);
    }, [adminAddress, selectedSolanaNetwork]);

    useEffect(() => {
        if (!adminAddress) {
            setSwigAddress(null);
            setEvmSignerAddress(null);
            setIsActivated(false);
            setRequiredFundingLamports(null);
            setCurrentFundingLamports(null);
            setError(null);
            checkedKeyRef.current = null;
            return;
        }

        setEvmSignerAddress(adminAddress);

        let cancelled = false;
        setError(null);
        checkedKeyRef.current = null;
        (async () => {
            try {
                const walletPda = await deriveSwigWalletAddress(adminAddress);
                if (cancelled) return;
                setSwigAddress(walletPda);
            } catch (err) {
                if (cancelled) return;
                console.error("[useSolanaSmartAccount] Derive failed:", err);
            }
        })();

        return () => { cancelled = true; };
    }, [adminAddress]);

    useEffect(() => {
        if (!adminAddress || !selectedSolanaNetwork) return;
        if (readSwigCreated(adminAddress, selectedSolanaNetwork)) {
            setIsActivated(true);
            setRequiredFundingLamports(null);
            setCurrentFundingLamports(null);
        }
    }, [adminAddress, selectedSolanaNetwork]);

    const status = useQuery({
        queryKey: ['swig', adminAddress?.toLowerCase(), selectedSolanaNetwork, selectedSolanaRpcUrl, swigAddress],
        enabled: Boolean(adminAddress && swigAddress && selectedSolanaNetwork && selectedSolanaRpcUrl),
        retry: false,
        staleTime: ACTIVATION_POLL_MS,
        refetchInterval: ACTIVATION_POLL_MS,
        queryFn: async () => {
            const rpc = createSolanaRpcFromNetwork(selectedSolanaNetwork!, selectedSolanaRpcUrl!);
            const configPda = await deriveSwigConfigAddress(adminAddress!);
            const existing = await fetchSwigAccount(rpc, configPda);
            const balance = existing ? null : (await rpc.getBalance(swigAddress as any).send()).value;
            return { configPda, activated: Boolean(existing), balance };
        },
    });

    useEffect(() => {
        if (!adminAddress || !selectedSolanaNetwork || !status.data) return;
        checkedKeyRef.current = `${adminAddress.toLowerCase()}:${selectedSolanaNetwork}:${status.data.configPda}`;
        if (status.data.activated) writeSwigCreated(adminAddress, selectedSolanaNetwork);
        else clearSwigCreated(adminAddress, selectedSolanaNetwork);
        setIsActivated(status.data.activated);
        setRequiredFundingLamports(status.data.activated ? null : SVM_ACTIVATION_MINIMUM_LAMPORTS);
        setCurrentFundingLamports(status.data.balance);
        setError(null);
    }, [adminAddress, selectedSolanaNetwork, status.data, status.dataUpdatedAt]);

    useEffect(() => {
        if (status.error) setError(status.error.message);
    }, [status.error]);

    return {
        swigAddress,
        evmSignerAddress,
        isActivated,
        isCreating,
        requiredFundingLamports,
        currentFundingLamports,
        error,
        create,
    };
}
