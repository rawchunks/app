import {
  getContract,
  readContract,
  prepareContractCall,
  simulateTransaction,
  sendAndConfirmTransaction,
  type ThirdwebClient,
  type Chain,
  type PreparedTransaction,
} from "thirdweb";
import type { Account } from "thirdweb/wallets";
import { createPublicClient, http } from "viem";
import { getContractAddress } from "./performance/chains-data";
import type { ContractName } from "./performance/chains-data";

export async function requireEvmDeployment(chain: Chain, names: ContractName[]): Promise<void> {
  const client = createPublicClient({ transport: http(chain.rpc) });
  await Promise.all(names.map(async name => {
    const code = await client.getCode({ address: getContractAddress(name) });
    if (!code || code === "0x") throw new Error(`Rawchunks ${name} contract is not deployed on eip155:${chain.id}`);
  }));
}

export const FACTORY_ABI = [
  {
    type: "function",
    name: "mintSong",
    inputs: [
      { name: "licenseAmount", type: "uint256", internalType: "uint256" },
      { name: "licensePrice", type: "uint256", internalType: "uint256" },
      { name: "streamPrice", type: "uint256", internalType: "uint256" },
      { name: "remixable", type: "bool", internalType: "bool" },
      { name: "metadataUri", type: "string", internalType: "string" },
    ],
    outputs: [{ name: "songId", type: "uint256", internalType: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getSong",
    inputs: [{ name: "songId", type: "uint256", internalType: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct IFactory.Song",
        components: [
          { name: "licenseAmount", type: "uint256", internalType: "uint256" },
          { name: "licensePrice", type: "uint256", internalType: "uint256" },
          { name: "streamPrice", type: "uint256", internalType: "uint256" },
          { name: "creator", type: "address", internalType: "address" },
          { name: "remixable", type: "bool", internalType: "bool" },
          { name: "isRemix", type: "bool", internalType: "bool" },
          { name: "parentSongId", type: "uint256", internalType: "uint256" },
          { name: "metadataUri", type: "string", internalType: "string" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalSongs",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "updatePricing",
    inputs: [
      { name: "songId", type: "uint256", internalType: "uint256" },
      { name: "newLicensePrice", type: "uint256", internalType: "uint256" },
      { name: "newStreamPrice", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "updateMetadataUri",
    inputs: [
      { name: "songId", type: "uint256", internalType: "uint256" },
      { name: "newMetadataUri", type: "string", internalType: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "consumeLicense",
    inputs: [
      { name: "songId", type: "uint256" },
      { name: "licensee", type: "address" },
    ],
    outputs: [{ name: "remainingLicenses", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "hasLicense",
    inputs: [{ name: "songId", type: "uint256" }, { name: "user", type: "address" }],
    outputs: [{ name: "licensed", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "ownerOf",
    inputs: [{ name: "tokenId", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
] as const;

export const REMIX_ABI = [
  {
    type: "function", name: "buyLicense",
    inputs: [{ name: "songId", type: "uint256" }], outputs: [], stateMutability: "nonpayable",
  },
  {
    type: "function", name: "royalties", inputs: [],
    outputs: [{ name: "", type: "address" }], stateMutability: "view",
  },
  {
    type: "function",
    name: "remixSong",
    inputs: [
      { name: "originalSongId", type: "uint256" },
      { name: "params", type: "tuple", components: [
        { name: "licenseAmount", type: "uint256" },
        { name: "licensePrice", type: "uint256" },
        { name: "streamPrice", type: "uint256" },
      ] },
      { name: "metadataUri", type: "string", internalType: "string" },
    ],
    outputs: [{ name: "remixSongId", type: "uint256", internalType: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "canRemix",
    inputs: [{ name: "songId", type: "uint256" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRemixesOf",
    inputs: [{ name: "originalSongId", type: "uint256" }],
    outputs: [{ name: "remixIds", type: "uint256[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRemixCount",
    inputs: [{ name: "originalSongId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
] as const;

export const ROYALTIES_ABI = [
  {
    type: "function",
    name: "distributeLicensePayment",
    inputs: [
      { name: "songId", type: "uint256", internalType: "uint256" },
      { name: "payer", type: "address", internalType: "address" },
      { name: "creator", type: "address" },
      { name: "licensePrice", type: "uint256" },
    ],
    outputs: [
      { name: "creatorAmount", type: "uint256", internalType: "uint256" },
      { name: "treasuryAmount", type: "uint256", internalType: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "TREASURY_FEE_BPS",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "CREATOR_SHARE_BPS",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "treasury",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "usdc",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
] as const;

export function getFactoryContract(client: ThirdwebClient, chain: Chain) {
  return getContract({
    client,
    chain,
    address: getContractAddress("Factory"),
    abi: FACTORY_ABI,
  });
}

export function getRemixContract(client: ThirdwebClient, chain: Chain) {
  return getContract({
    client,
    chain,
    address: getContractAddress("Remix"),
    abi: REMIX_ABI,
  });
}

export function getRoyaltiesContract(client: ThirdwebClient, chain: Chain) {
  return getContract({
    client,
    chain,
    address: getContractAddress("Royalties"),
    abi: ROYALTIES_ABI,
  });
}

export function prepareBuyLicenseTransaction(
  client: ThirdwebClient,
  chain: Chain,
  songId: bigint,
) {
  const remix = getRemixContract(client, chain);
  return prepareContractCall({
    contract: remix,
    method: "buyLicense",
    params: [songId],
  });
}

export async function buyLicense({
  client,
  chain,
  account,
  songId,
  price,
  execute,
  assertCurrent,
}: {
  client: ThirdwebClient;
  chain: Chain;
  account: Account;
  songId: bigint;
  price?: bigint;
  execute?: (transaction: PreparedTransaction<any>) => Promise<{ status: string; transactionHash?: string }>;
  assertCurrent?: () => void;
}) {
  const check = () => assertCurrent?.();
  const remix = getRemixContract(client, chain);
  const royalties = getRoyaltiesContract(client, chain);
  const licensePrice =
    price !== undefined
      ? price
      : (
          await readContract({
            contract: getFactoryContract(client, chain),
            method: "getSong",
            params: [songId],
          })
        ).licensePrice;
  check();
  const tokenAddress = await readContract({ contract: royalties, method: "usdc" });
  check();
  const token = getContract({ client, chain, address: tokenAddress });
  const run =
    execute ??
    (async (transaction: PreparedTransaction<any>) => {
      check();
      const prepared = { account, transaction };
      await simulateTransaction(prepared);
      check();
      const receipt = await sendAndConfirmTransaction(prepared);
      check();
      return receipt;
    });
  const allowance = await readContract({
    contract: token,
    method: "function allowance(address owner, address spender) view returns (uint256)",
    params: [account.address, remix.address],
  });
  check();
  if (allowance < licensePrice) {
    const approval = prepareContractCall({
      contract: token,
      method: "function approve(address spender, uint256 amount) returns (bool)",
      params: [remix.address, licensePrice],
    });
    const receipt = await run(approval);
    if (receipt.status !== "success") throw new Error("Token approval failed");
  }
  const purchase = prepareBuyLicenseTransaction(client, chain, songId);
  const receipt = await run(purchase);
  if (receipt.status !== "success") throw new Error("License purchase failed");
  return receipt;
}

