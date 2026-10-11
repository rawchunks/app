import React from "react";
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FacilitatorChain, FacilitatorChainsResponse, NetworkId } from "@compose-market/sdk/chains";
import { ChainProvider, useChain, visibleRegistry, selectNetwork, readRegistry, writeRegistry, registryCacheKey, discoverRegistry } from "@/contexts/Network";
import { setChainRegistry, getChainObject, getChains, getDefaultNetwork } from "@/lib/chains";

vi.mock("@/lib/sdk", () => ({ COMPOSE_API_URL: "https://facilitator.test" }));

const networks = ["eip155:84532", "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", "eip155:42431", "eip155:8453", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"] as NetworkId[];
function chain(network: NetworkId): FacilitatorChain {
  return { network, namespace: network.startsWith("eip155:") ? "eip155" : "solana", name: network,
    isTestnet: network !== networks[3] && network !== networks[4], rpcUrl: `https://rpc.test/${network}`,
    explorer: "https://explorer.test", assetAddress: "0x1111111111111111111111111111111111111111", asset: "USDC", decimals: 6,
    schemes: ["upto"], ...(network === networks[1] ? { explorerQuery: "cluster=devnet" } : {}) };
}
const full: FacilitatorChainsResponse = { chains: [...networks.slice().reverse().map(chain), chain("eip155:5042"), chain("eip155:42161")], defaultNetwork: "eip155:5042" };
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); });

test("shows only the five requested API networks in order, preserves selection, defaults to Base", () => {
  const result = visibleRegistry(full);
  expect(result.chains.map(c => c.network)).toEqual(networks);
  expect(result.defaultNetwork).toBe("eip155:8453");
  expect(selectNetwork(result, networks[1])).toBe(networks[1]);
  expect(selectNetwork(result, "eip155:5042")).toBe("eip155:8453");
  const withoutBase = { ...full, chains: full.chains.filter(c => c.network !== "eip155:8453") };
  expect(visibleRegistry(withoutBase).defaultNetwork).toBe(networks[0]);
});

test("chain objects use the advertised RPC and explorer without presets or fabricated gas currency", () => {
  const registry = visibleRegistry(full);
  setChainRegistry(registry.chains, registry.defaultNetwork);
  for (const c of registry.chains.filter(c => c.namespace === "eip155")) {
    const object = getChainObject(Number(c.network.slice(7)))!;
    expect(object.rpc).toBe(c.rpcUrl);
    expect(object.blockExplorers?.[0].url).toBe(c.explorer);
    expect(object.nativeCurrency).toBeUndefined();
  }
  expect(getChainObject(42161)).toBeUndefined();
  expect(getChainObject(1)).toBeUndefined();
  expect(getChains().map(c => c.network)).toEqual(networks);
  expect(getDefaultNetwork()).toBe("eip155:8453");
});

test("API refresh updates RPC/explorer fields and removes networks without retaining old objects", () => {
  const initial = visibleRegistry(full);
  setChainRegistry(initial.chains, initial.defaultNetwork);
  const updated = visibleRegistry({ ...full, chains: full.chains.filter(c => c.network !== networks[0]).map(c =>
    c.network === networks[3] ? { ...c, rpcUrl: "https://updated.rpc", explorer: "https://updated.explorer" } : c) });
  setChainRegistry(updated.chains, updated.defaultNetwork);
  expect(getChainObject(84532)).toBeUndefined();
  expect(getChainObject(8453)).toMatchObject({ rpc: "https://updated.rpc", blockExplorers: [{ url: "https://updated.explorer" }] });
  expect(selectNetwork(updated, networks[0])).toBe(networks[3]);
  setChainRegistry(initial.chains, initial.defaultNetwork);
  expect(getChainObject(84532)?.rpc).toBe(initial.chains[0].rpcUrl);
});

test("ignores legacy/environment registry and scopes only API-derived caches by API URL", () => {
  localStorage.setItem("chain_registry", JSON.stringify(full));
  expect(readRegistry(localStorage, "https://facilitator.test")).toBeNull();
  writeRegistry(localStorage, "https://facilitator.test/", full);
  expect(readRegistry(localStorage, "https://facilitator.test")).toMatchObject(full);
  expect(readRegistry(localStorage, "https://other.test")).toBeNull();
  localStorage.setItem(registryCacheKey("https://facilitator.test"), '{"version":1}');
  expect(readRegistry(localStorage, "https://facilitator.test")).toBeNull();
});

test("fetches the configured facilitator URL and passes cancellation", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(full)));
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  await discoverRegistry("https://custom.test", controller.signal);
  expect(fetch.mock.calls[0][0]).toBe("https://custom.test/api/x402/facilitator/chains");
  expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
});

function Probe() {
  const context = useChain();
  return <><span data-testid="selection">{context.selectedNetwork}</span>
    <span data-testid="networks">{context.chains.map(c => c.network).join(",")}</span>
    <button onClick={() => context.setSelectedNetwork(networks[1])}>Select Devnet</button></>;
}

test("gates consumers until discovery, retries a failure, and mounts with all five definitions", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(new Response(JSON.stringify(full)));
  vi.stubGlobal("fetch", fetch);
  render(<ChainProvider><Probe /></ChainProvider>);
  expect(screen.queryByTestId("selection")).toBeNull();
  await screen.findByText("Retry");
  fireEvent.click(screen.getByText("Retry"));
  await screen.findByTestId("selection");
  expect(screen.getByTestId("selection").textContent).toBe("eip155:8453");
  expect(screen.getByTestId("networks").textContent).toBe(networks.join(","));
  fireEvent.click(screen.getByText("Select Devnet"));
  expect(screen.getByTestId("selection").textContent).toBe(networks[1]);
  await waitFor(() => expect(localStorage.getItem("selected_network")).toBe(networks[1]));
});

test("hydrates usable API cache when revalidation fails and removes stale hidden selections", async () => {
  writeRegistry(localStorage, "https://facilitator.test", full);
  localStorage.setItem("selected_network", "eip155:42161");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  render(<ChainProvider><Probe /></ChainProvider>);
  expect(screen.getByTestId("selection").textContent).toBe("eip155:8453");
  await act(async () => {});
  expect(screen.getByTestId("networks").textContent).toBe(networks.join(","));
});

test("cancels discovery at eight seconds and exposes retry", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("timeout")));
  })));
  render(<ChainProvider><Probe /></ChainProvider>);
  await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
  expect(screen.getByText("Retry")).toBeDefined();
  expect(screen.queryByTestId("selection")).toBeNull();
});
