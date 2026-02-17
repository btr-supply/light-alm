import { encodeFunctionData } from "viem";
import type { Database } from "bun:sqlite";
import type {
  AllocationEntry,
  PairConfig,
  Position,
  Range,
  MintResult,
  BurnResult,
  DexId,
} from "../types";
import { DexFamily, findPool } from "../types";
import { getDex, getDexFamily, ABIS } from "../config/dexs";
import { rangeToTicks } from "../strategy/range";
import { getPublicClient, getAccount, sendAndWait, approveTokenPair, requireAddress } from "./tx";
import { sortTokensWithAmounts, withFallback } from "../utils";
import { mintLBPosition, burnLBPosition } from "./positions-lb";
import { mintV4Position, burnV4Position } from "./positions-v4";

import { savePosition } from "../data/store";
import { computeEntryValueUsd } from "../config/tokens";
import { readFeeTier } from "../data/fees";
import { ingestToO2 } from "../infra/o2";
import { log } from "../utils";
import { DEFAULT_SLIPPAGE_BPS, BPS_DIVISOR, MAX_UINT128, txDeadline } from "../config/params";

const COLLECT_EVENT_SIG = "0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01";

export function failedMintResult(result: {
  hash: string;
  gasUsed: bigint;
  gasPrice: bigint;
}): MintResult {
  return {
    position: null,
    txHash: result.hash as `0x${string}`,
    gasUsed: result.gasUsed,
    gasPrice: result.gasPrice,
  };
}

export function failedBurnResult(result: {
  hash: string;
  gasUsed: bigint;
  gasPrice: bigint;
}): BurnResult {
  return {
    success: false,
    amount0: 0n,
    amount1: 0n,
    hash: result.hash as `0x${string}`,
    gasUsed: result.gasUsed,
    gasPrice: result.gasPrice,
  };
}

export function successBurnResult(
  amount0: bigint,
  amount1: bigint,
  hash: string,
  gasUsed: bigint,
  gasPrice: bigint,
): BurnResult {
  return { success: true, amount0, amount1, hash: hash as `0x${string}`, gasUsed, gasPrice };
}

async function readPositionLiquidity(
  chain: number,
  pm: `0x${string}`,
  tokenId: bigint,
  isAlgebra = false,
): Promise<bigint> {
  return withFallback(
    async () => {
      const pub = getPublicClient(chain);
      const abi = isAlgebra ? [ABIS.algebra.positions] : [ABIS.univ3.positions];
      const posData = await pub.readContract({
        address: pm,
        abi,
        functionName: "positions",
        args: [tokenId],
      });
      return (posData as readonly unknown[])[isAlgebra ? 6 : 7] as bigint;
    },
    0n,
    `Read on-chain liquidity for tokenId ${tokenId}`,
  );
}

/**
 * Compute slippage-adjusted minimum amounts.
 */
export function applySlippage(amount: bigint, slippageBps = DEFAULT_SLIPPAGE_BPS): bigint {
  return amount - (amount * BigInt(slippageBps)) / BPS_DIVISOR;
}

/**
 * Extract tokenId from a mint transaction's Transfer event logs.
 */
export function extractTokenIdFromLogs(
  logs: readonly {
    topics: readonly `0x${string}`[];
    data: `0x${string}`;
    address: `0x${string}`;
  }[],
): string {
  // ERC721 Transfer event: Transfer(address,address,uint256)
  const transferSig = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  for (const l of logs) {
    if (l.topics[0] === transferSig && l.topics.length === 4) {
      // tokenId is in topics[3] for ERC721 Transfer
      return BigInt(l.topics[3]).toString();
    }
  }
  return "";
}

/**
 * Extract collected amounts from a Collect event in tx logs.
 */
export function extractCollectedAmounts(
  logs: readonly {
    topics: readonly `0x${string}`[];
    data: `0x${string}`;
    address: `0x${string}`;
  }[],
  tokenId: bigint,
): { amount0: bigint; amount1: bigint } | null {
  for (const l of logs) {
    if (
      l.topics[0] === COLLECT_EVENT_SIG &&
      l.topics.length >= 2 &&
      BigInt(l.topics[1]) === tokenId
    ) {
      // data: address(32 bytes) + amount0(32 bytes) + amount1(32 bytes)
      const hex = l.data.slice(2);
      return {
        amount0: BigInt("0x" + hex.slice(64, 128)),
        amount1: BigInt("0x" + hex.slice(128, 192)),
      };
    }
  }
  return null;
}

