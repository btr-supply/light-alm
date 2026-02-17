import { encodeAbiParameters, encodeFunctionData, concat, toHex, keccak256 } from "viem";
import type { DragonflyStore } from "../data/store-dragonfly";
import type {
  AllocationEntry,
  PairConfig,
  Position,
  Range,
  MintResult,
  BurnResult,
} from "../types";
import { DexFamily, findPool } from "../types";
import {
  getDexFamily,
  V4_STATE_VIEW,
  V4_POSITION_MANAGER,
  PCS_V4_POSITION_MANAGER,
  PCS_V4_CL_MANAGER,
  ABIS,
} from "../config/dexs";
import { rangeToTicks } from "../strategy/range";
import { getPublicClient, getAccount, sendAndWait, approveTokenPair, requireAddress } from "./tx";
import {
  applySlippage,
  extractTokenIdFromLogs,
  buildAndSaveMintResult,
  checkMintRevert,
  checkBurnRevert,
  successBurnResult,
} from "./positions";
import { log, sortTokens, sortTokensWithAmounts } from "../utils";
import {
  Q96,
  txDeadline,
  ZERO_ADDR,
  V4_MINT_POSITION,
  V4_BURN_POSITION,
  V4_SETTLE_PAIR,
  V4_TAKE_PAIR,
  V4_MAX_TICK,
} from "../config/params";

// ---- Tick → sqrtPriceX96 (pure bigint, port of Uniswap TickMath.getSqrtRatioAtTick) ----

export function tickToSqrtPriceX96(tick: number): bigint {
  const absTick = Math.abs(tick);
  if (absTick > V4_MAX_TICK) throw new Error(`Tick ${tick} out of range`);

  let ratio: bigint =
    (absTick & 0x1) !== 0
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;
  if (absTick & 0x2) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n;
  if (absTick & 0x4) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n;
  if (absTick & 0x8) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n;
  if (absTick & 0x10) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n;
  if (absTick & 0x20) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n;
  if (absTick & 0x40) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n;
  if (absTick & 0x80) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n;
  if (absTick & 0x100) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n;
  if (absTick & 0x200) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n;
  if (absTick & 0x400) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n;
  if (absTick & 0x800) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n;
  if (absTick & 0x1000) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n;
  if (absTick & 0x2000) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n;
  if (absTick & 0x4000) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n;
  if (absTick & 0x8000) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n;
  if (absTick & 0x10000) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n;
  if (absTick & 0x20000) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n;
  if (absTick & 0x40000) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n;
  if (absTick & 0x80000) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n;

  if (tick > 0) ratio = ((1n << 256n) - 1n) / ratio;

  // Convert Q128 → Q96: shift right by 32, round up
  return (ratio >> 32n) + (ratio % (1n << 32n) > 0n ? 1n : 0n);
}

/** Compute sqrt-liquidity from desired token amounts and tick range. */
export function computeLiquidity(
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
  amount0: bigint,
  amount1: bigint,
): bigint {
  const sqrtA = tickToSqrtPriceX96(tickLower);
  const sqrtB = tickToSqrtPriceX96(tickUpper);

  if (sqrtPriceX96 <= sqrtA) {
    // Below range — all token0
    return (amount0 * sqrtA * sqrtB) / ((sqrtB - sqrtA) * Q96);
  }
  if (sqrtPriceX96 >= sqrtB) {
    // Above range — all token1
    return (amount1 * Q96) / (sqrtB - sqrtA);
  }
  // In range — constrained by both
  const L0 = (amount0 * sqrtPriceX96 * sqrtB) / ((sqrtB - sqrtPriceX96) * Q96);
  const L1 = (amount1 * Q96) / (sqrtPriceX96 - sqrtA);
  return L0 < L1 ? L0 : L1;
}

// ---- PoolKey reconstruction ----

