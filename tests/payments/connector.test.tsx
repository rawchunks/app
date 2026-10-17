import { cleanup, render, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { custom, decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi, keccak256, recoverMessageAddress } from "viem";
import { entryPoint06Abi, getUserOperationHash } from "viem/account-abstraction";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Transaction } from "viem/tempo";

const mock = vi.hoisted(() => ({ selected: "eip155:8453", button: vi.fn(), autoConnect: vi.fn(), chains: [] as any[],
  rpc: { getChainId: vi.fn(), getCode: vi.fn(), readContract: vi.fn(), waitForTransactionReceipt: vi.fn(), sendRawTransaction: vi.fn() },
  transport: vi.fn(), read: vi.fn(), allowance: vi.fn(), send: vi.fn() }));
vi.mock("viem", async original => {
  const actual = await original<typeof import("viem")>();
  return { ...actual, createPublicClient: () => mock.rpc,
    http: (url: string) => custom({ request: request => mock.transport({ ...request, url }) }, { retryCount: 0 }) };
});
vi.mock("thirdweb", async original => ({ ...await original<typeof import("thirdweb")>(), readContract: mock.read, sendAndConfirmTransaction: mock.send }));
vi.mock("thirdweb/extensions/erc20", async original => ({ ...await original<typeof import("thirdweb/extensions/erc20")>(), allowance: mock.allowance }));
vi.mock("thirdweb/react", () => ({ ConnectButton: (props: any) => { mock.button(props); return null; }, useActiveAccount: () => null,
  useActiveWallet: () => null, useActiveWalletConnectionStatus: () => "disconnected", useConnectModal: () => ({ connect: mock.button, isConnecting: false }), useAutoConnect: mock.autoConnect }));
vi.mock("thirdweb/wallets", () => ({ inAppWallet: () => ({}), createWallet: () => ({}) }));
vi.mock("@/contexts/Network", () => ({ NetworkGlyph: () => null, useChain: () => ({ chains: mock.chains, defaultNetwork: "eip155:8453",
  paymentNetwork: mock.selected, getChainByNetworkId: (id: string) => mock.chains.find(chain => chain.network === id) }) }));
vi.mock("@/hooks/use-multichain", () => ({ useTotalBalance: () => ({ formatted: "0", isLoading: false }) }));
vi.mock("@/hooks/use-address", () => ({ useSelectedUserAddress: () => ({}) }));
vi.mock("@/hooks/use-profile", () => ({ useProfile: () => ({}) }));
vi.mock("@/hooks/use-disclaimer", () => ({ useDisclaimerConsent: () => ({ hasConsented: true, isLoading: false }) }));
vi.mock("@/components/disclaimer", () => ({ DisclaimerModal: () => null }));
vi.mock("@/components/profile-modal", () => ({ ProfileModal: () => null }));
vi.mock("@/hooks/use-session", () => ({ useSession: () => ({ credits: { availableAtomics: "0", packs: [] }, creditsEnabled: false, creditsLoading: false, creditsError: null }) }));
vi.mock("@/lib/connector", () => ({ thirdwebCustomTheme: {} }));

import { WalletConnector, approveTempoSession, prepareTempoTransaction } from "@/components/connector";
import { getChainObject, setChainRegistry } from "@/lib/chains";

const adminAddress = "0x1111111111111111111111111111111111111111";
const smartAddress = "0x2222222222222222222222222222222222222222";
const ousd = "0x20c0000000000000000000006a37DA5C996874BE";
const spender = "0x3333333333333333333333333333333333333333";
function approvalInput() {
  const admin = { address: adminAddress, signTransaction: vi.fn(), signMessage: vi.fn().mockResolvedValue(`0x${"11".repeat(64)}1b`) };
  return { chain: { id: 42431, rpc: "https://rpc.test" }, admin: admin as any,
    adminWallet: { getAccount: () => admin } as any, accountAddress: smartAddress, asset: ousd, spender,
    amount: 1_000_000n, assertCurrent: vi.fn() };
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.button.mockResolvedValue(undefined);
  mock.rpc.getChainId.mockResolvedValue(42431); mock.rpc.getCode.mockReset().mockResolvedValue("0x01");
  mock.rpc.readContract.mockReset().mockResolvedValue(0n);
  mock.transport.mockReset();
  mock.read.mockImplementation(async input => input.method.includes("getAddress") ? smartAddress : true);
  mock.allowance.mockReset().mockResolvedValueOnce(0n).mockResolvedValue(1_000_000n);
  mock.send.mockResolvedValue({ status: "success" });
  mock.rpc.sendRawTransaction.mockResolvedValue(`0x${"ab".repeat(32)}`);
});

