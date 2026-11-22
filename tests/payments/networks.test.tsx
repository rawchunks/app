// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FacilitatorChain, FacilitatorChainsResponse, NetworkId } from "@compose-market/sdk/chains";
import {
  ChainProvider,
  useChain,
  visibleRegistry,
  selectNetwork,
  readRegistry,
  writeRegistry,
  registryCacheKey,
  discoverRegistry,
} from "@/contexts/Network";
import {
  setChainRegistry,
  getChainObject,
  getChains,
  TESTNET_NETWORKS,
  MAINNET_NETWORKS,
} from "@/lib/chains";

vi.mock("@/lib/compose", () => ({ COMPOSE_API_URL: "https://facilitator.test" }));

const allKnownNetworks = [
  ...TESTNET_NETWORKS,
  ...MAINNET_NETWORKS,
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" as NetworkId,
];

function chain(network: NetworkId, isTestnet = TESTNET_NETWORKS.includes(network)): FacilitatorChain {
  return {
    network,
    namespace: network.startsWith("eip155:") ? "eip155" : "solana",
    name: network,
    isTestnet,
    rpcUrl: `https://rpc.test/${network}`,
    explorer: "https://explorer.test",
    assetAddress: "0x1111111111111111111111111111111111111111",
    asset: network === "eip155:42431" ? "OUSD" : "USDC",
    decimals: 6,
    schemes: ["exact", "upto", "batch-settlement"],
    ...(network === "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" ? { explorerQuery: "cluster=devnet" } : {}),
  };
}

const full: FacilitatorChainsResponse = {
  chains: [
    ...allKnownNetworks.slice().reverse().map(n => chain(n)),
    chain("eip155:5042", false),
    chain("eip155:42161", false),
    chain("eip155:43113", true),
  ],
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

test("shows only the active mode networks in order, preserves selection, and never requires defaultNetwork", () => {
  const testnetResult = visibleRegistry(full, "testnet");
  expect(testnetResult.chains.map(c => c.network)).toEqual([...TESTNET_NETWORKS]);
  expect(selectNetwork(testnetResult, TESTNET_NETWORKS[1])).toBe(TESTNET_NETWORKS[1]);
  expect(selectNetwork(testnetResult, "eip155:8453")).toBe(TESTNET_NETWORKS[0]);
  expect(selectNetwork(testnetResult, "eip155:5042")).toBe(TESTNET_NETWORKS[0]);

  const mainnetResult = visibleRegistry(full, "mainnet");
  expect(mainnetResult.chains.map(c => c.network)).toEqual([...MAINNET_NETWORKS]);
  expect(selectNetwork(mainnetResult, TESTNET_NETWORKS[0])).toBe(MAINNET_NETWORKS[0]);
});

test("chain objects use advertised RPC and explorer for active-mode chains only without cross-mode leaks", () => {
  const registry = visibleRegistry(full, "testnet");
  setChainRegistry(registry.chains);
  for (const c of registry.chains.filter(c => c.namespace === "eip155")) {
    const object = getChainObject(Number(c.network.slice(7)))!;
    expect(object.rpc).toBe(c.rpcUrl);
    expect(object.blockExplorers?.[0].url).toBe(c.explorer);
    expect(object.nativeCurrency).toBeUndefined();
  }
  expect(getChainObject(8453)).toBeUndefined();
  expect(getChainObject(42161)).toBeUndefined();
  expect(getChainObject(1)).toBeUndefined();
  expect(getChains().map(c => c.network)).toEqual([...TESTNET_NETWORKS]);
});

test("API refresh updates RPC/explorer fields and drops removed networks cleanly", () => {
  const initial = visibleRegistry(full, "testnet");
  setChainRegistry(initial.chains);
  const updated = visibleRegistry({
    chains: full.chains
      .filter(c => c.network !== TESTNET_NETWORKS[0])
      .map(c => c.network === TESTNET_NETWORKS[2]
        ? { ...c, rpcUrl: "https://updated.rpc", explorer: "https://updated.explorer" }
        : c),
  }, "testnet");
  setChainRegistry(updated.chains);
  expect(getChainObject(84532)).toBeUndefined();
  expect(getChainObject(42431)).toMatchObject({ rpc: "https://updated.rpc", blockExplorers: [{ url: "https://updated.explorer" }] });
  expect(selectNetwork(updated, TESTNET_NETWORKS[0])).toBe(TESTNET_NETWORKS[1]);
  setChainRegistry(initial.chains);
  expect(getChainObject(84532)?.rpc).toBe(initial.chains[0].rpcUrl);
});

test("scopes API caches by both mode and API URL and ignores legacy versions", () => {
  localStorage.setItem("chain_registry", JSON.stringify(full));
  expect(readRegistry(localStorage, "https://facilitator.test", "testnet")).toBeNull();
  const testnetVisible = visibleRegistry(full, "testnet");
  writeRegistry(localStorage, "https://facilitator.test/", testnetVisible, "testnet");
  expect(readRegistry(localStorage, "https://facilitator.test", "testnet")).toMatchObject(testnetVisible);
  expect(readRegistry(localStorage, "https://facilitator.test", "mainnet")).toBeNull();
  expect(readRegistry(localStorage, "https://other.test", "testnet")).toBeNull();
  localStorage.setItem(registryCacheKey("https://facilitator.test", "testnet"), '{"version":2}');
  expect(readRegistry(localStorage, "https://facilitator.test", "testnet")).toBeNull();
});

test("fetches the configured facilitator URL and passes cancellation", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(full)));
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  await discoverRegistry("https://custom.test", controller.signal, "testnet");
  expect(fetch.mock.calls[0][0]).toBe("https://custom.test/api/x402/facilitator/chains");
  expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
});

