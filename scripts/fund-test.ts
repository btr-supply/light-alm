/**
 * Fund test EOA across BSC, Arbitrum, and Base.
 *
 * Starting state: ~$30 BNB on the PK_USDC_USDT EOA on BSC (chain 56).
 *
 * Allocation: 1/3 gas tokens, 2/3 stablecoins (split USDC/USDT 50/50).
 *
 * Phase 1 — Gas distribution (1/3 of total, equal across 3 chains):
 *   Bridge BNB → ETH on Arbitrum and Base; keep BNB on BSC.
 * Phase 2 — Stablecoin acquisition (2/3 of total):
 *   Swap/bridge remaining BNB → USDC on each chain.
 * Phase 3 — USDC→USDT rebalancing:
 *   On each chain, swap half USDC → USDT for 50/50 LP split.
 * Phase 4 — Verify gas balances meet minimum thresholds.
 *
 * Usage: bun scripts/fund-test.ts
 */

import {
  lifiQuote,
  verifyCalldata,
  getBalance,
  waitForArrival,
  type SwapBackend,
} from "../src/execution/swap";
import { getPublicClient, getAccount, sendAndWait, approveIfNeeded } from "../src/execution/tx";
import { getChain } from "../src/config/chains";
import { USDC, USDT, tokenDecimals } from "../src/config/tokens";
import { log } from "../src/utils";
import type { ChainId } from "../src/types";

log.setLevel("debug");

// ---- Constants ----

const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;

const TEST_CHAINS = [
  ["BSC", 56],
  ["Arbitrum", 42161],
  ["Base", 8453],
] as const;

const BSC = 56 as ChainId;
const ARB = 42161 as ChainId;
const BASE = 8453 as ChainId;

// Swap backend: "lifi" (direct, 0.25% fee) or "jumper" (two-step, 0% fee but stricter rate limits).
const BACKEND: SwapBackend = "lifi";

// Minimum native gas per chain (~$1 at approximate prices, Feb 2026).
// BNB ~$600 → $1 ≈ 0.0017 BNB; ETH ~$2800 → $1 ≈ 0.00036 ETH.
const MIN_GAS_WEI: Record<number, bigint> = {
  [BSC]: 17n * 10n ** 14n, // 0.0017 BNB
  [ARB]: 36n * 10n ** 13n, // 0.00036 ETH
  [BASE]: 36n * 10n ** 13n, // 0.00036 ETH
};

// ---- Helpers ----

async function getNativeBalance(chainId: ChainId, address: `0x${string}`): Promise<bigint> {
  const pub = getPublicClient(chainId);
  return pub.getBalance({ address });
}

function fmtNative(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(6);
}

function fmtToken(amount: bigint, decimals: number): string {
  return (Number(amount) / 10 ** decimals).toFixed(2);
}

/**
 * Check native gas balances on all test chains.
 * Returns true if all are above MIN_GAS_WEI, logs warnings for any that aren't.
 */
async function verifyGasBalances(address: `0x${string}`): Promise<boolean> {
  let ok = true;
  for (const [label, chainId] of TEST_CHAINS) {
    const bal = await getNativeBalance(chainId, address);
    const sym = getChain(chainId).nativeSymbol;
    const min = MIN_GAS_WEI[chainId];
    if (bal < min) {
      log.warn(`${label}: gas LOW — ${fmtNative(bal)} ${sym} < minimum ${fmtNative(min)} ${sym}`);
      ok = false;
    } else {
      log.info(`${label}: gas OK — ${fmtNative(bal)} ${sym}`);
    }
  }
  return ok;
}

/** Quote + verify + send for native-token swaps (no approval needed). */
async function swapNative(p: {
  fromChain: ChainId;
  toChain: ChainId;
  toToken: string;
  amount: bigint;
  pk: `0x${string}`;
}): Promise<bigint> {
  const account = getAccount(p.pk);
  const addr = account.address;

  const quote = await lifiQuote(
    {
      fromChain: p.fromChain,
      toChain: p.toChain,
      fromToken: NATIVE,
      toToken: p.toToken,
      fromAmount: p.amount.toString(),
      fromAddress: addr,
      toAddress: addr,
    },
    BACKEND,
  );
  if (!quote) throw new Error(`No quote: native ${p.fromChain}→${p.toChain}`);

  log.info(`Quote: ${quote.type} toAmount=${quote.estimate.toAmount}`);

  const isCross = p.fromChain !== p.toChain;
  const verified = await verifyCalldata(
    p.fromChain,
    quote.transactionRequest.data as `0x${string}`,
    addr,
    isCross ? p.toChain : undefined,
  );
  if (!verified && isCross) throw new Error("Calldata verification failed (cross-chain)");
  if (!verified)
    log.warn("Calldata verification failed for same-chain swap — proceeding (lower risk)");

  // Snapshot destination balance before send
  let balBefore = 0n;
  if (isCross) {
    const isNativeDst = p.toToken.toLowerCase() === NATIVE.toLowerCase();
    balBefore = isNativeDst
      ? await getNativeBalance(p.toChain, addr)
      : await getBalance(p.toChain, p.toToken as `0x${string}`, addr);
  }

  const result = await sendAndWait(p.fromChain, p.pk, {
    to: quote.transactionRequest.to as `0x${string}`,
    data: quote.transactionRequest.data as `0x${string}`,
    value: quote.transactionRequest.value ? BigInt(quote.transactionRequest.value) : p.amount,
  });
  if (result.status === "reverted") throw new Error(`Swap reverted: ${result.hash}`);

  if (isCross) {
    const isNativeDst = p.toToken.toLowerCase() === NATIVE.toLowerCase();
    if (isNativeDst) {
      const interval = getChain(p.toChain).blockTimeMs * 4;
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, interval));
        const bal = await getNativeBalance(p.toChain, addr);
        if (bal > balBefore) return bal - balBefore;
      }
      throw new Error(`Native arrival timeout on chain ${p.toChain}`);
    }
    const newBal = await waitForArrival(p.toChain, p.toToken as `0x${string}`, addr, balBefore);
    return newBal - balBefore;
  }

  return BigInt(quote.estimate.toAmountMin);
}

