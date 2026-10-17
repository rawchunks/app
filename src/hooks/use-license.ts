import { useState } from 'react';
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query';
import { useActiveAccount, useAdminWallet } from 'thirdweb/react';
import { Bridge, readContract, simulateTransaction, sendAndConfirmTransaction, type PreparedTransaction } from 'thirdweb';
import { prepareTempoTransaction } from '../components/connector';
import { toast } from 'sonner';
import type { SolanaNetworkId } from '@compose-market/sdk/chains';
import { useSelectedUserAddress } from './use-address';
import * as chainUtils from '../lib/chains';
const { thirdwebClient, isEvmNetwork, getEvmChainObject, getNetworkRpcUrl } = chainUtils;
import { buyLicense, getFactoryContract, getRoyaltiesContract, requireEvmDeployment } from '../lib/contracts';
import { fetchSolanaHasLicense, fetchSolanaSong, relaySolanaBuyLicense, requireSolanaDeployment } from '../lib/programs';
import { creditsApi } from '../lib/credits';
import { sdk } from '../lib/sdk';
import { store } from '../lib/store';
import { fetchFromIpfs } from '../lib/pinata';
import { licenseSales } from '../lib/versions';
import type { Song } from '../lib/schema';

const licenseKey = (song: Song, evmAddress: string | null, svmAddress: string | null) =>
  ['license', song.id, song.network, song.chain_song_id, song.metadata_cid, evmAddress, svmAddress];

async function readLicense(song: Song, evmAddress: string | null, svmAddress: string | null) {
  if (song.source) throw new Error('Remixes cannot be licensed');
  if (!song.chain_song_id || !song.network || !song.metadata_cid) throw new Error('The song has not been minted');
  const id = BigInt(song.chain_song_id);
  if (isEvmNetwork(song.network)) {
    const chain = getEvmChainObject(song.network);
    if (!chain) throw new Error('The song network is unavailable');
    const factory = getFactoryContract(thirdwebClient, chain);
    const data = await readContract({ contract: factory, method: 'getSong', params: [id] });
    if (data.isRemix) throw new Error('Remixes cannot be licensed');
    if (data.creator.toLowerCase() !== song.creator.toLowerCase() || data.metadataUri !== `ipfs://${song.metadata_cid}`) throw new Error('The song mint does not match the catalogue');
    const owned = evmAddress ? await readContract({ contract: factory, method: 'hasLicense', params: [id, evmAddress] }) : false;
    return { owned, price: data.licensePrice, remaining: data.licenseAmount, available: data.remixable && !data.isRemix };
  }
  const args = { network: song.network as SolanaNetworkId, rpcUrl: getNetworkRpcUrl(song.network), songId: id };
  const data = await fetchSolanaSong(args);
  if (data.isRemix) throw new Error('Remixes cannot be licensed');
  if (data.creator !== song.creator || data.metadataUri !== `ipfs://${song.metadata_cid}`) throw new Error('The song mint does not match the catalogue');
  const owned = svmAddress ? await fetchSolanaHasLicense({ ...args, user: svmAddress }) : false;
  return { owned, price: data.licensePrice, remaining: data.licenseAmount, available: data.remixable && !data.isRemix };
}

export function useLicensedSongs(songs: Song[]) {
  const { userAddress, evmAddress, svmAddress } = useSelectedUserAddress();
  const originals = songs.filter(song => !song.source && song.chain_song_id && song.network && song.metadata_cid);
  const results = useQueries({ queries: originals.map(song => ({
    queryKey: licenseKey(song, evmAddress, svmAddress),
    enabled: Boolean(userAddress),
    retry: false,
    queryFn: () => readLicense(song, evmAddress, svmAddress),
  })) });
  return {
    songs: userAddress ? originals.filter((_, index) => results[index].data?.owned) : [],
    loading: Boolean(userAddress) && results.some(result => result.isPending),
    error: results.find(result => result.error)?.error ?? null,
  };
}

