import { encodeFunctionData } from "viem";
import type { Database } from "bun:sqlite";
import type {
  AllocationEntry,
  PairConfig,
  Position,
  Range,
  MintResult,
  BurnResult,
} from "../types";
import { findPool } from "../types";
import { getDex, ABIS } from "../config/dexs";
import { getPublicClient, getAccount, sendAndWait, approveTokenPair, requireAddress } from "./tx";
import {
  applySlippage,
  buildAndSaveMintResult,
  failedMintResult,
  failedBurnResult,
  successBurnResult,
} from "./positions";
import { log } from "../utils";
import {
  E18,
  txDeadline,
  LB_BIN_ID_OFFSET,
  LB_DEFAULT_BIN_RANGE,
  LB_ID_SLIPPAGE,
  LB_BIN_STEP_DIVISOR,
} from "../config/params";

// ---- Helpers ----

/** Convert price to LB bin ID: binId = round(log(price) / log(1 + binStep/10000)) + 2^23 */
export function priceToBinId(price: number, binStep: number): number {
  return (
    Math.round(Math.log(price) / Math.log(1 + binStep / LB_BIN_STEP_DIVISOR)) + LB_BIN_ID_OFFSET
  );
}

/** Build uniform distribution arrays for LB bins. TokenX in active+above, tokenY in active+below. */
export function buildDistributions(deltaIds: bigint[]): {
  distributionX: bigint[];
  distributionY: bigint[];
} {
  const xCount = deltaIds.filter((d) => d >= 0n).length;
  const yCount = deltaIds.filter((d) => d <= 0n).length;
  const xShare = xCount > 0 ? E18 / BigInt(xCount) : 0n;
  const yShare = yCount > 0 ? E18 / BigInt(yCount) : 0n;

  const distributionX = deltaIds.map((d) => (d >= 0n ? xShare : 0n));
  const distributionY = deltaIds.map((d) => (d <= 0n ? yShare : 0n));

  // Fix rounding so sum == 1e18
  if (xCount > 0) {
    const diff = E18 - distributionX.reduce((a, b) => a + b, 0n);
    distributionX[distributionX.findLastIndex((v) => v > 0n)] += diff;
  }
  if (yCount > 0) {
    const diff = E18 - distributionY.reduce((a, b) => a + b, 0n);
    distributionY[distributionY.findLastIndex((v) => v > 0n)] += diff;
  }

  return { distributionX, distributionY };
}

// ---- Mint ----

export async function mintLBPosition(
  db: Database,
  pair: PairConfig,
  allocation: AllocationEntry,
  range: Range,
  amount0: bigint,
  amount1: bigint,
  privateKey: `0x${string}`,
): Promise<MintResult> {
  const pool = findPool(pair, allocation.pool, allocation.chain);

  const dex = getDex(pool.dex);
  const router = requireAddress(
    dex.positionManager[pool.chain],
    `${pool.dex} LB router chain ${pool.chain}`,
  );

  const client = getPublicClient(pool.chain);
  const account = getAccount(privateKey);

  const [activeId, binStep, tokenX, tokenY] = await Promise.all([
    client.readContract({
      address: pool.address,
      abi: [ABIS.lb.getActiveId],
      functionName: "getActiveId",
    }),
    client.readContract({
      address: pool.address,
      abi: [ABIS.lb.getBinStep],
      functionName: "getBinStep",
    }),
    client.readContract({
      address: pool.address,
      abi: [ABIS.lb.getTokenX],
      functionName: "getTokenX",
    }) as Promise<`0x${string}`>,
    client.readContract({
      address: pool.address,
      abi: [ABIS.lb.getTokenY],
      functionName: "getTokenY",
    }) as Promise<`0x${string}`>,
  ]);
  const activeIdNum = Number(activeId);
  const binStepNum = Number(binStep);

  // Match pair token ordering to pool's tokenX/tokenY
  const t0Addr = pair.token0.addresses[pool.chain]?.toLowerCase();
  const amountX = t0Addr === (tokenX as string).toLowerCase() ? amount0 : amount1;
  const amountY = t0Addr === (tokenX as string).toLowerCase() ? amount1 : amount0;

  // Derive bin range from price range
  const minBin = priceToBinId(range.min, binStepNum);
  const maxBin = priceToBinId(range.max, binStepNum);
  const halfRange = Math.max(LB_DEFAULT_BIN_RANGE, Math.floor((maxBin - minBin) / 2));

  const deltaIds: bigint[] = [];
  for (let i = -halfRange; i <= halfRange; i++) deltaIds.push(BigInt(i));

  const { distributionX, distributionY } = buildDistributions(deltaIds);

  // Approve tokens to router sequentially
  await approveTokenPair(pair, pool.chain, router, amount0, amount1, privateKey);

  const deadline = txDeadline();

  const data = encodeFunctionData({
    abi: [ABIS.lbRouter.addLiquidity],
    functionName: "addLiquidity",
    args: [
      {
        tokenX: tokenX as `0x${string}`,
        tokenY: tokenY as `0x${string}`,
        binStep: BigInt(binStepNum),
        amountX,
        amountY,
        amountXMin: applySlippage(amountX),
        amountYMin: applySlippage(amountY),
        activeIdDesired: BigInt(activeIdNum),
        idSlippage: LB_ID_SLIPPAGE,
        deltaIds,
        distributionX,
        distributionY,
        to: account.address,
        refundTo: account.address,
        deadline,
      },
    ],
  });

  const result = await sendAndWait(pool.chain, privateKey, { to: router, data });
  if (result.status === "reverted") {
    log.error(`LB mint reverted: ${result.hash}`);
    return failedMintResult(result);
  }

  const lowerBin = activeIdNum - halfRange;
  const upperBin = activeIdNum + halfRange;
  return buildAndSaveMintResult(
    db,
    pool,
    pair,
    allocation,
    range,
    {
      positionId: `lb:${lowerBin}:${upperBin}`,
      tickLower: lowerBin,
      tickUpper: upperBin,
      liquidity: 0n,
      amount0,
      amount1,
    },
    { hash: result.hash, gasUsed: result.gasUsed, gasPrice: result.gasPrice },
  );
}