/** Swap ERC20 via approval + lifi quote + verify + send. */
async function swapErc20(p: {
  fromChain: ChainId;
  toChain: ChainId;
  fromToken: `0x${string}`;
  toToken: `0x${string}`;
  amount: bigint;
  pk: `0x${string}`;
}): Promise<bigint> {
  const account = getAccount(p.pk);
  const addr = account.address;

  const quote = await lifiQuote(
    {
      fromChain: p.fromChain,
      toChain: p.toChain,
      fromToken: p.fromToken,
      toToken: p.toToken,
      fromAmount: p.amount.toString(),
      fromAddress: addr,
      toAddress: addr,
    },
    BACKEND,
  );
  if (!quote) throw new Error(`No quote: ERC20 ${p.fromChain}→${p.toChain}`);

  log.info(`Quote: ${quote.type} toAmount=${quote.estimate.toAmount}`);

  const spender = (quote.estimate.approvalAddress ||
    "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE") as `0x${string}`;
  await approveIfNeeded(p.fromChain, p.fromToken, spender, p.amount, p.pk);

  const isCross = p.fromChain !== p.toChain;
  const verified = await verifyCalldata(
    p.fromChain,
    quote.transactionRequest.data as `0x${string}`,
    addr,
    isCross ? p.toChain : undefined,
  );
  if (!verified && isCross) throw new Error("Calldata verification failed (cross-chain)");
  if (!verified)
    log.warn("Calldata verification failed for same-chain swap — proceeding (lower risk)");

  let balBefore = 0n;
  if (isCross) {
    balBefore = await getBalance(p.toChain, p.toToken, addr);
  }

  const result = await sendAndWait(p.fromChain, p.pk, {
    to: quote.transactionRequest.to as `0x${string}`,
    data: quote.transactionRequest.data as `0x${string}`,
    value: quote.transactionRequest.value ? BigInt(quote.transactionRequest.value) : undefined,
  });
  if (result.status === "reverted") throw new Error(`Swap reverted: ${result.hash}`);

  if (isCross) {
    const newBal = await waitForArrival(p.toChain, p.toToken, addr, balBefore);
    return newBal - balBefore;
  }

  return BigInt(quote.estimate.toAmountMin);
}

// ---- Main ----

