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
import { getBalance, swapTokens } from "./execution/swap";
import { computeRange } from "./strategy/range";
import { getAccount } from "./execution/tx";
import { tokenDecimals } from "./config/tokens";
import {
  IMBALANCE_THRESHOLD,
  BRIDGE_THRESHOLD,
  CASH_RESERVE_PCT,
  FALLBACK_RANGE_MIN_FACTOR,
  FALLBACK_RANGE_MAX_FACTOR,
  FALLBACK_RANGE_BREADTH,
  FALLBACK_RANGE_CONFIDENCE,
  RETRY,
} from "./config/params";
import { ingestToO2 } from "./infra/o2";
import { log, errMsg, retry, scaleByPct } from "./utils";

// ---- Token balance helpers ----

async function getChainBalances(pair: PairConfig, chain: number, account: `0x${string}`) {
  const t0 = pair.token0.addresses[chain];
  const t1 = pair.token1.addresses[chain];
  const [bal0, bal1] = await Promise.all([
    t0 ? getBalance(chain, t0, account) : 0n,
    t1 ? getBalance(chain, t1, account) : 0n,
  ]);
  const val0 = t0 ? Number(bal0) / 10 ** tokenDecimals(pair.token0, chain) : 0;
  const val1 = t1 ? Number(bal1) / 10 ** tokenDecimals(pair.token1, chain) : 0;
  return { bal0, bal1, val0, val1, total: val0 + val1 };
}

/**
 * Rebalance token ratios after burn by swapping excess if imbalance > 5%.
 */
async function rebalanceTokenRatio(
  pair: PairConfig, chain: number, account: `0x${string}`, privateKey: `0x${string}`,
): Promise<void> {
  const { val0, val1, total } = await getChainBalances(pair, chain, account);
  if (total === 0) return;

  const excessUsd = Math.abs(val0 - val1) / 2;
  if (excessUsd < IMBALANCE_THRESHOLD * total) return;

  const token0Addr = pair.token0.addresses[chain]!;
  const token1Addr = pair.token1.addresses[chain]!;
  const [fromToken, toToken, fromDec] =
    val0 > val1
      ? [token0Addr, token1Addr, tokenDecimals(pair.token0, chain)]
      : [token1Addr, token0Addr, tokenDecimals(pair.token1, chain)];
  const swapAmount = BigInt(Math.floor(excessUsd * 10 ** fromDec));
  if (swapAmount === 0n) return;

  log.info(`Rebalancing ${pair.id}: swapping excess on chain ${chain}`, { pairId: pair.id, chain });
  await swapTokens({ fromChain: chain, toChain: chain, fromToken, toToken, amount: swapAmount, privateKey });
}

/**
 * Compute per-chain balance deltas and bridge funds from surplus to deficit chains.
 */
async function bridgeCrossChain(
  pair: PairConfig, allocations: AllocationEntry[], account: `0x${string}`, privateKey: `0x${string}`,
): Promise<void> {
  const chainTargets = new Map<number, number>();
  for (const alloc of allocations) {
    chainTargets.set(alloc.chain, (chainTargets.get(alloc.chain) ?? 0) + alloc.pct);
  }

  const chains = [...new Set(chainTargets.keys())];
  if (chains.length <= 1) return;

  const chainBalances = new Map<number, number>();
  let totalBalance = 0;
  const balEntries = await Promise.all(
    chains.map(async (chain) => {
      const { total } = await getChainBalances(pair, chain, account);
      return [chain, total] as const;
    }),
  );
  for (const [chain, val] of balEntries) {
    chainBalances.set(chain, val);
    totalBalance += val;
  }
  if (totalBalance === 0) return;

  const deltas = new Map<number, number>();
  for (const chain of chains) {
    deltas.set(chain, (chainBalances.get(chain) ?? 0) / totalBalance - (chainTargets.get(chain) ?? 0));
  }

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

      const result = await swapTokens({
        fromChain: srcChain, toChain: dstChain, fromToken: srcToken, toToken: dstToken, amount, privateKey,
      });

      if (result) {
        remaining -= bridgeAmount;
        deltas.set(dstChain, (deltas.get(dstChain) ?? 0) + bridgeAmount / totalBalance);
      }
    }
  }
}

