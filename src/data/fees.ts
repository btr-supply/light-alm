import type { PublicClient } from "viem";
import type { PoolConfig } from "../types";
import { type DexId, DexFamily } from "../types";
import { getDexFamily, ABIS, V4_STATE_VIEW, PCS_V4_CL_MANAGER } from "../config/dexs";
import { getPublicClient } from "../execution/tx";
import { DEFAULT_FEE, FEE_PRECISION, LB_BIN_STEP_DIVISOR } from "../config/params";
import { withFallback } from "../utils";

type FeeReader = (c: PublicClient, p: PoolConfig) => Promise<number>;

const readPoolFee: FeeReader = async (c, p) =>
  Number(await c.readContract({ address: p.address, abi: [ABIS.pool.fee], functionName: "fee" })) /
  FEE_PRECISION;

const readV4Fee =
  (lens: Record<number, `0x${string}`>): FeeReader =>
  async (c, p) => {
    const addr = lens[p.chain];
    if (!addr) return DEFAULT_FEE;
    return (
      Number(
        (
          (await c.readContract({
            address: addr,
            abi: [ABIS.v4.getSlot0],
            functionName: "getSlot0",
            args: [p.address],
          })) as readonly unknown[]
        )[3],
      ) / FEE_PRECISION
    );
  };

const FEE_READERS: Partial<Record<DexFamily, FeeReader>> = {
  [DexFamily.ALGEBRA]: async (c, p) =>
    Number(
      (
        (await c.readContract({
          address: p.address,
          abi: [ABIS.pool.globalState],
          functionName: "globalState",
        })) as readonly unknown[]
      )[2],
    ) / FEE_PRECISION,
  [DexFamily.V3]: readPoolFee,
  [DexFamily.AERODROME]: readPoolFee,
  [DexFamily.V4]: readV4Fee(V4_STATE_VIEW),
  [DexFamily.PCS_V4]: readV4Fee(PCS_V4_CL_MANAGER),
  [DexFamily.LB]: async (c, p) =>
    Number(
      await c.readContract({
        address: p.address,
        abi: [ABIS.lb.getBinStep],
        functionName: "getBinStep",
      }),
    ) / LB_BIN_STEP_DIVISOR,
};

export async function readFeeTier(pool: PoolConfig): Promise<number> {
  return withFallback(
    async () => {
      const reader = FEE_READERS[getDexFamily(pool.dex as DexId)];
      return reader ? reader(getPublicClient(pool.chain), pool) : DEFAULT_FEE;
    },
    DEFAULT_FEE,
    `Fee read failed for ${pool.address}`,
  );
}