afterEach(cleanup);
test("payment selection including Tempo does not change the connector login chain; API refresh updates its fields", () => {
  mock.chains = [8453, 84532, 42431].map(id => ({ network: `eip155:${id}`, namespace: "eip155", name: `Chain ${id}`,
    rpcUrl: `https://rpc.test/${id}`, explorer: `https://explorer.test/${id}`, assetAddress: "0x1111111111111111111111111111111111111111", asset: "USDC", decimals: 6, schemes: ["upto"] }));
  mock.selected = "eip155:8453";
  setChainRegistry(mock.chains, "eip155:8453");
  const result = render(<WalletConnector />);
  fireEvent.click(screen.getByRole("button", { name: "CONNECT" }));
  const initial = mock.button.mock.calls.at(-1)![0];
  expect(initial.chain.id).toBe(8453);
  expect(initial.chain.rpc).toBe("https://rpc.test/8453");
  mock.selected = "eip155:42431";
  result.rerender(<WalletConnector />);
  fireEvent.click(screen.getByRole("button", { name: "CONNECT" }));
  expect(mock.button.mock.calls.at(-1)![0].chain).toBe(initial.chain);
  expect(mock.autoConnect.mock.calls.at(-1)![0].accountAbstraction.chain).toBe(initial.chain);
  expect(getChainObject(42431)).toMatchObject({ id: 42431, rpc: "https://rpc.test/42431", blockExplorers: [{ url: "https://explorer.test/42431" }] });
  mock.chains = mock.chains.map(c => c.network === "eip155:8453" ? { ...c, rpcUrl: "https://new.rpc" } : c);
  setChainRegistry(mock.chains, "eip155:8453");
  result.rerender(<WalletConnector />);
  fireEvent.click(screen.getByRole("button", { name: "CONNECT" }));
  expect(mock.button.mock.calls.at(-1)![0].chain).toMatchObject({ id: 8453, rpc: "https://new.rpc" });
});

test("Tempo approval keeps the smart account as token owner and signs an EntryPoint operation", async () => {
  const input = approvalInput();
  await approveTempoSession(input);
  const { encode } = await import("thirdweb");
  const transaction = mock.send.mock.calls[0][0].transaction;
  const decoded = decodeFunctionData({ abi: entryPoint06Abi, data: await encode(transaction) });
  expect(decoded.functionName).toBe("handleOps");
  const op = (decoded.args as any)[0][0];
  expect(op.sender.toLowerCase()).toBe(smartAddress);
  expect(op.initCode).toBe("0x");
  expect(op.maxFeePerGas).toBe(0n);
  const inner = encodeFunctionData({ abi: parseAbi(["function approve(address,uint256) returns(bool)"]), functionName: "approve", args: [spender, 1_000_000n] });
  expect(op.callData).toBe(encodeFunctionData({ abi: parseAbi(["function execute(address,uint256,bytes)"]), functionName: "execute", args: [ousd, 0n, inner] }));
  expect(mock.allowance).toHaveBeenCalledWith(expect.objectContaining({ owner: smartAddress, spender }));
  expect(input.admin.signTransaction).not.toHaveBeenCalled();
});

test("an existing Tempo account with sufficient allowance needs no operation", async () => {
  mock.allowance.mockReset().mockResolvedValue(1_000_000n);
  const input = approvalInput();
  await approveTempoSession(input);
  expect(input.admin.signMessage).not.toHaveBeenCalled();
  expect(mock.send).not.toHaveBeenCalled();
});

test("Tempo rejects missing infrastructure, a different derived address, and a non-admin before signing", async () => {
  mock.rpc.getCode.mockResolvedValueOnce("0x");
  await expect(approveTempoSession(approvalInput())).rejects.toThrow("not deployed");
  mock.rpc.getCode.mockResolvedValueOnce("0x01").mockResolvedValueOnce("0x");
  await expect(approveTempoSession(approvalInput())).rejects.toThrow("EntryPoint");
  mock.read.mockResolvedValueOnce(spender);
  await expect(approveTempoSession(approvalInput())).rejects.toThrow("universal EVM address");
  mock.read.mockResolvedValueOnce(smartAddress).mockResolvedValueOnce(false);
  await expect(approveTempoSession(approvalInput())).rejects.toThrow("not an admin");
  expect(mock.send).not.toHaveBeenCalled();
});

