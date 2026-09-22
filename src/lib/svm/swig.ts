/**
 * Swig smart-account creation — entirely client-side.
 *
 * The displayed wallet PDA is funded before activation. The client then builds
 * an atomic CreateV1 + SignV2 transaction that returns every activation lamport
 * advanced by the relay.
 *
 * The client:
 *   1. Fetches a blockhash from the real Solana RPC (directly, no proxy)
 *   2. Builds the create-Swig instruction with the EVM secp256k1 pubkey as authority
 *   3. Sets the facilitator (from api/) as transaction fee-payer
 *   4. Compiles + serializes the unsigned transaction to base64
 *   5. Sends it to api/ POST /api/svm/relay for fee-payer signing + broadcast
 *
 * The facilitator key never leaves the server. The client never sees it.
 */

import {
    createSolanaRpc,
    devnet as solanaDevnet,
    mainnet as solanaMainnet,
    createTransactionMessage,
    setTransactionMessageFeePayer,
    setTransactionMessageLifetimeUsingBlockhash,
    appendTransactionMessageInstruction,
    compileTransaction,
    compressTransactionMessageUsingAddressLookupTables,
    getBase64EncodedWireTransaction,
    getBase64Encoder,
    getBase64Decoder,
    getProgramDerivedAddress,
    getAddressEncoder,
    address as svmAddress,
    AccountRole,
    pipe,
    type Address as SvmAddress,
    type Instruction,
    type AddressesByLookupTableAddress,
} from "@solana/kit";
import {
    getCreateSwigInstruction,
    createSecp256k1AuthorityInfo,
    Actions,
    fetchNullableSwig,
    getSwigWalletAddress,
    getSignInstructions,
    getEvmPersonalSignPrefix,
    findSwigPdaRaw,
    findSwigSystemAddressPdaRaw,
    Swig,
    type SigningFn,
} from "@swig-wallet/kit";
import type { NetworkId } from "@compose-market/sdk/chains";
import { buildMainnetUsdcToSolRoute } from "@/lib/svm/jupiter";

/**
 * Create a Solana RPC client from a network ID + RPC URL.
 * Uses the real RPC URL from the chains config (no proxy).
 */
export function createSolanaRpcFromNetwork(network: NetworkId, rpcUrl: string) {
    if (network === "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1") { return createSolanaRpc(solanaDevnet(rpcUrl)); }
    if (network === "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp") { return createSolanaRpc(solanaMainnet(rpcUrl)); }
    throw new Error(`Unsupported Solana network: ${network}`);
}

/**
 * Check if a Swig account already exists on-chain at the derived PDA.
 * Returns null for a missing account. RPC and decoding failures propagate.
 */
export async function fetchSwigAccount(
    rpc: ReturnType<typeof createSolanaRpcFromNetwork>,
    swigAddress: SvmAddress,
): Promise<Swig | null> {
    return fetchNullableSwig(rpc as any, swigAddress);
}

export const SWIG_PROGRAM = "swigypWHEksbC64pWKwah1WTeh9JXwx8H1rJHLdbQMB";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const SWIG_CONFIG_SIZE = 112n;
export const SVM_ACTIVATION_MINIMUM_LAMPORTS = 50_000_000n;
export const SVM_ACTIVATION_MEMO = "compose.market: activate account";
export const SVM_SESSION_APPROVAL_MEMO = "compose.market: approve session";
const MAINNET_NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
const MAX_COMPUTE_UNITS = 1_400_000;
const SPL_TOKEN_ACCOUNT_SIZE = 165n;
const SWIG_HEADER_SIZE = 48;
const SWIG_POSITION_SIZE = 16;
const SWIG_SECP256K1_AUTHORITY_SIZE = 40;
const SWIG_ALL_ACTION_SIZE = 8;
const SWIG_ACCOUNT_DISCRIMINATOR = 1;
const SWIG_SECP256K1_AUTHORITY_TYPE = 3;
const SWIG_ALL_PERMISSION = 7;
const ASSOCIATED_TOKEN_CREATE_IDEMPOTENT = 1;
const SYSTEM_TRANSFER_DISCRIMINATOR = 2;

