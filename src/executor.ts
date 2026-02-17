import type {
  PairConfig,
  AllocationEntry,
  Range,
  DecisionType,
  TxLogEntry,
  Forces,
  Position,
  BurnResult,
  MintResult,
} from "./types";
import type { DragonflyStore } from "./data/store-dragonfly";
import { burnPosition, mintPosition } from "./execution/positions";
import { getBalance, swapTokens, waitForArrival } from "./execution/swap";
import { computeRange } from "./strategy/range";
import { getAccount } from "./execution/tx";
import { tokenDecimals } from "./config/tokens";
import {
  IMBALANCE_THRESHOLD,
  BRIDGE_THRESHOLD,
  FALLBACK_RANGE_MIN_FACTOR,
  FALLBACK_RANGE_MAX_FACTOR,
  FALLBACK_RANGE_BREADTH,
  FALLBACK_RANGE_CONFIDENCE,
  BURN_RETRY_COUNT,
  BURN_RETRY_BACKOFF_MS,
  MINT_RETRY_COUNT,
  MINT_RETRY_BACKOFF_MS,
} from "./config/params";
import { ingestToO2 } from "./infra/o2";
import { log, retry, errMsg } from "./utils";

/**
 * Rebalance token ratios after burn by swapping excess if imbalance > 5%.
 * For stablecoin pairs, both tokens are ~$1, so we compare raw decimal-adjusted balances.
 */
async function rebalanceTokenRatio(
  pair: PairConfig,
  chain: number,
  account: `0x${string}`,
  privateKey: `0x${string}`,
): Promise<void> {
  const token0Addr = pair.token0.addresses[chain];
  const token1Addr = pair.token1.addresses[chain];
  if (!token0Addr || !token1Addr) return;

  const bal0 = await getBalance(chain, token0Addr, account);
  const bal1 = await getBalance(chain, token1Addr, account);

  // Convert to USD-equivalent values (stables ~ $1 each)
  const val0 = Number(bal0) / 10 ** tokenDecimals(pair.token0, chain);
  const val1 = Number(bal1) / 10 ** tokenDecimals(pair.token1, chain);
  const totalVal = val0 + val1;
  if (totalVal === 0) return;

  // Swap half the excess from the overweight token to the underweight token
  const excessUsd = Math.abs(val0 - val1) / 2;
  if (excessUsd < IMBALANCE_THRESHOLD * totalVal) return;

  const [fromToken, toToken, fromDec] =
    val0 > val1
      ? [token0Addr, token1Addr, tokenDecimals(pair.token0, chain)]
      : [token1Addr, token0Addr, tokenDecimals(pair.token1, chain)];
  const swapAmount = BigInt(Math.floor(excessUsd * 10 ** fromDec));
  if (swapAmount === 0n) return;

  log.info(`Rebalancing ${pair.id}: swapping excess on chain ${chain}`, { pairId: pair.id, chain });
  await swapTokens({
    fromChain: chain,
    toChain: chain,
    fromToken,
    toToken,
    amount: swapAmount,
    privateKey,
  });
}

/**
 * Compute per-chain balance deltas and bridge funds from surplus to deficit chains.
 */