test("Tempo stops on scope changes, reverts, and an allowance that was not applied", async () => {
  const input = approvalInput();
  input.assertCurrent.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error("selection changed"); });
  await expect(approveTempoSession(input)).rejects.toThrow("selection changed");
  expect(mock.send).not.toHaveBeenCalled();
  mock.send.mockResolvedValueOnce({ status: "reverted" });
  await expect(approveTempoSession(approvalInput())).rejects.toThrow("reverted");
  mock.allowance.mockReset().mockResolvedValue(0n);
  await expect(approveTempoSession(approvalInput())).rejects.toThrow("not applied");
});

test("Tempo stops if selection or admin changes while the operation is signed", async () => {
  const input = approvalInput();
  let current = true;
  input.assertCurrent.mockImplementation(() => { if (!current) throw new Error("selection changed"); });
  input.admin.signMessage.mockImplementationOnce(async () => { current = false; return "0x"; });
  await expect(approveTempoSession(input)).rejects.toThrow("selection changed");
  expect(mock.send).not.toHaveBeenCalled();
  mock.allowance.mockReset().mockResolvedValue(0n);
  const changed = approvalInput();
  changed.admin.signMessage.mockImplementationOnce(async () => { changed.adminWallet.getAccount = () => ({ address: spender }); return "0x"; });
  await expect(approveTempoSession(changed)).rejects.toThrow("admin signer changed");
  expect(mock.send).not.toHaveBeenCalled();
});

test.each([
  ["mintSong", "function mintSong(uint256,uint256,uint256,bool,string) returns (uint256)", [10n, 1_000_000n, 100_000n, true, "ipfs://song"]],
  ["remixSong", "function remixSong(uint256,(uint256 licenseAmount,uint256 licensePrice,uint256 streamPrice),string) returns (uint256)", [7n, { licenseAmount: 0n, licensePrice: 0n, streamPrice: 100_000n }, "ipfs://remix"]],
  ["buyLicense", "function buyLicense(uint256)", [7n]],
  ["approve", "function approve(address,uint256) returns (bool)", [spender, 1_000_000n]],
])("Tempo %s preserves contract calldata in an admin-signed smart-account operation", async (_name, method, params) => {
  const { getContract, prepareContractCall, encode } = await import("thirdweb");
  const signer = privateKeyToAccount(generatePrivateKey());
  const input = approvalInput();
  input.admin.address = signer.address;
  input.admin.signMessage = vi.fn(options => {
    expect(options.message.raw).toBeInstanceOf(Uint8Array);
    return signer.signMessage(options);
  });
  const original = prepareContractCall({ contract: getContract({ client: (await import("@/lib/chains")).thirdwebClient,
    chain: input.chain, address: spender }), method, params } as any);
  const prepared = await prepareTempoTransaction(input, original);
  const decoded = decodeFunctionData({ abi: entryPoint06Abi, data: await encode(prepared.transaction) });
  const op = (decoded.args as any)[0][0];
  const expected = encodeFunctionData({ abi: parseAbi(["function execute(address,uint256,bytes)"]), functionName: "execute",
    args: [spender, 0n, await encode(original)] });
  expect(op.callData).toBe(expected);
  expect(op.initCode).toBe("0x");
  const hash = getUserOperationHash({ chainId: 42431, entryPointAddress: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
    entryPointVersion: "0.6", userOperation: op });
  expect(await recoverMessageAddress({ message: { raw: hash }, signature: op.signature })).toBe(signer.address);
  expect(input.admin.signTransaction).not.toHaveBeenCalled();
});

