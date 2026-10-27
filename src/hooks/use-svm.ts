import type { Account } from "thirdweb/wallets";
import type { FacilitatorChain } from "@compose-market/sdk/chains";
import { getSwigWalletAddress } from "@swig-wallet/kit";
import { deriveSwigId, deriveSwigConfigAddress, deriveSwigWalletAddress, recoverEvmSecp256k1Pubkey, SWIG_AUTH_SIGN_MESSAGE } from "@/lib/svm/account";
import { createSolanaRpcFromNetwork, fetchSwigAccount, readSvmTokenBalance, buildSelfFundedCreateSwigTransaction, buildUsdcFundedCreateSwigTransaction, SVM_ACTIVATION_MINIMUM_LAMPORTS } from "@/lib/svm/swig";
import { sdk } from "@/lib/sdk";

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
import { useChain } from "@/contexts/Network";
import { isEvmNetwork } from "@/lib/chains";
import { clearSwigCreated, readCachedAccount, readSwigCreated, writeSwigCreated } from "@/lib/cache";

export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export interface SolanaActivationResult {
  signature: string;
  confirmed: boolean;
  reimbursementLamports: bigint;
}

const activationDependencies = {
  rpc: createSolanaRpcFromNetwork,
  config: deriveSwigConfigAddress,
  deriveWallet: deriveSwigWalletAddress,
  fetch: fetchSwigAccount,
  wallet: getSwigWalletAddress,
  balance: readSvmTokenBalance,
  pubkey: recoverEvmSecp256k1Pubkey,
  selfFunded: buildSelfFundedCreateSwigTransaction,
  usdcFunded: buildUsdcFundedCreateSwigTransaction,
  feePayer: () => sdk.svm.feePayer(),
  relay: (input: Parameters<typeof sdk.svm.relay>[0]) => sdk.svm.relay(input),
};

export function createActivationService(deps = activationDependencies) {
  const pending = new Map<string, Promise<SolanaActivationResult | null>>();
  return function activate(input: {
    chain: FacilitatorChain;
    signer: Account;
    walletAddress: string;
    assertCurrent: () => void;
    onFunding?: (balance: bigint) => void;
  }): Promise<SolanaActivationResult | null> {
    const { chain, signer, walletAddress, assertCurrent } = input;
    assertCurrent();
    const key = `${signer.address.toLowerCase()}:${chain.network}:${chain.rpcUrl}:${chain.assetAddress}:${walletAddress}`;
    const existingPromise = pending.get(key);
    if (existingPromise) return existingPromise.then(result => { assertCurrent(); return result; });

    const operation = (async () => {
      const rpc = deps.rpc(chain.network, chain.rpcUrl);
      const config = await deps.config(signer.address);
      assertCurrent();
      const derivedWallet = await deps.deriveWallet(signer.address);
      assertCurrent();
      if (derivedWallet !== walletAddress) throw new Error("Derived Swig wallet does not match the selected Solana address");
      const verify = async (swig: NonNullable<Awaited<ReturnType<typeof fetchSwigAccount>>>) => {
        if (await deps.wallet(swig) !== walletAddress) throw new Error("Swig wallet does not match the selected Solana address");
        if (!swig.findRolesBySecp256k1SignerAddress(signer.address).length) throw new Error("The admin signer has no role on the Swig account");
      };
      const swig = await deps.fetch(rpc, config);
      assertCurrent();
      if (swig) { await verify(swig); assertCurrent(); return null; }

      const balance = (await rpc.getBalance(walletAddress as any).send()).value;
      assertCurrent();
      input.onFunding?.(balance);
      const useUsdc = balance < SVM_ACTIVATION_MINIMUM_LAMPORTS && chain.network === SOLANA_MAINNET;
      const availableUsdc = useUsdc ? await deps.balance({ owner: walletAddress as any, mint: chain.assetAddress, rpc }) : 0n;
      assertCurrent();
      if (balance < SVM_ACTIVATION_MINIMUM_LAMPORTS && availableUsdc === 0n) {
        throw new Error(`Fund Solana account ${walletAddress} with at least 0.05 SOL before activation`);
      }
      const { feePayer } = await deps.feePayer();
      assertCurrent();
      const signature = await signer.signMessage({ message: SWIG_AUTH_SIGN_MESSAGE });
      assertCurrent();
      const evmPubkey = await deps.pubkey(signature, SWIG_AUTH_SIGN_MESSAGE);
      assertCurrent();
      const signMessage = async (message: Uint8Array) => {
        assertCurrent();
        const signed = await signer.signMessage({ message: { raw: message } });
        assertCurrent();
        return signed;
      };
      const args = { swigId: deriveSwigId(signer.address), evmPubkey, feePayer: feePayer as any, usdcMint: chain.assetAddress, rpc, signMessage };
      const activation = useUsdc
        ? await deps.usdcFunded({ ...args, availableUsdc, network: chain.network })
        : await deps.selfFunded(args);
      assertCurrent();
      const relayed = await deps.relay({ unsignedTransaction: activation.unsignedTransaction, network: chain.network });
      assertCurrent();
      if (!relayed.confirmed) throw new Error("Solana activation is awaiting confirmation");
      const created = await deps.fetch(rpc, config);
      assertCurrent();
      if (!created) throw new Error("Solana account creation relayed but Swig account was not found");
      await verify(created);
      assertCurrent();
      return { ...relayed, reimbursementLamports: activation.reimbursementLamports };
    })();
    pending.set(key, operation);
    void operation.finally(() => { if (pending.get(key) === operation) pending.delete(key); }).catch(() => undefined);
    return operation;
  };
}

