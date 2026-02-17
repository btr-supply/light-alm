import type { TokenConfig } from "../types";

export const USDC: TokenConfig = {
  symbol: "USDC",
  decimals: 6,
  chainDecimals: { 56: 18 },
  addresses: {
    1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    56: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    137: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    43114: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    999: "0x6B2e0fACD2B7c26Ea603639d4c1A5fafCBBf5053",
  },
};

export const USDT: TokenConfig = {
  symbol: "USDT",
  decimals: 6,
  chainDecimals: { 56: 18 },
  addresses: {
    1: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    56: "0x55d398326f99059fF775485246999027B3197955",
    137: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    8453: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    42161: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    43114: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7",
    // HyperEVM (999): USDT not yet deployed — omitted to prevent zero-address operations
  },
};

export const TOKENS: Record<string, TokenConfig> = {
  USDC,
  USDT,
  "USDC.e": {
    symbol: "USDC.e",
    decimals: 6,
    addresses: {
      42161: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
      43114: "0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664",
      137: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    },
  },
  "USDT.e": {
    symbol: "USDT.e",
    decimals: 6,
    addresses: { 43114: "0xc7198437980c041c805A1EDcbA50c1Ce5db95118" },
  },
};

export function tokenDecimals(token: TokenConfig, chain: number): number {
  return token.chainDecimals?.[chain] ?? token.decimals;
}

export function computeEntryValueUsd(
  pair: { token0: TokenConfig; token1: TokenConfig },
  chain: number,
  amount0: bigint,
  amount1: bigint,
): number {
  return (
    Number(amount0) / 10 ** tokenDecimals(pair.token0, chain) +
    Number(amount1) / 10 ** tokenDecimals(pair.token1, chain)
  );
}