async function bridgeCrossChain(
  pair: PairConfig,
  allocations: AllocationEntry[],
  account: `0x${string}`,
  privateKey: `0x${string}`,
): Promise<void> {
  // Compute target per-chain allocation pct
  const chainTargets = new Map<number, number>();
  for (const alloc of allocations) {
    chainTargets.set(alloc.chain, (chainTargets.get(alloc.chain) ?? 0) + alloc.pct);
  }

  // Compute per-chain current balances in USD (stable ~ $1)
  const chains = [...new Set(chainTargets.keys())];
  if (chains.length <= 1) return;

  const chainBalances = new Map<number, number>();
  let totalBalance = 0;
  const balEntries = await Promise.all(
    chains.map(async (chain) => {
      const token0Addr = pair.token0.addresses[chain];
      const token1Addr = pair.token1.addresses[chain];
      const [bal0, bal1] = await Promise.all([
        token0Addr ? getBalance(chain, token0Addr, account) : 0n,
        token1Addr ? getBalance(chain, token1Addr, account) : 0n,
      ]);
      let val = 0;
      if (token0Addr) val += Number(bal0) / 10 ** tokenDecimals(pair.token0, chain);
      if (token1Addr) val += Number(bal1) / 10 ** tokenDecimals(pair.token1, chain);
      return [chain, val] as const;
    }),
  );
  for (const [chain, val] of balEntries) {
    chainBalances.set(chain, val);
    totalBalance += val;
  }

  if (totalBalance === 0) return;

  // Compute deltas: positive = surplus, negative = deficit
  const deltas = new Map<number, number>();
  for (const chain of chains) {
    const current = (chainBalances.get(chain) ?? 0) / totalBalance;
    const target = chainTargets.get(chain) ?? 0;
    deltas.set(chain, current - target);
  }

  // Bridge from surplus chains to deficit chains using token0 as bridge asset
  const surplusChains = chains.filter((c) => (deltas.get(c) ?? 0) > BRIDGE_THRESHOLD);
  const deficitChains = chains.filter((c) => (deltas.get(c) ?? 0) < -BRIDGE_THRESHOLD);

  for (const srcChain of surplusChains) {
    const surplus = (deltas.get(srcChain) ?? 0) * totalBalance;
    const srcToken = pair.token0.addresses[srcChain];
    if (!srcToken) continue;

    let remaining = surplus;
    for (const dstChain of deficitChains) {
      if (remaining <= 0) break;
      const deficit = Math.abs((deltas.get(dstChain) ?? 0) * totalBalance);
      const bridgeAmount = Math.min(remaining, deficit);
      const amount = BigInt(Math.floor(bridgeAmount * 10 ** tokenDecimals(pair.token0, srcChain)));
      if (amount === 0n) continue;

      const dstToken = pair.token0.addresses[dstChain];
      if (!dstToken) continue;

      log.info(
        `Bridging ${bridgeAmount.toFixed(2)} ${pair.token0.symbol} from chain ${srcChain} -> ${dstChain}`,
        { pairId: pair.id, srcChain, dstChain },
      );

      const balBefore = await getBalance(dstChain, dstToken, account);
      const result = await swapTokens({
        fromChain: srcChain,
        toChain: dstChain,
        fromToken: srcToken,
        toToken: dstToken,
        amount,
        privateKey,
      });

      if (result) {
        // Wait for arrival on destination chain
        await waitForArrival(dstChain, dstToken, account, balBefore);
        remaining -= bridgeAmount;
        // Reduce deficit for next iteration
        deltas.set(dstChain, (deltas.get(dstChain) ?? 0) + bridgeAmount / totalBalance);
      }
    }
  }
}

async function captureChainBalances(
  pair: PairConfig,
  chains: number[],
  account: `0x${string}`,
): Promise<Map<number, { bal0: bigint; bal1: bigint }>> {
  const entries = await Promise.all(
    chains.map(async (chain) => {
      const t0 = pair.token0.addresses[chain];
      const t1 = pair.token1.addresses[chain];
      const [bal0, bal1] = await Promise.all([
        t0 ? getBalance(chain, t0, account) : 0n,
        t1 ? getBalance(chain, t1, account) : 0n,
      ]);
      return [chain, { bal0, bal1 }] as const;
    }),
  );
  return new Map(entries);
}

const SCALE_PRECISION = 1_000_000_000n; // 1e9 for sub-basis-point precision

function scaleByPct(balance: bigint, pct: number): bigint {
  return (balance * BigInt(Math.round(pct * Number(SCALE_PRECISION)))) / SCALE_PRECISION;
}

const TX_DEFAULTS: {
  gasPrice: bigint;
  inputToken: string;
  inputAmount: string;
  inputUsd: number;
  outputToken: string;
  outputAmount: string;
  outputUsd: number;
  targetAllocationPct: number;
  actualAllocationPct: number;
} = {
  gasPrice: 0n,
  inputToken: "",
  inputAmount: "0",
  inputUsd: 0,
  outputToken: "",
  outputAmount: "0",
  outputUsd: 0,
  targetAllocationPct: 0,
  actualAllocationPct: 0,
};

type TxOpts = {
  pairId: string;
  decisionType: DecisionType;
  opType: TxLogEntry["opType"];
  pool: `0x${string}`;
  chain: number;
  txHash: `0x${string}`;
  status: "success" | "reverted";
  gasUsed: bigint;
} & Partial<typeof TX_DEFAULTS>;

