import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  AccountRole,
  type Address as SvmAddress,
  type Instruction,
} from "@solana/kit";
import type { NetworkId, SolanaNetworkId } from "@compose-market/sdk/chains";

import { sdk } from "@/lib/sdk";
import { isEvmNetwork } from "@/lib/chains";
import { deriveSwigConfigAddress } from "@/lib/svm/account";
import {
  buildSwigInstructionTransaction,
  createSolanaRpcFromNetwork,
} from "@/lib/svm/swig";

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};

export const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const SPL_TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";

export type SolanaProgramName = "Factory" | "Remix" | "Royalties";

export interface RawchunksSolanaDeployment {
  factoryProgramId: SvmAddress;
  royaltiesProgramId: SvmAddress;
  remixProgramId: SvmAddress;
}

export interface SolanaSong {
  songId: bigint;
  licenseAmount: bigint;
  licensePrice: bigint;
  streamPrice: bigint;
  creator: SvmAddress;
  remixable: boolean;
  isRemix: boolean;
  parentSongId: bigint;
  metadataUri: string;
}

export interface SolanaFactoryConfig {
  admin: SvmAddress;
  nextSongId: bigint;
  totalSongs: bigint;
}

export interface SolanaLicenseRecord {
  hasLicense: boolean;
  songId: bigint;
  user: SvmAddress;
}

export interface SolanaRoyaltiesConfig {
  admin: SvmAddress;
  treasury: SvmAddress;
  usdcMint: SvmAddress;
}

export interface SolanaRemixConfig {
  admin: SvmAddress;
  factoryProgram: SvmAddress;
  royaltiesProgram: SvmAddress;
}

function requireEnvAddress(name: string, value: string | undefined): SvmAddress {
  if (!value) throw new Error(`${name} is not configured`);
  return address(value);
}

export function getRawchunksSolanaDeployment(): RawchunksSolanaDeployment {
  return {
    factoryProgramId: requireEnvAddress(
      "VITE_FACTORY_PROGRAM_ID",
      env.VITE_FACTORY_PROGRAM_ID,
    ),
    royaltiesProgramId: requireEnvAddress(
      "VITE_ROYALTIES_PROGRAM_ID",
      env.VITE_ROYALTIES_PROGRAM_ID,
    ),
    remixProgramId: requireEnvAddress(
      "VITE_REMIX_PROGRAM_ID",
      env.VITE_REMIX_PROGRAM_ID,
    ),
  };
}

export function getRawchunksDeployment(network: NetworkId) {
  if (isEvmNetwork(network)) {
    return {
      network,
      type: "evm" as const,
    };
  }
  return {
    network,
    type: "solana" as const,
    solana: getRawchunksSolanaDeployment(),
  };
}

// Binary / Serialization Helpers
function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeU64(val: bigint | number): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, BigInt(val), true);
  return buf;
}

function encodeU16(val: number): Uint8Array {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, val, true);
  return buf;
}

async function readAccountData(
  rpc: ReturnType<typeof createSolanaRpcFromNetwork>,
  account: SvmAddress,
  owner?: SvmAddress,
): Promise<Uint8Array | null> {
  const info = await rpc.getAccountInfo(account, { encoding: "base64" }).send();
  if (!info.value) return null;
  if (owner && info.value.owner !== owner) throw new Error("Invalid account owner");
  const [base64Data] = info.value.data as [string, string];
  return decodeBase64(base64Data);
}

// Associated Token Account
export async function findAssociatedTokenAddress(input: {
  owner: string | SvmAddress;
  mint: string | SvmAddress;
  tokenProgram?: string | SvmAddress;
}): Promise<SvmAddress> {
  const encoder = getAddressEncoder();
  const tokenProgram = address(input.tokenProgram ?? SPL_TOKEN_PROGRAM);
  const [ata] = await getProgramDerivedAddress({
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM),
    seeds: [
      encoder.encode(address(input.owner)),
      encoder.encode(tokenProgram),
      encoder.encode(address(input.mint)),
    ],
  });
  return ata;
}

