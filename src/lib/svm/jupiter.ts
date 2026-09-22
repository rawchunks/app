import {
    AccountRole,
    address,
    getBase64Encoder,
    type Address,
    type AddressesByLookupTableAddress,
    type Instruction,
} from "@solana/kit";

const JUPITER_BUILD_URL = "https://api.jup.ag/swap/v2/build";
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const MAX_QUOTE_ATTEMPTS = 4;

interface JupiterApiInstruction {
    programId: string;
    accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
    data: string;
}

interface JupiterBuildResponse {
    inputMint?: string;
    outputMint?: string;
    inAmount?: string;
    outAmount?: string;
    otherAmountThreshold?: string;
    swapMode?: string;
    setupInstructions?: JupiterApiInstruction[];
    swapInstruction?: JupiterApiInstruction;
    cleanupInstruction?: JupiterApiInstruction | null;
    otherInstructions?: JupiterApiInstruction[];
    tipInstruction?: JupiterApiInstruction | null;
    addressesByLookupTableAddress?: Record<string, string[]> | null;
    error?: string;
    errorMessage?: string;
}

export interface JupiterSolRecoveryRoute {
    inputAmount: bigint;
    minimumOutputLamports: bigint;
    instructions: Instruction[];
    addressesByLookupTableAddress: AddressesByLookupTableAddress;
}

export async function buildMainnetUsdcToSolRoute(input: {
    walletAddress: Address;
    usdcMint: Address;
    availableUsdc: bigint;
    requiredOutputLamports: bigint;
}): Promise<JupiterSolRecoveryRoute> {
    const { walletAddress, usdcMint, availableUsdc, requiredOutputLamports } = input;
    if (availableUsdc <= 0n) throw new Error("Mainnet USDC balance is required for SOL recovery");

    let amount = availableUsdc < 1_000_000n ? availableUsdc : 1_000_000n;
    let build: JupiterBuildResponse | null = null;

    for (let attempt = 0; attempt < MAX_QUOTE_ATTEMPTS; attempt += 1) {
        build = await fetchJupiterBuild({ walletAddress, usdcMint, amount });
        const minimumOutput = BigInt(build.otherAmountThreshold ?? "0");
        if (minimumOutput <= 0n) throw new Error("Jupiter returned no minimum SOL output");

        const scaledAmount = divideCeil(amount * requiredOutputLamports * 101n, minimumOutput * 100n);
        if (minimumOutput >= requiredOutputLamports && scaledAmount >= amount * 99n / 100n) break;
        amount = scaledAmount > 0n ? scaledAmount : 1n;
        if (amount > availableUsdc) {
            throw new Error("Insufficient mainnet USDC to recover activation SOL");
        }
    }

    if (!build) throw new Error("Jupiter did not return a SOL recovery route");
    const minimumOutputLamports = BigInt(build.otherAmountThreshold ?? "0");
    if (minimumOutputLamports < requiredOutputLamports) {
        throw new Error("Jupiter route cannot guarantee enough SOL for activation");
    }
    if (BigInt(build.inAmount ?? "0") > availableUsdc) {
        throw new Error("Jupiter route exceeds the available mainnet USDC balance");
    }
    if (!build.swapInstruction || !build.cleanupInstruction) {
        throw new Error("Jupiter route must include swap and native SOL cleanup instructions");
    }
    if ((build.setupInstructions?.length ?? 0) !== 1) {
        throw new Error("Jupiter SOL recovery route must require exactly one WSOL setup instruction");
    }
    if ((build.otherInstructions?.length ?? 0) > 0 || build.tipInstruction) {
        throw new Error("Jupiter route contains unsupported auxiliary instructions");
    }

    const instructions = [
        ...(build.setupInstructions ?? []).map(toInstruction),
        toInstruction(build.swapInstruction),
        toInstruction(build.cleanupInstruction),
    ];
    const addressesByLookupTableAddress = Object.fromEntries(
        Object.entries(build.addressesByLookupTableAddress ?? {}).map(([lookupTable, addresses]) => [
            address(lookupTable),
            addresses.map((value) => address(value)),
        ]),
    ) as AddressesByLookupTableAddress;

    return {
        inputAmount: BigInt(build.inAmount ?? amount),
        minimumOutputLamports,
        instructions,
        addressesByLookupTableAddress,
    };
}

async function fetchJupiterBuild(input: {
    walletAddress: Address;
    usdcMint: Address;
    amount: bigint;
}): Promise<JupiterBuildResponse> {
    const params = new URLSearchParams({
        inputMint: input.usdcMint,
        outputMint: WRAPPED_SOL_MINT,
        amount: input.amount.toString(),
        taker: input.walletAddress,
        payer: input.walletAddress,
        slippageBps: "100",
        maxAccounts: "20",
        mode: "fast",
        computeUnitPricePercentile: "0",
        wrapAndUnwrapSol: "true",
        nativeDestinationAccount: input.walletAddress,
    });
    const apiKey = import.meta.env?.VITE_JUPITER_API_KEY?.trim();
    let response = await fetch(`${JUPITER_BUILD_URL}?${params}`, {
        headers: apiKey ? { "x-api-key": apiKey } : undefined,
    });
    if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "2");
        await new Promise((resolve) => globalThis.setTimeout(resolve, Math.max(1, retryAfter) * 1_000));
        response = await fetch(`${JUPITER_BUILD_URL}?${params}`, {
            headers: apiKey ? { "x-api-key": apiKey } : undefined,
        });
    }
    const body = await response.json() as JupiterBuildResponse;
    if (!response.ok || body.error || body.errorMessage) {
        throw new Error(body.errorMessage ?? body.error ?? `Jupiter build failed (${response.status})`);
    }
    return body;
}

function toInstruction(instruction: JupiterApiInstruction): Instruction {
    return {
        programAddress: address(instruction.programId),
        accounts: instruction.accounts.map((account) => ({
            address: address(account.pubkey),
            role: account.isSigner
                ? account.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER
                : account.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY,
        })),
        data: Uint8Array.from(getBase64Encoder().encode(instruction.data)),
    };
}

function divideCeil(numerator: bigint, denominator: bigint): bigint {
    return (numerator + denominator - 1n) / denominator;
}