/**
 * Build a Position, save to DB, log, and return MintResult.
 * Shared by all mint adapters (V3, LB, V4).
 */
export function buildAndSaveMintResult(
  db: Database,
  pool: { address: `0x${string}`; chain: number; dex: DexId },
  pair: PairConfig,
  allocation: AllocationEntry,
  range: Range,
  mint: {
    positionId: string;
    tickLower: number;
    tickUpper: number;
    liquidity: bigint;
    amount0: bigint;
    amount1: bigint;
  },
  tx: { hash: string; gasUsed: bigint; gasPrice: bigint },
): MintResult {
  const id = `${pool.chain}:${pool.address.length > 42 ? pool.address.slice(0, 20) : pool.address}:${Date.now()}`;
  const position: Position = {
    id,
    pool: pool.address,
    chain: pool.chain,
    dex: pool.dex,
    ...mint,
    entryPrice: range.base,
    entryTs: Date.now(),
    entryApr: allocation.expectedApr,
    entryValueUsd: computeEntryValueUsd(pair, pool.chain, mint.amount0, mint.amount1),
  };
  savePosition(db, position);
  ingestToO2("positions", [{ event: "mint", ...position }]);
  log.info(
    `Position minted: ${id} ticks=[${mint.tickLower},${mint.tickUpper}] posId=${mint.positionId.slice(0, 20)}`,
  );
  return { position, txHash: tx.hash as `0x${string}`, gasUsed: tx.gasUsed, gasPrice: tx.gasPrice };
}

/**
 * Mint a new concentrated liquidity position.
 */
export async function mintPosition(
  db: Database,
  pair: PairConfig,
  allocation: AllocationEntry,
  range: Range,
  amount0: bigint,
  amount1: bigint,
  privateKey: `0x${string}`,
): Promise<MintResult> {
  const pool = findPool(pair, allocation.pool, allocation.chain);

  // Dispatch to family-specific adapter
  const family = getDexFamily(pool.dex);
  if (family === DexFamily.LB)
    return mintLBPosition(db, pair, allocation, range, amount0, amount1, privateKey);
  if (family === DexFamily.V4 || family === DexFamily.PCS_V4)
    return mintV4Position(db, pair, allocation, range, amount0, amount1, privateKey);

  // V3 / Algebra / Aerodrome — original logic
  const dex = getDex(pool.dex);
  const pm = requireAddress(dex.positionManager[pool.chain], `${pool.dex} PM chain ${pool.chain}`);
  const isAlgebra = dex.type === "algebra";
  const pub = getPublicClient(pool.chain);

  // Read tick spacing from pool contract (correct for all DEX families)
  const tickSpacing = Number(
    await pub.readContract({
      address: pool.address,
      abi: [ABIS.pool.tickSpacing],
      functionName: "tickSpacing",
    }),
  );
  const { tickLower, tickUpper } = rangeToTicks(range, tickSpacing);

  // Sort tokens (V3 PM requires token0 < token1) and swap amounts accordingly
  const {
    tokens: [token0, token1],
    amounts: [amt0, amt1],
  } = sortTokensWithAmounts(
    pair.token0.addresses[pool.chain],
    pair.token1.addresses[pool.chain],
    amount0,
    amount1,
  );

  // Approve tokens sequentially to avoid nonce collisions on the same chain
  await approveTokenPair(pair, pool.chain, pm, amount0, amount1, privateKey);

  const account = getAccount(privateKey);
  const deadline = txDeadline();
  const amount0Min = applySlippage(amt0);
  const amount1Min = applySlippage(amt1);

  // Algebra PM: no fee field; V3 PM: fee required
  const data = isAlgebra
    ? encodeFunctionData({
        abi: [ABIS.algebra.mint],
        functionName: "mint",
        args: [
          {
            token0,
            token1,
            tickLower,
            tickUpper,
            amount0Desired: amt0,
            amount1Desired: amt1,
            amount0Min,
            amount1Min,
            recipient: account.address,
            deadline,
          },
        ],
      })
    : encodeFunctionData({
        abi: [ABIS.univ3.mint],
        functionName: "mint",
        args: [
          {
            token0,
            token1,
            fee: Math.round((await readFeeTier(pool)) * 1_000_000),
            tickLower,
            tickUpper,
            amount0Desired: amt0,
            amount1Desired: amt1,
            amount0Min,
            amount1Min,
            recipient: account.address,
            deadline,
          },
        ],
      });

  const result = await sendAndWait(pool.chain, privateKey, { to: pm, data });
  if (result.status === "reverted") {
    log.error(`Mint reverted: ${result.hash}`);
    return failedMintResult(result);
  }

  const tokenId = extractTokenIdFromLogs(result.logs ?? []);
  const liquidity = tokenId
    ? await readPositionLiquidity(pool.chain, pm, BigInt(tokenId), isAlgebra)
    : 0n;

  // Save with original pair-order amounts (not sorted)
  return buildAndSaveMintResult(
    db,
    pool,
    pair,
    allocation,
    range,
    {
      positionId: tokenId || `pending:${result.hash}`,
      tickLower,
      tickUpper,
      liquidity,
      amount0,
      amount1,
    },
    { hash: result.hash, gasUsed: result.gasUsed, gasPrice: result.gasPrice },
  );
}

