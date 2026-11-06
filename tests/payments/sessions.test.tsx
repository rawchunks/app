// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

const mock = vi.hoisted(() => ({
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", svm: "J62vBhiY1skwoXLmh3VG7jpgu6nrwczXh7NAfZgZn2tz",
  admin: "0x1111111111111111111111111111111111111111", smart: "0x2222222222222222222222222222222222222222",
  fetch: vi.fn(), activate: vi.fn(), sign: vi.fn(), visibleSign: vi.fn(), solanaSignTx: vi.fn(), balance: vi.fn(), approve: vi.fn(), directApprove: vi.fn(), relay: vi.fn(), support: vi.fn(),
  currentWallet: null as any, token: null as string | null, cleared: vi.fn(), listeners: new Map<string, Set<(event: any) => void>>(),
  attached: vi.fn(), clearWallet: vi.fn(), select: vi.fn(), connected: true, eoaOnly: false, solanaEoa: false,
  evmBalance: vi.fn(), evmAllowance: vi.fn(), evmApprove: vi.fn(), evmSend: vi.fn(), receipt: vi.fn(), tempoApprove: vi.fn(),
  time: 0, update: (_: number) => {}, credit: null as any,
}));
vi.mock("@/lib/audio", () => ({ audio: {
  load: vi.fn(() => { mock.time = 0; }), play: vi.fn(), pause: vi.fn(), reset: vi.fn(), stopImmediate: vi.fn(),
  preloadNext: vi.fn(), hasSource: () => true, position: () => mock.time,
  setOnTimeUpdate: (callback: any) => { mock.update = callback; }, setOnDuration: vi.fn(), setOnEnd: vi.fn(),
} }));
vi.mock("thirdweb", () => ({ getContract: vi.fn(input => input), sendTransaction: mock.evmSend, waitForReceipt: mock.receipt }));
vi.mock("thirdweb/extensions/erc20", () => ({ balanceOf: mock.evmBalance, allowance: mock.evmAllowance, approve: mock.evmApprove }));
vi.mock("@/components/connector", () => ({ approveTempoSession: mock.tempoApprove }));
vi.mock("@/lib/chains", () => ({ isEvmNetwork: (network: string) => network.startsWith("eip155:"),
  isSolanaNetwork: (network: string) => network.startsWith("solana:"), evmChainId: (network: string) => Number(network.slice(7)),
  getChainObject: (id: number) => ({ id, rpc: "https://rpc.test" }), thirdwebClient: {} }));
vi.mock("thirdweb/react", () => ({
  useActiveWallet: () => mock.solanaEoa
    ? { id: "app.phantom", getAccount: () => ({ address: mock.svm, isSolanaBrowserAccount: true, signMessage: mock.visibleSign, signSolanaTransaction: mock.solanaSignTx }) }
    : mock.eoaOnly
      ? { id: "io.metamask", getAccount: () => ({ address: mock.admin, signMessage: mock.visibleSign }) }
      : undefined,
  useActiveAccount: () => mock.connected
    ? mock.solanaEoa
      ? { address: mock.svm, isSolanaBrowserAccount: true, signMessage: mock.visibleSign, signSolanaTransaction: mock.solanaSignTx }
      : { address: mock.eoaOnly ? mock.admin : mock.smart, signMessage: mock.visibleSign }
    : undefined,
  useAdminWallet: () => mock.solanaEoa ? undefined : ({ getAccount: () => ({ address: mock.admin, signMessage: mock.sign }) }),
}));
vi.mock("@/contexts/Network", () => ({ NetworkGlyph: () => null, useChain: () => ({ selectedNetwork: mock.network,
  chains: [{ network: mock.network, rpcUrl: "https://rpc.test", assetAddress: "mint", asset: mock.network === "eip155:42431" ? "OUSD" : "USDC" }], setSelectedNetwork: mock.select }) }));
vi.mock("@/hooks/use-address", () => ({ useSelectedUserAddress: () => ({ userAddress: mock.connected ? (mock.network.startsWith("eip155:") ? (mock.eoaOnly ? mock.admin : mock.smart) : mock.svm) : null,
  readAddress: mock.svm, evmSignerAddress: mock.connected && !mock.eoaOnly && !mock.solanaEoa ? mock.admin : null, activate: mock.activate }) }));