interface SelfFundedActivationContext {
    configAddress: SvmAddress;
    walletAddress: SvmAddress;
    usdcAtaAddress: SvmAddress;
    configBump: number;
    walletBump: number;
    tokenProgram: SvmAddress;
}

export interface SvmActivationTransaction {
    unsignedTransaction: string;
    reimbursementLamports: bigint;
}

/** Build the canonical, user-funded CreateV1 + SignV2 activation transaction. */
export async function buildSelfFundedCreateSwigTransaction(input: {
    swigId: Uint8Array;
    evmPubkey: `0x${string}`;
    feePayer: SvmAddress;
    usdcMint: string;
    rpc: ReturnType<typeof createSolanaRpcFromNetwork>;
    signMessage: (message: Uint8Array) => Promise<string>;
}): Promise<SvmActivationTransaction> {
    const { swigId, evmPubkey, feePayer, usdcMint, rpc, signMessage } = input;
    const context = await deriveSelfFundedActivationContext(swigId, usdcMint, rpc);
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const currentSlot = await rpc.getSlot().send();

    const [configRentLamports, walletBalance] = await Promise.all([
        rpc.getMinimumBalanceForRentExemption(SWIG_CONFIG_SIZE).send(),
        rpc.getBalance(context.walletAddress).send(),
    ]);

    const provisionalInstructions = await buildSelfFundedActivationInstructions({
        swigId,
        evmPubkey,
        feePayer,
        usdcMint,
        reimbursementLamports: 0n,
        currentSlot: BigInt(currentSlot),
        context,
        signingFn: async (message) => ({
            signature: new Uint8Array(65),
            prefix: getEvmPersonalSignPrefix(message.length),
        }),
    });
    const memoInstruction = encodeMemoInstruction(SVM_ACTIVATION_MEMO);
    const provisionalTransaction = compileActivationTransaction(
        [memoInstruction, ...provisionalInstructions],
        feePayer,
        latestBlockhash,
    );
    const transactionFeeLamports = await readTransactionFee(rpc, provisionalTransaction.messageBytes);
    if (walletBalance.value < SVM_ACTIVATION_MINIMUM_LAMPORTS) {
        throw new Error(
            `Fund Solana account ${context.walletAddress} with at least ${SVM_ACTIVATION_MINIMUM_LAMPORTS} lamports before activation`,
        );
    }

    const signingFn: SigningFn = async (message: Uint8Array) => {
        const signed = await signMessage(message);
        return {
            signature: hexToBytes(signed),
            prefix: getEvmPersonalSignPrefix(message.length),
        };
    };
    const finalInstructions = await buildSelfFundedActivationInstructions({
        swigId,
        evmPubkey,
        feePayer,
        usdcMint,
        reimbursementLamports: configRentLamports + transactionFeeLamports,
        currentSlot: BigInt(currentSlot),
        context,
        signingFn,
    });
    const transaction = compileActivationTransaction(
        [memoInstruction, ...finalInstructions],
        feePayer,
        latestBlockhash,
    );
    const finalFee = await readTransactionFee(rpc, transaction.messageBytes);
    if (finalFee !== transactionFeeLamports) {
        throw new Error("Solana activation fee changed while constructing the transaction; retry activation");
    }

    return {
        unsignedTransaction: getBase64EncodedWireTransaction(transaction),
        reimbursementLamports: configRentLamports + transactionFeeLamports,
    };
}

