import { afterEach, expect, test, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { address, createSolanaRpc, getAddressEncoder, getBase64Encoder, getProgramDerivedAddress, getTransactionDecoder } from "@solana/kit";
import { buildSelfFundedCreateSwigTransaction, buildUsdcFundedCreateSwigTransaction } from "@/lib/svm/swig";
import { deriveSwigId, deriveSwigConfigAddress, deriveSwigWalletAddress, recoverEvmSecp256k1Pubkey, SWIG_AUTH_SIGN_MESSAGE } from "@/lib/svm/account";
// Exercise Rawchunks' wire output against the Compose source checkout used for this repair.
import { validateSelfFundedSwigActivation, validateRelayFeePayerSigner } from "../../../../../compose-market/api/svm/relay";

const SYSTEM = address("11111111111111111111111111111111");
const TOKEN = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const WSOL = address("So11111111111111111111111111111111111111112");
const JUPITER = address("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const PAYER = address("139ckThCRxYDDFXgfRjH4TCiaTJETbb1UMLwACvWJ1fq");
const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const encode = getAddressEncoder();
async function ata(owner: string, mint: string) {
  return (await getProgramDerivedAddress({ programAddress: ATA, seeds: [encode.encode(address(owner)), encode.encode(TOKEN), encode.encode(address(mint))] }))[0];
}
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

async function setup(network: typeof DEVNET | typeof MAINNET, usdcOnly = false) {
  // Public synthetic test key; never used for a broadcast or a funded wallet.
  const signer = privateKeyToAccount(`0x${"01".repeat(32)}`);
  const config = await deriveSwigConfigAddress(signer.address);
  const wallet = await deriveSwigWalletAddress(signer.address);
  const mint = address(network === DEVNET ? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const usdcAta = await ata(wallet, mint);
  const tokenData = new Uint8Array(165);
  tokenData.set(encode.encode(mint), 0); tokenData.set(encode.encode(address(wallet)), 32);
  new DataView(tokenData.buffer).setBigUint64(64, 20_000_000n, true);
  const rpc = {
    getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: SYSTEM, lastValidBlockHeight: 1n } }) }),
    getSlot: () => ({ send: async () => 1n }),
    getBalance: () => ({ send: async () => ({ value: usdcOnly ? 0n : 5_000_000_000n }) }),
    getMinimumBalanceForRentExemption: (size: bigint) => ({ send: async () => size === 112n ? 1_670_400n : size === 165n ? 2_039_280n : 890_880n }),
    getFeeForMessage: () => ({ send: async () => ({ value: 5_000n }) }),
    getAccountInfo: (requested: string) => ({ send: async () => {
      if (requested === mint) return { value: { owner: TOKEN, lamports: 1n, data: ["", "base64"] } };
      if (requested === wallet) return { value: usdcOnly ? null : { owner: SYSTEM, lamports: 5_000_000_000n, data: ["", "base64"] } };
      if (requested === usdcAta) return { value: usdcOnly ? { owner: TOKEN, lamports: 2_039_280n, data: [base64(tokenData), "base64"] } : null };
      if (requested === config) return { value: null };
      throw new Error(`Unexpected account lookup: ${requested}`);
    } }),
  };
  const evmPubkey = await recoverEvmSecp256k1Pubkey(await signer.signMessage({ message: SWIG_AUTH_SIGN_MESSAGE }), SWIG_AUTH_SIGN_MESSAGE);
  return { rpc, wallet, mint, args: { swigId: deriveSwigId(signer.address), evmPubkey, feePayer: PAYER, usdcMint: mint, rpc: rpc as any,
    signMessage: (raw: Uint8Array) => signer.signMessage({ message: { raw } }) } };
}
afterEach(() => vi.unstubAllGlobals());

