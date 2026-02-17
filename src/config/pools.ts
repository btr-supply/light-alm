import { DexId, DexFamily, type PoolEntry, type PoolConfig } from "../types";
import { getDex, getDexFamily, V4_POSITION_MANAGER, PCS_V4_POSITION_MANAGER } from "./dexs";
import { log } from "../utils";

export const POOL_REGISTRY: Record<string, PoolEntry[]> = {
  "USDC-USDT": [
    // ---- Ethereum (1) ----
    {
      id: "0x3416cf6c708da44db2624d63ea0aaef7113527c6",
      chain: 1,
      dex: DexId.UNI_V3,
    },
    {
      id: "0xd49b419ced7700b88756e5c576f7a6fc165d8b4b140970ec4e6f468784c8385c",
      chain: 1,
      dex: DexId.UNI_V4,
    },
    {
      id: "0x8aa4e11cbdf30eedc92100f4c8a31ff748e201d44712cc8c90d189edaa8e4e47",
      chain: 1,
      dex: DexId.UNI_V4,
    },
    {
      id: "0x395f91b34aa34a477ce3bc6505639a821b286a62b1a164fc1887fa3a5ef713a5",
      chain: 1,
      dex: DexId.UNI_V4,
    },
    {
      id: "0xe018f09af38956affdfeab72c2cefbcd4e6fee44d09df7525ec9dba3e51356a5",
      chain: 1,
      dex: DexId.UNI_V4,
    },
    {
      id: "0x04c8577958ccc170eb3d2cca76f9d51bc6e42d8f",
      chain: 1,
      dex: DexId.PCS_V3,
    },

    // ---- BNB Chain (56) ----
    {
      id: "0x92b7807bf19b7dddf89b706143896d05228f3121",
      chain: 56,
      dex: DexId.PCS_V3,
    },
    {
      id: "0x4f31fa980a675570939b737ebdde0471a4be40eb",
      chain: 56,
      dex: DexId.PCS_V3,
    },
    {
      id: "0x2c3c320d49019d4f9a92352e947c7e5acfe47d68",
      chain: 56,
      dex: DexId.UNI_V3,
    },
    {
      id: "0x3c2c41b2711bf990822e25135eab4effe9bd33c8d016fd19dc131d7c9e2a432d",
      chain: 56,
      dex: DexId.PCS_V4,
    },
    {
      id: "0x32a805e65a3219a79707ab3e75443d75160d798de46613fc960d39cd4a96bb22",
      chain: 56,
      dex: DexId.PCS_V4,
    },
    {
      id: "0x258907d03806aad208f23147bf05d4e5f69eaba5c6ded94f02d98445add62c31",
      chain: 56,
      dex: DexId.PCS_V4,
    },
    {
      id: "0xf8c7b3c122f31aec155c6beb0c1c78a5e74208358a840cadfbc6129b59391850",
      chain: 56,
      dex: DexId.UNI_V4,
    },
    {
      id: "0x628ea54a6450645d2bb7b2911c8c6f3d7f3944c2f4703c259a1b85bf5569870b",
      chain: 56,
      dex: DexId.UNI_V4,
    },
    {
      id: "0x8321c1f53959b14ece4b5400e60aeac59e7b6b8bac446f2f0a89b9e84e68a08a",
      chain: 56,
      dex: DexId.UNI_V4,
    },

    // ---- Arbitrum (42161) ----
    {
      id: "0xbe3ad6a5669dc0b8b12febc03608860c31e2eef6",
      chain: 42161,
      dex: DexId.UNI_V3,
    },
    {
      id: "0x7e928afb59f5de9d2f4d162f754c6eb40c88aa8e",
      chain: 42161,
      dex: DexId.UNI_V3,
    },
    {
      id: "0xa17afcab059f3c6751f5b64347b5a503c3291868",
      chain: 42161,
      dex: DexId.CAMELOT_V3,
    },
    {
      id: "0xab05003a63d2f34ac7eec4670bca3319f0e3d2f62af5c2b9cbd69d03fd804fd2",
      chain: 42161,
      dex: DexId.UNI_V4,
    },
    {
      id: "0x13fd8faf63c1b0dbd44157df1a390224d734bdcf1f60451fb84a8b48dd3d388a",
      chain: 42161,
      dex: DexId.UNI_V4,
    },

    // ---- Base (8453) ----
    {
      id: "0xa41bc0affba7fd420d186b84899d7ab2ac57fcd1",
      chain: 8453,
      dex: DexId.AERO_V3,
    },
    {
      id: "0x5f07bb9fee6062e9d09a52e6d587c64bad6ba706",
      chain: 8453,
      dex: DexId.PCS_V3,
    },

    // ---- HyperEVM (999) ----
    {
      id: "0x94291bea4c3ac9dbe81615083bb9a028722eebec",
      chain: 999,
      dex: DexId.PROJECT_X_V3,
    },
    {
      id: "0x46abbdfc675ffa9ddf032c64fee363745204e63e",
      chain: 999,
      dex: DexId.RAMSES_V3,
    },
    {
      id: "0x7319ac5bb90164191bd236c16000fa3f1c29e456",
      chain: 999,
      dex: DexId.HYBRA_V4,
    },

    // ---- Avalanche (43114) ----
    {
      id: "0x1150403b19315615aad1638d9dd86cd866b2f456",
      chain: 43114,
      dex: DexId.PANGOLIN_V3,
    },
    {
      id: "0x1b39ee86ec5979e1a5f4dba9cfa4ea2cfa638f56",
      chain: 43114,
      dex: DexId.JOE_V2,
    },
    {
      id: "0x804226ca4edb38e7ef56d16d16e92dc3223347a0",
      chain: 43114,
      dex: DexId.UNI_V3,
    },
    {
      id: "0xe2b11d3002a2e49f1005e212e860f3b3ec73f985",
      chain: 43114,
      dex: DexId.JOE_V21,
    },
    {
      id: "0x9b2cc8e6a2bbb56d6be4682891a91b0e48633c72",
      chain: 43114,
      dex: DexId.JOE_V21,
    },
    {
      id: "0x2823299af89285ff1a1abf58db37ce57006fef5d",
      chain: 43114,
      dex: DexId.JOE_V22,
    },
    {
      id: "0x859592a4a469610e573f96ef87a0e5565f9a94c8",
      chain: 43114,
      dex: DexId.BLACKHOLE_V3,
    },
    {
      id: "0x9bfe3108cc16d17a9ec65545a0f50b2ca1c970c0",
      chain: 43114,
      dex: DexId.PHARAOH_V3,
    },
    {
      id: "0x8dc096ecc5cb7565daa9615d6b6b4e6d1ffb3b16cca4e0971dfaf0ed9cb55c63",
      chain: 43114,
      dex: DexId.UNI_V4,
    },

    // ---- Polygon (137) ----
    {
      id: "0xa37d3e6da98dfeb7dc8103a6614f586916a6e04d41ea0a929bc19a029de1a399",
      chain: 137,
      dex: DexId.UNI_V4,
    },
    {
      id: "0xba0c112426423431867d2803c6df4e894ef5875a985e99e85eb5c9dad82ba9af",
      chain: 137,
      dex: DexId.UNI_V4,
    },
    {
      id: "0x56daf0ba2f3a6f8995d4f30a086e1873dc9b509d5adf2462dae264d5f16bab08",
      chain: 137,
      dex: DexId.UNI_V4,
    },
    {
      id: "0xdac8a8e6dbf8c690ec6815e0ff03491b2770255d",
      chain: 137,
      dex: DexId.UNI_V3,
    },
    {
      id: "0x31083a78e11b18e450fd139f9abea98cd53181b7",
      chain: 137,
      dex: DexId.UNI_V3,
    },
    {
      id: "0x7b925e617aefd7fb3a93abe3a701135d7a1ba710",
      chain: 137,
      dex: DexId.QUICKSWAP_V3,
    },
    {
      id: "0x0e3eb2c75bd7dd0e12249d96b1321d9570764d77",
      chain: 137,
      dex: DexId.QUICKSWAP_V3,
    },
  ],
};

