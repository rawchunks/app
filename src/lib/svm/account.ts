/**
 * Deterministic Solana smart-account derivation from an EVM EOA.
 *
 * One EVM EOA ↔ one Solana smart account, forever.
 *
 *   EVM:  smartAccountAddress = CREATE2(factory, EOA)     → deterministic
 *   SVM:  swigWalletAddress = findSwigSystemAddressPda(   → deterministic PDA
 *           findSwigPda(hash(EOA)))
 *
 * The mapping is permanent — it's pure math (PDA derivation from a hash),
 * not a cached association. The same EVM EOA always produces the same
 * Solana wallet address on every device, every session, forever.
 *
 * The Swig account is controlled by the SAME secp256k1 key that controls
 * the EVM EOA (the personal/in-app wallet), registered as a `Secp256k1`
 * authority on the Swig program on-chain. Once created, the authority lives
 * on-chain permanently — no client-side persistence needed.
 *
 * Architecture:
 *   configPda  = findSwigPda(swigId)                  — Swig program config (internal)
 *   walletPda  = findSwigSystemAddressPda(configPda)  — where SOL/SPL tokens live (UI address)
 *
 * The wallet PDA is the SVM equivalent of the EVM smart account address.
 * It's what the user sees, funds, and what balance/settlement use.
 * The config PDA is internal — only used for Swig instruction building.
 */

import { findSwigPda, findSwigSystemAddressPdaRaw } from "@swig-wallet/kit";
import type { Address as SvmAddress } from "@solana/kit";
import { sha256, hashMessage, recoverPublicKey, hexToBytes } from "viem";

/**
 * Derive the 32-byte Swig ID from an EVM EOA address.
 *
 * Pure function — no network, no side effects, no storage.
 * The same EVM address always produces the same Swig ID, everywhere, forever.
 *
 * Domain-separated with the production domain so our PDAs never collide
 * with any other Swig integration deriving from the same EVM address.
 */
export function deriveSwigId(evmAddress: string): Uint8Array {
    const normalized = evmAddress.toLowerCase();
    const hashHex = sha256(new TextEncoder().encode(`compose.market:${normalized}`));
    return hexToBytes(hashHex);
}

/**
 * Derive the Swig config PDA address from an EVM EOA address.
 *
 * This is the Swig program's config account — internal, NOT for funding.
 * Used for fetchSwigAccount lookups and Swig instruction building.
 */
export async function deriveSwigConfigAddress(evmAddress: string): Promise<SvmAddress> {
    return findSwigPda(deriveSwigId(evmAddress));
}

/**
 * Derive the Swig wallet PDA address from an EVM EOA address.
 *
 * This is the SVM smart account address — what the user sees, funds,
 * and what balance/settlement use. Where SOL and SPL tokens actually live.
 *
 * Deterministic from the config PDA via findSwigSystemAddressPdaRaw —
 * no on-chain fetch needed. Computed instantly, client-side.
 *
 * This is the Solana equivalent of the EVM smart account address
 * (useActiveAccount().address on EVM).
 */
export async function deriveSwigWalletAddress(evmAddress: string): Promise<SvmAddress> {
    const configPda = await findSwigPda(deriveSwigId(evmAddress));
    const [walletPda] = await findSwigSystemAddressPdaRaw(configPda);
    return walletPda.toBase58() as SvmAddress;
}

/**
 * The message the EVM personal wallet signs (via personal_sign / EIP-191) to
 * prove control of the secp256k1 key. For in-app wallets this is invisible
 * (enclave signing). For external wallets it shows one popup.
 *
 * The signature is only used locally to recover the public key — it is never
 * sent to the server. The recovered pubkey is registered on-chain as the
 * Swig Secp256k1 authority, permanently.
 */
export const SWIG_AUTH_SIGN_MESSAGE =
    "Compose.Market Solana Account Setup\n\n" +
    "Signing this message enables your deterministic Solana smart account.\n" +
    "No transaction is sent, no gas is paid, and this signature is free.";

/**
 * Recover the uncompressed secp256k1 public key (65 bytes: 0x04 ‖ X ‖ Y)
 * from an EVM personal_sign signature. This is the key that gets registered
 * as the Swig `Secp256k1` authority on-chain.
 *
 * Pure function — no network, no side effects.
 */
export async function recoverEvmSecp256k1Pubkey(signature: `0x${string}`, message: string): Promise<`0x${string}`> {
    return recoverPublicKey({ hash: hashMessage(message), signature });
}
