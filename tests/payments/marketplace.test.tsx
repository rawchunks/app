import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mock = vi.hoisted(() => ({
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  wallet: "J62vBhiY1skwoXLmh3VG7jpgu6nrwczXh7NAfZgZn2tz",
  admin: "0x1111111111111111111111111111111111111111",
  smart: "0x2222222222222222222222222222222222222222",
  activate: vi.fn(), sign: vi.fn(), capture: vi.fn(), guard: vi.fn(), deployment: vi.fn(),
  mint: vi.fn(), remix: vi.fn(), buy: vi.fn(), refetch: vi.fn(), invalidate: vi.fn(), error: vi.fn(), success: vi.fn(),
  songs: new Map<string, any>(), minted: false,
}));
vi.mock("thirdweb/react", () => ({ useActiveAccount: () => ({ address: mock.smart }) }));
vi.mock("@/hooks/use-address", () => ({ useSelectedUserAddress: () => ({ userAddress: mock.wallet, svmAddress: mock.wallet,
  evmAddress: mock.smart, paymentNetwork: mock.network, captureSolanaOperation: mock.capture, assertCurrent: mock.guard }) }));
vi.mock("@/lib/chains", () => ({ isEvmNetwork: (network: string) => network.startsWith("eip155:"),
  getNetworkRpcUrl: () => "https://rpc.test", usdcToWei: (amount: number) => BigInt(amount * 1_000_000) }));
vi.mock("@/lib/contracts", () => ({ getFactoryContract: vi.fn(), getRemixContract: vi.fn(), getRoyaltiesContract: vi.fn(), requireEvmDeployment: vi.fn() }));
vi.mock("@/lib/programs", () => ({ requireSolanaDeployment: mock.deployment,
  relaySolanaMintSong: mock.mint, relaySolanaRemixSong: mock.remix, relaySolanaBuyLicense: mock.buy,
  fetchSolanaFactoryConfig: async () => ({ totalSongs: mock.minted ? 1n : 0n }),
  fetchSolanaSong: async () => { const song = mock.songs.get("song"); return { creator: song.creator, metadataUri: "ipfs://cid",
    isRemix: Boolean(song.source), parentSongId: song.source ? 7n : 0n }; }, fetchSolanaHasLicense: vi.fn() }));
vi.mock("@/lib/pinata", () => ({ uploadSongMetadata: async () => "cid", fetchFromIpfs: vi.fn() }));
vi.mock("@/lib/store", () => ({ store: { updateSong: vi.fn(), addSong: vi.fn() } }));
vi.mock("@/lib/sdk", () => ({ sdk: { fetch: async (path: string, input: any) => {
  const id = path.split("/").at(-1)!;
  const song = mock.songs.get(id);
  if (input.method === "PATCH") { const updated = { ...song, ...JSON.parse(input.body) }; mock.songs.set(id, updated); return new Response(JSON.stringify(updated)); }
  return new Response(JSON.stringify({ song }));
} } }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mock.invalidate }), useQueries: () => [],
  useQuery: (options: any) => options.queryKey[0] === "license" ? { refetch: mock.refetch } : {} }));
vi.mock("sonner", () => ({ toast: { error: mock.error, success: mock.success } }));

import { useMint } from "@/hooks/use-mint";
import { useLicense } from "@/hooks/use-license";

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); mock.songs.clear(); mock.minted = false;
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: (_key: string, run: () => unknown) => run() } });
  mock.songs.set("song", { id: "song", title: "Song", creator: mock.wallet, licenses: 10, license_price: 1, stream_price: 0.1 });
  mock.activate.mockResolvedValue(null); mock.sign.mockResolvedValue("signature"); mock.deployment.mockResolvedValue(undefined);
  mock.capture.mockImplementation(() => ({ chain: { network: mock.network, rpcUrl: "https://captured.rpc" },
    walletAddress: mock.wallet, signerAddress: mock.admin, activate: mock.activate, signMessage: mock.sign, assertCurrent: mock.guard }));
  mock.mint.mockImplementation(async input => { await input.signMessage(new Uint8Array([1])); mock.minted = true; return { songId: 1n, signature: "mint" }; });
  mock.remix.mockImplementation(async input => { await input.signMessage(new Uint8Array([2])); mock.minted = true; return { remixSongId: 1n, signature: "remix" }; });
  mock.buy.mockImplementation(async input => { await input.signMessage(new Uint8Array([3])); return { signature: "buy" }; });
  mock.refetch.mockResolvedValueOnce({ data: { owned: false, available: true, remaining: 10n, price: 1_000_000n } })
    .mockResolvedValue({ data: { owned: true } });
});
afterEach(() => cleanup());

