import { getContract, type ThirdwebClient, type Chain } from "thirdweb";
import { getContractAddress } from "./performance/chains-data";

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