vi.mock("@/lib/svm/swig", () => ({ createSolanaRpcFromNetwork: vi.fn(() => ({})), readSvmTokenBalance: mock.balance, buildSwigApproveTransaction: mock.approve, buildDirectSvmApproveTransaction: mock.directApprove }));
vi.mock("@/lib/api", () => ({
  api: { fetch: mock.fetch },
  setCreditRequestContext: vi.fn(value => { mock.credit = value; }),
  hasStreamBudget: () => Boolean(mock.token || Number(mock.credit?.cardAvailableAtomics) > 0), hasPromoCreditsOnly: () => false,
  captureStreamBilling: (account: string) => [{ source: 'usdc', token: mock.token, account, network: mock.network, walletToken: null }],
  streamOptions: (billing: any) => ({ key: billing.token, network: billing.network, userAddress: billing.account, headers: {} }),
}));
vi.mock("@/lib/compose", () => ({
  compose: {
    fetch: mock.fetch, x402: { facilitator: { supported: mock.support } }, svm: { relay: mock.relay },
    wallets: { attach: (input: any) => { mock.currentWallet = input; mock.token = null; mock.attached(input); }, current: () => mock.currentWallet ?? { address: null, network: null },
      clear: () => { mock.currentWallet = null; mock.token = null; mock.clearWallet(); } },
    keys: { use: (value: any) => { mock.token = value; }, currentToken: () => mock.token, clearToken: () => { mock.token = null; mock.cleared(); }, revoke: vi.fn() },
    events: { on: (name: string, callback: any) => { const set = mock.listeners.get(name) ?? new Set(); set.add(callback); mock.listeners.set(name, set); return () => set.delete(callback); } },
    session: { subscribe: () => ({ async *[Symbol.asyncIterator]() {} }) },
  },
}));

import { SessionProvider, useSession, emptySession, readSession, writeSession, sameScope, requireSessionSupport } from "@/components/session";
import { store } from '@/lib/store';
import { audio } from '@/lib/audio';
import { closeGate } from '@/lib/gate';
import { zeroCredits } from "@/lib/credits";
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
  store.clearUserWorkspace(); closeGate(false); mock.time = 0;
  vi.clearAllMocks(); localStorage.clear(); mock.listeners.clear(); mock.network = DEVNET; mock.connected = true; mock.eoaOnly = false; mock.solanaEoa = false; mock.currentWallet = null; mock.token = null;
  mock.fetch.mockImplementation(async path => response(path === "/api/keys" ? keyResponse() : { hasSession: false }));
  mock.support.mockImplementation(async () => ({ kinds: [{ x402Version: 2, scheme: "upto", network: mock.network, extra: { feePayer: mock.svm } }] }));
  mock.activate.mockResolvedValue(null); mock.balance.mockResolvedValue(30_000_000n); mock.sign.mockResolvedValue("0x01");
  mock.solanaSignTx.mockImplementation(async (bytes: Uint8Array) => bytes);
  mock.approve.mockImplementation(async input => { await input.signMessage(new Uint8Array([1])); return "unsigned"; });
  mock.directApprove.mockImplementation(async input => { await input.signTransaction(new Uint8Array([1, 2, 3])); return "unsigned-direct-solana"; });
  mock.relay.mockResolvedValue({ signature: "approval", confirmed: true });
  mock.evmBalance.mockResolvedValue(30_000_000n); mock.evmAllowance.mockResolvedValue(0n);
  mock.evmApprove.mockReturnValue({}); mock.evmSend.mockResolvedValue({ transactionHash: "0x01" }); mock.receipt.mockResolvedValue({ status: "success" });
  mock.tempoApprove.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); store.clearUserWorkspace(); closeGate(false); });
async function mount() {
  const result = render(<SessionProvider><Probe /></SessionProvider>);
  await waitFor(() => expect(mock.fetch).toHaveBeenCalledWith("/api/session", expect.objectContaining({ network: DEVNET, userAddress: mock.svm, key: null })));
  await act(async () => {});
  return result;
}

