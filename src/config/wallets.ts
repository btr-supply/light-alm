/**
 * EOA addresses per trading pair.
 *
 * Each pair uses a dedicated EOA (private key in env as PK_<PAIR>).
 * This registry provides the public addresses for balance checks,
 * monitoring, and read-only operations without requiring the private key.
 */

export const EOA_ADDRESSES: Record<string, `0x${string}`> = {
  "USDC-USDT": "0xaAA7421390813c8c6bC7c8338D837Cf4Fe3F0adA",
  "WETH-USDC": "0xd7579c0Ced2D3F8aa3664bB0Bc8B725C9B653295",
  "WBTC-USDC": "0x8EB26ceB49a67eC312814bA4B3533ae838A21D8A",
  "BNB-USDC": "0xB5213347942962cd5264e45Fbd5C2626220e5151",
  "ETH-BTC": "0xD2f0f88b28CFf123edfE3Fd378bF4616d8991d9A",
  "BNB-ETH": "0x7564624bd60766B58c877e53e7e3fcD11E2eA6aC",
};