interface PoolKey {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

interface PcsPoolKey {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  hooks: `0x${string}`;
  poolManager: `0x${string}`;
  fee: number;
  parameters: `0x${string}`; // bytes32 packed: hookPermissions(16) + tickSpacing(24)
}

type Slot0 = readonly [bigint, number, number, number];

/** Read slot0 + tickSpacing from a V4 lens contract, reusing preSlot0 if provided. */
async function readV4State(
  chainId: number,
  lens: `0x${string}`,
  poolId: `0x${string}`,
  preSlot0?: Slot0,
): Promise<{ slot0: Slot0; fee: number; tickSpacing: number }> {
  const client = getPublicClient(chainId);
  if (preSlot0) {
    const ts = Number(
      await client.readContract({
        address: lens,
        abi: [ABIS.v4.getTickSpacing],
        functionName: "getTickSpacing",
        args: [poolId],
      }),
    );
    return { slot0: preSlot0, fee: preSlot0[3], tickSpacing: ts };
  }
  const [slot0, ts] = await Promise.all([
    client.readContract({
      address: lens,
      abi: [ABIS.v4.getSlot0],
      functionName: "getSlot0",
      args: [poolId],
    }),
    client.readContract({
      address: lens,
      abi: [ABIS.v4.getTickSpacing],
      functionName: "getTickSpacing",
      args: [poolId],
    }),
  ]);
  const s = slot0 as Slot0;
  return { slot0: s, fee: s[3], tickSpacing: Number(ts) };
}

/** Resolve V4 PoolKey from on-chain data (Uniswap or PancakeSwap). */
async function resolveV4PoolKey(
  type: "uni" | "pcs",
  chainId: number,
  poolId: `0x${string}`,
  token0Addr: `0x${string}`,
  token1Addr: `0x${string}`,
  preSlot0?: Slot0,
): Promise<PoolKey | PcsPoolKey> {
  const lensRegistry = type === "pcs" ? PCS_V4_CL_MANAGER : V4_STATE_VIEW;
  const lens = requireAddress(
    lensRegistry[chainId],
    `${type === "pcs" ? "PCS V4 CLPoolManager" : "V4 StateView"} chain ${chainId}`,
  );

  const { fee, tickSpacing } = await readV4State(chainId, lens, poolId, preSlot0);
  const [c0, c1] = sortTokens(token0Addr, token1Addr);

  if (type === "pcs") {
    const params = toHex(BigInt(tickSpacing) & 0xffffffn, { size: 32 });
    return {
      currency0: c0,
      currency1: c1,
      hooks: ZERO_ADDR,
      poolManager: lens,
      fee,
      parameters: params as `0x${string}`,
    } as PcsPoolKey;
  }

  const key: PoolKey = { currency0: c0, currency1: c1, fee, tickSpacing, hooks: ZERO_ADDR };

  // Verify hash matches poolId
  const computed = keccak256(
    encodeAbiParameters([{ type: "tuple", components: ABIS.v4PoolKey.uni }], [key]),
  );
  if (computed.toLowerCase() !== poolId.toLowerCase()) {
    log.warn(`V4 PoolKey hash mismatch for ${poolId.slice(0, 20)}... (pool may have hooks)`);
  }

  return key;
}

/** Get the V4 PositionManager address for a given pool. */
function getV4PM(chainId: number, family: string): `0x${string}` {
  const registry = family === DexFamily.PCS_V4 ? PCS_V4_POSITION_MANAGER : V4_POSITION_MANAGER;
  return requireAddress(registry[chainId], `${family} PositionManager chain ${chainId}`);
}

// ---- Encode action batches ----

function encodeV4Actions(actionIds: number[], paramsList: `0x${string}`[]): `0x${string}` {
  const actions = concat(actionIds.map((a) => toHex(a, { size: 1 })));
  return encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actions, paramsList]);
}

function encodeMintActions(
  poolKey: PoolKey | PcsPoolKey,
  poolKeyComponents: readonly { readonly name: string; readonly type: string }[],
  tickLower: number,
  tickUpper: number,
  liquidity: bigint,
  amount0Max: bigint,
  amount1Max: bigint,
  recipient: `0x${string}`,
): `0x${string}` {
  const mintParams = encodeAbiParameters(
    [
      { type: "tuple", name: "poolKey", components: poolKeyComponents as any },
      { type: "int24", name: "tickLower" },
      { type: "int24", name: "tickUpper" },
      { type: "uint256", name: "liquidity" },
      { type: "uint128", name: "amount0Max" },
      { type: "uint128", name: "amount1Max" },
      { type: "address", name: "recipient" },
      { type: "bytes", name: "hookData" },
    ],
    [poolKey as any, tickLower, tickUpper, liquidity, amount0Max, amount1Max, recipient, "0x"],
  );

  const settleParams = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }],
    [poolKey.currency0, poolKey.currency1],
  );

  return encodeV4Actions([V4_MINT_POSITION, V4_SETTLE_PAIR], [mintParams, settleParams]);
}

function encodeBurnActions(
  tokenId: bigint,
  amount0Min: bigint,
  amount1Min: bigint,
  currency0: `0x${string}`,
  currency1: `0x${string}`,
  recipient: `0x${string}`,
): `0x${string}` {
  const burnParams = encodeAbiParameters(
    [
      { type: "uint256", name: "tokenId" },
      { type: "uint128", name: "amount0Min" },
      { type: "uint128", name: "amount1Min" },
      { type: "bytes", name: "hookData" },
    ],
    [tokenId, amount0Min, amount1Min, "0x"],
  );

  const takeParams = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }],
    [currency0, currency1, recipient],
  );

  return encodeV4Actions([V4_BURN_POSITION, V4_TAKE_PAIR], [burnParams, takeParams]);
}

// ---- Mint ----