const paidSong = { id: 'paid-song', title: 'Paid', creator: 'other-creator', url: 'https://cdn.test/song.wav', stream_price: .03, duration: 180, public: true } as any;
const checkpointResponse = (body: any) => response({ success: true, result: { status: 'confirmed', acceptedListenedSeconds: body.listenedSeconds, billedWei: '1001', deltaWei: '1001' } });
async function startPlayback() {
  await mount();
  await act(async () => { await context.createSession('1000000', 1); });
  const previous = mock.fetch.getMockImplementation()!;
  mock.fetch.mockImplementation(async (path: string, init: any) => {
    if (path.endsWith('/stream')) return response({ paymentIntentId: 'intent', url: paidSong.url });
    if (path.endsWith('/checkpoint')) return checkpointResponse(JSON.parse(init.body));
    return previous(path, init);
  });
  store.setUserAddress(mock.svm);
  store.setActiveSong(paidSong);
  await act(async () => { await store.setPlaying(true); });
  mock.time = 2.003; mock.update(mock.time);
}

test('session disconnect stops active audio and flushes the captured fractional tail', async () => {
  await startPlayback();
  await act(async () => {
    context.clearSession();
    expect(audio.pause).toHaveBeenCalled();
    expect(store.getState().isPlaying).toBe(false);
  });
  expect(mock.token).toBeNull();
  const checkpoints = mock.fetch.mock.calls.filter(c => String(c[0]).endsWith('/checkpoint'));
  expect(checkpoints).toHaveLength(1);
  expect(checkpoints[0][1]).toMatchObject({ key: 'token', network: DEVNET, userAddress: mock.svm });
  expect(JSON.parse(checkpoints[0][1].body)).toMatchObject({ listenedSeconds: 2.003, terminal: true });
  expect(await store.setPlaying(true)).toBe(false);
});

test('session deletion stops audio and settles usage before revoking the captured key', async () => {
  await startPlayback();
  let accept!: () => void;
  const order: string[] = [];
  const previous = mock.fetch.getMockImplementation()!;
  mock.fetch.mockImplementation((path: string, init: any) => {
    if (path.endsWith('/checkpoint')) return new Promise<Response>(resolve => { accept = () => { order.push('settled'); resolve(checkpointResponse(JSON.parse(init.body))); }; });
    if (init?.method === 'DELETE') { order.push('deleted'); return Promise.resolve(response({ success: true })); }
    return previous(path, init);
  });
  let ending!: Promise<void>;
  await act(async () => {
    ending = context.endSession();
    expect(audio.pause).toHaveBeenCalled();
    expect(store.getState().isPlaying).toBe(false);
  });
  expect(mock.token).toBeNull();
  expect(order).toEqual([]);
  expect(await store.setPlaying(true)).toBe(false);
  await act(async () => { accept(); await ending; });
  expect(order).toEqual(['settled', 'deleted']);
  expect(mock.fetch).toHaveBeenCalledWith('/api/keys/key', expect.objectContaining({ method: 'DELETE', key: 'token', userAddress: mock.svm, network: DEVNET }));
});

test('failed final settlement retains usage and prevents session deletion', async () => {
  await startPlayback();
  const previous = mock.fetch.getMockImplementation()!;
  mock.fetch.mockImplementation((path: string, init: any) => path.endsWith('/checkpoint') ? Promise.resolve(response({ error: 'Unavailable' }, 503)) : previous(path, init));
  await act(async () => { await expect(context.endSession()).rejects.toThrow(/settlement.*pending/i); });
  expect(store.getState().isPlaying).toBe(false);
  expect(mock.fetch.mock.calls.some(c => c[1]?.method === 'DELETE')).toBe(false);
  const key = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).find(k => k?.startsWith('rawchunks:stream:'))!;
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ observedMs: 2003, acceptedMs: 0, terminal: true, billing: { token: 'token' } });
});

test('session expiry from the provider stops playback without waiting for another checkpoint', async () => {
  await startPlayback();
  await act(async () => { emit('sessionExpired', { userAddress: mock.svm, network: DEVNET }); });
  expect(audio.pause).toHaveBeenCalled();
  expect(store.getState().isPlaying).toBe(false);
  expect(mock.token).toBeNull();
});