export const activateSolanaAccount = createActivationService();

const ACTIVATION_POLL_MS = 5_000;

export function useSolanaSmartAccount() {
  const adminWallet = useAdminWallet();
  const signer = adminWallet?.getAccount();
  const adminAddress = signer?.address ?? null;
  const { paymentNetwork, solanaChains } = useChain();
  const selectedChain = useMemo(() => isEvmNetwork(paymentNetwork)
    ? solanaChains[0] : solanaChains.find(chain => chain.network === paymentNetwork), [paymentNetwork, solanaChains]);
  const [derived, setDerived] = useState<{ owner: string; address: string } | null>(() => {
    const cached = readCachedAccount();
    if (adminAddress && cached?.adminAddress?.toLowerCase() === adminAddress.toLowerCase() && cached.svmAddress) {
      return { owner: adminAddress, address: cached.svmAddress };
    }
    return null;
  });
  const swigAddress = derived?.owner === adminAddress
    ? derived.address
    : (adminAddress && readCachedAccount()?.adminAddress?.toLowerCase() === adminAddress.toLowerCase()
      ? readCachedAccount()?.svmAddress ?? null
      : null);
  const [creation, setCreation] = useState<{ key: string; generation: number; pending: boolean; error: string | null }>({ key: "", generation: 0, pending: false, error: null });
  const scopeKey = `${adminAddress}:${paymentNetwork}:${selectedChain?.rpcUrl}:${selectedChain?.assetAddress}`;
  const current = useRef({ key: scopeKey, generation: 0 });
  if (current.current.key !== scopeKey) current.current = { key: scopeKey, generation: current.current.generation + 1 };
  const generation = current.current.generation;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (!adminAddress) { setDerived(null); return; }
    let cancelled = false;
    void deriveSwigWalletAddress(adminAddress).then(address => {
      if (!cancelled) setDerived({ owner: adminAddress, address });
    }).catch(error => {
      if (!cancelled) setCreation({ key: scopeKey, generation, pending: false, error: error.message });
    });
    return () => { cancelled = true; };
  }, [adminAddress]);

  const cachedActivated = Boolean(adminAddress && selectedChain && readSwigCreated(adminAddress, selectedChain.network));
  const status = useQuery({
    queryKey: ['swig', adminAddress, selectedChain?.network, selectedChain?.rpcUrl, selectedChain?.assetAddress, swigAddress],
    enabled: Boolean(adminAddress && swigAddress && selectedChain && !isEvmNetwork(paymentNetwork)),
    retry: false,
    staleTime: ACTIVATION_POLL_MS,
    refetchInterval: (query) => query.state.data?.activated ? false : ACTIVATION_POLL_MS,
    queryFn: async () => {
      const rpc = createSolanaRpcFromNetwork(selectedChain!.network, selectedChain!.rpcUrl);
      const config = await deriveSwigConfigAddress(adminAddress!);
      const existing = await fetchSwigAccount(rpc, config);
      const balance = existing ? null : (await rpc.getBalance(swigAddress as any).send()).value;
      return { activated: Boolean(existing), balance };
    },
  });
  useEffect(() => {
    if (!adminAddress || !selectedChain || !status.data) return;
    if (status.data.activated) writeSwigCreated(adminAddress, selectedChain.network);
    else clearSwigCreated(adminAddress, selectedChain.network);
  }, [adminAddress, selectedChain, status.data]);

  const create = useCallback(async (): Promise<SolanaActivationResult | null> => {
    if (!signer || !adminAddress) throw new Error("EVM signer account not available");
    if (!swigAddress) throw new Error("Solana account address is still resolving");
    if (!selectedChain || isEvmNetwork(paymentNetwork)) throw new Error("Select a configured Solana network before activation");
    const assertCurrent = () => {
      if (!mounted.current || current.current.generation !== generation || current.current.key !== scopeKey || adminWallet?.getAccount()?.address !== adminAddress) {
        throw new Error("The signer or selected network changed; retry the operation");
      }
    };
    assertCurrent();
    setCreation({ key: scopeKey, generation, pending: true, error: null });
    try {
      const result = await activateSolanaAccount({ chain: selectedChain, signer, walletAddress: swigAddress, assertCurrent });
      assertCurrent();
      writeSwigCreated(adminAddress, selectedChain.network);
      await status.refetch();
      assertCurrent();
      return result;
    } catch (cause) {
      if (mounted.current && current.current.generation === generation) setCreation({ key: scopeKey, generation, pending: false, error: cause instanceof Error ? cause.message : String(cause) });
      throw cause;
    } finally {
      if (mounted.current && current.current.generation === generation) setCreation(value => ({ ...value, pending: false }));
    }
  }, [signer, adminAddress, swigAddress, selectedChain, paymentNetwork, scopeKey, generation, adminWallet, status.refetch]);

  const isActivated = status.data?.activated ?? cachedActivated;

  return {
    swigAddress,
    evmSignerAddress: adminAddress,
    isActivated,
    isCreating: creation.key === scopeKey && creation.generation === generation && creation.pending,
    requiredFundingLamports: isActivated ? null : SVM_ACTIVATION_MINIMUM_LAMPORTS,
    currentFundingLamports: status.data?.balance ?? null,
    error: creation.key === scopeKey && creation.generation === generation && creation.error ? creation.error : status.error?.message ?? null,
    create,
  };
}