/** Check if a V4 pool has a PositionManager on the given chain. */
function hasV4PM(chain: number, family: DexFamily): boolean {
  if (family === DexFamily.PCS_V4) return !!PCS_V4_POSITION_MANAGER[chain];
  if (family === DexFamily.V4) return !!V4_POSITION_MANAGER[chain];
  return false;
}

export function toPoolConfigs(entries: PoolEntry[]): PoolConfig[] {
  return entries
    .filter((e) => {
      const family = getDexFamily(e.dex);

      // V4 pools have bytes32 IDs (66 chars) — check for V4 PositionManager
      if (e.id.length !== 42) {
        if (hasV4PM(e.chain, family)) return true;
        log.debug(`Skipping V4 pool (${e.dex} on chain ${e.chain}): no PositionManager`);
        return false;
      }

      // V3/Algebra/LB pools — check dexes registry for position manager/router
      try {
        const dex = getDex(e.dex);
        if (!dex.positionManager[e.chain]) {
          log.debug(
            `Skipping pool ${e.id.slice(0, 20)}...: no position manager for ${e.dex} on chain ${e.chain}`,
          );
          return false;
        }
        return true;
      } catch {
        log.debug(`Skipping pool ${e.id.slice(0, 20)}...: unsupported DEX "${e.dex}"`);
        return false;
      }
    })
    .map((e) => ({
      address: e.id as `0x${string}`,
      chain: e.chain,
      dex: e.dex,
    }));
}