/** Mainnet-only activation when the wallet holds USDC but less than 0.05 SOL. */
export async function buildUsdcFundedCreateSwigTransaction(input: {
    swigId: Uint8Array;
    evmPubkey: `0x${string}`;
    feePayer: SvmAddress;
    usdcMint: string;
    availableUsdc: bigint;
    network: NetworkId;
    rpc: ReturnType<typeof createSolanaRpcFromNetwork>;
    signMessage: (message: Uint8Array) => Promise<string>;
}): Promise<SvmActivationTransaction> {
    const { swigId, evmPubkey, feePayer, usdcMint, availableUsdc, network, rpc, signMessage } = input;
    if (network !== MAINNET_NETWORK) {
        throw new Error("USDC-funded Solana activation is available on mainnet only");
    }
    const context = await deriveSelfFundedActivationContext(swigId, usdcMint, rpc);
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const currentSlot = await rpc.getSlot().send();
    const [configRentLamports, walletReserveLamports, temporaryWsolRentLamports] = await Promise.all([
        rpc.getMinimumBalanceForRentExemption(SWIG_CONFIG_SIZE).send(),
        rpc.getMinimumBalanceForRentExemption(0n).send(),
        rpc.getMinimumBalanceForRentExemption(SPL_TOKEN_ACCOUNT_SIZE).send(),
    ]);

    const createInstruction = await getCreateSwigInstruction({
        payer: feePayer,
        id: swigId,
        actions: Actions.set().all().get(),
        authorityInfo: createSecp256k1AuthorityInfo(evmPubkey),
    });
    const memoInstruction = encodeMemoInstruction(SVM_ACTIVATION_MEMO);
    const feeProbe = compileActivationTransaction(
        [memoInstruction, createInstruction as Instruction],
        feePayer,
        latestBlockhash,
    );
    const transactionFeeLamports = await readTransactionFee(rpc, feeProbe.messageBytes);
    const route = await buildMainnetUsdcToSolRoute({
        walletAddress: context.walletAddress,
        usdcMint: svmAddress(usdcMint),
        availableUsdc,
        requiredOutputLamports: configRentLamports + transactionFeeLamports + walletReserveLamports,
    });

    const signingFn: SigningFn = async (message: Uint8Array) => ({
        signature: hexToBytes(await signMessage(message)),
        prefix: getEvmPersonalSignPrefix(message.length),
    });
    const syntheticSwig = createPendingSwig({
        swigId,
        authorityData: createSecp256k1AuthorityInfo(evmPubkey).data,
        configAddress: context.configAddress,
        configBump: context.configBump,
        walletBump: context.walletBump,
    });
    const reimbursementLamports = temporaryWsolRentLamports + configRentLamports + transactionFeeLamports;
    const reimbursementInstruction = {
        programAddress: svmAddress(SYSTEM_PROGRAM),
        accounts: [
            { address: context.walletAddress, role: AccountRole.WRITABLE_SIGNER },
            { address: feePayer, role: AccountRole.WRITABLE },
        ],
        data: encodeSystemTransferInstructionData(reimbursementLamports),
    } as Instruction;
    const signInstructions = await getSignInstructions(
        syntheticSwig,
        0,
        [...route.instructions, reimbursementInstruction] as any,
        false,
        { payer: feePayer, currentSlot: BigInt(currentSlot), signingFn } as any,
    );
    const prefundInstruction = {
        programAddress: svmAddress(SYSTEM_PROGRAM),
        accounts: [
            { address: feePayer, role: AccountRole.WRITABLE_SIGNER },
            { address: context.walletAddress, role: AccountRole.WRITABLE },
        ],
        data: encodeSystemTransferInstructionData(temporaryWsolRentLamports),
    } as Instruction;
    const computeLimitInstruction = encodeComputeUnitLimitInstruction(MAX_COMPUTE_UNITS);
    const transaction = compileActivationTransaction(
        [memoInstruction, computeLimitInstruction, prefundInstruction, createInstruction as Instruction, ...(signInstructions as Instruction[])],
        feePayer,
        latestBlockhash,
        route.addressesByLookupTableAddress,
    );
    const finalFee = await readTransactionFee(rpc, transaction.messageBytes);
    if (finalFee !== transactionFeeLamports) {
        throw new Error("Solana activation fee changed while constructing the USDC recovery transaction");
    }
    const unsignedTransaction = getBase64EncodedWireTransaction(transaction);
    if (getBase64Encoder().encode(unsignedTransaction).length > 1232) {
        throw new Error("USDC-funded activation transaction exceeds Solana's 1,232-byte limit");
    }
    return { unsignedTransaction, reimbursementLamports };
}

export async function readSvmTokenBalance(input: {
    owner: SvmAddress;
    mint: string;
    rpc: ReturnType<typeof createSolanaRpcFromNetwork>;
}): Promise<bigint> {
    const mint = svmAddress(input.mint);
    const tokenProgram = await readMintOwner(input.rpc, mint);
    const ata = await findAta(input.owner, mint, tokenProgram);
    const info = await input.rpc.getAccountInfo(ata, { encoding: "base64" }).send();
    if (!info.value) return 0n;
    const encoded = info.value.data[0];
    const bytes = Uint8Array.from(globalThis.atob(encoded), (character) => character.charCodeAt(0));
    if (bytes.length < 72) return 0n;
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(64, true);
}