test.each([DEVNET, MAINNET] as const)("real self-funded builder passes relay validation on %s", async network => {
  const input = await setup(network);
  const built = await buildSelfFundedCreateSwigTransaction(input.args);
  const bytes = getBase64Encoder().encode(built.unsignedTransaction);
  const transaction = getTransactionDecoder().decode(bytes);
  expect(bytes.length).toBeLessThanOrEqual(1232);
  expect(built.reimbursementLamports).toBe(1_675_400n);
  expect(validateRelayFeePayerSigner(transaction, PAYER)).toBeNull();
  expect(await validateSelfFundedSwigActivation(transaction, PAYER, input.rpc as any, network)).toBeNull();
});

test("real Mainnet USDC builder and Jupiter response parser produce an atomic transaction accepted by relay", async () => {
  const input = await setup(MAINNET, true);
  const wsolAta = await ata(input.wallet, WSOL);
  const usdcAta = await ata(input.wallet, input.mint);
  const account = (pubkey: string, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });
  const fetch = vi.fn(async (url: string) => {
    const params = new URL(url).searchParams;
    expect(params.get("inputMint")).toBe(input.mint);
    expect(params.get("outputMint")).toBe(WSOL);
    expect(params.get("taker")).toBe(input.wallet);
    expect(params.get("payer")).toBe(input.wallet);
    const amount = BigInt(params.get("amount")!);
    return new Response(JSON.stringify({ inAmount: amount.toString(), otherAmountThreshold: (amount * 100n).toString(),
      setupInstructions: [{ programId: ATA, data: base64(new Uint8Array([1])), accounts: [account(input.wallet, true, true), account(wsolAta, true), account(input.wallet), account(WSOL), account(SYSTEM), account(TOKEN)] }],
      swapInstruction: { programId: JUPITER, data: base64(new Uint8Array([1, 2, 3])), accounts: [account(input.wallet, true, true), account(usdcAta, true), account(wsolAta, true)] },
      cleanupInstruction: { programId: TOKEN, data: base64(new Uint8Array([9])), accounts: [account(wsolAta, true), account(input.wallet, true), account(input.wallet, false, true)] },
    }));
  });
  vi.stubGlobal("fetch", fetch);
  const built = await buildUsdcFundedCreateSwigTransaction({ ...input.args, network: MAINNET, availableUsdc: 20_000_000n });
  const bytes = getBase64Encoder().encode(built.unsignedTransaction);
  const transaction = getTransactionDecoder().decode(bytes);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(bytes.length).toBeLessThanOrEqual(1232);
  expect(built.reimbursementLamports).toBe(3_714_680n);
  expect(validateRelayFeePayerSigner(transaction, PAYER)).toBeNull();
  expect(await validateSelfFundedSwigActivation(transaction, PAYER, input.rpc as any, MAINNET)).toBeNull();
});

test.skipIf(process.env.RAWCHUNKS_LIVE_JUPITER !== "1")("live Jupiter Mainnet route fits the real activation builder and relay validator", async () => {
  const input = await setup(MAINNET, true);
  const built = await buildUsdcFundedCreateSwigTransaction({ ...input.args, network: MAINNET, availableUsdc: 20_000_000n });
  const bytes = getBase64Encoder().encode(built.unsignedTransaction);
  const transaction = getTransactionDecoder().decode(bytes);
  const publicRpc = createSolanaRpc("https://api.mainnet-beta.solana.com");
  const validationRpc = { ...input.rpc, getMultipleAccounts: publicRpc.getMultipleAccounts, getAccountInfo: (requested: any, options: any) => ({ send: async () => {
    try { return await input.rpc.getAccountInfo(requested).send(); }
    catch { return publicRpc.getAccountInfo(requested, options).send(); }
  } }) };
  expect(bytes.length).toBeLessThanOrEqual(1232);
  expect(validateRelayFeePayerSigner(transaction, PAYER)).toBeNull();
  expect(await validateSelfFundedSwigActivation(transaction, PAYER, validationRpc as any, MAINNET)).toBeNull();
}, 30_000);