test.each([false, true])("%s remix: mint preflight checks deployment and activates before admin signing", async remix => {
  if (remix) {
    mock.songs.get("song").source = "original";
    mock.songs.set("original", { id: "original", chain_song_id: "7", network: mock.network });
  }
  const hook = renderHook(useMint);
  let result: any;
  await act(async () => { result = await hook.result.current.ensure(mock.songs.get("song")); });
  const relay = remix ? mock.remix : mock.mint;
  expect(mock.deployment).toHaveBeenCalledWith({ network: mock.network, rpcUrl: "https://captured.rpc" }, remix ? ["Factory", "Remix", "Royalties"] : ["Factory"]);
  expect(mock.deployment.mock.invocationCallOrder[0]).toBeLessThan(mock.activate.mock.invocationCallOrder[0]);
  expect(mock.activate.mock.invocationCallOrder[0]).toBeLessThan(relay.mock.invocationCallOrder[0]);
  expect(relay.mock.calls[0][0]).toMatchObject({ selectedSvmAddress: mock.wallet, evmSignerAddress: mock.admin, rpcUrl: "https://captured.rpc", signMessage: mock.sign });
  expect(result.chain_song_id).toBe("1");
  expect(localStorage.getItem("mint:song")).toBeNull();
});

test.each(["deployment", "activation"])("%s failure leaves mint unsubmitted and retryable", async failure => {
  (failure === "deployment" ? mock.deployment : mock.activate).mockRejectedValueOnce(new Error(failure));
  const hook = renderHook(useMint);
  await act(async () => { await expect(hook.result.current.ensure(mock.songs.get("song"))).rejects.toThrow(failure); });
  expect(JSON.parse(localStorage.getItem("mint:song")!).submitted).toBe(false);
  expect(mock.mint).not.toHaveBeenCalled();
  expect(mock.sign).not.toHaveBeenCalled();
  await act(async () => { await hook.result.current.ensure(mock.songs.get("song")); });
  expect(mock.mint).toHaveBeenCalledOnce();
});

test("license purchase checks deployment, activates and signs with the admin account", async () => {
  const song = { ...mock.songs.get("song"), network: mock.network, chain_song_id: "1", metadata_cid: "cid" };
  const hook = renderHook(() => useLicense(song, undefined, false));
  await act(async () => { await hook.result.current.buy(); });
  expect(mock.deployment.mock.invocationCallOrder[0]).toBeLessThan(mock.activate.mock.invocationCallOrder[0]);
  expect(mock.activate.mock.invocationCallOrder[0]).toBeLessThan(mock.buy.mock.invocationCallOrder[0]);
  expect(mock.buy.mock.calls[0][0]).toMatchObject({ selectedSvmAddress: mock.wallet, evmSignerAddress: mock.admin, signMessage: mock.sign, rpcUrl: "https://captured.rpc" });
  expect(mock.success).toHaveBeenCalledOnce();
});

test("license readiness and deployment errors stay in the purchase error handling and prevent signing", async () => {
  const song = { ...mock.songs.get("song"), network: mock.network, chain_song_id: "1", metadata_cid: "cid" };
  const hook = renderHook(() => useLicense(song, undefined, false));
  mock.capture.mockImplementationOnce(() => { throw new Error("signer unavailable"); });
  await act(async () => { await hook.result.current.buy(); });
  expect(mock.error).toHaveBeenLastCalledWith("signer unavailable");
  expect(hook.result.current.pending).toBe(false);
  mock.deployment.mockRejectedValueOnce(new Error("program missing"));
  await act(async () => { await hook.result.current.buy(); });
  expect(mock.error).toHaveBeenLastCalledWith("program missing");
  expect(mock.sign).not.toHaveBeenCalled();
  expect(mock.buy).not.toHaveBeenCalled();
});