async function deriveSelfFundedActivationContext(
    swigId: Uint8Array,
    usdcMintValue: string,
    rpc: ReturnType<typeof createSolanaRpcFromNetwork>,
): Promise<SelfFundedActivationContext> {
    const [configPda, configBump] = await findSwigPdaRaw(swigId);
    const [walletPda, walletBump] = await findSwigSystemAddressPdaRaw(configPda);
    const configAddress = configPda.toBase58() as SvmAddress;
    const walletAddress = walletPda.toBase58() as SvmAddress;
    const mint = svmAddress(usdcMintValue);
    const tokenProgram = await readMintOwner(rpc, mint);
    if (tokenProgram !== SPL_TOKEN_PROGRAM) {
        throw new Error("Self-funded activation currently requires a standard SPL Token payment mint");
    }
    const usdcAtaAddress = await findAta(walletAddress, mint, tokenProgram);
    return {
        configAddress,
        walletAddress,
        usdcAtaAddress,
        configBump,
        walletBump,
        tokenProgram,
    };
}

async function buildSelfFundedActivationInstructions(input: {
    swigId: Uint8Array;
    evmPubkey: `0x${string}`;
    feePayer: SvmAddress;
    usdcMint: string;
    reimbursementLamports: bigint;
    currentSlot: bigint;
    context: SelfFundedActivationContext;
    signingFn: SigningFn;
}): Promise<Instruction[]> {
    const { swigId, evmPubkey, feePayer, usdcMint, reimbursementLamports, currentSlot, context, signingFn } = input;
    const actions = Actions.set().all().get();
    const authorityInfo = createSecp256k1AuthorityInfo(evmPubkey);
    const createInstruction = await getCreateSwigInstruction({
        payer: feePayer,
        id: swigId,
        actions,
        authorityInfo,
    });
    const syntheticSwig = createPendingSwig({
        swigId,
        authorityData: authorityInfo.data,
        configAddress: context.configAddress,
        configBump: context.configBump,
        walletBump: context.walletBump,
    });

    const createAtaInstruction = {
        programAddress: svmAddress(ASSOCIATED_TOKEN_PROGRAM),
        accounts: [
            { address: context.walletAddress, role: AccountRole.WRITABLE_SIGNER },
            { address: context.usdcAtaAddress, role: AccountRole.WRITABLE },
            { address: context.walletAddress, role: AccountRole.READONLY },
            { address: svmAddress(usdcMint), role: AccountRole.READONLY },
            { address: svmAddress(SYSTEM_PROGRAM), role: AccountRole.READONLY },
            { address: context.tokenProgram, role: AccountRole.READONLY },
        ],
        data: new Uint8Array([ASSOCIATED_TOKEN_CREATE_IDEMPOTENT]),
    } as Instruction;
    const reimbursementInstruction = {
        programAddress: svmAddress(SYSTEM_PROGRAM),
        accounts: [
            { address: context.walletAddress, role: AccountRole.WRITABLE_SIGNER },
            { address: feePayer, role: AccountRole.WRITABLE },
        ],
        data: encodeSystemTransferInstructionData(reimbursementLamports),
    } as Instruction;
    const signInstructions = await getSignInstructions(
        syntheticSwig,
        0,
        [createAtaInstruction, reimbursementInstruction] as any,
        false,
        { payer: feePayer, currentSlot, signingFn } as any,
    );
    return [createInstruction as Instruction, ...(signInstructions as Instruction[])];
}