export function useLicense(song: Song, onEditSong?: (song: Song) => void, includeSales = true, readOnMount = true) {
  const account = useActiveAccount();
  const adminWallet = useAdminWallet();
  const { userAddress, evmAddress, svmAddress, paymentNetwork, captureSolanaOperation, assertCurrent } = useSelectedUserAddress();
  const [pending, setPending] = useState(false);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: licenseKey(song, evmAddress, svmAddress),
    enabled: Boolean(readOnMount && !song.source && song.chain_song_id && song.network),
    retry: false,
    queryFn: () => readLicense(song, evmAddress, svmAddress),
  });

  const allocation = useQuery({
    queryKey: ['allocation', song.metadata_cid],
    enabled: Boolean(includeSales && !song.source && song.chain_song_id && song.metadata_cid),
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const metadata = await fetchFromIpfs<Song>(song.metadata_cid!);
      if (!Number.isSafeInteger(metadata.licenses) || metadata.licenses < 0) throw new Error('The minted license allocation is unavailable');
      return metadata.licenses;
    },
  });
  let sold: number | undefined;
  let salesError = allocation.error;
  if (allocation.data !== undefined && query.data) {
    try { sold = licenseSales(allocation.data, query.data.remaining); }
    catch (error) { salesError = error instanceof Error ? error : new Error('Could not read license sales'); }
  }

  let testnetMode = song.network !== 'eip155:8453' && song.network !== 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
  try {
    if (typeof chainUtils.isTestnet === 'function') {
      const mode = typeof chainUtils.getNetworkMode === 'function' ? chainUtils.getNetworkMode() : 'testnet';
      testnetMode = mode === 'testnet' && !chainUtils.isMainnet(song.network);
    }
  } catch { /* Partial unit test mocks of chains omit mode helpers. */ }

  const executeOnChainPurchase = async (
    price: bigint,
    solana: ReturnType<typeof captureSolanaOperation> | null,
  ) => {
    if (!song.chain_song_id || !song.network) throw new Error('The license is unavailable');
    if (isEvmNetwork(song.network)) {
      if (!account) throw new Error('Connect your wallet');
      const chain = getEvmChainObject(song.network);
      if (!chain) throw new Error('The song network is unavailable');
      await requireEvmDeployment(chain, ['Factory', 'Remix', 'Royalties']);
      assertCurrent();
      const execute = async (transaction: PreparedTransaction<any>) => {
        assertCurrent();
        let prepared = { account, transaction };
        if (chain.id === 42431) {
          const admin = adminWallet?.getAccount();
          if (!adminWallet || !admin) throw new Error('The admin signer is not ready');
          prepared = await prepareTempoTransaction({ chain, admin, adminWallet,
            accountAddress: account.address, assertCurrent }, transaction);
        }
        await simulateTransaction(prepared);
        assertCurrent();
        const receipt = await sendAndConfirmTransaction(prepared);
        assertCurrent();
        return receipt;
      };
      await buyLicense({
        client: thirdwebClient,
        chain,
        account,
        songId: BigInt(song.chain_song_id),
        price,
        execute,
        assertCurrent,
      });
    } else {
      if (!solana) throw new Error('Solana account is not ready');
      await requireSolanaDeployment({ network: song.network as SolanaNetworkId, rpcUrl: solana.chain.rpcUrl }, ['Factory', 'Remix', 'Royalties']);
      solana.assertCurrent();
      await solana.activate();
      await relaySolanaBuyLicense({
        network: song.network as SolanaNetworkId,
        rpcUrl: solana.chain.rpcUrl,
        selectedSvmAddress: solana.walletAddress,
        evmSignerAddress: solana.signerAddress,
        songId: BigInt(song.chain_song_id),
        signMessage: solana.signMessage,
        assertCurrent: solana.assertCurrent,
      });
      solana.assertCurrent();
    }
    const licensed = await query.refetch({ throwOnError: true });
    assertCurrent();
    if (!licensed.data?.owned) throw new Error('The purchase has not been confirmed');
    await queryClient.invalidateQueries({ queryKey: ['license', song.id] });
    assertCurrent();
    toast.success('License purchased. You can remix this song from My-Page.');
  };

  const buy = async () => {
    if (pending) return;
    if (song.source) { toast.error('Remixes cannot be licensed'); return; }
    if (!account || !userAddress) { toast.error('Connect your wallet'); return; }
    if (paymentNetwork !== song.network) { toast.error('Select the song network in your wallet'); return; }
    setPending(true);
    try {
      const solana = !isEvmNetwork(paymentNetwork) ? captureSolanaOperation() : null;
      const state = await query.refetch({ throwOnError: true });
      assertCurrent();
      if (!state.data || !song.chain_song_id || !song.network) throw new Error('The license is unavailable');
      if (!state.data.owned) {
        if (!state.data.available || state.data.remaining === 0n) throw new Error('No licenses are available');
        await executeOnChainPurchase(state.data.price, solana);
      } else {
        await queryClient.invalidateQueries({ queryKey: ['license', song.id] });
        assertCurrent();
        toast.success('License purchased. You can remix this song from My-Page.');
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not buy the license'); }
    finally { setPending(false); }
  };

  const createFiatOrder = async (idempotencyKey: string) => {
    if (song.source) throw new Error('Remixes cannot be licensed');
    if (!account || !userAddress) throw new Error('Connect your wallet');
    if (paymentNetwork !== song.network) throw new Error('Select the song network in your wallet');
    if (!song.chain_song_id || !song.network) throw new Error('The license is unavailable');
    const state = await query.refetch({ throwOnError: true });
    assertCurrent();
    if (!state.data) throw new Error('The license is unavailable');
    if (state.data.owned) throw new Error('You already own a license for this song');
    if (!state.data.available || state.data.remaining === 0n) throw new Error('No licenses are available');
    const result = await creditsApi<{ operationId: string; orderId: string; status: string }>(
      'license/create-order',
      {
        songId: song.id,
        chainSongId: song.chain_song_id,
        network: song.network,
        amountAtomics: state.data.price.toString(),
        walletAddress: userAddress,
      },
      idempotencyKey,
    );
    return { ...result, price: state.data.price };
  };

  const completeFiatOrder = async ({ operationId, orderId, price }: { operationId: string; orderId: string; price?: bigint }) => {
    if (pending) return;
    setPending(true);
    try {
      const solana = !isEvmNetwork(paymentNetwork) ? captureSolanaOperation() : null;
      const capture = await creditsApi<{ status: string; coinflowPaymentId?: string | null }>('license/capture-order', {
        operationId,
        orderId,
      });
      if (capture.status !== 'completed' && capture.status !== 'credited') throw new Error('Card payment could not be confirmed');
      const state = await query.refetch({ throwOnError: true });
      assertCurrent();
      if (!state.data || !song.chain_song_id || !song.network) throw new Error('The license is unavailable');
      if (!state.data.owned) {
        await executeOnChainPurchase(price ?? state.data.price, solana);
      } else {
        await queryClient.invalidateQueries({ queryKey: ['license', song.id] });
        assertCurrent();
        toast.success('License purchased. You can remix this song from My-Page.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not complete card license purchase');
      throw error;
    } finally {
      setPending(false);
    }
  };

  const buyWithStripeBridge = async () => {
    if (pending) return;
    if (song.source) { toast.error('Remixes cannot be licensed'); return; }
    if (!account || !userAddress) { toast.error('Connect your wallet'); return; }
    if (paymentNetwork !== song.network) { toast.error('Select the song network in your wallet'); return; }
    setPending(true);
    try {
      const solana = !isEvmNetwork(paymentNetwork) ? captureSolanaOperation() : null;
      const state = await query.refetch({ throwOnError: true });
      assertCurrent();
      if (!state.data || !song.chain_song_id || !song.network) throw new Error('The license is unavailable');
      if (!state.data.owned) {
        if (!state.data.available || state.data.remaining === 0n) throw new Error('No licenses are available');
        let chainId = 8453;
        let tokenAddress = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`;
        if (isEvmNetwork(song.network)) {
          const chain = getEvmChainObject(song.network);
          if (!chain) throw new Error('The song network is unavailable');
          chainId = chain.id;
          const royalties = getRoyaltiesContract(thirdwebClient, chain);
          tokenAddress = (await readContract({ contract: royalties, method: 'usdc' })) as `0x${string}`;
          assertCurrent();
        }
        const preparedOnramp = await Bridge.Onramp.prepare({
          client: thirdwebClient,
          onramp: 'stripe',
          chainId,
          tokenAddress,
          receiver: account.address as `0x${string}`,
          amount: state.data.price,
          currency: 'USD',
          purchaseData: { songId: song.id, chainSongId: song.chain_song_id, network: song.network },
        });
        assertCurrent();
        const popup = typeof window !== 'undefined'
          ? window.open(preparedOnramp.link, 'rawchunks_stripe_onramp', 'width=500,height=720')
          : null;
        const deadline = Date.now() + 10 * 60 * 1000;
        while (Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 2500));
          assertCurrent();
          const onrampStatus = await Bridge.Onramp.status({
            id: preparedOnramp.id,
            client: thirdwebClient,
          });
          if (onrampStatus.status === 'COMPLETED') {
            popup?.close();
            break;
          }
          if (onrampStatus.status === 'FAILED') {
            popup?.close();
            throw new Error('Stripe onramp payment failed');
          }
          if (popup && popup.closed && onrampStatus.status === 'CREATED') {
            throw new Error('Stripe checkout window was closed before completion');
          }
        }
        await executeOnChainPurchase(state.data.price, solana);
      } else {
        await queryClient.invalidateQueries({ queryKey: ['license', song.id] });
        assertCurrent();
        toast.success('License purchased. You can remix this song from My-Page.');
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not buy the license with Stripe'); }
    finally { setPending(false); }
  };

  const remix = async () => {
    if (pending || !onEditSong) return;
    if (!userAddress) { toast.error('Connect your wallet'); return; }
    if (paymentNetwork !== song.network) { toast.error('Select the song network in your wallet'); return; }
    setPending(true);
    try {
      const state = await query.refetch({ throwOnError: true });
      if (!state.data?.owned) throw new Error('A purchased license is required to remix this song');
      const response = await sdk.fetch(`/api/songs/${encodeURIComponent(song.id)}/remix`, { method: 'POST', userAddress });
      const created = await response.json();
      if (!response.ok) throw new Error(created.error || 'Could not open a remix');
      store.addSong(created);
      onEditSong(created);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not open a remix'); }
    finally { setPending(false); }
  };
  return { ...query, buy, createFiatOrder, completeFiatOrder, buyWithStripeBridge, testnetMode, remix, pending, sold, salesError };
}

