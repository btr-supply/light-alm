import type { PublicClient } from "viem";
import { DexFamily, type PoolEntry, type PoolState, type TokenConfig } from "../types";
import { ABIS, getDexFamily, V4_STATE_VIEW, PCS_V4_CL_MANAGER } from "../config/dexs";
import { requireAddress } from "../execution/tx";
import { ZERO_ADDR, LB_BIN_ID_OFFSET, LB_BIN_STEP_DIVISOR, FEE_PRECISION } from "../config/params";
import { getPublicClient } from "../execution/tx";
import { log, sortTokens } from "../utils";

/** Convert sqrtPriceX96 → token1/token0 price. */
function sqrtPriceX96ToPrice(sqrtPriceX96: bigint): number {
  const sq = Number(sqrtPriceX96) / 2 ** 96;
  return sq * sq;
}

// ---- V3-style adapter (V3 / Algebra / Aerodrome) ----

interface V3StyleConfig {
  stateAbi: {
    readonly inputs: readonly [];
    readonly name: string;
    readonly outputs: readonly { readonly name: string; readonly type: string }[];
    readonly stateMutability: "view";
    readonly type: "function";
  };
  stateFn: string;
  feeFromState?: number; // index in state tuple for fee; if unset, reads fee() separately
}

const V3_STYLE: Record<string, V3StyleConfig> = {
  [DexFamily.V3]: { stateAbi: ABIS.pool.slot0, stateFn: "slot0" },
  [DexFamily.AERODROME]: { stateAbi: ABIS.pool.aeroSlot0, stateFn: "slot0" },
  [DexFamily.ALGEBRA]: { stateAbi: ABIS.pool.globalState, stateFn: "globalState", feeFromState: 2 },
};

async function queryV3Style(
  client: PublicClient,
  address: `0x${string}`,
  cfg: V3StyleConfig,
): Promise<PoolState> {
  const reads: Promise<unknown>[] = [
    client.readContract({ address, abi: [ABIS.pool.token0], functionName: "token0" }),
    client.readContract({ address, abi: [ABIS.pool.token1], functionName: "token1" }),
    client.readContract({ address, abi: [cfg.stateAbi], functionName: cfg.stateFn as any }),
    client.readContract({ address, abi: [ABIS.pool.liquidity], functionName: "liquidity" }),
    client.readContract({ address, abi: [ABIS.pool.tickSpacing], functionName: "tickSpacing" }),
  ];
  if (cfg.feeFromState === undefined)
    reads.push(client.readContract({ address, abi: [ABIS.pool.fee], functionName: "fee" }));

  const r = await Promise.all(reads);
  const s = r[2] as readonly [bigint, number, ...unknown[]];
  const fee = cfg.feeFromState !== undefined ? Number(s[cfg.feeFromState]) : Number(r[5]);
  return {
    token0: r[0] as `0x${string}`,
    token1: r[1] as `0x${string}`,
    price: sqrtPriceX96ToPrice(s[0]),
    fee: fee / FEE_PRECISION,
    sqrtPriceX96: s[0],
    tick: Number(s[1]),
    liquidity: r[3] as bigint,
    tickSpacing: Number(r[4]),
  };
}

async function queryV4Family(
  client: PublicClient,
  poolId: `0x${string}`,
  lens: `0x${string}`,
  chainId: number,
  readTickSpacing: boolean,
  pairTokens?: [TokenConfig, TokenConfig],
): Promise<PoolState> {
  const calls: [Promise<unknown>, Promise<unknown>, Promise<unknown> | null] = [
    client.readContract({
      address: lens,
      abi: [ABIS.v4.getSlot0],
      functionName: "getSlot0",
      args: [poolId],
    }),
    client.readContract({
      address: lens,
      abi: [ABIS.v4.getLiquidity],
      functionName: "getLiquidity",
      args: [poolId],
    }),
    readTickSpacing
      ? client.readContract({
          address: lens,
          abi: [ABIS.v4.getTickSpacing],
          functionName: "getTickSpacing",
          args: [poolId],
        })
      : null,
  ];

  const [slot0, liquidity, tickSpacing] = await Promise.all(
    calls.filter((c): c is Promise<unknown> => c !== null),
  );
  const s = slot0 as readonly [bigint, number, number, number];
  const sqrtPriceX96 = s[0];

  let token0: `0x${string}` = ZERO_ADDR;
  let token1: `0x${string}` = ZERO_ADDR;
  if (pairTokens) {
    const a0 = pairTokens[0].addresses[chainId];
    const a1 = pairTokens[1].addresses[chainId];
    if (a0 && a1) [token0, token1] = sortTokens(a0, a1);
  }

  const state: PoolState = {
    token0,
    token1,
    price: sqrtPriceX96ToPrice(sqrtPriceX96),
    fee: Number(s[3]) / FEE_PRECISION,
    sqrtPriceX96,
    tick: Number(s[1]),
    liquidity: liquidity as bigint,
  };
  if (readTickSpacing) state.tickSpacing = Number(tickSpacing);
  return state;
}