function createPendingSwig(input: {
    swigId: Uint8Array;
    authorityData: Uint8Array;
    configAddress: SvmAddress;
    configBump: number;
    walletBump: number;
}): Swig {
    const { swigId, authorityData, configAddress, configBump, walletBump } = input;
    if (authorityData.length !== 64) {
        throw new Error("Expected a 64-byte uncompressed secp256k1 public key");
    }
    const data = new Uint8Array(Number(SWIG_CONFIG_SIZE));
    const view = new DataView(data.buffer);
    data[0] = SWIG_ACCOUNT_DISCRIMINATOR;
    data[1] = configBump;
    data.set(swigId, 2);
    view.setUint16(34, 1, true);
    view.setUint32(36, 1, true);
    data[40] = walletBump;

    const positionOffset = SWIG_HEADER_SIZE;
    view.setUint16(positionOffset, SWIG_SECP256K1_AUTHORITY_TYPE, true);
    view.setUint16(positionOffset + 2, SWIG_SECP256K1_AUTHORITY_SIZE, true);
    view.setUint16(positionOffset + 4, 1, true);
    view.setUint32(positionOffset + 8, 0, true);
    view.setUint32(
        positionOffset + 12,
        SWIG_POSITION_SIZE + SWIG_SECP256K1_AUTHORITY_SIZE + SWIG_ALL_ACTION_SIZE,
        true,
    );

    const authorityOffset = positionOffset + SWIG_POSITION_SIZE;
    data[authorityOffset] = (authorityData[63] ?? 0) & 1 ? 3 : 2;
    data.set(authorityData.slice(0, 32), authorityOffset + 1);
    view.setUint32(authorityOffset + 36, 0, true);

    const actionOffset = authorityOffset + SWIG_SECP256K1_AUTHORITY_SIZE;
    view.setUint16(actionOffset, SWIG_ALL_PERMISSION, true);
    view.setUint16(actionOffset + 2, 0, true);
    view.setUint32(actionOffset + 4, SWIG_ALL_ACTION_SIZE, true);
    return Swig.fromRawAccountData(configAddress, data);
}

function encodeSystemTransferInstructionData(amount: bigint): Uint8Array {
    const data = new Uint8Array(12);
    const view = new DataView(data.buffer);
    view.setUint32(0, SYSTEM_TRANSFER_DISCRIMINATOR, true);
    view.setBigUint64(4, amount, true);
    return data;
}

function encodeComputeUnitLimitInstruction(units: number): Instruction {
    const data = new Uint8Array(5);
    data[0] = 2;
    new DataView(data.buffer).setUint32(1, units, true);
    return {
        programAddress: svmAddress(COMPUTE_BUDGET_PROGRAM),
        accounts: [],
        data,
    };
}

function encodeMemoInstruction(value: string): Instruction {
    return {
        programAddress: svmAddress(MEMO_PROGRAM),
        accounts: [],
        data: new TextEncoder().encode(value),
    };
}

function compileActivationTransaction(
    instructions: readonly Instruction[],
    feePayer: SvmAddress,
    latestBlockhash: any,
    lookupTables?: AddressesByLookupTableAddress,
) {
    let transactionMessage = instructions.reduce(
        (message: any, instruction) => appendTransactionMessageInstruction(instruction, message),
        pipe(
            createTransactionMessage({ version: 0 }),
            (message: any) => setTransactionMessageFeePayer(feePayer, message),
            (message: any) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message),
        ),
    );
    if (lookupTables && Object.keys(lookupTables).length > 0) {
        transactionMessage = compressTransactionMessageUsingAddressLookupTables(
            transactionMessage as any,
            lookupTables,
        ) as any;
    }
    return compileTransaction(transactionMessage as any);
}

async function readTransactionFee(
    rpc: ReturnType<typeof createSolanaRpcFromNetwork>,
    messageBytes: Parameters<ReturnType<typeof getBase64Decoder>["decode"]>[0],
): Promise<bigint> {
    const messageBase64 = getBase64Decoder().decode(messageBytes);
    const response = await rpc.getFeeForMessage(messageBase64 as any, { commitment: "confirmed" }).send();
    if (response.value === null) {
        throw new Error("Solana RPC could not quote the activation transaction fee");
    }
    return response.value;
}

const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SPL_TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SPL_APPROVE_DISCRIMINATOR = 4;

