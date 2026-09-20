export type ContractName = "Factory" | "Remix" | "Royalties";

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};

const CONTRACT_ENV: Record<ContractName, string | undefined> = {
  Factory: env.VITE_FACTORY_ADDRESS,
  Remix: env.VITE_REMIX_ADDRESS,
  Royalties: env.VITE_ROYALTIES_ADDRESS,
};

export const CONTRACT_ADDRESSES: Record<ContractName, `0x${string}` | undefined> = {
  Factory: CONTRACT_ENV.Factory as `0x${string}` | undefined,
  Remix: CONTRACT_ENV.Remix as `0x${string}` | undefined,
  Royalties: CONTRACT_ENV.Royalties as `0x${string}` | undefined,
};

export type SolanaProgramName = "Factory" | "Remix" | "Royalties";

const SOLANA_PROGRAM_ENV: Record<SolanaProgramName, string | undefined> = {
  Factory: env.VITE_FACTORY_PROGRAM_ID ?? env.VITE_FACTORY_PROGRAM_ID,
  Remix: env.VITE_REMIX_PROGRAM_ID ?? env.VITE_REMIX_PROGRAM_ID,
  Royalties: env.VITE_ROYALTIES_PROGRAM_ID ?? env.VITE_ROYALTIES_PROGRAM_ID,
};

export const SOLANA_PROGRAM_IDS: Record<SolanaProgramName, string | undefined> = {
  Factory: SOLANA_PROGRAM_ENV.Factory,
  Remix: SOLANA_PROGRAM_ENV.Remix,
  Royalties: SOLANA_PROGRAM_ENV.Royalties,
};

export function getSolanaProgramId(name: SolanaProgramName): string {
  const id = SOLANA_PROGRAM_IDS[name];
  if (!id) throw new Error(`Solana ${name} program ID is not configured`);
  return id;
}

export function isDeployed(name: ContractName): boolean {
  return Boolean(CONTRACT_ADDRESSES[name]);
}

export function getContractAddress(name: ContractName): `0x${string}` {
  const address = CONTRACT_ADDRESSES[name];
  if (!address) throw new Error(`${name} address is not configured`);
  return address;
}

export function getContractAddressForChain(name: ContractName, _chainId?: number): `0x${string}` {
  return getContractAddress(name);
}

export function formatUsdcPrice(value: string | number, decimals = 2): string {
  const wei = typeof value === "number"
    ? (Number.isFinite(value) ? value : 0)
    : (Number.parseInt(value, 10) || 0);
  return `$${(wei / 1_000_000).toFixed(decimals)}`;
}

export function weiToUsdc(value: string | number): number {
  const wei = typeof value === "number" ? value : (Number.parseInt(value, 10) || 0);
  return wei / 1_000_000;
}

export function usdcToWei(value: string | number): bigint {
  const num = typeof value === "number" ? value : (parseFloat(value) || 0);
  return BigInt(Math.round(num * 1_000_000));
}
