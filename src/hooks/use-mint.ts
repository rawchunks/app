import { useSyncExternalStore } from 'react';
import { useActiveAccount } from 'thirdweb/react';
import { prepareContractCall, readContract, sendTransaction, simulateTransaction, waitForReceipt, type PreparedTransaction } from 'thirdweb';
import { parseEventLogs } from 'viem';
import { useSelectedUserAddress } from './use-address';
import { getEvmChainObject, isEvmNetwork, getNetworkRpcUrl, thirdwebClient, usdcToWei } from '../lib/chains';
import { getFactoryContract, getRemixContract } from '../lib/contracts';
import { fetchSolanaFactoryConfig, fetchSolanaSong, relaySolanaMintSong, relaySolanaRemixSong } from '../lib/programs';
import { uploadSongMetadata } from '../lib/pinata';
import { mintSong, type Mint } from '../lib/mint';
import { sdk } from '../lib/sdk';
import { store } from '../lib/store';
import type { Song } from '../lib/schema';
import type { SolanaNetworkId } from '@compose-market/sdk/chains';

const event = [{
  type: 'event', name: 'SongMinted', inputs: [
    { name: 'songId', type: 'uint256', indexed: true },
    { name: 'creator', type: 'address', indexed: true },
    { name: 'licenseAmount', type: 'uint256', indexed: false },
    { name: 'licensePrice', type: 'uint256', indexed: false },
    { name: 'streamPrice', type: 'uint256', indexed: false },
    { name: 'remixable', type: 'bool', indexed: false },
    { name: 'metadataUri', type: 'string', indexed: false },
  ]
}] as const;

const jobs = new Map<string, Promise<Song>>();
const listeners = new Set<() => void>();
function notify() { for (const listener of listeners) listener(); }
function sameAddress(left: string, right: string) { return left.startsWith('0x') ? left.toLowerCase() === right.toLowerCase() : left === right; }

async function loadSong(id: string, userAddress: string): Promise<Song> {
  const response = await sdk.fetch(`/api/songs/${encodeURIComponent(id)}`, { userAddress });
  const result = await response.json();
  if (!response.ok || !result.song) throw new Error(result.error || 'Could not load the song');
  return result.song;
}

