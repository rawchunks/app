import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { encodeFunctionData, parseAbi, parseTransaction, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const mock = vi.hoisted(() => ({ selected: "eip155:8453", button: vi.fn(), autoConnect: vi.fn(), chains: [] as any[],
  rpc: { getChainId: vi.fn(), getCode: vi.fn(), sendRawTransaction: vi.fn() }, read: vi.fn(), allowance: vi.fn(), send: vi.fn() }));
vi.mock("viem", async original => ({ ...await original<typeof import("viem")>(), createPublicClient: () => mock.rpc }));
vi.mock("thirdweb", async original => ({ ...await original<typeof import("thirdweb")>(), readContract: mock.read, sendAndConfirmTransaction: mock.send }));
vi.mock("thirdweb/extensions/erc20", async original => ({ ...await original<typeof import("thirdweb/extensions/erc20")>(), allowance: mock.allowance }));
vi.mock("thirdweb/react", () => ({ ConnectButton: (props: any) => { mock.button(props); return null; }, useActiveAccount: () => null,
  useActiveWallet: () => null, useActiveWalletConnectionStatus: () => "disconnected", useAutoConnect: mock.autoConnect }));
vi.mock("thirdweb/wallets", () => ({ inAppWallet: () => ({}), createWallet: () => ({}) }));
vi.mock("@/contexts/Network", () => ({ NetworkGlyph: () => null, useChain: () => ({ chains: mock.chains, defaultNetwork: "eip155:8453",
  paymentNetwork: mock.selected, getChainByNetworkId: (id: string) => mock.chains.find(chain => chain.network === id) }) }));
vi.mock("@/hooks/use-multichain", () => ({ useTotalBalance: () => ({ formatted: "0", isLoading: false }) }));
vi.mock("@/hooks/use-address", () => ({ useSelectedUserAddress: () => ({}) }));
vi.mock("@/hooks/use-profile", () => ({ useProfile: () => ({}) }));
vi.mock("@/hooks/use-disclaimer", () => ({ useDisclaimerConsent: () => ({ hasConsented: true, isLoading: false }) }));
vi.mock("@/components/disclaimer", () => ({ DisclaimerModal: () => null }));
vi.mock("@/components/profile-modal", () => ({ ProfileModal: () => null }));
vi.mock("@/lib/connector", () => ({ thirdwebCustomTheme: {} }));

import { WalletConnector, approveTempoSession, prepareTempoTransaction } from "@/components/connector";
import { getChainObject, setChainRegistry } from "@/lib/chains";

const adminAddress = "0x1111111111111111111111111111111111111111";
const smartAddress = "0x2222222222222222222222222222222222222222";
const ousd = "0x20c0000000000000000000006a37DA5C996874BE";
const spender = "0x3333333333333333333333333333333333333333";
function approvalInput() {
  const admin = { address: adminAddress, signTransaction: vi.fn() };
  return { chain: { id: 42431, rpc: "https://rpc.test" }, admin: admin as any,
    adminWallet: { getAccount: () => admin } as any, accountAddress: smartAddress, asset: ousd, spender,
    amount: 1_000_000n, assertCurrent: vi.fn() };
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.rpc.getChainId.mockResolvedValue(42431); mock.rpc.getCode.mockResolvedValue("0x01");
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
  const initial = mock.button.mock.calls.at(-1)![0];
  expect(initial.chain.id).toBe(8453);
  expect(initial.chain.rpc).toBe("https://rpc.test/8453");
  mock.selected = "eip155:42431";
  result.rerender(<WalletConnector />);
  expect(mock.button.mock.calls.at(-1)![0].chain).toBe(initial.chain);
  expect(mock.autoConnect.mock.calls.at(-1)![0].accountAbstraction.chain).toBe(initial.chain);
  expect(getChainObject(42431)).toMatchObject({ id: 42431, rpc: "https://rpc.test/42431", blockExplorers: [{ url: "https://explorer.test/42431" }] });
  mock.chains = mock.chains.map(c => c.network === "eip155:8453" ? { ...c, rpcUrl: "https://new.rpc" } : c);
  setChainRegistry(mock.chains, "eip155:8453");
  result.rerender(<WalletConnector />);
  expect(mock.button.mock.calls.at(-1)![0].chain).toMatchObject({ id: 8453, rpc: "https://new.rpc" });
});