test.each(["new", "existing", "operation failure", "missing event", "wrong event address", "sponsor failure", "selection during sponsor", "another RPC chain"])(
  "an unfunded login uses a sponsored smart-account operation: %s", async scenario => {
  const signer = privateKeyToAccount(generatePrivateKey());
  const sponsor = privateKeyToAccount(generatePrivateKey());
  const input = approvalInput();
  input.admin.address = signer.address;
  input.admin.signMessage = vi.fn(options => signer.signMessage(options));
  input.admin.signTransaction = vi.fn(() => { throw new Error("login wallet has no gas funds"); });
  mock.rpc.getCode.mockImplementation(async ({ address }) => scenario !== "existing" && address.toLowerCase() === smartAddress ? "0x" : "0x01");
  mock.allowance.mockReset().mockResolvedValueOnce(scenario === "existing" ? 0n : 1_000_000n).mockResolvedValue(1_000_000n);
  mock.rpc.readContract.mockResolvedValue(0n);
  mock.send.mockImplementation(async ({ account, transaction }) => {
    const { encode } = await import("thirdweb");
    await account.sendTransaction({ chainId: 42431, to: transaction.to, data: await encode(transaction) });
    return { status: "success" };
  });
  let broadcast: any;
  let current = true;
  input.assertCurrent.mockImplementation(() => { if (!current) throw new Error("selection changed"); });
  mock.transport.mockImplementation(async ({ method, params, url }) => {
    if (method === "eth_fillTransaction") {
      expect(url).toBe("https://sponsor.moderato.tempo.xyz");
      if (scenario === "sponsor failure") throw new Error("sponsorship unavailable");
      if (scenario === "selection during sponsor") current = false;
      return { tx: { ...params[0], type: "0x76", chainId: scenario === "another RPC chain" ? "0x1" : "0xa5bf", nonce: "0x0",
      gas: "0xb71b00", maxFeePerGas: "0x47868c01", maxPriorityFeePerGas: "0x1", feePayerSignature: null,
      calls: [{ to: params[0].to, data: params[0].data, value: "0x0" }] } };
    }
    if (method === "eth_signRawTransaction") {
      expect(url).toBe("https://sponsor.moderato.tempo.xyz");
      const tx = Transaction.deserialize(params[0]);
      return signer.signTransaction({ ...tx, feePayer: sponsor } as any, { serializer: Transaction.serialize });
    }
    if (method === "eth_sendRawTransaction") {
      expect(url).toBe(input.chain.rpc);
      broadcast = Transaction.deserialize(params[0]);
      if (!broadcast.feePayerSignature) throw new Error("unsponsored transaction");
      return keccak256(params[0]);
    }
    throw new Error(`Unexpected RPC method: ${method}`);
  });
  mock.rpc.waitForTransactionReceipt.mockImplementation(async ({ hash }) => {
    const decoded = decodeFunctionData({ abi: entryPoint06Abi, data: broadcast.calls[0].data });
    expect(decoded.functionName).toBe("handleOps");
    const op = (decoded.args as any)[0][0];
    const userOpHash = getUserOperationHash({ chainId: 42431, entryPointAddress: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
      entryPointVersion: "0.6", userOperation: op });
    expect(await recoverMessageAddress({ message: { raw: userOpHash }, signature: op.signature })).toBe(signer.address);
    expect(op.sender.toLowerCase()).toBe(smartAddress);
    expect(op.maxFeePerGas).toBe(0n);
    expect(op.initCode.toLowerCase()).toBe(scenario === "existing" ? "0x" : "0x85e23b94e7f5e9cc1ff78bce78cfb15b81f0df00" + encodeFunctionData({
      abi: parseAbi(["function createAccount(address,bytes) returns(address)"]), functionName: "createAccount", args: [signer.address, "0x"] }).slice(2).toLowerCase());
    const executed = decodeFunctionData({ abi: parseAbi(["function execute(address,uint256,bytes)"]), data: op.callData });
    expect(executed.args?.[0].toLowerCase()).toBe(ousd.toLowerCase());
    expect(executed.args?.[2]).toBe(encodeFunctionData({ abi: parseAbi(["function approve(address,uint256) returns(bool)"]),
      functionName: "approve", args: [spender, 1_000_000n] }));
    return { transactionHash: hash, status: "success", logs: scenario === "missing event" ? [] : [{ address: scenario === "wrong event address" ? spender : "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
      topics: encodeEventTopics({ abi: entryPoint06Abi, eventName: "UserOperationEvent", args: { userOpHash, sender: op.sender, paymaster: "0x0000000000000000000000000000000000000000" } }),
      data: encodeAbiParameters(parseAbi(["function result(uint256 nonce,bool success,uint256 cost,uint256 gas)"])[0].inputs,
        [op.nonce, scenario !== "operation failure", 0n, 500_000n]) }] };
  });
  if (["operation failure", "missing event", "wrong event address"].includes(scenario)) {
    await expect(approveTempoSession(input)).rejects.toThrow("smart-account operation failed");
    return;
  }
  if (["sponsor failure", "selection during sponsor", "another RPC chain"].includes(scenario)) {
    await expect(approveTempoSession(input)).rejects.toThrow();
    expect(broadcast).toBeUndefined();
    return;
  }
  await approveTempoSession(input);
  expect(broadcast.calls[0].to.toLowerCase()).toBe("0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789");
  expect(input.admin.signTransaction).not.toHaveBeenCalled();
  expect(input.admin.signMessage).toHaveBeenCalledOnce();
});
