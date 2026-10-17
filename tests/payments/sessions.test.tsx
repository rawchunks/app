import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

const mock = vi.hoisted(() => ({
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", svm: "J62vBhiY1skwoXLmh3VG7jpgu6nrwczXh7NAfZgZn2tz",
  admin: "0x1111111111111111111111111111111111111111", smart: "0x2222222222222222222222222222222222222222",
  fetch: vi.fn(), activate: vi.fn(), sign: vi.fn(), visibleSign: vi.fn(), balance: vi.fn(), approve: vi.fn(), relay: vi.fn(), support: vi.fn(),
  currentWallet: null as any, token: null as string | null, cleared: vi.fn(), listeners: new Map<string, Set<(event: any) => void>>(),
  attached: vi.fn(), clearWallet: vi.fn(), select: vi.fn(), connected: true,
  evmBalance: vi.fn(), evmAllowance: vi.fn(), evmApprove: vi.fn(), evmSend: vi.fn(), receipt: vi.fn(), tempoApprove: vi.fn(),
}));
vi.mock("thirdweb", () => ({ getContract: vi.fn(input => input), sendTransaction: mock.evmSend, waitForReceipt: mock.receipt }));
vi.mock("thirdweb/extensions/erc20", () => ({ balanceOf: mock.evmBalance, allowance: mock.evmAllowance, approve: mock.evmApprove }));
vi.mock("@/components/connector", () => ({ approveTempoSession: mock.tempoApprove }));
vi.mock("@/lib/chains", () => ({ isEvmNetwork: (network: string) => network.startsWith("eip155:"),
  isSolanaNetwork: (network: string) => network.startsWith("solana:"), evmChainId: (network: string) => Number(network.slice(7)),
  getChainObject: (id: number) => ({ id, rpc: "https://rpc.test" }), thirdwebClient: {} }));
vi.mock("thirdweb/react", () => ({ useActiveWallet: () => undefined, useActiveAccount: () => mock.connected ? { address: mock.smart, signMessage: mock.visibleSign } : undefined,
  useAdminWallet: () => ({ getAccount: () => ({ address: mock.admin, signMessage: mock.sign }) }) }));
vi.mock("@/contexts/Network", () => ({ NetworkGlyph: () => null, useChain: () => ({ selectedNetwork: mock.network,
  chains: [{ network: mock.network, rpcUrl: "https://rpc.test", assetAddress: "mint", asset: mock.network === "eip155:42431" ? "OUSD" : "USDC" }], setSelectedNetwork: mock.select }) }));
vi.mock("@/hooks/use-address", () => ({ useSelectedUserAddress: () => ({ userAddress: mock.connected ? (mock.network.startsWith("eip155:") ? mock.smart : mock.svm) : null,
  readAddress: mock.svm, evmSignerAddress: mock.connected ? mock.admin : null, activate: mock.activate }) }));
vi.mock("@/lib/svm/swig", () => ({ createSolanaRpcFromNetwork: vi.fn(() => ({})), readSvmTokenBalance: mock.balance, buildSwigApproveTransaction: mock.approve }));
vi.mock("@/lib/sdk", () => ({ setCreditRequestContext: vi.fn(), sdk: {
  fetch: mock.fetch, x402: { facilitator: { supported: mock.support } }, svm: { relay: mock.relay },
  wallets: { attach: input => { mock.currentWallet = input; mock.token = null; mock.attached(input); }, current: () => mock.currentWallet ?? { address: null, network: null },
    clear: () => { mock.currentWallet = null; mock.token = null; mock.clearWallet(); } },
  keys: { use: value => { mock.token = value; }, currentToken: () => mock.token, clearToken: () => { mock.token = null; mock.cleared(); }, revoke: vi.fn() },
  events: { on: (name, callback) => { const set = mock.listeners.get(name) ?? new Set(); set.add(callback); mock.listeners.set(name, set); return () => set.delete(callback); } },
  session: { subscribe: () => ({ async *[Symbol.asyncIterator]() {} }) },
} }));