test('a delayed session refresh cannot reconnect a manually disconnected session', async () => {
  await startPlayback();
  let resolve!: (value: Response) => void;
  mock.fetch.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  let refreshing!: Promise<void>;
  await act(async () => { refreshing = context.refreshSession(); });
  await act(async () => { context.clearSession(); });
  await act(async () => { resolve(response({ hasSession: true, ...keyResponse() })); await refreshing; });
  expect(mock.token).toBeNull();
  expect(context.session.active).toBe(false);
});

test.each([{ hasSession: false }, { hasSession: true, status: { isActive: false } }])('an inactive session refresh stops active playback: %j', async status => {
  await startPlayback();
  const previous = mock.fetch.getMockImplementation()!;
  mock.fetch.mockImplementation((path: string, init: any) => path === '/api/session' ? Promise.resolve(response(status)) : previous(path, init));
  await act(async () => { await context.refreshSession(); });
  expect(store.getState().isPlaying).toBe(false);
  expect(audio.pause).toHaveBeenCalled();
  expect(mock.token).toBeNull();
});

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

test("Solana browser wallet EOA (Phantom) creates a Solana session directly without Swig activation or EVM signer", async () => {
  mock.solanaEoa = true;
  await mount();
  await act(async () => { await context.createSession("1000000", 1); });
  expect(mock.activate).not.toHaveBeenCalled();
  expect(mock.approve).not.toHaveBeenCalled();
  expect(mock.directApprove).toHaveBeenCalledWith(expect.objectContaining({
    owner: mock.svm,
    usdcMint: "mint",
    amount: 1_000_000n,
    feePayer: mock.svm,
    network: DEVNET,
  }));
  expect(mock.solanaSignTx).toHaveBeenCalledOnce();
  expect(mock.relay).toHaveBeenCalledWith({ unsignedTransaction: "unsigned-direct-solana", network: DEVNET });
  expect(context.session).toMatchObject({ active: true, userAddress: mock.svm, network: DEVNET, token: "token" });
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

test("browser-wallet EOA user on Tempo approves directly from the EOA without smart-account wrapping", async () => {
  mock.network = "eip155:42431";
  mock.eoaOnly = true;
  mock.support.mockResolvedValue({ kinds: [{ x402Version: 2, scheme: "upto", network: mock.network, extra: { facilitatorAddress: mock.smart } }] });
  render(<SessionProvider><Probe /></SessionProvider>);
  await act(async () => {});
  await act(async () => { await context.createSession("1000000", 1); });
  expect(mock.tempoApprove).not.toHaveBeenCalled();
  expect(mock.evmApprove).toHaveBeenCalledWith(expect.objectContaining({ spender: mock.smart, amountWei: 1_000_000n }));
  expect(mock.evmSend).toHaveBeenCalledWith(expect.objectContaining({ account: expect.objectContaining({ address: mock.admin }) }));
  expect(mock.fetch).toHaveBeenCalledWith("/api/keys", expect.objectContaining({ network: mock.network, userAddress: mock.admin }));
  expect(context.session).toMatchObject({ active: true, network: mock.network, userAddress: mock.admin });
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

test("zeroCredits separates promo accounting and SessionProvider always fetches Compose Market USDC session", async () => {
  expect(zeroCredits.availableAtomics).toBe("0");
  expect(zeroCredits.promo).toBeUndefined();
  expect(zeroCredits.packs).toEqual([]);

  mock.fetch.mockImplementation(async () => response({
    hasSession: true,
    network: DEVNET,
    keyId: "compose-key-1",
    token: "compose-jwt-1",
    budgetLimit: "5000000",
    budgetUsed: "0",
    budgetRemaining: "5000000",
    expiresAt: Date.now() + 60_000,
    status: { isActive: true },
  }));
  await mount();
  expect(context.session.active).toBe(true);
  expect(context.session.fundingSource).toBe("wallet");
  expect(context.session.budgetRemaining).toBe("5000000");
  expect(context.hasBudget).toBe(true);
  expect(context.hasStreamBudget).toBe(true);
  expect(context.activeSource).toBe("usdc");
});