/**
 * Burn (remove) an existing position: decreaseLiquidity + collect.
 */
export async function burnPosition(
  position: Position,
  privateKey: `0x${string}`,
  pair?: PairConfig,
): Promise<BurnResult | null> {
  // Dispatch to family-specific adapter
  const family = getDexFamily(position.dex);
  if (family === DexFamily.LB) return burnLBPosition(position, privateKey);
  if (family === DexFamily.V4 || family === DexFamily.PCS_V4) {
    if (!pair) throw new Error("V4 burn requires pair config for token addresses");
    return burnV4Position(position, pair, privateKey);
  }

  // V3 / Algebra / Aerodrome — original logic
  const dex = getDex(position.dex);
  const pm = requireAddress(
    dex.positionManager[position.chain],
    `${position.dex} PM chain ${position.chain}`,
  );
  const isAlgebra = dex.type === "algebra";

  // Guard against unresolved positionId
  if (!position.positionId || position.positionId.startsWith("pending")) {
    log.error(
      `Cannot burn position ${position.id}: positionId not resolved (${position.positionId})`,
    );
    return null;
  }

  const account = getAccount(privateKey);
  const tokenId = BigInt(position.positionId);
  const deadline = txDeadline();
  let totalGasUsed = 0n;
  let lastGasPrice = 0n;

  // 1. Read on-chain liquidity (stored value may be stale/zero)
  const onChainLiq = await readPositionLiquidity(position.chain, pm, tokenId, isAlgebra);
  const onChainLiquidity = onChainLiq > 0n ? onChainLiq : position.liquidity;

  // 2. Decrease liquidity to 0 (always attempt if any liquidity exists on-chain)
  if (onChainLiquidity > 0n) {
    const decreaseData = encodeFunctionData({
      abi: [ABIS.univ3.decreaseLiquidity],
      functionName: "decreaseLiquidity",
      args: [
        {
          tokenId,
          liquidity: onChainLiquidity,
          amount0Min: applySlippage(position.amount0),
          amount1Min: applySlippage(position.amount1),
          deadline,
        },
      ],
    });
    const res = await sendAndWait(position.chain, privateKey, { to: pm, data: decreaseData });
    if (res.status === "reverted") {
      log.error(`DecreaseLiquidity reverted: ${res.hash}`);
      return failedBurnResult(res);
    }
    totalGasUsed += res.gasUsed;
    lastGasPrice = res.gasPrice;
  }

  // 3. Collect all tokens + fees
  const collectData = encodeFunctionData({
    abi: [ABIS.univ3.collect],
    functionName: "collect",
    args: [
      {
        tokenId,
        recipient: account.address,
        amount0Max: MAX_UINT128,
        amount1Max: MAX_UINT128,
      },
    ],
  });
  const collectRes = await sendAndWait(position.chain, privateKey, { to: pm, data: collectData });
  if (collectRes.status === "reverted") {
    log.error(`Collect reverted: ${collectRes.hash}`);
    return failedBurnResult({
      hash: collectRes.hash,
      gasUsed: totalGasUsed + collectRes.gasUsed,
      gasPrice: collectRes.gasPrice,
    });
  }

  totalGasUsed += collectRes.gasUsed;
  lastGasPrice = collectRes.gasPrice;

  // Parse actual collected amounts from Collect event logs
  const collected = extractCollectedAmounts(collectRes.logs ?? [], tokenId);

  log.info(`Position burned: ${position.id}`);
  return successBurnResult(
    collected?.amount0 ?? position.amount0,
    collected?.amount1 ?? position.amount1,
    collectRes.hash,
    totalGasUsed,
    lastGasPrice,
  );
}