async function captureChainBalances(
  pair: PairConfig, chains: number[], account: `0x${string}`,
): Promise<Map<number, { bal0: bigint; bal1: bigint }>> {
  const entries = await Promise.all(
    chains.map(async (chain) => {
      const { bal0, bal1 } = await getChainBalances(pair, chain, account);
      return [chain, { bal0, bal1 }] as const;
    }),
  );
  return new Map(entries);
}

// ---- Transaction logging ----

type TxOpts = {
  pairId: string;
  decisionType: DecisionType;
  opType: TxLogEntry["opType"];
  pool: `0x${string}`;
  chain: number;
  txHash: `0x${string}`;
  status: "success" | "reverted";
  gasUsed: bigint;
  gasPrice?: bigint;
  targetAllocationPct?: number;
};

function logTransaction(opts: TxOpts) {
  ingestToO2("tx_log", [{
    ...opts,
    ts: Date.now(),
    gasPrice: opts.gasPrice ?? 0n,
    targetAllocationPct: opts.targetAllocationPct ?? 0,
    actualAllocationPct: 0,
    allocationErrorPct: opts.targetAllocationPct ?? 0,
    inputToken: "", inputAmount: "0", inputUsd: 0,
    outputToken: "", outputAmount: "0", outputUsd: 0,
  }]);
}

function logBurn(pairId: string, dt: DecisionType, r: BurnResult, pool: `0x${string}`, chain: number) {
  logTransaction({
    pairId, decisionType: dt, opType: "burn", pool, chain,
    txHash: r.hash, status: r.success ? "success" : "reverted",
    gasUsed: r.gasUsed, gasPrice: r.gasPrice,
  });
}

function logMint(pairId: string, dt: DecisionType, r: MintResult, a: AllocationEntry) {
  logTransaction({
    pairId, decisionType: dt, opType: "mint", pool: a.pool, chain: a.chain,
    txHash: r.txHash, status: r.position ? "success" : "reverted",
    gasUsed: r.gasUsed, gasPrice: r.gasPrice, targetAllocationPct: a.pct,
  });
}

// ---- Shared burn/mint helpers ----

/**
 * Burn a position, log it, delete from store, and ingest to O2.
 * Returns { result, success } — caller decides abort vs continue semantics.
 */
async function burnAndRecord(
  store: DragonflyStore, pair: PairConfig, pos: Position,
  dt: DecisionType, privateKey: `0x${string}`,
): Promise<{ result: BurnResult | null; success: boolean }> {
  let result: BurnResult | null = null;
  try {
    result = await retry(() => burnPosition(pos, privateKey, pair), RETRY.burn.count, RETRY.burn.backoffMs);
  } catch (e: unknown) {
    log.error(`Burn threw for position ${pos.id}: ${errMsg(e)}`, { pairId: pair.id, pool: pos.pool, chain: pos.chain });
    return { result: null, success: false };
  }
  if (result) logBurn(pair.id, dt, result, pos.pool, pos.chain);
  if (result?.success) {
    await store.deletePosition(pos.id);
    ingestToO2("positions", [{ event: "burn", pairId: pair.id, positionId: pos.id, pool: pos.pool, chain: pos.chain }]);
    return { result, success: true };
  }
  return { result, success: false };
}

/** Rebalance token ratios on each chain, snapshot balances, then mint from allocations. */
async function rebalanceAndMint(
  store: DragonflyStore, pair: PairConfig, dt: DecisionType, privateKey: `0x${string}`,
  chains: number[], items: { alloc: AllocationEntry; range: Range }[],
): Promise<number> {
  const account = getAccount(privateKey);
  for (const chain of chains) await rebalanceTokenRatio(pair, chain, account.address, privateKey);
  const chainBals = await captureChainBalances(pair, chains, account.address);
  return mintFromAllocations(store, pair, dt, privateKey, items, chainBals);
}

async function mintFromAllocations(
  store: DragonflyStore, pair: PairConfig, dt: DecisionType, privateKey: `0x${string}`,
  items: { alloc: AllocationEntry; range: Range }[],
  chainBals: Map<number, { bal0: bigint; bal1: bigint }>,
): Promise<number> {
  let txCount = 0;
  for (const { alloc, range } of items) {
    if (!pair.pools.find((p) => p.address === alloc.pool && p.chain === alloc.chain)) continue;
    const bals = chainBals.get(alloc.chain);
    if (!bals) continue;
    const investPct = alloc.pct * (1 - CASH_RESERVE_PCT);
    const amt0 = scaleByPct(bals.bal0, investPct);
    const amt1 = scaleByPct(bals.bal1, investPct);
    if (amt0 === 0n && amt1 === 0n) {
      log.warn(`No balance for ${pair.id} on chain ${alloc.chain}, skipping`, { pairId: pair.id, chain: alloc.chain });
      continue;
    }
    try {
      const r = await retry(() => mintPosition(store, pair, alloc, range, amt0, amt1, privateKey), RETRY.mint.count, RETRY.mint.backoffMs);
      logMint(pair.id, dt, r, alloc);
      txCount++;
    } catch (e: unknown) {
      log.error(`Mint failed for ${alloc.pool} on chain ${alloc.chain}: ${errMsg(e)}`, { pairId: pair.id, pool: alloc.pool, chain: alloc.chain });
    }
  }
  return txCount;
}