test("Tempo approval encodes approve inside execute and sends with the admin while allowance belongs to the smart account", async () => {
  const input = approvalInput();
  await approveTempoSession(input);
  expect(mock.send).toHaveBeenCalledOnce();
  expect(mock.send.mock.calls[0][0].account.address).toBe(adminAddress);
  const transaction = mock.send.mock.calls[0][0].transaction;
  const { encode } = await import("thirdweb");
  const inner = encodeFunctionData({ abi: parseAbi(["function approve(address,uint256) returns(bool)"]), functionName: "approve", args: [spender, 1_000_000n] });
  expect(await encode(transaction)).toBe(encodeFunctionData({ abi: parseAbi(["function execute(address,uint256,bytes)"]), functionName: "execute", args: [ousd, 0n, inner] }));
  expect(transaction.to).toBe(smartAddress);
  expect(mock.allowance).toHaveBeenCalledWith(expect.objectContaining({ owner: smartAddress, spender }));
});

test("Tempo creates the matching account once and reuses an existing approval", async () => {
  mock.rpc.getCode.mockResolvedValueOnce("0x01").mockResolvedValueOnce("0x");
  mock.allowance.mockReset().mockResolvedValue(1_000_000n);
  await approveTempoSession(approvalInput());
  expect(mock.send).toHaveBeenCalledOnce();
  expect(mock.send.mock.calls[0][0].transaction.to).toBe("0x85e23b94e7F5E9cC1fF78BCe78cfb15B81f0DF00");
});

