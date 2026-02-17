import { describe, expect, test } from "bun:test";
import { readFeeTier } from "../../src/data/fees";
import type { PoolConfig } from "../../src/types";

// Real pools for integration testing
const UNI_V3_ETH: PoolConfig = {
  address: "0x3416cF6C708Da44DB2624D63ea0AAef7113527C6", // USDC-USDT on Uniswap V3 Ethereum
  chain: 1,
  dex: "uni-v3",
};

const UNI_V3_ARB: PoolConfig = {
  address: "0xbE3aD6a5669Dc0B8b12FeBC03608860C31E2eef6", // USDC-USDT on Uniswap V3 Arbitrum
  chain: 42161,
  dex: "uni-v3",
};

const QUICKSWAP_POLYGON: PoolConfig = {
  address: "0x3F5228d0e7D75467366be7De2c31D0d098bA2C23", // USDC-USDT on QuickSwap V3 Polygon (Algebra)
  chain: 137,
  dex: "quickswap-v3",
};

describe("on-chain fee reads", () => {
  test("readFeeTier: UniV3 ETH (standard fee)", async () => {
    const fee = await readFeeTier(UNI_V3_ETH);
    // Typical stablecoin pool fee: 0.0001 (1bp) or 0.0005 (5bp)
    expect(fee).toBeGreaterThan(0);
    expect(fee).toBeLessThan(0.01);
    console.log(`  Uni V3 ETH USDC-USDT fee: ${(fee * 100).toFixed(4)}%`);
  }, 15_000);

  test("readFeeTier: UniV3 Arbitrum", async () => {
    const fee = await readFeeTier(UNI_V3_ARB);
    expect(fee).toBeGreaterThan(0);
    expect(fee).toBeLessThan(0.01);
    console.log(`  Uni V3 ARB USDC-USDT fee: ${(fee * 100).toFixed(4)}%`);
  }, 15_000);

  test("readFeeTier: QuickSwap Polygon (Algebra dynamic fee)", async () => {
    const fee = await readFeeTier(QUICKSWAP_POLYGON);
    // Dynamic fees can vary; just verify it's reasonable
    expect(fee).toBeGreaterThanOrEqual(0);
    expect(fee).toBeLessThan(0.05);
    console.log(`  QuickSwap Polygon USDC-USDT fee: ${(fee * 100).toFixed(4)}%`);
  }, 15_000);
});