import { SessionProvider, useSession, emptySession, readSession, writeSession, sameScope, requireSessionSupport } from "@/components/session";
import { deriveSwigConfigAddress } from "@/lib/svm/account";
const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
let context: ReturnType<typeof useSession>;
function Probe() { context = useSession(); return <span>{context.session.network}</span>; }
const scope = () => ({ address: mock.svm, network: mock.network as any });
const keyResponse = () => ({ network: mock.network, keyId: "key", token: "token", budgetLimit: "1000000", budgetUsed: "0", budgetRemaining: "1000000", expiresAt: Date.now() + 60_000 });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function emit(name: string, value: unknown) { mock.listeners.get(name)?.forEach(callback => callback(value)); }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); mock.listeners.clear(); mock.network = DEVNET; mock.connected = true; mock.currentWallet = null; mock.token = null;
  mock.fetch.mockImplementation(async path => response(path === "/api/keys" ? keyResponse() : { hasSession: false }));
  mock.support.mockImplementation(async () => ({ kinds: [{ x402Version: 2, scheme: "upto", network: mock.network, extra: { feePayer: mock.svm } }] }));
  mock.activate.mockResolvedValue(null); mock.balance.mockResolvedValue(30_000_000n); mock.sign.mockResolvedValue("0x01");
  mock.approve.mockImplementation(async input => { await input.signMessage(new Uint8Array([1])); return "unsigned"; });
  mock.relay.mockResolvedValue({ signature: "approval", confirmed: true });
  mock.evmBalance.mockResolvedValue(30_000_000n); mock.evmAllowance.mockResolvedValue(0n);
  mock.evmApprove.mockReturnValue({}); mock.evmSend.mockResolvedValue({ transactionHash: "0x01" }); mock.receipt.mockResolvedValue({ status: "success" });
  mock.tempoApprove.mockResolvedValue(undefined);
});
afterEach(() => cleanup());
async function mount() {
  const result = render(<SessionProvider><Probe /></SessionProvider>);
  await waitFor(() => expect(mock.fetch).toHaveBeenCalledWith("/api/session", expect.objectContaining({ network: DEVNET, userAddress: mock.svm, key: null })));
  await act(async () => {});
  return result;
}

test("first session activates before approval, derives from admin, signs with admin, then creates a key", async () => {
  await mount();
  await act(async () => { await context.createSession("1000000", 1); });
  expect(mock.activate.mock.invocationCallOrder[0]).toBeLessThan(mock.approve.mock.invocationCallOrder[0]);
  const approval = mock.approve.mock.calls[0][0];
  expect(approval.swigConfigAddress).toBe(await deriveSwigConfigAddress(mock.admin));
  expect(approval.evmSignerAddress).toBe(mock.admin);
  expect(approval.expectedWalletAddress).toBe(mock.svm);
  expect(mock.sign).toHaveBeenCalledOnce();
  expect(mock.visibleSign).not.toHaveBeenCalled();
  expect(context.session).toMatchObject({ active: true, userAddress: mock.svm, network: DEVNET, token: "token" });
  expect(mock.relay.mock.invocationCallOrder[0]).toBeLessThan(mock.fetch.mock.invocationCallOrder.find((_, i) => mock.fetch.mock.calls[i][0] === "/api/keys")!);
});

test("EVM session approves from the smart account to the discovered facilitator and waits for success", async () => {
  mock.network = "eip155:84532";
  mock.support.mockResolvedValue({ kinds: [{ x402Version: 2, scheme: "upto", network: mock.network, extra: { facilitatorAddress: mock.admin } }] });
  render(<SessionProvider><Probe /></SessionProvider>);
  await act(async () => {});
  await act(async () => { await context.createSession("1000000", 1); });
  expect(mock.activate).not.toHaveBeenCalled();
  expect(mock.evmAllowance).toHaveBeenCalledWith(expect.objectContaining({ owner: mock.smart, spender: mock.admin }));
  expect(mock.evmApprove).toHaveBeenCalledWith(expect.objectContaining({ spender: mock.admin, amountWei: 1_000_000n }));
  expect(mock.evmSend).toHaveBeenCalledWith(expect.objectContaining({ account: expect.objectContaining({ address: mock.smart }) }));
  expect(mock.receipt.mock.invocationCallOrder[0]).toBeLessThan(mock.fetch.mock.invocationCallOrder.find((_, i) => mock.fetch.mock.calls[i][0] === "/api/keys")!);
  mock.evmAllowance.mockResolvedValue(0n); mock.receipt.mockResolvedValueOnce({ status: "reverted" });
  const posts = mock.fetch.mock.calls.filter(call => call[0] === "/api/keys").length;
  await act(async () => { await expect(context.createSession("1000000", 1)).rejects.toThrow("approval failed"); });
  expect(mock.fetch.mock.calls.filter(call => call[0] === "/api/keys").length).toBe(posts);
});