function logTransaction(opts: TxOpts) {
  const o = { ...TX_DEFAULTS, ...opts };
  const entry = {
    ...o,
    ts: Date.now(),
    allocationErrorPct: Math.abs(o.targetAllocationPct - o.actualAllocationPct),
  };
  ingestToO2("tx_log", [entry]);
}

function logBurn(
  pairId: string,
  dt: DecisionType,
  r: BurnResult,
  pool: `0x${string}`,
  chain: number,
) {
  logTransaction({
    pairId,
    decisionType: dt,
    opType: "burn",
    pool,
    chain,
    txHash: r.hash,
    status: r.success ? "success" : "reverted",
    gasUsed: r.gasUsed,
    gasPrice: r.gasPrice,
  });
}

function logMint(pairId: string, dt: DecisionType, r: MintResult, a: AllocationEntry) {
  logTransaction({
    pairId,
    decisionType: dt,
    opType: "mint",
    pool: a.pool,
    chain: a.chain,
    txHash: r.txHash,
    status: r.position ? "success" : "reverted",
    gasUsed: r.gasUsed,
    gasPrice: r.gasPrice,
    targetAllocationPct: a.pct,
  });
}

async function mintFromAllocations(
  store: DragonflyStore,
  pair: PairConfig,
  dt: DecisionType,
  privateKey: `0x${string}`,
  items: { alloc: AllocationEntry; range: Range }[],
  chainBals: Map<number, { bal0: bigint; bal1: bigint }>,
): Promise<number> {
  let txCount = 0;
  for (const { alloc, range } of items) {
    if (!pair.pools.find((p) => p.address === alloc.pool && p.chain === alloc.chain)) continue;
    const bals = chainBals.get(alloc.chain);
    if (!bals) continue;
    const amt0 = scaleByPct(bals.bal0, alloc.pct);
    const amt1 = scaleByPct(bals.bal1, alloc.pct);
    if (amt0 === 0n && amt1 === 0n) {
      log.warn(`No balance for ${pair.id} on chain ${alloc.chain}, skipping`, {
        pairId: pair.id,
        chain: alloc.chain,
      });
      continue;
    }
    try {
      const r = await retry(
        () => mintPosition(store, pair, alloc, range, amt0, amt1, privateKey),
        MINT_RETRY_COUNT,
        MINT_RETRY_BACKOFF_MS,
      );
      logMint(pair.id, dt, r, alloc);
      txCount++;
    } catch (e: unknown) {
      log.error(`Mint failed for ${alloc.pool} on chain ${alloc.chain}: ${errMsg(e)}`, {
        pairId: pair.id,
        pool: alloc.pool,
        chain: alloc.chain,
      });
    }
  }
  return txCount;
}

/**
 * Execute a Pool Re-Allocation (PRA):
 * 1. Burn all existing positions (log each) — abort on failure
 * 2. Compute optimal range per pool
 * 3. Mint new positions per allocation (log each)
 */
export async function executePRA(
  store: DragonflyStore,
  pair: PairConfig,
  allocations: AllocationEntry[],
  decisionType: DecisionType,
  privateKey: `0x${string}`,
  forces: Forces | null = null,
  price = 1,
): Promise<number> {
  log.info(`Executing PRA for ${pair.id}: ${allocations.length} allocation(s)`, {
    pairId: pair.id,
  });
  const account = getAccount(privateKey);
  let txCount = 0;

  // 1. Burn existing positions — abort on failure
  const existing = await store.getPositions();
  for (const pos of existing) {
    let result: BurnResult | null = null;
    try {
      result = await retry(
        () => burnPosition(pos, privateKey, pair),
        BURN_RETRY_COUNT,
        BURN_RETRY_BACKOFF_MS,
      );
    } catch (e: unknown) {
      log.error(`PRA aborted: burn threw for position ${pos.id}: ${errMsg(e)}`);
      return txCount;
    }
    if (result) { logBurn(pair.id, decisionType, result, pos.pool, pos.chain); txCount++; }
    if (result?.success) {
      await store.deletePosition(pos.id);
      ingestToO2("positions", [
        { event: "burn", pairId: pair.id, positionId: pos.id, pool: pos.pool, chain: pos.chain },
      ]);
    } else {
      log.error(`PRA aborted: burn failed for position ${pos.id}`);
      return txCount;
    }
  }

  // 2. Cross-chain rebalancing: bridge funds to target chains
  await bridgeCrossChain(pair, allocations, account.address, privateKey);

  // 3. Rebalance token ratios on each target chain
  const targetChains = [...new Set(allocations.map((a) => a.chain))];
  for (const chain of targetChains) {
    await rebalanceTokenRatio(pair, chain, account.address, privateKey);
  }

  // 4. Get current range from force model
  const range = forces
    ? computeRange(price, forces)
    : {
        min: price * FALLBACK_RANGE_MIN_FACTOR,
        max: price * FALLBACK_RANGE_MAX_FACTOR,
        base: price,
        breadth: FALLBACK_RANGE_BREADTH,
        confidence: FALLBACK_RANGE_CONFIDENCE,
        trendBias: 0,
        type: "neutral" as const,
      };

  // 5. Snapshot per-chain balances upfront, then mint per allocation
  const chainBals = await captureChainBalances(pair, targetChains, account.address);
  txCount += await mintFromAllocations(
    store,
    pair,
    decisionType,
    privateKey,
    allocations.map((a) => ({ alloc: a, range })),
    chainBals,
  );
  return txCount;
}