async function main() {
  const pk = process.env.PK_USDC_USDT as `0x${string}` | undefined;
  if (!pk) throw new Error("PK_USDC_USDT not set");

  const account = getAccount(pk);
  const addr = account.address;
  log.info(`Account: ${addr}`);

  // ================================================================
  // Step 1: Read BNB balance and compute allocation
  // ================================================================
  const bnbBalance = await getNativeBalance(BSC, addr);
  log.info(`BNB balance: ${fmtNative(bnbBalance)} BNB`);

  // 1/3 for gas across 3 chains → 1/9 of total per chain
  const gasPerChain = bnbBalance / 9n;
  // We need gasPerChain for Arb + gasPerChain for Base + gasPerChain kept on BSC
  // plus enough leftover for the swap txs themselves. Minimum sanity check:
  const minRequired = gasPerChain * 3n + gasPerChain; // at least some stables budget
  if (bnbBalance < minRequired) {
    throw new Error(
      `Insufficient BNB: have ${fmtNative(bnbBalance)}, need at least ${fmtNative(minRequired)}`,
    );
  }

  log.info(`Allocation: ${fmtNative(gasPerChain)} BNB gas per chain (~1/9 of total)`);

  // ================================================================
  // Step 2: Bridge gas to Arbitrum and Base (sequential — nonce safety)
  // ================================================================
  log.info("--- Phase 1: Gas Distribution ---");

  log.info(`Bridging ${fmtNative(gasPerChain)} BNB → ETH on Arbitrum...`);
  const arbGas = await swapNative({
    fromChain: BSC,
    toChain: ARB,
    toToken: NATIVE,
    amount: gasPerChain,
    pk,
  });
  log.info(`Received ${fmtNative(arbGas)} ETH on Arbitrum`);

  log.info(`Bridging ${fmtNative(gasPerChain)} BNB → ETH on Base...`);
  const baseGas = await swapNative({
    fromChain: BSC,
    toChain: BASE,
    toToken: NATIVE,
    amount: gasPerChain,
    pk,
  });
  log.info(`Received ${fmtNative(baseGas)} ETH on Base`);

  // ================================================================
  // Step 3: Swap remaining BNB → USDC across 3 chains
  // BSC keeps gasPerChain as native gas; the rest becomes stables.
  // ================================================================
  log.info("--- Phase 2: Stablecoin Acquisition ---");

  const bnbAfterGas = await getNativeBalance(BSC, addr);
  // Reserve gasPerChain for BSC gas; everything else → stables
  const stablesPool = bnbAfterGas - gasPerChain;
  const stableThird = stablesPool / 3n;

  log.info(
    `BNB remaining: ${fmtNative(bnbAfterGas)}, reserving ${fmtNative(gasPerChain)} for BSC gas`,
  );
  log.info(`Stables pool: ${fmtNative(stablesPool)}, ${fmtNative(stableThird)} per chain`);

  // BSC: swap BNB → USDC (same-chain)
  log.info(`Swapping ${fmtNative(stableThird)} BNB → USDC on BSC...`);
  const bscUsdc = await swapNative({
    fromChain: BSC,
    toChain: BSC,
    toToken: USDC.addresses[BSC],
    amount: stableThird,
    pk,
  });
  log.info(`Received ${fmtToken(bscUsdc, tokenDecimals(USDC, BSC))} USDC on BSC`);

  // Arbitrum: bridge BNB → USDC
  log.info(`Bridging ${fmtNative(stableThird)} BNB → USDC on Arbitrum...`);
  const arbUsdc = await swapNative({
    fromChain: BSC,
    toChain: ARB,
    toToken: USDC.addresses[ARB],
    amount: stableThird,
    pk,
  });
  log.info(`Received ${fmtToken(arbUsdc, tokenDecimals(USDC, ARB))} USDC on Arbitrum`);

  // Base: bridge remaining BNB → USDC (sweep to avoid dust)
  const bnbForBase = (await getNativeBalance(BSC, addr)) - gasPerChain;
  log.info(`Bridging ${fmtNative(bnbForBase)} BNB → USDC on Base...`);
  const baseUsdc = await swapNative({
    fromChain: BSC,
    toChain: BASE,
    toToken: USDC.addresses[BASE],
    amount: bnbForBase,
    pk,
  });
  log.info(`Received ${fmtToken(baseUsdc, tokenDecimals(USDC, BASE))} USDC on Base`);

  // ================================================================
  // Step 4: On each chain, swap half USDC → USDT
  // ================================================================
  log.info("--- Phase 3: USDC→USDT Rebalancing ---");

  for (const [label, chainId] of TEST_CHAINS) {
    const usdcAddr = USDC.addresses[chainId] as `0x${string}`;
    const usdtAddr = USDT.addresses[chainId] as `0x${string}`;
    const usdcBal = await getBalance(chainId, usdcAddr, addr);
    const half = usdcBal / 2n;

    log.info(`${label}: swapping ${fmtToken(half, tokenDecimals(USDC, chainId))} USDC → USDT...`);
    const usdtOut = await swapErc20({
      fromChain: chainId,
      toChain: chainId,
      fromToken: usdcAddr,
      toToken: usdtAddr,
      amount: half,
      pk,
    });
    log.info(`${label}: received ${fmtToken(usdtOut, tokenDecimals(USDT, chainId))} USDT`);
  }

  // ================================================================
  // Step 5: Verify gas balances and print final summary
  // ================================================================
  log.info("--- Final Balances ---");

  for (const [label, chainId] of TEST_CHAINS) {
    const native = await getNativeBalance(chainId, addr);
    const usdcBal = await getBalance(chainId, USDC.addresses[chainId] as `0x${string}`, addr);
    const usdtBal = await getBalance(chainId, USDT.addresses[chainId] as `0x${string}`, addr);
    const sym = getChain(chainId).nativeSymbol;
    const usdcDec = tokenDecimals(USDC, chainId);
    const usdtDec = tokenDecimals(USDT, chainId);

    log.info(
      `${label.padEnd(10)} | ${sym}: ${fmtNative(native).padStart(12)} | USDC: ${fmtToken(usdcBal, usdcDec).padStart(10)} | USDT: ${fmtToken(usdtBal, usdtDec).padStart(10)}`,
    );
  }

  log.info("--- Gas Health Check ---");
  const gasOk = await verifyGasBalances(addr);
  if (!gasOk) {
    log.warn("Some chains have insufficient gas for upkeep transactions!");
  } else {
    log.info("All chains have sufficient gas for upkeep.");
  }
}

main().catch((e) => {
  log.error(`Fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
