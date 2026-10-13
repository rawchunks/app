import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";

const mock = vi.hoisted(() => ({
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  wallet: "J62vBhiY1skwoXLmh3VG7jpgu6nrwczXh7NAfZgZn2tz",
  admin: "0x1111111111111111111111111111111111111111",
  smart: "0x2222222222222222222222222222222222222222",
  activate: vi.fn(), sign: vi.fn(), capture: vi.fn(), guard: vi.fn(), deployment: vi.fn(),
  mint: vi.fn(), remix: vi.fn(), buy: vi.fn(), refetch: vi.fn(), invalidate: vi.fn(), error: vi.fn(), success: vi.fn(),
  songs: new Map<string, any>(), minted: false, tempo: vi.fn(), send: vi.fn(), simulate: vi.fn(), contractRead: vi.fn(),
  sendTransaction: vi.fn(), receipt: vi.fn(),
}));
vi.mock("thirdweb/react", () => ({ useActiveAccount: () => ({ address: mock.smart }), useAdminWallet: () => ({ getAccount: () => ({ address: mock.admin }) }) }));
vi.mock("thirdweb", async original => ({ ...await original<typeof import("thirdweb")>(),
  readContract: mock.contractRead, simulateTransaction: mock.simulate, sendAndConfirmTransaction: mock.send,
  sendTransaction: mock.sendTransaction, waitForReceipt: mock.receipt }));
vi.mock("@/components/connector", () => ({ prepareTempoTransaction: mock.tempo }));
vi.mock("@/hooks/use-address", () => ({ useSelectedUserAddress: () => ({ userAddress: mock.wallet, svmAddress: mock.wallet,
  evmAddress: mock.smart, paymentNetwork: mock.network, captureSolanaOperation: mock.capture, assertCurrent: mock.guard }) }));
vi.mock("@/lib/chains", () => ({ isEvmNetwork: (network: string) => network.startsWith("eip155:"),
  getEvmChainObject: () => ({ id: 42431, rpc: "https://rpc.test" }), thirdwebClient: { clientId: "test" },
  getNetworkRpcUrl: () => "https://rpc.test", usdcToWei: (amount: number) => BigInt(amount * 1_000_000) }));
vi.mock("@/lib/contracts", async original => ({ ...await original<typeof import("@/lib/contracts")>(), requireEvmDeployment: vi.fn() }));
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
  mock.network = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
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

test("Tempo license approval and purchase use the admin execution path while preserving the smart-account allowance owner", async () => {
  const chain = { id: 42431, rpc: "https://rpc.test" };
  mock.network = "eip155:42431";
  mock.contractRead.mockResolvedValueOnce("0x4444444444444444444444444444444444444444").mockResolvedValueOnce(0n);
  mock.tempo.mockImplementation(async (input, transaction) => ({ account: { address: input.admin.address }, transaction }));
  mock.send.mockResolvedValue({ status: "success" });
  const song = { ...mock.songs.get("song"), creator: mock.smart, network: mock.network, chain_song_id: "1", metadata_cid: "cid" };
  const hook = renderHook(() => useLicense(song, undefined, false));
  await act(async () => { await hook.result.current.buy(); });
  expect(mock.success).toHaveBeenCalledOnce();
  expect(mock.contractRead.mock.calls[1][0].params[0]).toBe(mock.smart);
  expect(mock.tempo).toHaveBeenCalledTimes(2);
  expect(mock.tempo.mock.calls[0][0]).toMatchObject({ accountAddress: mock.smart, admin: { address: mock.admin }, chain });
  expect(mock.send.mock.calls.map(([input]) => input.account.address)).toEqual([mock.admin, mock.admin]);
});

test.each([false, true])("Tempo mint (remix: %s) sends with the admin and records the smart account as creator", async remix => {
  const { encode } = await import("thirdweb");
  mock.network = "eip155:42431";
  mock.songs.get("song").creator = mock.smart;
  if (remix) {
    mock.songs.get("song").source = "original";
    mock.songs.set("original", { id: "original", chain_song_id: "7", network: mock.network });
  }
  mock.contractRead.mockImplementation(async input => input.method === "totalSongs" ? 0n : {
    creator: mock.smart, metadataUri: "ipfs://cid", isRemix: remix, parentSongId: remix ? 7n : 0n,
  });
  mock.tempo.mockImplementation(async (input, transaction) => ({ account: { address: input.admin.address }, transaction }));
  const hash = `0x${"ab".repeat(32)}`;
  mock.sendTransaction.mockResolvedValue({ transactionHash: hash });
  mock.receipt.mockResolvedValue({ status: "success", logs: [{
    address: "0x4Ac838b970D44AB9056b4201e9ED3c1Ce271545e",
    topics: encodeEventTopics({ abi: parseAbi(["event SongMinted(uint256 indexed songId,address indexed creator,uint256 licenseAmount,uint256 licensePrice,uint256 streamPrice,bool remixable,string metadataUri)"]),
      eventName: "SongMinted", args: { songId: 1n, creator: mock.smart as `0x${string}` } }),
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bool" }, { type: "string" }],
      [remix ? 0n : 10n, remix ? 0n : 1_000_000n, 100_000n, true, "ipfs://cid"]),
  }] });
  const hook = renderHook(useMint);
  let result: any;
  await act(async () => { result = await hook.result.current.ensure(mock.songs.get("song")); });
  expect(result).toMatchObject({ chain_song_id: "1", creator: mock.smart, network: "eip155:42431", tx_hash: hash });
  expect(localStorage.getItem("mint:song")).toBeNull();
  expect(mock.tempo).toHaveBeenCalledOnce();
  const [input, transaction] = mock.tempo.mock.calls[0];
  expect(input).toMatchObject({ accountAddress: mock.smart, admin: { address: mock.admin } });
  const decoded = decodeFunctionData({ abi: parseAbi([
    "function mintSong(uint256,uint256,uint256,bool,string) returns(uint256)",
    "function remixSong(uint256,(uint256 licenseAmount,uint256 licensePrice,uint256 streamPrice),string) returns(uint256)",
  ]), data: await encode(transaction) });
  expect(decoded.functionName).toBe(remix ? "remixSong" : "mintSong");
  expect(decoded.args).toEqual(remix ? [7n, { licenseAmount: 0n, licensePrice: 0n, streamPrice: 100_000n }, "ipfs://cid"]
    : [10n, 1_000_000n, 100_000n, true, "ipfs://cid"]);
  expect(mock.simulate.mock.calls[0][0].account.address).toBe(mock.admin);
  expect(mock.sendTransaction.mock.calls[0][0].account.address).toBe(mock.admin);
  expect(mock.capture).not.toHaveBeenCalled();
});