export async function mintV4Position(
  store: DragonflyStore,
  pair: PairConfig,
  allocation: AllocationEntry,
  range: Range,
  amount0: bigint,
  amount1: bigint,
  privateKey: `0x${string}`,
): Promise<MintResult> {
  const pool = findPool(pair, allocation.pool, allocation.chain);

  const family = getDexFamily(pool.dex);
  const pm = getV4PM(pool.chain, family);
  const client = getPublicClient(pool.chain);
  const account = getAccount(privateKey);

  const t0Addr = pair.token0.addresses[pool.chain];
  const t1Addr = pair.token1.addresses[pool.chain];

  // Sort tokens to match pool ordering; swap amounts if pair order differs from sorted order
  const {
    amounts: [a0, a1],
  } = sortTokensWithAmounts(t0Addr, t1Addr, amount0, amount1);

  // Read slot0 once, then resolve PoolKey (passing pre-fetched slot0 to avoid redundant RPC)
  const lens = requireAddress(
    family === DexFamily.PCS_V4 ? PCS_V4_CL_MANAGER[pool.chain] : V4_STATE_VIEW[pool.chain],
    `${family} lens chain ${pool.chain}`,
  );

  const slot0 = (await client.readContract({
    address: lens!,
    abi: [ABIS.v4.getSlot0],
    functionName: "getSlot0",
    args: [pool.address],
  })) as Slot0;
  const sqrtPriceX96 = slot0[0];

  const v4Type = family === DexFamily.PCS_V4 ? ("pcs" as const) : ("uni" as const);
  const poolKey = await resolveV4PoolKey(v4Type, pool.chain, pool.address, t0Addr, t1Addr, slot0);
  const poolKeyComponents = v4Type === "pcs" ? ABIS.v4PoolKey.pcs : ABIS.v4PoolKey.uni;
  const tickSpacing =
    v4Type === "pcs"
      ? Number(BigInt((poolKey as PcsPoolKey).parameters) & 0xffffffn)
      : (poolKey as PoolKey).tickSpacing;

  const { tickLower, tickUpper } = rangeToTicks(range, tickSpacing);

  // Use sorted amounts (a0/a1 match PoolKey currency0/currency1)
  const liquidity = computeLiquidity(sqrtPriceX96, tickLower, tickUpper, a0, a1);
  if (liquidity <= 0n) {
    log.warn(`V4 computed liquidity is 0 for ${allocation.pool}, skipping`);
    return { position: null, txHash: "0x0" as `0x${string}`, gasUsed: 0n, gasPrice: 0n };
  }

  // V4 PM uses Permit2 for token transfers (not direct ERC20 approval)
  await approveTokenPair(pair, pool.chain, pm, amount0, amount1, privateKey, "permit2");

  const deadline = txDeadline();
  // Max amounts = desired amounts (PM pulls up to this limit, liquidity constrains actual)
  const amount0Max = a0;
  const amount1Max = a1;

  const unlockData = encodeMintActions(
    poolKey,
    poolKeyComponents,
    tickLower,
    tickUpper,
    liquidity,
    amount0Max,
    amount1Max,
    account.address,
  );

  const data = encodeFunctionData({
    abi: [ABIS.v4pm.modifyLiquidities],
    functionName: "modifyLiquidities",
    args: [unlockData, deadline],
  });

  const result = await sendAndWait(pool.chain, privateKey, { to: pm, data });
  const reverted = checkMintRevert("V4 mint", result);
  if (reverted) return reverted;

  const tokenId = extractTokenIdFromLogs(result.logs ?? []);

  return buildAndSaveMintResult(store, pool, pair, allocation, range,
    { positionId: tokenId || `pending:${result.hash}`, tickLower, tickUpper, liquidity, amount0, amount1 },
    result,
  );
}

// ---- Burn ----

export async function burnV4Position(
  position: Position,
  pair: PairConfig,
  privateKey: `0x${string}`,
): Promise<BurnResult | null> {
  if (!position.positionId || position.positionId.startsWith("pending")) {
    log.error(`Cannot burn V4 position ${position.id}: positionId not resolved`);
    return null;
  }

  const family = getDexFamily(position.dex);
  const pm = getV4PM(position.chain, family);
  const account = getAccount(privateKey);

  const t0Addr = pair.token0.addresses[position.chain];
  const t1Addr = pair.token1.addresses[position.chain];
  const [c0, c1] = sortTokens(t0Addr, t1Addr);

  const tokenId = BigInt(position.positionId);
  const deadline = txDeadline();

  const unlockData = encodeBurnActions(
    tokenId,
    applySlippage(position.amount0),
    applySlippage(position.amount1),
    c0,
    c1,
    account.address,
  );

  const data = encodeFunctionData({
    abi: [ABIS.v4pm.modifyLiquidities],
    functionName: "modifyLiquidities",
    args: [unlockData, deadline],
  });

  const result = await sendAndWait(position.chain, privateKey, { to: pm, data });
  const reverted = checkBurnRevert("V4 burn", result);
  if (reverted) return reverted;

  log.info(`V4 position burned: ${position.id}`);
  return successBurnResult(position.amount0, position.amount1, result);
}
