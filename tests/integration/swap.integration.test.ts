import { describe, expect, test } from "bun:test";
import { lifiQuote, type SwapBackend } from "../../src/execution/swap";

// Skip unless INTEGRATION=true - these hit real LiFi/Jumper APIs
const RUN_INTEGRATION = process.env.INTEGRATION === "true";
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip;

const QUOTE_PARAMS = {
  fromChain: 1,
  toChain: 1,
  fromToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
  toToken: "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT
  fromAmount: "1000000", // 1 USDC
  fromAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", // vitalik.eth
  toAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
} as const;

for (const backend of ["jumper", "lifi"] as SwapBackend[]) {
  describeIntegration(`lifiQuote integration [${backend}]`, () => {
    test("fetches a real USDC->USDT quote on Ethereum", async () => {
      const quote = await lifiQuote(QUOTE_PARAMS, backend);

      expect(quote).not.toBeNull();
      expect(quote!.type).toBeTruthy();
      expect(quote!.transactionRequest.to).toBeTruthy();
      expect(quote!.transactionRequest.data).toBeTruthy();
      expect(BigInt(quote!.estimate.toAmount)).toBeGreaterThan(0n);
      expect(BigInt(quote!.estimate.toAmountMin)).toBeGreaterThan(0n);
      expect(quote!.action.fromChainId).toBe(1);
      expect(quote!.action.toChainId).toBe(1);

      console.log(
        `  [${backend}] USDC->USDT: type=${quote!.type} toAmount=${quote!.estimate.toAmount} toAmountMin=${quote!.estimate.toAmountMin}`,
      );
    });

    test("fetches a cross-chain USDC quote (ETH -> ARB)", async () => {
      const quote = await lifiQuote(
        {
          ...QUOTE_PARAMS,
          toChain: 42161,
          toToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC on ARB
          fromAmount: "10000000", // 10 USDC
        },
        backend,
      );

      expect(quote).not.toBeNull();
      expect(quote!.action.fromChainId).toBe(1);
      expect(quote!.action.toChainId).toBe(42161);
      expect(BigInt(quote!.estimate.toAmount)).toBeGreaterThan(0n);

      console.log(
        `  [${backend}] ETH->ARB USDC: type=${quote!.type} toAmount=${quote!.estimate.toAmount}`,
      );
    });
  });
}
