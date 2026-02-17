import { describe, expect, test } from "bun:test";
import { fetchPool, fetchPoolSnapshots } from "../../src/data/gecko";
import { initPairStore } from "../../src/data/store";
import type { PoolConfig } from "../../src/types";

// Skip unless INTEGRATION=true - these hit real GeckoTerminal API
const RUN_INTEGRATION = process.env.INTEGRATION === "true";
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip;

// Real pool addresses for USDC-USDT
const POOLS: Record<
  string,
  { network: string; address: `0x${string}`; chain: number; dex: string }
> = {
  uniV3_eth: {
    network: "eth",
    address: "0x3416cF6C708Da44DB2624D63ea0AAef7113527C6",
    chain: 1,
    dex: "uni-v3",
  },
  uniV3_arb: {
    network: "arbitrum",
    address: "0xbE3aD6a5669Dc0B8b12FeBC03608860C31E2eef6",
    chain: 42161,
    dex: "uni-v3",
  },
  pcsV3_bsc: {
    network: "bsc",
    address: "0x92b7807bF19b7DDdf89b706143896d05228f3121",
    chain: 56,
    dex: "pcs-v3",
  },
};

describeIntegration("GeckoTerminal API", () => {
  test("fetchPool: ETH USDC-USDT returns enriched data", async () => {
    const { network, address } = POOLS.uniV3_eth;
    const data = await fetchPool(network, address);

    expect(data.volume24h).toBeGreaterThan(0);
    expect(data.tvl).toBeGreaterThan(0);
    expect(data.basePriceUsd).toBeGreaterThan(0);
    expect(data.quotePriceUsd).toBeGreaterThan(0);
    console.log(
      `  ETH USDC-USDT: vol24h=${data.volume24h.toLocaleString()} tvl=${data.tvl.toLocaleString()} feePct=${data.feePct} rate=${data.exchangeRate}`,
    );
  }, 15_000);

  test("fetchPool: ARB USDC-USDT returns enriched data", async () => {
    const { network, address } = POOLS.uniV3_arb;
    const data = await fetchPool(network, address);

    expect(data.volume24h).toBeGreaterThan(0);
    expect(data.tvl).toBeGreaterThan(0);
    console.log(
      `  ARB USDC-USDT: vol24h=${data.volume24h.toLocaleString()} tvl=${data.tvl.toLocaleString()} feePct=${data.feePct}`,
    );
  }, 15_000);

  test("fetchPool: BSC USDC-USDT returns enriched data", async () => {
    const { network, address } = POOLS.pcsV3_bsc;
    const data = await fetchPool(network, address);

    expect(data.volume24h).toBeGreaterThanOrEqual(0);
    expect(data.tvl).toBeGreaterThan(0);
    console.log(
      `  BSC USDC-USDT: vol24h=${data.volume24h.toLocaleString()} tvl=${data.tvl.toLocaleString()} feePct=${data.feePct}`,
    );
  }, 15_000);

  test("fetchPoolSnapshots: batch fetch returns enriched snapshots", async () => {
    const db = initPairStore("TEST-INTEGRATION", ":memory:");
    const pools: PoolConfig[] = Object.values(POOLS).map((p) => ({
      address: p.address,
      chain: p.chain,
      dex: p.dex,
    }));

    const snapshots = await fetchPoolSnapshots(db, pools);
    expect(snapshots.length).toBeGreaterThanOrEqual(1);

    for (const snap of snapshots) {
      expect(snap.volume24h).toBeGreaterThanOrEqual(0);
      expect(snap.tvl).toBeGreaterThan(0);
      expect(snap.ts).toBeGreaterThan(0);
      expect(snap.basePriceUsd).toBeGreaterThan(0);
      console.log(
        `  ${snap.chain}:${snap.pool.slice(0, 10)}: vol=${snap.volume24h.toLocaleString()} tvl=${snap.tvl.toLocaleString()} fee=${snap.feePct}`,
      );
    }
  }, 30_000);
});