// ---- Burn ----

export async function burnLBPosition(
  position: Position,
  privateKey: `0x${string}`,
): Promise<BurnResult | null> {
  const dex = getDex(position.dex);
  const router = requireAddress(
    dex.positionManager[position.chain],
    `${position.dex} LB router chain ${position.chain}`,
  );

  const client = getPublicClient(position.chain);
  const account = getAccount(privateKey);

  // Parse bin range from positionId: "lb:<lower>:<upper>"
  const parts = position.positionId.split(":");
  if (parts[0] !== "lb" || parts.length < 3) {
    log.error(`Invalid LB positionId: ${position.positionId}`);
    return null;
  }
  const lowerBin = Number(parts[1]);
  const upperBin = Number(parts[2]);

  // Read balances for all bins in parallel
  const binRange = Array.from({ length: upperBin - lowerBin + 1 }, (_, i) => lowerBin + i);
  const bals = await Promise.all(
    binRange.map(
      (id) =>
        client.readContract({
          address: position.pool,
          abi: [ABIS.lbRouter.balanceOf],
          functionName: "balanceOf",
          args: [account.address, BigInt(id)],
        }) as Promise<bigint>,
    ),
  );
  const binIds: bigint[] = [];
  const binAmounts: bigint[] = [];
  for (let i = 0; i < binRange.length; i++) {
    if (bals[i] > 0n) {
      binIds.push(BigInt(binRange[i]));
      binAmounts.push(bals[i]);
    }
  }

  if (binIds.length === 0) {
    log.warn(`No LB balances for position ${position.id}`);
    return {
      success: true,
      amount0: 0n,
      amount1: 0n,
      hash: "0x0" as `0x${string}`,
      gasUsed: 0n,
      gasPrice: 0n,
    };
  }

  // Approve router for LBPair tokens (ERC-1155 operator)
  const isApproved = (await client.readContract({
    address: position.pool,
    abi: [ABIS.lbRouter.isApprovedForAll],
    functionName: "isApprovedForAll",
    args: [account.address, router],
  })) as boolean;

  let totalGasUsed = 0n;
  let lastGasPrice = 0n;

  if (!isApproved) {
    const approveData = encodeFunctionData({
      abi: [ABIS.lbRouter.approveForAll],
      functionName: "approveForAll",
      args: [router, true],
    });
    const res = await sendAndWait(position.chain, privateKey, {
      to: position.pool,
      data: approveData,
    });
    totalGasUsed += res.gasUsed;
    lastGasPrice = res.gasPrice;
  }

  // Read token addresses + bin step from pool
  const [tokenX, tokenY, binStep] = await Promise.all([
    client.readContract({
      address: position.pool,
      abi: [ABIS.lb.getTokenX],
      functionName: "getTokenX",
    }),
    client.readContract({
      address: position.pool,
      abi: [ABIS.lb.getTokenY],
      functionName: "getTokenY",
    }),
    client.readContract({
      address: position.pool,
      abi: [ABIS.lb.getBinStep],
      functionName: "getBinStep",
    }),
  ]);

  const deadline = txDeadline();

  const data = encodeFunctionData({
    abi: [ABIS.lbRouter.removeLiquidity],
    functionName: "removeLiquidity",
    args: [
      tokenX as `0x${string}`,
      tokenY as `0x${string}`,
      Number(binStep),
      applySlippage(position.amount0),
      applySlippage(position.amount1),
      binIds,
      binAmounts,
      account.address,
      deadline,
    ],
  });

  const result = await sendAndWait(position.chain, privateKey, { to: router, data });
  totalGasUsed += result.gasUsed;
  lastGasPrice = result.gasPrice;

  if (result.status === "reverted") {
    log.error(`LB burn reverted: ${result.hash}`);
    return failedBurnResult({ hash: result.hash, gasUsed: totalGasUsed, gasPrice: lastGasPrice });
  }

  log.info(`LB position burned: ${position.id}`);
  return successBurnResult(
    position.amount0,
    position.amount1,
    result.hash,
    totalGasUsed,
    lastGasPrice,
  );
}