export function useMint() {
  const account = useActiveAccount();
  const { userAddress, svmAddress, paymentNetwork } = useSelectedUserAddress();
  const pending = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => [...jobs.keys()].join(','));

  const ensure = (input: Song): Promise<Song> => {
    if (!userAddress) return Promise.reject(new Error('Connect your wallet'));
    const key = `mint:${input.id}`;
    const existing = jobs.get(key);
    if (existing) return existing;
    const write = (mint: Mint | null) => {
      if (mint) localStorage.setItem(key, JSON.stringify(mint));
      else localStorage.removeItem(key);
    };
    const factory = (network: string) => {
      if (!isEvmNetwork(network)) throw new Error('The song network is unavailable');
      const chain = getEvmChainObject(network);
      if (!chain) throw new Error('The song network is unavailable');
      return getFactoryContract(thirdwebClient, chain);
    };
    const parent = async (song: Song, network: string) => {
      if (!song.source) return 0n;
      const source = await loadSong(song.source, userAddress);
      if (source.source) throw new Error('Remixes cannot be remixed');
      if (!source.chain_song_id || source.network !== network) throw new Error('The source song must be minted on the same network');
      return BigInt(source.chain_song_id);
    };
    const read = async (network: string, id: string) => isEvmNetwork(network)
      ? readContract({ contract: factory(network), method: 'getSong', params: [BigInt(id)] })
      : fetchSolanaSong({ network: network as SolanaNetworkId, rpcUrl: getNetworkRpcUrl(network), songId: BigInt(id) });
    const verify = async (song: Song, mint: Mint) => {
      if (!mint.id) throw new Error('The mint has not been confirmed');
      const data = await read(mint.network, mint.id);
      const creator = song.creator;
      if (!creator || !sameAddress(data.creator, creator) || data.metadataUri !== `ipfs://${mint.cid}` || data.isRemix !== Boolean(song.source) || data.parentSongId !== await parent(song, mint.network)) {
        throw new Error('The saved mint does not match this song');
      }
    };
    const total = async (network: string) => isEvmNetwork(network)
      ? readContract({ contract: factory(network), method: 'totalSongs' })
      : (await fetchSolanaFactoryConfig({ network: network as SolanaNetworkId, rpcUrl: getNetworkRpcUrl(network) })).totalSongs;
    const job = navigator.locks.request(key, async () => mintSong({
      load: () => loadSong(input.id, userAddress),
      save: async updates => {
        const response = await sdk.fetch(`/api/songs/${encodeURIComponent(input.id)}`, { userAddress, method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not save the mint');
        store.updateSong(input.id, result);
        return result;
      },
      read: () => {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const mint = JSON.parse(raw) as Mint;
        if (!mint.network || !mint.cid || !/^\d+$/.test(mint.after) || typeof mint.submitted !== 'boolean') throw new Error('The saved mint progress is invalid');
        return mint;
      },
      write,
      prepare: async song => {
        if (!account) throw new Error('Connect your wallet');
        const network = song.metadata_cid && song.network ? song.network : song.source ? (await loadSong(song.source, userAddress)).network : paymentNetwork;
        if (!network) throw new Error('The source song network is unavailable');
        const cid = song.metadata_cid || await uploadSongMetadata(song, song.title);
        return { network, cid, after: song.metadata_cid ? '0' : (await total(network)).toString(), submitted: false };
      },
      verify,
      find: async (song, mint) => {
        const count = await total(mint.network);
        for (let id = BigInt(mint.after) + 1n; id <= count; id++) {
          const data = await read(mint.network, id.toString());
          if (data.metadataUri === `ipfs://${mint.cid}`) {
            const found = { ...mint, id: id.toString(), submitted: true };
            await verify(song, found);
            return found;
          }
        }
        return null;
      },
      preflight: async (song, mint) => {
        if (!account) throw new Error('Connect your wallet');
        if (paymentNetwork !== mint.network) throw new Error('Select the song network in your wallet');
        const creator = isEvmNetwork(mint.network) ? account.address : svmAddress;
        if (!creator || !sameAddress(song.creator, creator)) throw new Error('Select the wallet that created this song');
      },
      send: async (song, mint) => {
        if (!account) throw new Error('Connect your wallet');
        if (paymentNetwork !== mint.network) throw new Error('Select the song network in your wallet');
        const originalSongId = await parent(song, mint.network);
        if (isEvmNetwork(mint.network)) {
          const contract = factory(mint.network);
          const transaction: PreparedTransaction<any> = originalSongId
            ? prepareContractCall({ contract: getRemixContract(thirdwebClient, contract.chain), method: 'remixSong', params: [originalSongId, { licenseAmount: 0n, licensePrice: 0n, streamPrice: usdcToWei(song.stream_price) }, `ipfs://${mint.cid}`] })
            : prepareContractCall({ contract, method: 'mintSong', params: [BigInt(song.licenses), usdcToWei(song.license_price), usdcToWei(song.stream_price), true, `ipfs://${mint.cid}`] });
          try { await simulateTransaction({ account, transaction }); }
          catch (error) { write({ ...mint, submitted: false }); throw error; }
          try {
            const result = await sendTransaction({ account, transaction });
            return { ...mint, hash: result.transactionHash };
          } catch (error) {
            if ((error as { code?: number }).code === 4001) write({ ...mint, submitted: false });
            throw error;
          }
        }
        if (!svmAddress) throw new Error('Solana account is not ready');
        const args = { network: mint.network as SolanaNetworkId, rpcUrl: getNetworkRpcUrl(mint.network), selectedSvmAddress: svmAddress, evmSignerAddress: account.address, signMessage: (message: Uint8Array) => account.signMessage({ message: { raw: message } }), licenseAmount: originalSongId ? 0n : BigInt(song.licenses), licensePrice: originalSongId ? 0n : usdcToWei(song.license_price), streamPrice: usdcToWei(song.stream_price), metadataUri: `ipfs://${mint.cid}` };
        if (originalSongId) {
          const result = await relaySolanaRemixSong({ ...args, originalSongId });
          return { ...mint, id: result.remixSongId.toString(), hash: result.signature };
        }
        const result = await relaySolanaMintSong({ ...args, remixable: true });
        return { ...mint, id: result.songId.toString(), hash: result.signature };
      },
      confirm: async (song, mint) => {
        if (!isEvmNetwork(mint.network)) { await verify(song, mint); return mint; }
        if (!mint.hash) throw new Error('The mint transaction is missing');
        const contract = factory(mint.network);
        const receipt = await waitForReceipt({ client: thirdwebClient, chain: contract.chain, transactionHash: mint.hash as `0x${string}` });
        if (receipt.status !== 'success') { write({ ...mint, hash: undefined, submitted: false }); throw new Error('The mint transaction reverted'); }
        const events = parseEventLogs({ abi: event, logs: receipt.logs.filter(log => log.address.toLowerCase() === contract.address.toLowerCase()), eventName: 'SongMinted' });
        const matches = events.filter(log => sameAddress(log.args.creator, song.creator) && log.args.metadataUri === `ipfs://${mint.cid}`);
        if (matches.length !== 1) throw new Error('The mint receipt does not identify this song');
        return { ...mint, id: matches[0].args.songId.toString() };
      },
    })).finally(() => { jobs.delete(key); notify(); });
    jobs.set(key, job);
    notify();
    return job;
  };
  return { ensure, pending };
}