test("Tempo uses the same smart-account session and admin-authorized approval without Thirdweb bundling", async () => {
  mock.network = "eip155:42431";
  mock.support.mockResolvedValue({ kinds: [{ x402Version: 2, scheme: "upto", network: mock.network, extra: { facilitatorAddress: mock.admin } }] });
  render(<SessionProvider><Probe /></SessionProvider>);
  await act(async () => {});
  await act(async () => { await context.createSession("1000000", 1); });
  expect(mock.tempoApprove).toHaveBeenCalledWith(expect.objectContaining({
    accountAddress: mock.smart, admin: expect.objectContaining({ address: mock.admin }),
    chain: expect.objectContaining({ id: 42431 }), asset: "mint", spender: mock.admin, amount: 1_000_000n,
  }));
  expect(mock.evmSend).not.toHaveBeenCalled();
  expect(mock.fetch).toHaveBeenCalledWith("/api/keys", expect.objectContaining({ network: mock.network, userAddress: mock.smart }));
  expect(context.session).toMatchObject({ active: true, network: mock.network, userAddress: mock.smart });
  mock.tempoApprove.mockRejectedValueOnce(new Error("Fund the admin wallet with pathUSD"));
  await act(async () => { await expect(context.createSession("1000000", 1)).rejects.toThrow("pathUSD"); });
  expect(mock.fetch.mock.calls.filter(c => c[0] === "/api/keys")).toHaveLength(1);
});

test("Tempo funding errors name the API-advertised stablecoin", async () => {
  mock.network = "eip155:42431";
  mock.support.mockResolvedValue({ kinds: [{ x402Version: 2, scheme: "upto", network: mock.network, extra: { facilitatorAddress: mock.admin } }] });
  mock.evmBalance.mockResolvedValue(0n);
  render(<SessionProvider><Probe /></SessionProvider>);
  await act(async () => {});
  await act(async () => { await expect(context.createSession("1000000", 1)).rejects.toThrow("OUSD"); });
  expect(mock.tempoApprove).not.toHaveBeenCalled();
});

test("StrictMode restores and refreshes the current scope without installing a stale response", async () => {
  render(<React.StrictMode><SessionProvider><Probe /></SessionProvider></React.StrictMode>);
  await act(async () => {});
  await act(async () => { await context.createSession("1000000", 1); });
  expect(context.session).toMatchObject({ active: true, network: DEVNET, token: "token" });
});

test("unsupported capability, activation failure, and approval failure each prevent key creation", async () => {
  await mount();
  mock.support.mockResolvedValueOnce({ kinds: [] });
  await act(async () => { await expect(context.createSession("1000000", 1)).rejects.toThrow("unavailable"); });
  expect(mock.activate).not.toHaveBeenCalled();
  mock.activate.mockRejectedValueOnce(new Error("activation failed"));
  await act(async () => { await expect(context.createSession("1000000", 1)).rejects.toThrow("activation failed"); });
  expect(mock.approve).not.toHaveBeenCalled();
  mock.relay.mockRejectedValueOnce(new Error("approval failed"));
  await act(async () => { await expect(context.createSession("1000000", 1)).rejects.toThrow("approval failed"); });
  expect(mock.fetch.mock.calls.some(call => call[0] === "/api/keys")).toBe(false);
});

test("switching scope cancels refresh and ignores delayed responses and old session events", async () => {
  const result = await mount();
  let resolve!: (value: Response) => void;
  mock.fetch.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  let refresh!: Promise<void>;
  await act(async () => { refresh = context.refreshSession(); });
  const request = mock.fetch.mock.calls.at(-1)![1];
  mock.network = MAINNET;
  result.rerender(<SessionProvider><Probe /></SessionProvider>);
  await act(async () => {});
  expect(request.signal.aborted).toBe(true);
  await act(async () => { resolve(response({ hasSession: true, network: DEVNET, token: "old", ...keyResponse() })); await refresh; });
  await act(async () => { emit("sessionActive", { userAddress: mock.svm, network: DEVNET, budgetRemaining: "999" }); });
  expect(context.session.active).toBe(false);
  expect(mock.currentWallet.network).toBe(MAINNET);
  expect(mock.token).not.toBe("old");
  expect(mock.select).not.toHaveBeenCalled();
});

test("a network switch during activation stops approval and key creation", async () => {
  const result = await mount();
  let resolve!: () => void;
  mock.activate.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  let operation!: Promise<unknown>;
  await act(async () => { operation = context.createSession("1000000", 1).catch(error => error); });
  mock.network = MAINNET;
  result.rerender(<SessionProvider><Probe /></SessionProvider>);
  await act(async () => { resolve(); });
  expect(await operation).toBeInstanceOf(Error);
  expect(mock.approve).not.toHaveBeenCalled();
  expect(mock.fetch.mock.calls.some(call => call[0] === "/api/keys")).toBe(false);
});

