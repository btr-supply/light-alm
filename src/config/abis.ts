// Minimal ABI fragments needed for position management, pool queries, and token ops.

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