/**
 * Execute Range-Shift (RS):
 * 1. Burn positions that diverged (log each)
 * 2. Swap to rebalance token ratios
 * 3. Mint new positions at optimal range (log each, with retry)
 */
export async function executeRS(
  store: DragonflyStore,
  pair: PairConfig,
  shifts: { pool: `0x${string}`; chain: number; oldRange: Range; newRange: Range }[],
  decisionType: DecisionType,
  privateKey: `0x${string}`,
): Promise<number> {
  log.info(`Executing RS for ${pair.id}: ${shifts.length} shift(s)`, { pairId: pair.id });
  const account = getAccount(privateKey);
  const existing = await store.getPositions();
  let txCount = 0;

  // M4: Compute proportional allocation based on entryValueUsd
  const matchedPositions = shifts
    .map((s) => ({
      shift: s,
      position: existing.find((p) => p.pool === s.pool && p.chain === s.chain),
    }))
    .filter((m): m is { shift: (typeof shifts)[number]; position: Position } => !!m.position);

  // Burn all positions first, then mint all — avoids balance depletion between sequential burn+mint
  const burned: typeof matchedPositions = [];
  for (const m of matchedPositions) {
    let burnResult: BurnResult | null = null;
    try {
      burnResult = await retry(
        () => burnPosition(m.position, privateKey, pair),
        BURN_RETRY_COUNT,
        BURN_RETRY_BACKOFF_MS,
      );
    } catch (e: unknown) {
      log.error(`RS burn threw for position ${m.position.id}: ${errMsg(e)}`, {
        pairId: pair.id,
        pool: m.shift.pool,
        chain: m.shift.chain,
      });
      continue;
    }
    if (burnResult) { logBurn(pair.id, decisionType, burnResult, m.shift.pool, m.shift.chain); txCount++; }
    if (burnResult?.success) {
      await store.deletePosition(m.position.id);
      ingestToO2("positions", [
        {
          event: "burn",
          pairId: pair.id,
          positionId: m.position.id,
          pool: m.position.pool,
          chain: m.position.chain,
        },
      ]);
      burned.push(m);
    }
  }

  // Recompute totalValue from only successfully burned positions (not all matched)
  const totalValue = burned.reduce((sum, m) => sum + m.position.entryValueUsd, 0);

  // Rebalance token ratios on each affected chain
  const rsChains = [...new Set(burned.map((m) => m.shift.chain))];
  for (const chain of rsChains) {
    await rebalanceTokenRatio(pair, chain, account.address, privateKey);
  }

  // Snapshot per-chain balances after all burns + rebalancing
  const chainBals = await captureChainBalances(pair, rsChains, account.address);

  // Build proportional allocations from burned positions
  const items = burned.map(({ shift, position: pos }) => {
    const poolCfg = pair.pools.find((p) => p.address === shift.pool && p.chain === shift.chain);
    const pct = totalValue > 0 ? pos.entryValueUsd / totalValue : 1 / burned.length;
    return {
      alloc: {
        pool: shift.pool,
        chain: shift.chain,
        dex: poolCfg!.dex,
        pct,
        expectedApr: pos.entryApr,
      } as AllocationEntry,
      range: shift.newRange,
    };
  });
  txCount += await mintFromAllocations(store, pair, decisionType, privateKey, items, chainBals);
  return txCount;
}