test("switching away and back still invalidates the original approval operation", async () => {
  const result = await mount();
  let resolve!: () => void;
  mock.activate.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  let operation!: Promise<unknown>;
  await act(async () => { operation = context.createSession("1000000", 1).catch(error => error); });
  mock.network = MAINNET;
  result.rerender(<SessionProvider><Probe /></SessionProvider>);
  mock.network = DEVNET;
  result.rerender(<SessionProvider><Probe /></SessionProvider>);
  await act(async () => { resolve(); });
  expect(await operation).toBeInstanceOf(Error);
  expect(mock.approve).not.toHaveBeenCalled();
  expect(context.isCreating).toBe(false);
  await act(async () => { await context.createSession("1000000", 1); });
  expect(context.session.active).toBe(true);
});

test("manual refresh cannot overwrite a session while its approval is in progress", async () => {
  await mount();
  let resolve!: () => void;
  mock.activate.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  let operation!: Promise<unknown>;
  await act(async () => { operation = context.createSession("1000000", 1); });
  const before = mock.fetch.mock.calls.length;
  await act(async () => { await context.refreshSession(); });
  expect(mock.fetch.mock.calls.length).toBe(before);
  await act(async () => { resolve(); await operation; });
  expect(context.session.token).toBe("token");
});

test("unmount during activation stops approval and key creation", async () => {
  const result = await mount();
  let resolve!: () => void;
  mock.activate.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  let operation!: Promise<unknown>;
  await act(async () => { operation = context.createSession("1000000", 1).catch(error => error); });
  result.unmount();
  resolve();
  expect(await operation).toBeInstanceOf(Error);
  expect(mock.approve).not.toHaveBeenCalled();
});

test("restores each network's token when switching back without erasing the other cache", async () => {
  mock.fetch.mockImplementation(async () => response({ hasSession: true, network: mock.network, budgetRemaining: "1000000" }));
  writeSession(localStorage, { address: mock.svm, network: DEVNET }, { ...emptySession, ...keyResponse(), active: true, userAddress: mock.svm, network: DEVNET, token: "dev-token" } as any);
  writeSession(localStorage, { address: mock.svm, network: MAINNET }, { ...emptySession, ...keyResponse(), active: true, userAddress: mock.svm, network: MAINNET, token: "main-token" } as any);
  const result = await mount();
  expect(mock.token).toBe("dev-token");
  mock.network = MAINNET;
  result.rerender(<SessionProvider><Probe /></SessionProvider>);
  await act(async () => {});
  expect(mock.token).toBe("main-token");
  mock.network = DEVNET;
  result.rerender(<SessionProvider><Probe /></SessionProvider>);
  await act(async () => {});
  expect(mock.token).toBe("dev-token");
  expect(readSession(localStorage, { address: mock.svm, network: MAINNET })?.token).toBe("main-token");
});

test("cached sessions are scoped by address/network and migrate only a matching legacy cache", () => {
  const devnet = { ...emptySession, ...keyResponse(), active: true, userAddress: mock.svm, network: DEVNET } as any;
  localStorage.setItem("rawchunks:session", JSON.stringify(devnet));
  expect(readSession(localStorage, { address: mock.svm, network: MAINNET })).toBeNull();
  expect(readSession(localStorage, scope())).toMatchObject({ token: "token", network: DEVNET });
  expect(localStorage.getItem("rawchunks:session")).toBeNull();
  writeSession(localStorage, { address: mock.svm, network: MAINNET }, { ...devnet, network: MAINNET, token: "main" });
  writeSession(localStorage, scope(), emptySession);
  expect(readSession(localStorage, { address: mock.svm, network: MAINNET })?.token).toBe("main");
  expect(sameScope(devnet, { address: mock.smart, network: DEVNET })).toBe(false);
});

test("disconnect clears live session and cached addresses cannot sign", async () => {
  const result = await mount();
  await act(async () => { await context.createSession("1000000", 1); });
  mock.connected = false;
  result.rerender(<SessionProvider><Probe /></SessionProvider>);
  await act(async () => {});
  expect(context.session.active).toBe(false);
  expect(mock.currentWallet).toBeNull();
  await expect(context.createSession("1000000", 1)).rejects.toThrow("Connect");
});

test("session support requires v2 upto for the exact selected network", () => {
  expect(() => requireSessionSupport({ kinds: [{ x402Version: 1, scheme: "upto", network: DEVNET }], extensions: [] }, DEVNET)).toThrow();
  expect(() => requireSessionSupport({ kinds: [{ x402Version: 2, scheme: "upto", network: MAINNET }], extensions: [] }, DEVNET)).toThrow();
});