// PDA Derivations
export const rawchunksPdas = {
  async factoryConfig(programId?: SvmAddress | string): Promise<SvmAddress> {
    const pid = address(programId ?? getRawchunksSolanaDeployment().factoryProgramId);
    const [pda] = await getProgramDerivedAddress({
      programAddress: pid,
      seeds: [new TextEncoder().encode("factory")],
    });
    return pda;
  },

  async song(songId: bigint | number, programId?: SvmAddress | string): Promise<SvmAddress> {
    const pid = address(programId ?? getRawchunksSolanaDeployment().factoryProgramId);
    const [pda] = await getProgramDerivedAddress({
      programAddress: pid,
      seeds: [new TextEncoder().encode("song"), encodeU64(songId)],
    });
    return pda;
  },

  async authorizedConsumer(consumer: SvmAddress | string, programId?: SvmAddress | string): Promise<SvmAddress> {
    const pid = address(programId ?? getRawchunksSolanaDeployment().factoryProgramId);
    const encoder = getAddressEncoder();
    const [pda] = await getProgramDerivedAddress({
      programAddress: pid,
      seeds: [new TextEncoder().encode("consumer"), encoder.encode(address(consumer))],
    });
    return pda;
  },

  async license(
    songId: bigint | number,
    user: SvmAddress | string,
    programId?: SvmAddress | string,
  ): Promise<SvmAddress> {
    const pid = address(programId ?? getRawchunksSolanaDeployment().factoryProgramId);
    const encoder = getAddressEncoder();
    const [pda] = await getProgramDerivedAddress({
      programAddress: pid,
      seeds: [new TextEncoder().encode("license"), encodeU64(songId), encoder.encode(address(user))],
    });
    return pda;
  },

  async royaltiesConfig(programId?: SvmAddress | string): Promise<SvmAddress> {
    const pid = address(programId ?? getRawchunksSolanaDeployment().royaltiesProgramId);
    const [pda] = await getProgramDerivedAddress({
      programAddress: pid,
      seeds: [new TextEncoder().encode("royalties")],
    });
    return pda;
  },

  async remixConfig(programId?: SvmAddress | string): Promise<SvmAddress> {
    const pid = address(programId ?? getRawchunksSolanaDeployment().remixProgramId);
    const [pda] = await getProgramDerivedAddress({
      programAddress: pid,
      seeds: [new TextEncoder().encode("remix")],
    });
    return pda;
  },

  async remixAuthority(programId?: SvmAddress | string): Promise<SvmAddress> {
    const pid = address(programId ?? getRawchunksSolanaDeployment().remixProgramId);
    const [pda] = await getProgramDerivedAddress({
      programAddress: pid,
      seeds: [new TextEncoder().encode("remix_authority")],
    });
    return pda;
  },

  async songRemixCount(originalSongId: bigint | number, programId?: SvmAddress | string): Promise<SvmAddress> {
    const pid = address(programId ?? getRawchunksSolanaDeployment().remixProgramId);
    const [pda] = await getProgramDerivedAddress({
      programAddress: pid,
      seeds: [new TextEncoder().encode("remix_count"), encodeU64(originalSongId)],
    });
    return pda;
  },

  async remixRecord(
    originalSongId: bigint | number,
    remixIndex: bigint | number,
    programId?: SvmAddress | string,
  ): Promise<SvmAddress> {
    const pid = address(programId ?? getRawchunksSolanaDeployment().remixProgramId);
    const [pda] = await getProgramDerivedAddress({
      programAddress: pid,
      seeds: [new TextEncoder().encode("remix"), encodeU64(originalSongId), encodeU64(remixIndex)],
    });
    return pda;
  },
};

