import { type DexId, type DexFamily, DexId as DI, DexFamily as DF } from "../types";

// Minimal ABI fragments needed for position management
export const ABIS = {
  univ3: {
    // NonfungiblePositionManager
    mint: {
      inputs: [
        {
          name: "params",
          type: "tuple",
          components: [
            { name: "token0", type: "address" },
            { name: "token1", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "tickLower", type: "int24" },
            { name: "tickUpper", type: "int24" },
            { name: "amount0Desired", type: "uint256" },
            { name: "amount1Desired", type: "uint256" },
            { name: "amount0Min", type: "uint256" },
            { name: "amount1Min", type: "uint256" },
            { name: "recipient", type: "address" },
            { name: "deadline", type: "uint256" },
          ],
        },
      ],
      name: "mint",
      outputs: [
        { name: "tokenId", type: "uint256" },
        { name: "liquidity", type: "uint128" },
        { name: "amount0", type: "uint256" },
        { name: "amount1", type: "uint256" },
      ],
      stateMutability: "payable",
      type: "function",
    },
    decreaseLiquidity: {
      inputs: [
        {
          name: "params",
          type: "tuple",
          components: [
            { name: "tokenId", type: "uint256" },
            { name: "liquidity", type: "uint128" },
            { name: "amount0Min", type: "uint256" },
            { name: "amount1Min", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
      ],
      name: "decreaseLiquidity",
      outputs: [
        { name: "amount0", type: "uint256" },
        { name: "amount1", type: "uint256" },
      ],
      stateMutability: "payable",
      type: "function",
    },
    collect: {
      inputs: [
        {
          name: "params",
          type: "tuple",
          components: [
            { name: "tokenId", type: "uint256" },
            { name: "recipient", type: "address" },
            { name: "amount0Max", type: "uint128" },
            { name: "amount1Max", type: "uint128" },
          ],
        },
      ],
      name: "collect",
      outputs: [
        { name: "amount0", type: "uint256" },
        { name: "amount1", type: "uint256" },
      ],
      stateMutability: "payable",
      type: "function",
    },
    positions: {
      inputs: [{ name: "tokenId", type: "uint256" }],
      name: "positions",
      outputs: [
        { name: "nonce", type: "uint96" },
        { name: "operator", type: "address" },
        { name: "token0", type: "address" },
        { name: "token1", type: "address" },
        { name: "fee", type: "uint24" },
        { name: "tickLower", type: "int24" },
        { name: "tickUpper", type: "int24" },
        { name: "liquidity", type: "uint128" },
        { name: "feeGrowthInside0LastX128", type: "uint256" },
        { name: "feeGrowthInside1LastX128", type: "uint256" },
        { name: "tokensOwed0", type: "uint128" },
        { name: "tokensOwed1", type: "uint128" },
      ],
      stateMutability: "view",
      type: "function",
    },
  },
  pool: {
    slot0: {
      inputs: [],
      name: "slot0",
      outputs: [
        { name: "sqrtPriceX96", type: "uint160" },
        { name: "tick", type: "int24" },
        { name: "observationIndex", type: "uint16" },
        { name: "observationCardinality", type: "uint16" },
        { name: "observationCardinalityNext", type: "uint16" },
        { name: "feeProtocol", type: "uint8" },
        { name: "unlocked", type: "bool" },
      ],
      stateMutability: "view",
      type: "function",
    },
    fee: {
      inputs: [],
      name: "fee",
      outputs: [{ name: "", type: "uint24" }],
      stateMutability: "view",
      type: "function",
    },
    liquidity: {
      inputs: [],
      name: "liquidity",
      outputs: [{ name: "", type: "uint128" }],
      stateMutability: "view",
      type: "function",
    },
    // Algebra-style globalState (dynamic fee)
    globalState: {
      inputs: [],
      name: "globalState",
      outputs: [
        { name: "price", type: "uint160" },
        { name: "tick", type: "int24" },
        { name: "fee", type: "uint16" },
        { name: "timepointIndex", type: "uint16" },
        { name: "communityFeeToken0", type: "uint8" },
        { name: "communityFeeToken1", type: "uint8" },
        { name: "unlocked", type: "bool" },
      ],
      stateMutability: "view",
      type: "function",
    },
    token0: {
      inputs: [],
      name: "token0",
      outputs: [{ name: "", type: "address" }],
      stateMutability: "view",
      type: "function",
    },
    token1: {
      inputs: [],
      name: "token1",
      outputs: [{ name: "", type: "address" }],
      stateMutability: "view",
      type: "function",
    },
    tickSpacing: {
      inputs: [],
      name: "tickSpacing",
      outputs: [{ name: "", type: "int24" }],
      stateMutability: "view",
      type: "function",
    },
    // Aerodrome slot0 (6 returns, no feeProtocol)
    aeroSlot0: {
      inputs: [],
      name: "slot0",
      outputs: [
        { name: "sqrtPriceX96", type: "uint160" },
        { name: "tick", type: "int24" },
        { name: "observationIndex", type: "uint16" },
        { name: "observationCardinality", type: "uint16" },
        { name: "observationCardinalityNext", type: "uint16" },
        { name: "unlocked", type: "bool" },
      ],
      stateMutability: "view",
      type: "function",
    },
  },
  // V4 StateView
  v4: {
    getSlot0: {
      inputs: [{ name: "poolId", type: "bytes32" }],
      name: "getSlot0",
      outputs: [
        { name: "sqrtPriceX96", type: "uint160" },
        { name: "tick", type: "int24" },
        { name: "protocolFee", type: "uint24" },
        { name: "lpFee", type: "uint24" },
      ],
      stateMutability: "view",
      type: "function",
    },
    getLiquidity: {
      inputs: [{ name: "poolId", type: "bytes32" }],
      name: "getLiquidity",
      outputs: [{ name: "", type: "uint128" }],
      stateMutability: "view",
      type: "function",
    },
    getTickSpacing: {
      inputs: [{ name: "poolId", type: "bytes32" }],
      name: "getTickSpacing",
      outputs: [{ name: "", type: "int24" }],
      stateMutability: "view",
      type: "function",
    },
  },
  // LB (ILBPair)
  lb: {
    getTokenX: {
      inputs: [],
      name: "getTokenX",
      outputs: [{ name: "", type: "address" }],
      stateMutability: "view",
      type: "function",
    },
    getTokenY: {
      inputs: [],
      name: "getTokenY",
      outputs: [{ name: "", type: "address" }],
      stateMutability: "view",
      type: "function",
    },
    getActiveId: {
      inputs: [],
      name: "getActiveId",
      outputs: [{ name: "", type: "uint24" }],
      stateMutability: "view",
      type: "function",
    },
    getBinStep: {
      inputs: [],
      name: "getBinStep",
      outputs: [{ name: "", type: "uint16" }],
      stateMutability: "view",
      type: "function",
    },
    getReserves: {
      inputs: [],
      name: "getReserves",
      outputs: [
        { name: "reserveX", type: "uint128" },
        { name: "reserveY", type: "uint128" },
      ],
      stateMutability: "view",
      type: "function",
    },
  },
  // Algebra NonfungiblePositionManager (no fee field in mint/positions)
  algebra: {
    mint: {
      inputs: [
        {
          name: "params",
          type: "tuple",
          components: [
            { name: "token0", type: "address" },
            { name: "token1", type: "address" },
            { name: "tickLower", type: "int24" },
            { name: "tickUpper", type: "int24" },
            { name: "amount0Desired", type: "uint256" },
            { name: "amount1Desired", type: "uint256" },
            { name: "amount0Min", type: "uint256" },
            { name: "amount1Min", type: "uint256" },
            { name: "recipient", type: "address" },
            { name: "deadline", type: "uint256" },
          ],
        },
      ],
      name: "mint",
      outputs: [
        { name: "tokenId", type: "uint256" },
        { name: "liquidity", type: "uint128" },
        { name: "amount0", type: "uint256" },
        { name: "amount1", type: "uint256" },
      ],
      stateMutability: "payable",
      type: "function",
    },
    positions: {
      inputs: [{ name: "tokenId", type: "uint256" }],
      name: "positions",
      outputs: [
        { name: "nonce", type: "uint96" },
        { name: "operator", type: "address" },
        { name: "token0", type: "address" },
        { name: "token1", type: "address" },
        { name: "tickLower", type: "int24" },
        { name: "tickUpper", type: "int24" },
        { name: "liquidity", type: "uint128" },
        { name: "feeGrowthInside0LastX128", type: "uint256" },
        { name: "feeGrowthInside1LastX128", type: "uint256" },
        { name: "tokensOwed0", type: "uint128" },
        { name: "tokensOwed1", type: "uint128" },
      ],
      stateMutability: "view",
      type: "function",
    },
  },
  // Permit2 (used by V4 PositionManagers)
  permit2: {
    approve: {
      inputs: [
        { name: "token", type: "address" },
        { name: "spender", type: "address" },
        { name: "amount", type: "uint160" },
        { name: "expiration", type: "uint48" },
      ],
      name: "approve",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    },
    allowance: {
      inputs: [
        { name: "owner", type: "address" },
        { name: "token", type: "address" },
        { name: "spender", type: "address" },
      ],
      name: "allowance",
      outputs: [
        { name: "amount", type: "uint160" },
        { name: "expiration", type: "uint48" },
        { name: "nonce", type: "uint48" },
      ],
      stateMutability: "view",
      type: "function",
    },
  },
  // LB Router ABIs (used by positions-lb.ts)
  lbRouter: {
    addLiquidity: {
      inputs: [
        {
          name: "liquidityParameters",
          type: "tuple",
          components: [
            { name: "tokenX", type: "address" },
            { name: "tokenY", type: "address" },
            { name: "binStep", type: "uint256" },
            { name: "amountX", type: "uint256" },
            { name: "amountY", type: "uint256" },
            { name: "amountXMin", type: "uint256" },
            { name: "amountYMin", type: "uint256" },
            { name: "activeIdDesired", type: "uint256" },
            { name: "idSlippage", type: "uint256" },
            { name: "deltaIds", type: "int256[]" },
            { name: "distributionX", type: "uint256[]" },
            { name: "distributionY", type: "uint256[]" },
            { name: "to", type: "address" },
            { name: "refundTo", type: "address" },
            { name: "deadline", type: "uint256" },
          ],
        },
      ],
      name: "addLiquidity",
      outputs: [
        { name: "amountXAdded", type: "uint256" },
        { name: "amountYAdded", type: "uint256" },
        { name: "amountXLeft", type: "uint256" },
        { name: "amountYLeft", type: "uint256" },
        { name: "depositIds", type: "uint256[]" },
        { name: "liquidityMinted", type: "uint256[]" },
      ],
      stateMutability: "nonpayable",
      type: "function",
    },
    removeLiquidity: {
      inputs: [
        { name: "tokenX", type: "address" },
        { name: "tokenY", type: "address" },
        { name: "binStep", type: "uint16" },
        { name: "amountXMin", type: "uint256" },
        { name: "amountYMin", type: "uint256" },
        { name: "ids", type: "uint256[]" },
        { name: "amounts", type: "uint256[]" },
        { name: "to", type: "address" },
        { name: "deadline", type: "uint256" },
      ],
      name: "removeLiquidity",
      outputs: [
        { name: "amountX", type: "uint256" },
        { name: "amountY", type: "uint256" },
      ],
      stateMutability: "nonpayable",
      type: "function",
    },
    approveForAll: {
      inputs: [
        { name: "spender", type: "address" },
        { name: "approved", type: "bool" },
      ],
      name: "approveForAll",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    },
    isApprovedForAll: {
      inputs: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
      ],
      name: "isApprovedForAll",
      outputs: [{ name: "", type: "bool" }],
      stateMutability: "view",
      type: "function",
    },
    balanceOf: {
      inputs: [
        { name: "account", type: "address" },
        { name: "id", type: "uint256" },
      ],
      name: "balanceOf",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
  },
  // V4 PositionManager ABIs (used by positions-v4.ts)
  v4pm: {
    modifyLiquidities: {
      inputs: [
        { name: "unlockData", type: "bytes" },
        { name: "deadline", type: "uint256" },
      ],
      name: "modifyLiquidities",
      outputs: [],
      stateMutability: "payable",
      type: "function",
    },
  },
  // V4 PoolKey tuple components for ABI encoding
  v4PoolKey: {
    uni: [
      { name: "currency0", type: "address" },
      { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "hooks", type: "address" },
    ] as const,
    pcs: [
      { name: "currency0", type: "address" },
      { name: "currency1", type: "address" },
      { name: "hooks", type: "address" },
      { name: "poolManager", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "parameters", type: "bytes32" },
    ] as const,
  },
  erc20: {
    approve: {
      inputs: [
        { name: "spender", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      name: "approve",
      outputs: [{ name: "", type: "bool" }],
      stateMutability: "nonpayable",
      type: "function",
    },
    allowance: {
      inputs: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
      ],
      name: "allowance",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
    balanceOf: {
      inputs: [{ name: "account", type: "address" }],
      name: "balanceOf",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
  },
} as const;

// DEX registry: slug -> type + chain-specific addresses
interface DEXEntry {
  type: "univ3" | "algebra" | "lb";
  positionManager: Record<number, `0x${string}`>;
}

export const dexes: Record<string, DEXEntry> = {
  [DI.UNI_V3]: {
    type: "univ3",
    positionManager: {
      1: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
      56: "0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613",
      137: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
      8453: "0x03a520b32C04BF3bEEf7BEb72E583e6d4ef98D81",
      42161: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
      43114: "0x655C406EBFa14EE2006250925e54ec43AD184f8B",
    },
  },
  [DI.PCS_V3]: {
    type: "univ3",
    positionManager: {
      1: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
      56: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
      8453: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
      42161: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
    },
  },
  [DI.AERO_V3]: {
    type: "univ3",
    positionManager: {
      8453: "0x827922686190790b37229fd06084350E74485b72",
    },
  },
  [DI.CAMELOT_V3]: {
    type: "algebra",
    positionManager: {
      42161: "0x00c7f3082833e796A5b3e4Bd59f6642FF44DCD15",
    },
  },
  [DI.QUICKSWAP_V3]: {
    type: "algebra",
    positionManager: {
      137: "0x8eF88E4c7CfbbaC1C163f7eddd4B578792201de6",
    },
  },
  [DI.RAMSES_V3]: {
    type: "univ3",
    positionManager: {
      42161: "0xAA277CB7914b7e5514946Da92cb9De332Ce610EF",
      999: "0xB3F77C5134D643483253D22E0Ca24627aE42ED51",
    },
  },
  [DI.PANGOLIN_V3]: {
    type: "univ3",
    positionManager: {
      43114: "0xf40937279F38D0c1f97aFA5919F1cB3cB7f06A7F",
    },
  },
  [DI.BLACKHOLE_V3]: {
    type: "algebra",
    positionManager: {
      43114: "0x3fED017EC0f5517Cdf2E8a9a4156c64d74252146",
    },
  },
  [DI.PHARAOH_V3]: {
    type: "univ3",
    positionManager: {
      43114: "0xAAA78E8C4241990B4ce159E105dA08129345946A",
    },
  },
  [DI.PROJECT_X_V3]: {
    type: "univ3",
    positionManager: {
      999: "0xead19ae861c29bbb2101e834922b2feee69b9091",
    },
  },
  [DI.JOE_V2]: {
    type: "lb",
    positionManager: {
      // LB router addresses
      43114: "0xE3Ffc583dC176575eEA7FD9dF2A7c65F7E23f4C3",
    },
  },
  [DI.JOE_V21]: {
    type: "lb",
    positionManager: {
      43114: "0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30",
    },
  },
  [DI.JOE_V22]: {
    type: "lb",
    positionManager: {
      43114: "0x18556DA13313f3532c54711497A8FedAC273220E",
    },
  },
};

export const getDex = (slug: string) => {
  const d = dexes[slug];
  if (!d) throw new Error(`Unknown DEX: ${slug}`);
  return d;
};

// ---- V4 lens contracts ----

export const V4_STATE_VIEW: Record<number, `0x${string}`> = {
  1: "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
  56: "0xd13dd3d6e93f276fafc9db9e6bb47c1180aee0c4",
  137: "0x5ea1bd7974c8a611cbab0bdcafcb1d9cc9b3ba5a",
  8453: "0xa3c0c9b65bad0b08107aa264b0f3db444b867a71",
  42161: "0x76fd297e2d437cd7f76d50f01afe6160f86e9990",
  43114: "0x3e3964d45ba7e79f3adbb832ceff5123f93a4740",
  999: "0x4b7e47e47b5d35dbc1c0b3eb1e5e49b42578a8a0",
};

export const PCS_V4_CL_MANAGER: Record<number, `0x${string}`> = {
  56: "0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b",
};

// ---- V4 PositionManager contracts ----

export const V4_POSITION_MANAGER: Record<number, `0x${string}`> = {
  1: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e",
  56: "0x7a4a5c919ae2541aed11041a1aeee68f1287f95b",
  137: "0x1ec2ebf4f37e7363fdfe3551602425af0b3ceef9",
  8453: "0x7c5f5a4bbd8fd63184577525326123b519429bdc",
  42161: "0xd88f38f930b7952f2db2432cb002e7abbf3dd869",
  43114: "0xb74b1f14d2754acfcbbe1a221023a5cf50ab8acd",
};

export const PCS_V4_POSITION_MANAGER: Record<number, `0x${string}`> = {
  56: "0x55f4c8abA71A1e923edC303eb4fEfF14608cC226",
};

// ---- DexId → DexFamily mapping ----

export const DEX_FAMILY: Record<DexId, DexFamily> = {
  [DI.UNI_V3]: DF.V3,
  [DI.PCS_V3]: DF.V3,
  [DI.PANGOLIN_V3]: DF.V3,
  [DI.BLACKHOLE_V3]: DF.ALGEBRA,
  [DI.PHARAOH_V3]: DF.V3,
  [DI.PROJECT_X_V3]: DF.V3,
  [DI.RAMSES_V3]: DF.V3,
  [DI.AERO_V3]: DF.AERODROME,
  [DI.CAMELOT_V3]: DF.ALGEBRA,
  [DI.QUICKSWAP_V3]: DF.ALGEBRA,
  [DI.UNI_V4]: DF.V4,
  [DI.HYBRA_V4]: DF.V4,
  [DI.PCS_V4]: DF.PCS_V4,
  [DI.JOE_V2]: DF.LB,
  [DI.JOE_V21]: DF.LB,
  [DI.JOE_V22]: DF.LB,
};

export const getDexFamily = (id: DexId): DexFamily => DEX_FAMILY[id];