// ---- Public executor functions ----

/**
 * Execute a Pool Re-Allocation (PRA):
 * 1. Burn all existing positions — abort on failure
 * 2. Bridge cross-chain if needed
 * 3. Rebalance + mint new positions per allocation
 */
export async function executePRA(
  store: DragonflyStore, pair: PairConfig, allocations: AllocationEntry[],
  decisionType: DecisionType, privateKey: `0x${string}`, forces: Forces | null = null, price = 1,
): Promise<number> {
  log.info(`Executing PRA for ${pair.id}: ${allocations.length} allocation(s)`, { pairId: pair.id });
  const account = getAccount(privateKey);
  let txCount = 0;

  // 1. Burn existing positions — abort on failure
  for (const pos of await store.getPositions()) {
    const { success } = await burnAndRecord(store, pair, pos, decisionType, privateKey);
    if (success) txCount++;
    else { log.error(`PRA aborted: burn failed for position ${pos.id}`); return txCount; }
  }

  // 2. Cross-chain rebalancing
  await bridgeCrossChain(pair, allocations, account.address, privateKey);

  // 3. Compute range + rebalance + mint
  const range = forces
    ? computeRange(price, forces)
    : {
        min: price * FALLBACK_RANGE_MIN_FACTOR, max: price * FALLBACK_RANGE_MAX_FACTOR,
        base: price, breadth: FALLBACK_RANGE_BREADTH, confidence: FALLBACK_RANGE_CONFIDENCE,
        trendBias: 0, type: "neutral" as const,
      };

  const targetChains = [...new Set(allocations.map((a) => a.chain))];
  txCount += await rebalanceAndMint(store, pair, decisionType, privateKey, targetChains,
    allocations.map((a) => ({ alloc: a, range })));
  return txCount;
}

/**
 * Execute Range-Shift (RS):
 * 1. Burn diverged positions
 * 2. Rebalance + mint at new ranges
 */
export async function executeRS(
  store: DragonflyStore, pair: PairConfig,
  shifts: { pool: `0x${string}`; chain: number; oldRange: Range; newRange: Range }[],
  decisionType: DecisionType, privateKey: `0x${string}`,
): Promise<number> {
  log.info(`Executing RS for ${pair.id}: ${shifts.length} shift(s)`, { pairId: pair.id });
  const existing = await store.getPositions();
  let txCount = 0;

  const matchedPositions = shifts
    .map((s) => ({ shift: s, position: existing.find((p) => p.pool === s.pool && p.chain === s.chain) }))
    .filter((m): m is { shift: (typeof shifts)[number]; position: Position } => !!m.position);

  // Burn all positions first
  const burned: typeof matchedPositions = [];
  for (const m of matchedPositions) {
    const { success } = await burnAndRecord(store, pair, m.position, decisionType, privateKey);
    if (success) { txCount++; burned.push(m); }
  }

  // Build proportional allocations from burned positions
  const totalValue = burned.reduce((sum, m) => sum + m.position.entryValueUsd, 0);
  const items = burned.map(({ shift, position: pos }) => {
    const poolCfg = pair.pools.find((p) => p.address === shift.pool && p.chain === shift.chain);
    const pct = totalValue > 0 ? pos.entryValueUsd / totalValue : 1 / burned.length;
    return {
      alloc: { pool: shift.pool, chain: shift.chain, dex: poolCfg!.dex, pct, expectedApr: pos.entryApr } as AllocationEntry,
      range: shift.newRange,
    };
  });

  const rsChains = [...new Set(burned.map((m) => m.shift.chain))];
  txCount += await rebalanceAndMint(store, pair, decisionType, privateKey, rsChains, items);
  return txCount;
}
