import { expect, test, vi } from "vitest";
import { createActivationService, SOLANA_MAINNET } from "@/hooks/use-svm";

vi.mock("@/lib/sdk", () => ({ sdk: { svm: { feePayer: vi.fn(), relay: vi.fn() } } }));
const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const ADMIN = "0x1111111111111111111111111111111111111111";
const WALLET = "J62vBhiY1skwoXLmh3VG7jpgu6nrwczXh7NAfZgZn2tz";

function setup({ existing = false, sol = 5_000_000_000n, usdc = 0n, network = DEVNET } = {}) {
  let initialized = existing;
  const swig = { findRolesBySecp256k1SignerAddress: vi.fn(() => [{ id: 0 }]) };
  const rpc = { getBalance: vi.fn(() => ({ send: async () => ({ value: sol }) })) };
  const deps = {
    rpc: vi.fn(() => rpc), config: vi.fn(async () => "config"), deriveWallet: vi.fn(async () => WALLET), fetch: vi.fn(async () => initialized ? swig : null),
    wallet: vi.fn(async () => WALLET), balance: vi.fn(async () => usdc), pubkey: vi.fn(async () => "pubkey"),
    selfFunded: vi.fn(async ({ signMessage }) => { await signMessage(new Uint8Array([1])); return { unsignedTransaction: "SOL", reimbursementLamports: 1n }; }),
    usdcFunded: vi.fn(async ({ signMessage }) => { await signMessage(new Uint8Array([2])); return { unsignedTransaction: "USDC", reimbursementLamports: 1n }; }),
    feePayer: vi.fn(async () => ({ feePayer: "payer" })), relay: vi.fn(async () => { initialized = true; return { signature: "signature", confirmed: true }; }),
  };
  const input = { chain: { network, namespace: "solana", rpcUrl: "https://rpc.test", assetAddress: "mint" } as any,
    signer: { address: ADMIN, signMessage: vi.fn(async () => "0x01") } as any,
    walletAddress: WALLET, assertCurrent: vi.fn() };
  return { deps, input, swig, activate: createActivationService(deps as any) };
}

test("funded Devnet initializes the config, verifies wallet/admin role, and then reuses onchain initialization", async () => {
  const { deps, input, swig, activate } = setup();
  await expect(activate(input)).resolves.toMatchObject({ signature: "signature", confirmed: true });
  expect(deps.config).toHaveBeenCalledWith(ADMIN);
  expect(swig.findRolesBySecp256k1SignerAddress).toHaveBeenCalledWith(ADMIN);
  expect(deps.selfFunded).toHaveBeenCalledOnce();
  expect(deps.usdcFunded).not.toHaveBeenCalled();
  expect(deps.relay).toHaveBeenCalledWith({ unsignedTransaction: "SOL", network: DEVNET });
  await expect(activate(input)).resolves.toBeNull();
  expect(deps.relay).toHaveBeenCalledOnce();
});

test("simultaneous activation callers share the entire check/create/confirm operation", async () => {
  const { deps, input, activate } = setup();
  await Promise.all([activate(input), activate(input), activate(input)]);
  expect(deps.selfFunded).toHaveBeenCalledOnce();
  expect(deps.relay).toHaveBeenCalledOnce();
  expect(deps.fetch).toHaveBeenCalledTimes(2);
});

test("Devnet USDC never triggers Jupiter and insufficient SOL stops before signing", async () => {
  const { deps, input, activate } = setup({ sol: 49_999_999n, usdc: 30_000_000n });
  await expect(activate(input)).rejects.toThrow("0.05 SOL");
  expect(deps.balance).not.toHaveBeenCalled();
  expect(input.signer.signMessage).not.toHaveBeenCalled();
  expect(deps.relay).not.toHaveBeenCalled();
});

test("Mainnet USDC recovery uses captured mint/network and checks the post-creation config", async () => {
  const { deps, input, activate } = setup({ sol: 0n, usdc: 20_000_000n, network: SOLANA_MAINNET });
  await activate(input);
  expect(deps.selfFunded).not.toHaveBeenCalled();
  expect(deps.usdcFunded.mock.calls[0][0]).toMatchObject({ network: SOLANA_MAINNET, usdcMint: "mint", availableUsdc: 20_000_000n });
  expect(deps.fetch).toHaveBeenCalledTimes(2);
});

test("a config belonging to another wallet or lacking the admin role is rejected before signing", async () => {
  const wrongDerived = setup();
  wrongDerived.deps.deriveWallet.mockResolvedValue("other");
  await expect(wrongDerived.activate(wrongDerived.input)).rejects.toThrow("does not match");
  expect(wrongDerived.input.signer.signMessage).not.toHaveBeenCalled();
  expect(wrongDerived.deps.relay).not.toHaveBeenCalled();
  const wrongWallet = setup({ existing: true });
  wrongWallet.deps.wallet.mockResolvedValue("other");
  await expect(wrongWallet.activate(wrongWallet.input)).rejects.toThrow("does not match");
  const wrongRole = setup({ existing: true });
  wrongRole.swig.findRolesBySecp256k1SignerAddress.mockReturnValue([]);
  await expect(wrongRole.activate(wrongRole.input)).rejects.toThrow("no role");
  expect(wrongRole.input.signer.signMessage).not.toHaveBeenCalled();
});

test("changing scope while constructing activation stops relay and allows retry", async () => {
  const { deps, input, activate } = setup();
  let changed = false;
  input.assertCurrent.mockImplementation(() => { if (changed) throw new Error("network changed"); });
  deps.selfFunded.mockImplementationOnce(async () => { changed = true; return { unsignedTransaction: "SOL", reimbursementLamports: 1n }; });
  await expect(activate(input)).rejects.toThrow("network changed");
  expect(deps.relay).not.toHaveBeenCalled();
  changed = false;
  await expect(activate(input)).resolves.toMatchObject({ confirmed: true });
});

test("relay failures and unconfirmed activation never report initialization", async () => {
  const failed = setup();
  failed.deps.relay.mockRejectedValueOnce(new Error("relay failed"));
  await expect(failed.activate(failed.input)).rejects.toThrow("relay failed");
  await expect(failed.activate(failed.input)).resolves.toMatchObject({ confirmed: true });
  const unconfirmed = setup();
  unconfirmed.deps.relay.mockResolvedValueOnce({ signature: "pending", confirmed: false });
  await expect(unconfirmed.activate(unconfirmed.input)).rejects.toThrow("awaiting confirmation");
});
