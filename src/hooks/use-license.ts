import { useState } from 'react';
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query';
import { useActiveAccount } from 'thirdweb/react';
import { getContract, readContract, prepareContractCall, simulateTransaction, sendAndConfirmTransaction } from 'thirdweb';
import { toast } from 'sonner';
import type { SolanaNetworkId } from '@compose-market/sdk/chains';
import { useSelectedUserAddress } from './use-address';
import { thirdwebClient, isEvmNetwork, getEvmChainObject, getNetworkRpcUrl } from '../lib/chains';
import { getFactoryContract, getRemixContract, getRoyaltiesContract, requireEvmDeployment } from '../lib/contracts';
import { fetchSolanaHasLicense, fetchSolanaSong, relaySolanaBuyLicense, requireSolanaDeployment } from '../lib/programs';
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

export function useLicense(song: Song, onEditSong?: (song: Song) => void, includeSales = true) {
  const account = useActiveAccount();
  const { userAddress, evmAddress, svmAddress, paymentNetwork, captureSolanaOperation, assertCurrent } = useSelectedUserAddress();
  const [pending, setPending] = useState(false);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: licenseKey(song, evmAddress, svmAddress),
    enabled: Boolean(!song.source && song.chain_song_id && song.network),
    retry: false,
    queryFn: () => readLicense(song, evmAddress, svmAddress),
  });

  const allocation = useQuery({
    queryKey:['allocation',song.metadata_cid],
    enabled:Boolean(includeSales && !song.source && song.chain_song_id && song.metadata_cid),
    staleTime:Infinity,
    retry:false,
    queryFn:async () => {
      const metadata=await fetchFromIpfs<Song>(song.metadata_cid!);
      if (!Number.isSafeInteger(metadata.licenses) || metadata.licenses < 0) throw new Error('The minted license allocation is unavailable');
      return metadata.licenses;
    },
  });
  let sold: number | undefined;
  let salesError = allocation.error;
  if (allocation.data !== undefined && query.data) {
    try { sold = licenseSales(allocation.data,query.data.remaining); }
    catch (error) {salesError=error instanceof Error ? error : new Error('Could not read license sales');}
  }

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
        if (isEvmNetwork(song.network)) {
          const chain = getEvmChainObject(song.network);
          if (!chain) throw new Error('The song network is unavailable');
          await requireEvmDeployment(chain, ['Factory', 'Remix', 'Royalties']);
          assertCurrent();
          const remix = getRemixContract(thirdwebClient, chain);
          const royalties = getRoyaltiesContract(thirdwebClient, chain);
          const tokenAddress = await readContract({ contract: royalties, method: 'usdc' });
          assertCurrent();
          const token = getContract({ client: thirdwebClient, chain, address: tokenAddress });
          const allowance = await readContract({ contract: token, method: 'function allowance(address owner, address spender) view returns (uint256)', params: [account.address, remix.address] });
          assertCurrent();
          if (allowance < state.data.price) {
            const approval = prepareContractCall({ contract: token, method: 'function approve(address spender, uint256 amount) returns (bool)', params: [remix.address, state.data.price] });
            await simulateTransaction({ account, transaction: approval });
            assertCurrent();
            const receipt = await sendAndConfirmTransaction({ account, transaction: approval });
            assertCurrent();
            if (receipt.status !== 'success') throw new Error('Token approval failed');
          }
          const purchase = prepareContractCall({ contract: remix, method: 'buyLicense', params: [BigInt(song.chain_song_id)] });
          await simulateTransaction({ account, transaction: purchase });
          assertCurrent();
          const receipt = await sendAndConfirmTransaction({ account, transaction: purchase });
          assertCurrent();
          if (receipt.status !== 'success') throw new Error('License purchase failed');
        } else {
          if (!solana) throw new Error('Solana account is not ready');
          await requireSolanaDeployment({ network: song.network as SolanaNetworkId, rpcUrl: solana.chain.rpcUrl }, ['Factory', 'Remix', 'Royalties']);
          solana.assertCurrent();
          await solana.activate();
          await relaySolanaBuyLicense({ network: song.network as SolanaNetworkId, rpcUrl: solana.chain.rpcUrl, selectedSvmAddress: solana.walletAddress, evmSignerAddress: solana.signerAddress, songId: BigInt(song.chain_song_id), signMessage: solana.signMessage, assertCurrent: solana.assertCurrent });
          solana.assertCurrent();
        }
        const licensed = await query.refetch({ throwOnError: true });
        assertCurrent();
        if (!licensed.data?.owned) throw new Error('The purchase has not been confirmed');
      }
      await queryClient.invalidateQueries({ queryKey: ['license', song.id] });
      assertCurrent();
      toast.success('License purchased. You can remix this song from My-Page.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not buy the license'); }
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
  return { ...query, buy, remix, pending, sold, salesError };
}