function Probe() {
  const context = useChain();
  return (
    <>
      <span data-testid="mounted">ready</span>
      <span data-testid="selection">{context.selectedNetwork ?? "none"}</span>
      <span data-testid="networks">{context.chains.map(c => c.network).join(",")}</span>
      <span data-testid="error">{context.error?.message ?? ""}</span>
      <button onClick={context.retry}>Retry</button>
      {context.chains.length > 1 ? (
        <button onClick={() => context.setSelectedNetwork(TESTNET_NETWORKS[1])}>Select Devnet</button>
      ) : null}
    </>
  );
}

test("renders children non-blockingly, exposes inline retry on failure, and resolves active mode networks", async () => {
  vi.stubEnv("VITE_NETWORK_MODE", "testnet");
  const fetch = vi.fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(new Response(JSON.stringify(full)));
  vi.stubGlobal("fetch", fetch);
  render(<ChainProvider><Probe /></ChainProvider>);
  expect(screen.getByTestId("mounted").textContent).toBe("ready");
  expect(screen.getByTestId("selection").textContent).toBe("none");
  await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("offline"));
  fireEvent.click(screen.getByText("Retry"));
  await waitFor(() => expect(screen.getByTestId("selection").textContent).toBe(TESTNET_NETWORKS[0]));
  expect(screen.getByTestId("networks").textContent).toBe(TESTNET_NETWORKS.join(","));
  fireEvent.click(screen.getByText("Select Devnet"));
  expect(screen.getByTestId("selection").textContent).toBe(TESTNET_NETWORKS[1]);
  await waitFor(() => expect(localStorage.getItem("selected_network")).toBe(TESTNET_NETWORKS[1]));
});

test("hydrates usable mode-scoped cache when revalidation fails and removes stale cross-mode selections", async () => {
  vi.stubEnv("VITE_NETWORK_MODE", "testnet");
  writeRegistry(localStorage, "https://facilitator.test", visibleRegistry(full, "testnet"), "testnet");
  localStorage.setItem("selected_network", "eip155:8453");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  render(<ChainProvider><Probe /></ChainProvider>);
  expect(screen.getByTestId("selection").textContent).toBe(TESTNET_NETWORKS[0]);
  await act(async () => {});
  expect(screen.getByTestId("networks").textContent).toBe(TESTNET_NETWORKS.join(","));
});

test("cancels discovery at eight seconds and exposes error for inline retry without unmounting children", async () => {
  vi.stubEnv("VITE_NETWORK_MODE", "testnet");
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("timeout")));
  })));
  render(<ChainProvider><Probe /></ChainProvider>);
  expect(screen.getByTestId("mounted").textContent).toBe("ready");
  await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
  expect(screen.getByTestId("error").textContent).toBe("timeout");
  expect(screen.getByTestId("selection").textContent).toBe("none");
});

test("ignores unsupported facilitator namespaces such as NEAR and caches only active-mode Rawchunks networks", async () => {
  vi.stubEnv("VITE_NETWORK_MODE", "testnet");
  const withNear: FacilitatorChainsResponse = {
    chains: [
      ...full.chains,
      {
        network: "near:testnet",
        namespace: "near",
        name: "NEAR Testnet",
        isTestnet: true,
        rpcUrl: "https://near-testnet.rpc.test",
        explorer: "https://testnet.nearblocks.io",
        assetAddress: "usdc.tidepool-sandbox.testnet",
        asset: "USDC",
        decimals: 6,
        schemes: ["exact", "upto", "batch-settlement"],
      },
      {
        network: "near:mainnet",
        namespace: "near",
        name: "NEAR",
        isTestnet: false,
        rpcUrl: "https://near-mainnet.rpc.test",
        explorer: "https://nearblocks.io",
        assetAddress: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
        asset: "USDC",
        decimals: 6,
        schemes: ["exact", "upto", "batch-settlement"],
      },
    ],
  };

  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(withNear))));
  render(<ChainProvider><Probe /></ChainProvider>);
  await waitFor(() => expect(screen.getByTestId("selection").textContent).toBe(TESTNET_NETWORKS[0]));
  expect(screen.getByTestId("networks").textContent).toBe(TESTNET_NETWORKS.join(","));

  const cached = readRegistry(localStorage, "https://facilitator.test", "testnet");
  expect(cached?.chains.map(c => c.network)).toEqual([...TESTNET_NETWORKS]);
});