async function readMintOwner(
    rpc: ReturnType<typeof createSolanaRpcFromNetwork>,
    mint: SvmAddress,
): Promise<SvmAddress> {
    const info = await rpc.getAccountInfo(mint, { encoding: "base64" }).send();
    const owner = info.value?.owner;
    if (owner === SPL_TOKEN_2022_PROGRAM) return svmAddress(SPL_TOKEN_2022_PROGRAM);
    if (owner === SPL_TOKEN_PROGRAM) return svmAddress(SPL_TOKEN_PROGRAM);
    if (owner) throw new Error(`Unsupported token program for mint ${mint}: ${owner}`);
    throw new Error(`Token mint not found: ${mint}`);
}

async function findAta(
    owner: SvmAddress,
    mint: SvmAddress,
    tokenProgram: SvmAddress,
): Promise<SvmAddress> {
    const encoder = getAddressEncoder();
    const [ata] = await getProgramDerivedAddress({
        programAddress: svmAddress(ASSOCIATED_TOKEN_PROGRAM),
        seeds: [encoder.encode(owner), encoder.encode(tokenProgram), encoder.encode(mint)],
    });
    return ata;
}

function encodeApproveInstructionData(amount: bigint): Uint8Array {
    const data = new Uint8Array(9);
    data[0] = SPL_APPROVE_DISCRIMINATOR;
    new DataView(data.buffer).setBigUint64(1, amount, true);
    return data;
}

/**
 * Build a Swig-signed SPL `approve` transaction that delegates USDC spending
 * from the Swig wallet to the facilitator (SVM_TREASURY_SERVER_WALLET_PUBLIC).
 *
 * This is the Solana equivalent of EVM's `approve(treasury, budget)`:
 *   EVM:  smartAccount.approve(USDC, treasury, budget)
 *   SVM:  Swig signs SPL approve(facilitator, budget) on its USDC ATA
 *
 * The EVM secp256k1 key (admin wallet EOA) signs the Swig instruction via
 * `personal_sign` (invisible enclave for in-app wallets). The facilitator
 * pays the transaction fee (gasless, like sponsorGas).
 *
 * After this, api/ can `transferChecked` from the Swig's ATA using the
 * facilitator as delegate — exactly like EVM `transferFrom`.
 */
export async function buildSwigApproveTransaction(input: {
    /** The Swig config PDA (used for fetchSwigAccount — NOT the wallet PDA). */
    swigConfigAddress: SvmAddress;
    /** The selected-network Solana userAddress. Must be the Swig wallet PDA. */
    expectedWalletAddress?: SvmAddress | string | null;
    evmSignerAddress: string;
    usdcMint: string;
    amount: bigint;
    feePayer: SvmAddress;
    network: NetworkId;
    rpcUrl: string;
    signMessage: (message: Uint8Array) => Promise<string>;
}): Promise<string> {
    const {
        swigConfigAddress,
        expectedWalletAddress,
        evmSignerAddress,
        usdcMint,
        amount,
        feePayer,
        network,
        rpcUrl,
        signMessage,
    } = input;

    const rpc = createSolanaRpcFromNetwork(network, rpcUrl);
    const { swigWalletAddress } = await loadSwigSigningContext({
        rpc,
        swigConfigAddress,
        expectedWalletAddress,
        evmSignerAddress,
    });

    const mint = svmAddress(usdcMint);
    const tokenProgram = await readMintOwner(rpc, mint);
    const sourceAta = await findAta(swigWalletAddress as SvmAddress, mint, tokenProgram);

    const approveData = encodeApproveInstructionData(amount);

    const approveInstruction = {
        programAddress: tokenProgram,
        accounts: [
            { address: sourceAta, role: AccountRole.WRITABLE },
            { address: feePayer, role: AccountRole.WRITABLE },
            { address: swigWalletAddress, role: AccountRole.READONLY_SIGNER },
        ],
        data: approveData,
    } as any;

    return buildSwigInstructionTransaction({
        swigConfigAddress,
        expectedWalletAddress,
        evmSignerAddress,
        feePayer,
        network,
        rpcUrl,
        instructions: [approveInstruction],
        memo: SVM_SESSION_APPROVAL_MEMO,
        signMessage,
    });
}