async function queryV4Variant(
  client: PublicClient,
  poolId: `0x${string}`,
  chainId: number,
  family: DexFamily,
  pairTokens?: [TokenConfig, TokenConfig],
): Promise<PoolState> {
  const isPcs = family === DexFamily.PCS_V4;
  const lens = requireAddress(
    isPcs ? PCS_V4_CL_MANAGER[chainId] : V4_STATE_VIEW[chainId],
    `${isPcs ? "PCS V4 CLPoolManager" : "V4 StateView"} chain ${chainId}`,
  );
  return queryV4Family(client, poolId, lens, chainId, !isPcs, pairTokens);
}

async function queryLB(client: PublicClient, address: `0x${string}`): Promise<PoolState> {
  const [tokenX, tokenY, activeId, binStep, reserves] = await Promise.all([
    client.readContract({ address, abi: [ABIS.lb.getTokenX], functionName: "getTokenX" }),
    client.readContract({ address, abi: [ABIS.lb.getTokenY], functionName: "getTokenY" }),
    client.readContract({ address, abi: [ABIS.lb.getActiveId], functionName: "getActiveId" }),
    client.readContract({ address, abi: [ABIS.lb.getBinStep], functionName: "getBinStep" }),
    client.readContract({ address, abi: [ABIS.lb.getReserves], functionName: "getReserves" }),
  ]);

  const id = Number(activeId);
  const step = Number(binStep);
  const r = reserves as readonly [bigint, bigint];

  const price = Math.pow(1 + step / LB_BIN_STEP_DIVISOR, id - LB_BIN_ID_OFFSET);

  return {
    token0: tokenX as `0x${string}`,
    token1: tokenY as `0x${string}`,
    price,
    fee: step / LB_BIN_STEP_DIVISOR,
    activeId: id,
    binStep: step,
    reserveX: r[0],
    reserveY: r[1],
  };
}

// ---- Dispatcher ----

export async function queryPool(
  entry: PoolEntry,
  pairTokens?: [TokenConfig, TokenConfig],
): Promise<PoolState> {
  const client = getPublicClient(entry.chain);
  const family = getDexFamily(entry.dex);

  const v3Cfg = V3_STYLE[family];
  if (v3Cfg) return queryV3Style(client, entry.id, v3Cfg);

  switch (family) {
    case DexFamily.V4:
    case DexFamily.PCS_V4:
      return queryV4Variant(client, entry.id, entry.chain, family, pairTokens);
    case DexFamily.LB:
      return queryLB(client, entry.id);
    default:
      throw new Error(`Unsupported DEX family: ${family}`);
  }
}

export async function queryAllPools(
  pools: PoolEntry[],
  pairTokens?: [TokenConfig, TokenConfig],
): Promise<Map<string, PoolState>> {
  const results = new Map<string, PoolState>();
  const settled = await Promise.allSettled(
    pools.map(async (p) => {
      const state = await queryPool(p, pairTokens);
      return { key: `${p.chain}:${p.id}`, state };
    }),
  );
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      results.set(r.value.key, r.value.state);
    } else {
      log.warn(
        `Pool query failed [${pools[i].dex} ${pools[i].chain}:${pools[i].id.slice(0, 10)}]: ${r.reason}`,
      );
    }
  }
  return results;
}