// Account Decoders
export function decodeFactoryConfigAccount(data: Uint8Array): SolanaFactoryConfig {
  if (data.length < 56 || data[0] !== 1) {
    throw new Error("Invalid FactoryConfig account data");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const adminBytes = data.subarray(8, 40);
  const admin = getAddressDecoder().decode(adminBytes);
  const nextSongId = view.getBigUint64(40, true);
  const totalSongs = view.getBigUint64(48, true);
  return { admin, nextSongId, totalSongs };
}

export function decodeSongAccount(data: Uint8Array): SolanaSong {
  if (data.length !== 280 || data[0] !== 2) {
    throw new Error("Invalid SongAccount data");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const remixable = data[2] !== 0;
  const isRemix = data[3] !== 0;
  const uriLen = view.getUint16(4, true);
  if (uriLen === 0 || uriLen > 200 || data[2] > 1 || data[3] > 1) throw new Error("Invalid SongAccount data");
  const songId = view.getBigUint64(8, true);
  const parentSongId = view.getBigUint64(16, true);
  const licenseAmount = view.getBigUint64(24, true);
  const licensePrice = view.getBigUint64(32, true);
  const streamPrice = view.getBigUint64(40, true);
  const creatorBytes = data.subarray(48, 80);
  const creator = getAddressDecoder().decode(creatorBytes);
  const metadataBytes = data.subarray(80, 80 + uriLen);
  const metadataUri = new TextDecoder().decode(metadataBytes);

  return {
    songId,
    licenseAmount,
    licensePrice,
    streamPrice,
    creator,
    remixable,
    isRemix,
    parentSongId,
    metadataUri,
  };
}

export function decodeLicenseRecordAccount(data: Uint8Array): SolanaLicenseRecord {
  if (data.length !== 48 || data[0] !== 4) {
    throw new Error("Invalid LicenseRecord account data");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const songId = view.getBigUint64(8, true);
  const user = getAddressDecoder().decode(data.subarray(16, 48));
  return { hasLicense: true, songId, user };
}

export function decodeRoyaltiesConfigAccount(data: Uint8Array): SolanaRoyaltiesConfig {
  if (data.length < 104 || data[0] !== 1) {
    throw new Error("Invalid RoyaltiesConfig account data");
  }
  const admin = getAddressDecoder().decode(data.subarray(8, 40));
  const treasury = getAddressDecoder().decode(data.subarray(40, 72));
  const usdcMint = getAddressDecoder().decode(data.subarray(72, 104));
  return { admin, treasury, usdcMint };
}

export function decodeRemixConfigAccount(data: Uint8Array): SolanaRemixConfig {
  if (data.length !== 112 || data[0] !== 1) {
    throw new Error("Invalid RemixConfig account data");
  }
  const admin = getAddressDecoder().decode(data.subarray(16, 48));
  const factoryProgram = getAddressDecoder().decode(data.subarray(48, 80));
  const royaltiesProgram = getAddressDecoder().decode(data.subarray(80, 112));
  return { admin, factoryProgram, royaltiesProgram };
}

// Fetchers (Mirroring contracts.ts View Methods)
export async function fetchSolanaFactoryConfig(input: {
  network: SolanaNetworkId;
  rpcUrl: string;
  factoryProgramId?: SvmAddress | string;
}): Promise<SolanaFactoryConfig> {
  const rpc = createSolanaRpcFromNetwork(input.network, input.rpcUrl);
  const pda = await rawchunksPdas.factoryConfig(input.factoryProgramId);
  const data = await readAccountData(rpc, pda, address(input.factoryProgramId ?? getRawchunksSolanaDeployment().factoryProgramId));
  if (!data) throw new Error(`Solana factory config not found at: ${pda}`);
  return decodeFactoryConfigAccount(data);
}

export async function fetchSolanaTotalSongs(input: {
  network: SolanaNetworkId;
  rpcUrl: string;
  factoryProgramId?: SvmAddress | string;
}): Promise<bigint> {
  const config = await fetchSolanaFactoryConfig(input);
  return config.totalSongs;
}

export async function fetchSolanaSong(input: {
  network: SolanaNetworkId;
  rpcUrl: string;
  songId: bigint | number;
  factoryProgramId?: SvmAddress | string;
}): Promise<SolanaSong> {
  const rpc = createSolanaRpcFromNetwork(input.network, input.rpcUrl);
  const pda = await rawchunksPdas.song(input.songId, input.factoryProgramId);
  const data = await readAccountData(rpc, pda, address(input.factoryProgramId ?? getRawchunksSolanaDeployment().factoryProgramId));
  if (!data) throw new Error(`Song ${input.songId} not found on Solana: ${pda}`);
  const song = decodeSongAccount(data);
  if (song.songId !== BigInt(input.songId)) throw new Error("Song account ID mismatch");
  return song;
}

export async function fetchSolanaHasLicense(input: {
  network: SolanaNetworkId;
  rpcUrl: string;
  songId: bigint | number;
  user: SvmAddress | string;
  factoryProgramId?: SvmAddress | string;
}): Promise<boolean> {
  const rpc = createSolanaRpcFromNetwork(input.network, input.rpcUrl);
  const pda = await rawchunksPdas.license(input.songId, input.user, input.factoryProgramId);
  const data = await readAccountData(rpc, pda, address(input.factoryProgramId ?? getRawchunksSolanaDeployment().factoryProgramId));
  if (!data) return false;
  const license = decodeLicenseRecordAccount(data);
  if (license.songId !== BigInt(input.songId) || license.user !== input.user) throw new Error("License account mismatch");
  return license.hasLicense;
}

export async function fetchSolanaRoyaltiesConfig(input: { network: SolanaNetworkId; rpcUrl: string }): Promise<SolanaRoyaltiesConfig> {
  const deployment = getRawchunksSolanaDeployment();
  const rpc = createSolanaRpcFromNetwork(input.network, input.rpcUrl);
  const pda = await rawchunksPdas.royaltiesConfig(deployment.royaltiesProgramId);
  const data = await readAccountData(rpc, pda, deployment.royaltiesProgramId);
  if (!data) throw new Error('Royalties configuration is unavailable');
  return decodeRoyaltiesConfigAccount(data);
}

export function buildSolanaBuyLicenseInstruction(input: {
  buyer: SvmAddress | string; authority: SvmAddress | string; config: SvmAddress | string;
  factoryProgram: SvmAddress | string; royaltiesProgram: SvmAddress | string;
  factoryConfig: SvmAddress | string; song: SvmAddress | string; license: SvmAddress | string;
  consumer: SvmAddress | string; payerToken: SvmAddress | string; creatorToken: SvmAddress | string;
  treasuryToken: SvmAddress | string; royaltiesConfig: SvmAddress | string; songId: bigint;
  programId?: SvmAddress | string;
}): Instruction {
  const data = new Uint8Array(9);
  data[0] = 4;
  data.set(encodeU64(input.songId), 1);
  return { programAddress: address(input.programId ?? getRawchunksSolanaDeployment().remixProgramId), data, accounts: [
    { address: address(input.buyer), role: AccountRole.WRITABLE_SIGNER },
    { address: address(input.authority), role: AccountRole.WRITABLE },
    { address: address(input.config), role: AccountRole.READONLY },
    { address: address(input.factoryProgram), role: AccountRole.READONLY },
    { address: address(input.royaltiesProgram), role: AccountRole.READONLY },
    { address: address(input.factoryConfig), role: AccountRole.READONLY },
    { address: address(input.song), role: AccountRole.WRITABLE },
    { address: address(input.license), role: AccountRole.WRITABLE },
    { address: address(input.consumer), role: AccountRole.READONLY },
    { address: address(input.payerToken), role: AccountRole.WRITABLE },
    { address: address(input.creatorToken), role: AccountRole.WRITABLE },
    { address: address(input.treasuryToken), role: AccountRole.WRITABLE },
    { address: address(input.royaltiesConfig), role: AccountRole.READONLY },
    { address: address(SPL_TOKEN_PROGRAM), role: AccountRole.READONLY },
    { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY },
  ] };
}

export async function relaySolanaBuyLicense(input: {
  network: SolanaNetworkId; rpcUrl: string; selectedSvmAddress: string; evmSignerAddress: string;
  signMessage: (message: Uint8Array) => Promise<string>; songId: bigint;
}): Promise<void> {
  if (await fetchSolanaHasLicense({ ...input, user: input.selectedSvmAddress })) return;
  const deployment = getRawchunksSolanaDeployment();
  const song = await fetchSolanaSong(input);
  const royalties = await fetchSolanaRoyaltiesConfig(input);
  const authority = await rawchunksPdas.remixAuthority(deployment.remixProgramId);
  const owners = [input.selectedSvmAddress, song.creator, royalties.treasury];
  const tokens = await Promise.all(owners.map(owner => findAssociatedTokenAddress({ owner, mint: royalties.usdcMint })));
  const accounts = { buyer: input.selectedSvmAddress, authority, config: await rawchunksPdas.remixConfig(),
    factoryProgram: deployment.factoryProgramId, royaltiesProgram: deployment.royaltiesProgramId,
    factoryConfig: await rawchunksPdas.factoryConfig(), song: await rawchunksPdas.song(input.songId),
    license: await rawchunksPdas.license(input.songId, input.selectedSvmAddress), consumer: await rawchunksPdas.authorizedConsumer(authority),
    payerToken: tokens[0], creatorToken: tokens[1], treasuryToken: tokens[2], royaltiesConfig: await rawchunksPdas.royaltiesConfig(), songId: input.songId };
  const instructions: Instruction[] = owners.map((owner, index) => ({
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM), data: new Uint8Array([1]), accounts: [
      { address: address(input.selectedSvmAddress), role: AccountRole.WRITABLE_SIGNER },
      { address: tokens[index], role: AccountRole.WRITABLE },
      { address: address(owner), role: AccountRole.READONLY },
      { address: royalties.usdcMint, role: AccountRole.READONLY },
      { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY },
      { address: address(SPL_TOKEN_PROGRAM), role: AccountRole.READONLY },
    ],
  }));
  instructions.push(buildSolanaBuyLicenseInstruction(accounts));
  const result = await relaySolanaInstructions({ ...input, instructions });
  if (!result.confirmed || !await fetchSolanaHasLicense({ ...input, user: input.selectedSvmAddress })) throw new Error('The license purchase is awaiting confirmation');
}

export async function fetchSolanaCanRemix(input: {
  network: SolanaNetworkId;
  rpcUrl: string;
  songId: bigint | number;
  user: SvmAddress | string;
  factoryProgramId?: SvmAddress | string;
}): Promise<boolean> {
  const song = await fetchSolanaSong({
    network: input.network,
    rpcUrl: input.rpcUrl,
    songId: input.songId,
    factoryProgramId: input.factoryProgramId,
  });
  if (!song.remixable) return false;
  return fetchSolanaHasLicense({
    network: input.network,
    rpcUrl: input.rpcUrl,
    songId: input.songId,
    user: input.user,
    factoryProgramId: input.factoryProgramId,
  });
}

export async function fetchSolanaOriginalParentSongId(input: {
  network: SolanaNetworkId;
  rpcUrl: string;
  songId: bigint | number;
  factoryProgramId?: SvmAddress | string;
}): Promise<bigint> {
  let currentId = BigInt(input.songId);
  for (let depth = 0; depth < 50; depth++) {
    const s = await fetchSolanaSong({
      network: input.network,
      rpcUrl: input.rpcUrl,
      songId: currentId,
      factoryProgramId: input.factoryProgramId,
    });
    if (!s.isRemix || s.parentSongId === 0n) {
      return currentId;
    }
    currentId = s.parentSongId;
  }
  return currentId;
}

export function getTreasuryFeeBps(): bigint {
  return 500n;
}

export function getCreatorShareBps(): bigint {
  return 9500n;
}

// Instruction Builders
export function buildSolanaMintSongInstruction(input: {
  programId?: SvmAddress | string;
  creator: SvmAddress | string;
  factoryConfig: SvmAddress | string;
  songAccount: SvmAddress | string;
  licenseAmount: bigint | number;
  licensePrice: bigint | number;
  streamPrice: bigint | number;
  remixable: boolean;
  metadataUri: string;
}): Instruction {
  const programAddress = address(input.programId ?? getRawchunksSolanaDeployment().factoryProgramId);
  const uriBytes = new TextEncoder().encode(input.metadataUri);
  const data = new Uint8Array(28 + uriBytes.length);
  data[0] = 1; // process_mint_song discriminator
  data.set(encodeU64(input.licenseAmount), 1);
  data.set(encodeU64(input.licensePrice), 9);
  data.set(encodeU64(input.streamPrice), 17);
  data[25] = input.remixable ? 1 : 0;
  data.set(encodeU16(uriBytes.length), 26);
  data.set(uriBytes, 28);

  return {
    programAddress,
    accounts: [
      { address: address(input.creator), role: AccountRole.WRITABLE_SIGNER },
      { address: address(input.factoryConfig), role: AccountRole.WRITABLE },
      { address: address(input.songAccount), role: AccountRole.WRITABLE },
      { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY },
    ],
    data,
  };
}

export function buildSolanaUpdatePricingInstruction(input: {
  programId?: SvmAddress | string;
  creator: SvmAddress | string;
  songAccount: SvmAddress | string;
  songId: bigint | number;
  newLicensePrice: bigint | number;
  newStreamPrice: bigint | number;
}): Instruction {
  const programAddress = address(input.programId ?? getRawchunksSolanaDeployment().factoryProgramId);
  const data = new Uint8Array(25);
  data[0] = 4; // process_update_pricing discriminator
  data.set(encodeU64(input.songId), 1);
  data.set(encodeU64(input.newLicensePrice), 9);
  data.set(encodeU64(input.newStreamPrice), 17);

  return {
    programAddress,
    accounts: [
      { address: address(input.creator), role: AccountRole.WRITABLE_SIGNER },
      { address: address(input.songAccount), role: AccountRole.WRITABLE },
    ],
    data,
  };
}

export function buildSolanaUpdateMetadataUriInstruction(input: {
  programId?: SvmAddress | string;
  creator: SvmAddress | string;
  songAccount: SvmAddress | string;
  songId: bigint | number;
  newMetadataUri: string;
}): Instruction {
  const programAddress = address(input.programId ?? getRawchunksSolanaDeployment().factoryProgramId);
  const uriBytes = new TextEncoder().encode(input.newMetadataUri);
  const data = new Uint8Array(11 + uriBytes.length);
  data[0] = 5; // process_update_metadata_uri discriminator
  data.set(encodeU64(input.songId), 1);
  data.set(encodeU16(uriBytes.length), 9);
  data.set(uriBytes, 11);

  return {
    programAddress,
    accounts: [
      { address: address(input.creator), role: AccountRole.WRITABLE_SIGNER },
      { address: address(input.songAccount), role: AccountRole.WRITABLE },
    ],
    data,
  };
}

export function buildSolanaConsumeLicenseInstruction(input: {
  programId?: SvmAddress | string;
  caller: SvmAddress | string;
  factoryConfig: SvmAddress | string;
  songAccount: SvmAddress | string;
  licenseRecord: SvmAddress | string;
  songId: bigint | number;
  licensee: SvmAddress | string;
}): Instruction {
  const programAddress = address(input.programId ?? getRawchunksSolanaDeployment().factoryProgramId);
  const encoder = getAddressEncoder();
  const licenseeBytes = encoder.encode(address(input.licensee));
  const data = new Uint8Array(41);
  data[0] = 3; // process_consume_license discriminator
  data.set(encodeU64(input.songId), 1);
  data.set(licenseeBytes, 9);

  return {
    programAddress,
    accounts: [
      { address: address(input.caller), role: AccountRole.WRITABLE_SIGNER },
      { address: address(input.factoryConfig), role: AccountRole.READONLY },
      { address: address(input.songAccount), role: AccountRole.WRITABLE },
      { address: address(input.licenseRecord), role: AccountRole.WRITABLE },
      { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY },
    ],
    data,
  };
}

export function buildSolanaDistributeLicensePaymentInstruction(input: {
  programId?: SvmAddress | string;
  payer: SvmAddress | string;
  royaltiesConfig: SvmAddress | string;
  factorySong: SvmAddress | string;
  payerUsdcAta: SvmAddress | string;
  creatorUsdcAta: SvmAddress | string;
  treasuryUsdcAta: SvmAddress | string;
  songId: bigint | number;
  tokenProgram?: SvmAddress | string;
}): Instruction {
  const programAddress = address(input.programId ?? getRawchunksSolanaDeployment().royaltiesProgramId);
  const tokenProgram = address(input.tokenProgram ?? SPL_TOKEN_PROGRAM);
  const data = new Uint8Array(9);
  data[0] = 1; // process_distribute_license_payment discriminator
  data.set(encodeU64(input.songId), 1);

  return {
    programAddress,
    accounts: [
      { address: address(input.payer), role: AccountRole.WRITABLE_SIGNER },
      { address: address(input.royaltiesConfig), role: AccountRole.READONLY },
      { address: address(input.factorySong), role: AccountRole.READONLY },
      { address: address(input.payerUsdcAta), role: AccountRole.WRITABLE },
      { address: address(input.creatorUsdcAta), role: AccountRole.WRITABLE },
      { address: address(input.treasuryUsdcAta), role: AccountRole.WRITABLE },
      { address: tokenProgram, role: AccountRole.READONLY },
    ],
    data,
  };
}

export function buildSolanaRemixSongInstruction(input: {
  programId?: SvmAddress | string;
  remixer: SvmAddress | string;
  remixConfig: SvmAddress | string;
  remixAuthority: SvmAddress | string;
  factoryConfig: SvmAddress | string;
  originalSong: SvmAddress | string;
  remixSong: SvmAddress | string;
  licenseRecord: SvmAddress | string;
  remixConsumerAccount: SvmAddress | string;
  songRemixCountAccount: SvmAddress | string;
  remixRecordAccount: SvmAddress | string;
  factoryProgram: SvmAddress | string;
  originalSongId: bigint | number;
  licenseAmount: bigint | number;
  licensePrice: bigint | number;
  streamPrice: bigint | number;
  metadataUri: string;
}): Instruction {
  const programAddress = address(input.programId ?? getRawchunksSolanaDeployment().remixProgramId);
  const uriBytes = new TextEncoder().encode(input.metadataUri);
  const data = new Uint8Array(35 + uriBytes.length);
  data[0] = 1; // process_remix_song discriminator
  data.set(encodeU64(input.originalSongId), 1);
  data.set(encodeU64(input.licenseAmount), 9);
  data.set(encodeU64(input.licensePrice), 17);
  data.set(encodeU64(input.streamPrice), 25);
  data.set(encodeU16(uriBytes.length), 33);
  data.set(uriBytes, 35);

  return {
    programAddress,
    accounts: [
      { address: address(input.remixer), role: AccountRole.WRITABLE_SIGNER },
      { address: address(input.remixAuthority), role: AccountRole.WRITABLE },
      { address: address(input.remixConfig), role: AccountRole.WRITABLE },
      { address: address(input.factoryProgram), role: AccountRole.READONLY },
      { address: address(input.factoryConfig), role: AccountRole.WRITABLE },
      { address: address(input.originalSong), role: AccountRole.READONLY },
      { address: address(input.remixSong), role: AccountRole.WRITABLE },
      { address: address(input.licenseRecord), role: AccountRole.READONLY },
      { address: address(input.remixConsumerAccount), role: AccountRole.READONLY },
      { address: address(input.songRemixCountAccount), role: AccountRole.WRITABLE },
      { address: address(input.remixRecordAccount), role: AccountRole.WRITABLE },
      { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY },
    ],
    data,
  };
}

// Relay Execution Helpers (Powered by Swig & @compose-market/sdk)
export async function relaySolanaInstructions(input: {
  network: SolanaNetworkId;
  rpcUrl: string;
  selectedSvmAddress: string;
  evmSignerAddress: string;
  feePayer?: string;
  signMessage: (message: Uint8Array) => Promise<string>;
  instructions: readonly Instruction[];
  memo?: string;
}): Promise<{ signature: string; confirmed: boolean }> {
  const feePayer = address(input.feePayer ?? (await sdk.svm.feePayer()).feePayer);
  const swigConfigAddress = await deriveSwigConfigAddress(input.evmSignerAddress);
  const unsignedTransaction = await buildSwigInstructionTransaction({
    swigConfigAddress,
    expectedWalletAddress: input.selectedSvmAddress,
    evmSignerAddress: input.evmSignerAddress,
    feePayer,
    network: input.network,
    rpcUrl: input.rpcUrl,
    instructions: input.instructions,
    memo: input.memo,
    signMessage: input.signMessage,
  });

  return sdk.svm.relay({
    unsignedTransaction,
    network: input.network,
  });
}

export async function relaySolanaMintSong(input: {
  network: SolanaNetworkId;
  rpcUrl: string;
  selectedSvmAddress: string;
  evmSignerAddress: string;
  signMessage: (message: Uint8Array) => Promise<string>;
  licenseAmount: bigint | number;
  licensePrice: bigint | number;
  streamPrice: bigint | number;
  remixable: boolean;
  metadataUri: string;
}): Promise<{ signature: string; songId: bigint; songAddress: SvmAddress }> {
  const deployment = getRawchunksSolanaDeployment();
  const factoryConfig = await fetchSolanaFactoryConfig({
    network: input.network,
    rpcUrl: input.rpcUrl,
    factoryProgramId: deployment.factoryProgramId,
  });
  const songId = factoryConfig.nextSongId;
  const songAddress = await rawchunksPdas.song(songId, deployment.factoryProgramId);
  const factoryConfigPda = await rawchunksPdas.factoryConfig(deployment.factoryProgramId);

  const mintIx = buildSolanaMintSongInstruction({
    programId: deployment.factoryProgramId,
    creator: input.selectedSvmAddress,
    factoryConfig: factoryConfigPda,
    songAccount: songAddress,
    licenseAmount: input.licenseAmount,
    licensePrice: input.licensePrice,
    streamPrice: input.streamPrice,
    remixable: input.remixable,
    metadataUri: input.metadataUri,
  });

  const res = await relaySolanaInstructions({
    network: input.network,
    rpcUrl: input.rpcUrl,
    selectedSvmAddress: input.selectedSvmAddress,
    evmSignerAddress: input.evmSignerAddress,
    signMessage: input.signMessage,
    instructions: [mintIx],
    memo: `rawchunks: mint song ${songId}`,
  });

  if (!res.confirmed) throw new Error("The transaction is awaiting confirmation");
  return {
    signature: res.signature,
    songId,
    songAddress,
  };
}

export async function relaySolanaRemixSong(input: {
  network: SolanaNetworkId;
  rpcUrl: string;
  selectedSvmAddress: string;
  evmSignerAddress: string;
  signMessage: (message: Uint8Array) => Promise<string>;
  originalSongId: bigint | number;
  licenseAmount: bigint | number;
  licensePrice: bigint | number;
  streamPrice: bigint | number;
  metadataUri: string;
}): Promise<{ signature: string; remixSongId: bigint; remixSongAddress: SvmAddress }> {
  const deployment = getRawchunksSolanaDeployment();
  const factoryConfig = await fetchSolanaFactoryConfig({
    network: input.network,
    rpcUrl: input.rpcUrl,
    factoryProgramId: deployment.factoryProgramId,
  });
  const remixSongId = factoryConfig.nextSongId;
  const remixSongAddress = await rawchunksPdas.song(remixSongId, deployment.factoryProgramId);
  const factoryConfigPda = await rawchunksPdas.factoryConfig(deployment.factoryProgramId);
  const originalSongAddress = await rawchunksPdas.song(input.originalSongId, deployment.factoryProgramId);
  const licenseRecord = await rawchunksPdas.license(input.originalSongId, input.selectedSvmAddress, deployment.factoryProgramId);
  const remixConfig = await rawchunksPdas.remixConfig(deployment.remixProgramId);
  const remixAuthority = await rawchunksPdas.remixAuthority(deployment.remixProgramId);
  const remixConsumerAccount = await rawchunksPdas.authorizedConsumer(remixAuthority, deployment.factoryProgramId);
  const songRemixCountAccount = await rawchunksPdas.songRemixCount(input.originalSongId, deployment.remixProgramId);

  // Read current remix count to derive remix record PDA
  const rpc = createSolanaRpcFromNetwork(input.network, input.rpcUrl);
  const countData = await readAccountData(rpc, songRemixCountAccount, deployment.remixProgramId);
  if (countData && (countData.length !== 24 || countData[0] !== 2)) throw new Error("Invalid remix count account");
  const nextRemixIndex = countData ? new DataView(countData.buffer, countData.byteOffset, countData.byteLength).getBigUint64(16, true) : 0n;
  const remixRecordAccount = await rawchunksPdas.remixRecord(input.originalSongId, nextRemixIndex, deployment.remixProgramId);

  const remixIx = buildSolanaRemixSongInstruction({
    programId: deployment.remixProgramId,
    remixer: input.selectedSvmAddress,
    remixConfig,
    remixAuthority,
    factoryConfig: factoryConfigPda,
    originalSong: originalSongAddress,
    remixSong: remixSongAddress,
    licenseRecord,
    remixConsumerAccount,
    songRemixCountAccount,
    remixRecordAccount,
    factoryProgram: deployment.factoryProgramId,
    originalSongId: input.originalSongId,
    licenseAmount: input.licenseAmount,
    licensePrice: input.licensePrice,
    streamPrice: input.streamPrice,
    metadataUri: input.metadataUri,
  });

  const res = await relaySolanaInstructions({
    network: input.network,
    rpcUrl: input.rpcUrl,
    selectedSvmAddress: input.selectedSvmAddress,
    evmSignerAddress: input.evmSignerAddress,
    signMessage: input.signMessage,
    instructions: [remixIx],
    memo: `rawchunks: remix song ${input.originalSongId}`,
  });

  if (!res.confirmed) throw new Error("The transaction is awaiting confirmation");
  return {
    signature: res.signature,
    remixSongId,
    remixSongAddress,
  };
}