export async function buildSwigInstructionTransaction(input: {
    /** The Swig config PDA (used for fetchSwigAccount — NOT the wallet PDA). */
    swigConfigAddress: SvmAddress;
    /** The selected-network Solana userAddress. Must be the Swig wallet PDA. */
    expectedWalletAddress?: SvmAddress | string | null;
    evmSignerAddress: string;
    feePayer: SvmAddress;
    network: NetworkId;
    rpcUrl: string;
    instructions: readonly Instruction[];
    memo?: string;
    signMessage: (message: Uint8Array) => Promise<string>;
}): Promise<string> {
    const {
        swigConfigAddress,
        expectedWalletAddress,
        evmSignerAddress,
        feePayer,
        network,
        rpcUrl,
        instructions,
        memo,
        signMessage,
    } = input;

    if (instructions.length === 0) {
        throw new Error("At least one Solana instruction is required");
    }
    for (const instruction of instructions) {
        if (!instruction.accounts || !instruction.data) {
            throw new Error("Swig-wrapped Solana instructions must include explicit accounts and data");
        }
    }

    const rpc = createSolanaRpcFromNetwork(network, rpcUrl);
    const { swig, roleId } = await loadSwigSigningContext({
        rpc,
        swigConfigAddress,
        expectedWalletAddress,
        evmSignerAddress,
    });

    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const currentSlot = await rpc.getSlot().send();

    const signingFn: SigningFn = async (message: Uint8Array) => {
        const signed = await signMessage(message);
        return {
            signature: hexToBytes(signed),
            prefix: getEvmPersonalSignPrefix(message.length),
        };
    };

    const signInstructions = await getSignInstructions(
        swig,
        roleId,
        instructions as any,
        false,
        {
            payer: feePayer,
            currentSlot: BigInt(currentSlot),
            signingFn,
        } as any,
    );

    const baseMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (msg: any) => setTransactionMessageFeePayer(feePayer, msg),
        (msg: any) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    );
    const transactionMessage = signInstructions.reduce(
        (msg: any, ix: any) => appendTransactionMessageInstruction(ix, msg),
        memo ? appendTransactionMessageInstruction(encodeMemoInstruction(memo), baseMessage as any) as any : baseMessage,
    );

    const unsignedTransaction = compileTransaction(transactionMessage as any);
    return getBase64EncodedWireTransaction(unsignedTransaction);
}

async function loadSwigSigningContext(input: {
    rpc: ReturnType<typeof createSolanaRpcFromNetwork>;
    swigConfigAddress: SvmAddress;
    expectedWalletAddress?: SvmAddress | string | null;
    evmSignerAddress: string;
}): Promise<{ swig: Swig; swigWalletAddress: SvmAddress; roleId: number }> {
    const { rpc, swigConfigAddress, expectedWalletAddress, evmSignerAddress } = input;

    let swig: Swig | null;
    try {
        swig = await fetchNullableSwig(rpc as any, swigConfigAddress);
    } catch {
        swig = null;
    }
    if (!swig) {
        throw new Error("Swig account not initialized on-chain at the derived address");
    }

    const swigWalletAddress = await getSwigWalletAddress(swig) as SvmAddress;
    if (expectedWalletAddress && swigWalletAddress !== expectedWalletAddress) {
        throw new Error(
            `Swig wallet mismatch for config ${swigConfigAddress}: selected Solana userAddress ${expectedWalletAddress}, fetched Swig wallet ${swigWalletAddress}, EVM signer ${evmSignerAddress}`,
        );
    }

    const roles = swig.findRolesBySecp256k1SignerAddress(evmSignerAddress);
    if (!roles || roles.length === 0) {
        const existingSigners = getSecp256k1RoleSignerAddresses(swig).join(", ") || "none";
        throw new Error(
            `No Swig role found for EVM signer ${evmSignerAddress} on config ${swigConfigAddress} / wallet ${swigWalletAddress}. Existing secp256k1 signers: ${existingSigners}`,
        );
    }

    return { swig, swigWalletAddress, roleId: roles[0].id };
}

function getSecp256k1RoleSignerAddresses(swig: Swig): string[] {
    return swig.roles
        .map((role: any) => role.authority?.secp256k1AddressString
            ?? role.authority?.signerAddressString
            ?? role.authority?.addressString
            ?? null)
        .filter((value: unknown): value is string => typeof value === "string" && value.length > 0)
        .map((value) => value.startsWith("0x") ? value : `0x${value}`);
}

function hexToBytes(hex: string): Uint8Array {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}