test("Tempo rejects missing factory, a different derived address, and a non-admin before signing", async () => {
  mock.rpc.getCode.mockResolvedValueOnce("0x");
  await expect(approveTempoSession(approvalInput())).rejects.toThrow("not deployed");
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

test("Tempo checks selection after transaction preparation before calling the wallet", async () => {
  const input = approvalInput();
  input.admin.sendTransaction = vi.fn().mockResolvedValue({ transactionHash: `0x${"ab".repeat(32)}` });
  let current = true;
  input.assertCurrent.mockImplementation(() => { if (!current) throw new Error("selection changed"); });
  mock.send.mockImplementationOnce(async ({ account }) => {
    current = false;
    await account.sendTransaction({ chainId: 42431, to: smartAddress, data: "0x" });
    return { status: "success" };
  });
  await expect(approveTempoSession(input)).rejects.toThrow("selection changed");
  expect(input.admin.sendTransaction).not.toHaveBeenCalled();
  expect(input.admin.signTransaction).not.toHaveBeenCalled();
});

test("Tempo checks selection after embedded signing before broadcasting to the API RPC", async () => {
  const input = approvalInput();
  input.admin.sendTransaction = vi.fn().mockResolvedValue({ transactionHash: `0x${"ab".repeat(32)}` });
  let current = true;
  input.assertCurrent.mockImplementation(() => { if (!current) throw new Error("selection changed"); });
  input.admin.signTransaction.mockImplementationOnce(async () => { current = false; return "0x02ab"; });
  mock.send.mockImplementationOnce(async ({ account }) => {
    await account.sendTransaction({ chainId: 42431, to: smartAddress, data: "0x" });
    return { status: "success" };
  });
  await expect(approveTempoSession(input)).rejects.toThrow("selection changed");
  expect(mock.rpc.sendRawTransaction).not.toHaveBeenCalled();
  expect(input.admin.sendTransaction).not.toHaveBeenCalled();
});

test("Tempo signs the real approval with the admin and submits the signed bytes to the configured RPC", async () => {
  const signer = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const input = approvalInput();
  input.admin.address = signer.address;
  input.admin.signTransaction = vi.fn(tx => signer.signTransaction(tx));
  input.admin.sendTransaction = vi.fn();
  mock.send.mockImplementationOnce(async ({ account, transaction }) => {
    const { encode } = await import("thirdweb");
    await account.sendTransaction({ chainId: transaction.chain.id, to: transaction.to, data: await encode(transaction),
      nonce: 0, gas: 500_000n, maxFeePerGas: 1_200_000_001n, maxPriorityFeePerGas: 1n });
    return { status: "success" };
  });
  mock.rpc.sendRawTransaction.mockImplementationOnce(async ({ serializedTransaction }) => {
    const signed = parseTransaction(serializedTransaction);
    expect(signed.chainId).toBe(42431);
    expect(signed.to?.toLowerCase()).toBe(smartAddress);
    const inner = encodeFunctionData({ abi: parseAbi(["function approve(address,uint256) returns(bool)"]),
      functionName: "approve", args: [spender, 1_000_000n] });
    expect(signed.data).toBe(encodeFunctionData({ abi: parseAbi(["function execute(address,uint256,bytes)"]),
      functionName: "execute", args: [ousd, 0n, inner] }));
    return keccak256(serializedTransaction);
  });
  await approveTempoSession(input);
  expect(input.admin.signTransaction).toHaveBeenCalledOnce();
  expect(mock.rpc.sendRawTransaction).toHaveBeenCalledOnce();
  expect(input.admin.sendTransaction).not.toHaveBeenCalled();
});

test("Tempo switches an external wallet and checks its chain again before sending", async () => {
  const input = approvalInput();
  input.admin.signTransaction = undefined;
  input.admin.sendTransaction = vi.fn().mockResolvedValue({ transactionHash: `0x${"ab".repeat(32)}` });
  let chainId = 8453;
  input.adminWallet.switchChain = vi.fn(async chain => { chainId = chain.id; });
  input.adminWallet.getChain = () => ({ id: chainId });
  mock.send.mockImplementationOnce(async ({ account }) => {
    chainId = 8453;
    await account.sendTransaction({ chainId: 42431, to: smartAddress, data: "0x" });
    return { status: "success" };
  });
  await expect(approveTempoSession(input)).rejects.toThrow("Select Tempo Moderato");
  expect(input.adminWallet.switchChain).toHaveBeenCalledWith(input.chain);
  expect(input.admin.sendTransaction).not.toHaveBeenCalled();
});

test.each([
  ["mintSong", "function mintSong(uint256,uint256,uint256,bool,string) returns (uint256)", [10n, 1_000_000n, 100_000n, true, "ipfs://song"]],
  ["remixSong", "function remixSong(uint256,(uint256 licenseAmount,uint256 licensePrice,uint256 streamPrice),string) returns (uint256)", [7n, { licenseAmount: 0n, licensePrice: 0n, streamPrice: 100_000n }, "ipfs://remix"]],
  ["buyLicense", "function buyLicense(uint256)", [7n]],
  ["approve", "function approve(address,uint256) returns (bool)", [spender, 1_000_000n]],
])("Tempo %s preserves contract calldata and executes from the universal account with an admin-signed RPC transaction", async (_name, method, params) => {
  const { getContract, prepareContractCall, encode } = await import("thirdweb");
  const signer = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const input = approvalInput();
  input.admin.address = signer.address;
  input.admin.signTransaction = vi.fn(tx => signer.signTransaction(tx));
  const original = prepareContractCall({ contract: getContract({ client: (await import("@/lib/chains")).thirdwebClient,
    chain: input.chain, address: spender }), method, params } as any);
  const prepared = await prepareTempoTransaction(input, original);
  expect(prepared.account.address).toBe(signer.address);
  expect(prepared.transaction.to).toBe(smartAddress);
  const expected = encodeFunctionData({ abi: parseAbi(["function execute(address,uint256,bytes)"]), functionName: "execute",
    args: [spender, 0n, await encode(original)] });
  expect(await encode(prepared.transaction)).toBe(expected);
  await prepared.account.sendTransaction({ chainId: 42431, to: smartAddress, data: expected, nonce: 0,
    gas: 500_000n, maxFeePerGas: 1_200_000_001n, maxPriorityFeePerGas: 1n });
  const signed = parseTransaction(mock.rpc.sendRawTransaction.mock.calls[0][0].serializedTransaction);
  expect(signed.chainId).toBe(42431);
  expect(signed.to?.toLowerCase()).toBe(smartAddress);
  expect(signed.data).toBe(expected);
  expect(input.admin.signTransaction).toHaveBeenCalledOnce();
});

test("Tempo contract execution stops after a selection change during signing", async () => {
  const { getContract, prepareContractCall } = await import("thirdweb");
  const input = approvalInput();
  const original = prepareContractCall({ contract: getContract({ client: (await import("@/lib/chains")).thirdwebClient,
    chain: input.chain, address: spender }), method: "function buyLicense(uint256)", params: [7n] });
  const prepared = await prepareTempoTransaction(input, original);
  let current = true;
  input.assertCurrent.mockImplementation(() => { if (!current) throw new Error("selection changed"); });
  input.admin.signTransaction.mockImplementationOnce(async () => { current = false; return "0x02ab"; });
  await expect(prepared.account.sendTransaction({ chainId: 42431, to: smartAddress, data: "0x" })).rejects.toThrow("selection changed");
  expect(mock.rpc.sendRawTransaction).not.toHaveBeenCalled();
});
