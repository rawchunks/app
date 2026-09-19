/**
 * Shared display formatters.
 *
 * One implementation of the wei → USDC display conversion (6-decimal USDC)
 * used by workflow cost summaries and execution results.
 */

export function formatWeiUsd(value: string | number, decimals = 4): string {
    const wei = typeof value === "number"
        ? (Number.isFinite(value) ? value : 0)
        : (parseInt(value) || 0);
    return `$${(wei / 1_000_000).toFixed(decimals)}`;
}

export function usd(value: number): string {
    return `$${value.toLocaleString("en-US")}`;
}
