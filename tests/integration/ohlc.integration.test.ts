import { describe, expect, test } from "bun:test";
import { fetchCandles } from "../../src/data/ohlc";

describe("OHLC via ccxt (M1)", () => {
  test("binance: USDC/USDT M1", async () => {
    const since = Date.now() - 4 * 60 * 60 * 1000; // 4h ago
    const candles = await fetchCandles("binance", "USDC/USDT", since, 10);

    expect(candles.length).toBeGreaterThan(0);
    for (const c of candles) {
      expect(c.ts).toBeGreaterThan(0);
      expect(c.o).toBeGreaterThan(0.99);
      expect(c.o).toBeLessThan(1.01);
      expect(c.h).toBeGreaterThanOrEqual(c.l);
      expect(c.v).toBeGreaterThanOrEqual(0);
    }
    console.log(
      `  Binance USDC/USDT: ${candles.length} candles, last close=${candles[candles.length - 1].c}`,
    );
  }, 15_000);

  test("bybit: USDC/USDT M1", async () => {
    const since = Date.now() - 4 * 60 * 60 * 1000;
    const candles = await fetchCandles("bybit", "USDC/USDT", since, 10);

    expect(candles.length).toBeGreaterThan(0);
    const last = candles[candles.length - 1];
    expect(last.c).toBeGreaterThan(0.99);
    expect(last.c).toBeLessThan(1.01);
    console.log(`  Bybit USDC/USDT: ${candles.length} candles, last close=${last.c}`);
  }, 15_000);

  test("binance: ETH/USDT M1", async () => {
    const since = Date.now() - 4 * 60 * 60 * 1000;
    const candles = await fetchCandles("binance", "ETH/USDT", since, 10);

    expect(candles.length).toBeGreaterThan(0);
    const last = candles[candles.length - 1];
    expect(last.c).toBeGreaterThan(100);
    expect(last.c).toBeLessThan(100_000);
    console.log(`  Binance ETH/USDT: ${candles.length} candles, last close=${last.c}`);
  }, 15_000);

  test("binance: BTC/USDT M1", async () => {
    const since = Date.now() - 4 * 60 * 60 * 1000;
    const candles = await fetchCandles("binance", "BTC/USDT", since, 10);

    expect(candles.length).toBeGreaterThan(0);
    const last = candles[candles.length - 1];
    expect(last.c).toBeGreaterThan(1_000);
    expect(last.c).toBeLessThan(1_000_000);
    console.log(`  Binance BTC/USDT: ${candles.length} candles, last close=${last.c}`);
  }, 15_000);

  test("candles are chronologically ordered", async () => {
    const since = Date.now() - 2 * 60 * 60 * 1000; // 2h
    const candles = await fetchCandles("binance", "USDC/USDT", since, 50);

    for (let i = 1; i < candles.length; i++) {
      expect(candles[i].ts).toBeGreaterThan(candles[i - 1].ts);
    }
  }, 15_000);

  test("candles aligned to 1m intervals", async () => {
    const since = Date.now() - 1 * 60 * 60 * 1000;
    const candles = await fetchCandles("binance", "USDC/USDT", since, 10);
    const TF_MS = 60 * 1000;

    for (const c of candles) {
      expect(c.ts % TF_MS).toBe(0);
    }
  }, 15_000);
});
