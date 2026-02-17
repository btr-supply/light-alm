import type { ChainId, LifiQuote, LifiQuoteParams, SwapResult } from "../types";
import { log, errMsg, RateLimiter } from "../utils";
import { getChain } from "../config/chains";
import { ABIS } from "../config/dexs";
import {
  LIFI_API,
  JUMPER_API,
  LIFI_DIAMOND,
  LIFI_INTEGRATOR,
  DEFAULT_INTEGRATOR,
  JUMPER_RATE_LIMIT_MS,
  LIFI_RATE_LIMIT_MS,
  SWAP_MAX_PRICE_IMPACT,
  SWAP_DEFAULT_SLIPPAGE,
  BRIDGE_TIMEOUT_MS,
  LIFI_SDK_VERSION,
  LIFI_WIDGET_VERSION,
  FETCH_TIMEOUT_MS,
} from "../config/params";
import { sendAndWait, getPublicClient, getAccount, approveIfNeeded } from "./tx";

export type SwapBackend = "jumper" | "lifi";

/** @internal exported for test override */
export const limiters: Record<SwapBackend, RateLimiter> = {
  jumper: new RateLimiter(JUMPER_RATE_LIMIT_MS),
  lifi: new RateLimiter(LIFI_RATE_LIMIT_MS),
};

const JUMPER_HEADERS = {
  "Content-Type": "application/json",
  "x-lifi-integrator": LIFI_INTEGRATOR,
  "x-lifi-sdk": LIFI_SDK_VERSION,
  "x-lifi-widget": LIFI_WIDGET_VERSION,
};

const VERIFY_ABI = {
  extractMainParameters: {
    inputs: [{ name: "data", type: "bytes" }],
    name: "extractMainParameters",
    outputs: [
      { name: "bridge", type: "string" },
      { name: "sendingAssetId", type: "address" },
      { name: "receiver", type: "address" },
      { name: "minAmount", type: "uint256" },
      { name: "destinationChainId", type: "uint256" },
      { name: "hasSourceSwaps", type: "bool" },
      { name: "hasDestinationCall", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  extractGenericSwapParameters: {
    inputs: [{ name: "data", type: "bytes" }],
    name: "extractGenericSwapParameters",
    outputs: [
      { name: "sendingAssetId", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "receivingAssetId", type: "address" },
      { name: "receivingAmount", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
} as const;

// ---- Jumper backend (two-step: routes → stepTransaction, 0% fee) ----

async function fetchJumperQuote(p: LifiQuoteParams): Promise<LifiQuote | null> {
  await limiters.jumper.wait();
  try {
    const res = await fetch(`${JUMPER_API}/routes`, {
      method: "POST",
      headers: JUMPER_HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      body: JSON.stringify({
        fromAmount: p.fromAmount,
        fromChainId: p.fromChain,
        fromTokenAddress: p.fromToken,
        fromAddress: p.fromAddress,
        toChainId: p.toChain,
        toTokenAddress: p.toToken,
        toAddress: p.toAddress,
        options: {
          integrator: LIFI_INTEGRATOR,
          order: "CHEAPEST",
          maxPriceImpact: SWAP_MAX_PRICE_IMPACT,
          slippage: p.slippage ?? SWAP_DEFAULT_SLIPPAGE,
        },
      }),
    });
    if (!res.ok) {
      log.warn(`Jumper routes ${res.status}: ${await res.text()}`);
      return null;
    }

    const body = await res.json();
    const routes = (body as { routes?: unknown[] }).routes;
    if (!routes?.length) {
      log.warn("Jumper: no routes found");
      return null;
    }

    const route = routes[0] as { toAmount?: string; toAmountMin?: string; steps?: unknown[] };
    const step = route.steps?.[0] as
      | {
          type?: string;
          action?: { fromChainId?: number; toChainId?: number; toAddress?: string };
          estimate?: {
            fromAmount?: string;
            toAmount?: string;
            toAmountMin?: string;
            approvalAddress?: string;
            feeCosts?: unknown[];
          };
        }
      | undefined;
    if (!step) {
      log.warn("Jumper: route has no steps");
      return null;
    }
    if (step.estimate?.feeCosts?.length) {
      log.warn("Jumper: unexpected feeCosts present");
      return null;
    }

    // Get transaction calldata
    await limiters.jumper.wait();
    const txRes = await fetch(`${JUMPER_API}/stepTransaction`, {
      method: "POST",
      headers: JUMPER_HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      body: JSON.stringify(step),
    });
    if (!txRes.ok) {
      log.warn(`Jumper stepTransaction ${txRes.status}: ${await txRes.text()}`);
      return null;
    }

    const txStep = (await txRes.json()) as {
      type?: string;
      transactionRequest?: { to: string; data: string; value?: string; gasLimit?: string };
      estimate?: { approvalAddress?: string };
    };
    if (!txStep.transactionRequest) {
      log.warn("Jumper: no transactionRequest in response");
      return null;
    }

    return {
      type: txStep.type ?? step.type ?? "swap",
      transactionRequest: {
        to: txStep.transactionRequest.to,
        data: txStep.transactionRequest.data,
        value: txStep.transactionRequest.value ?? "0",
        gasLimit: txStep.transactionRequest.gasLimit,
      },
      estimate: {
        fromAmount: step.estimate?.fromAmount ?? p.fromAmount,
        toAmount: route.toAmount ?? step.estimate?.toAmount ?? "0",
        toAmountMin: route.toAmountMin ?? step.estimate?.toAmountMin ?? "0",
        approvalAddress:
          txStep.estimate?.approvalAddress ?? step.estimate?.approvalAddress ?? LIFI_DIAMOND,
      },
      action: {
        fromChainId: step.action?.fromChainId ?? p.fromChain,
        toChainId: step.action?.toChainId ?? p.toChain,
        toAddress: step.action?.toAddress ?? p.toAddress,
      },
    };
  } catch (e: unknown) {
    log.warn(`Jumper quote failed: ${errMsg(e)}`);
    return null;
  }
}

// ---- Li.Fi direct backend (single-step, requires API key, 0.25% fee) ----

async function fetchLifiQuote(p: LifiQuoteParams): Promise<LifiQuote | null> {
  await limiters.lifi.wait();
  const qs = new URLSearchParams({
    fromChain: String(p.fromChain),
    toChain: String(p.toChain),
    fromToken: p.fromToken,
    toToken: p.toToken,
    fromAmount: p.fromAmount,
    fromAddress: p.fromAddress,
    toAddress: p.toAddress,
    slippage: String(p.slippage ?? SWAP_DEFAULT_SLIPPAGE),
    integrator: p.integrator ?? process.env.LIFI_INTEGRATOR ?? DEFAULT_INTEGRATOR,
  });

  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = process.env.LIFI_API_KEY;
  if (apiKey) headers["x-lifi-api-key"] = apiKey;

  try {
    const res = await fetch(`${LIFI_API}/quote?${qs}`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      log.warn(`Li.Fi quote ${res.status}: ${await res.text()}`);
      return null;
    }
    return (await res.json()) as LifiQuote;
  } catch (e: unknown) {
    log.warn(`Li.Fi quote failed: ${errMsg(e)}`);
    return null;
  }
}

/**
 * Fetch a swap/bridge quote. Defaults to Jumper (0% fee).
 */
export async function lifiQuote(
  params: LifiQuoteParams,
  backend: SwapBackend = "jumper",
): Promise<LifiQuote | null> {
  return backend === "jumper" ? fetchJumperQuote(params) : fetchLifiQuote(params);
}

/**
 * Verify Li.Fi calldata on-chain via staticcall to CalldataVerificationFacet.
 * Returns true if receiver and destination chain match expectations.
 */
export async function verifyCalldata(
  chainId: ChainId,
  calldata: `0x${string}`,
  expectedReceiver: string,
  expectedDestChain?: ChainId,
): Promise<boolean> {
  const pub = getPublicClient(chainId);
  const receiver = expectedReceiver.toLowerCase();

  try {
    if (expectedDestChain && expectedDestChain !== chainId) {
      const result = (await pub.simulateContract({
        address: LIFI_DIAMOND,
        abi: [VERIFY_ABI.extractMainParameters],
        functionName: "extractMainParameters",
        args: [calldata],
      })) as { result: readonly [string, string, string, bigint, bigint, boolean, boolean] };
      const [, , rxReceiver, , destChainId, , hasDestCall] = result.result;
      if (rxReceiver.toLowerCase() !== receiver) return false;
      if (Number(destChainId) !== expectedDestChain) return false;
      if (hasDestCall) return false;
      return true;
    }
    const result = (await pub.simulateContract({
      address: LIFI_DIAMOND,
      abi: [VERIFY_ABI.extractGenericSwapParameters],
      functionName: "extractGenericSwapParameters",
      args: [calldata],
    })) as { result: readonly [string, bigint, string, string, bigint] };
    const [, , rxReceiver] = result.result;
    return rxReceiver.toLowerCase() === receiver;
  } catch {
    return false;
  }
}

/**
 * Poll destination chain for token arrival after cross-chain swap.
 */
export async function waitForArrival(
  chainId: ChainId,
  token: `0x${string}`,
  account: `0x${string}`,
  balanceBefore: bigint,
  timeoutMs = BRIDGE_TIMEOUT_MS,
  pollMs?: number,
  getBalanceFn: typeof getBalance = getBalance,
): Promise<bigint> {
  const interval = pollMs ?? getChain(chainId).blockTimeMs * 4;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const bal = await getBalanceFn(chainId, token, account);
    if (bal > balanceBefore) return bal;
  }
  throw new Error(`waitForArrival timeout after ${timeoutMs}ms on chain ${chainId}`);
}

/**
 * Swap tokens via Li.Fi Diamond with on-chain calldata verification.
 */
export async function swapTokens(params: {
  fromChain: ChainId;
  toChain: ChainId;
  fromToken: `0x${string}`;
  toToken: `0x${string}`;
  amount: bigint;
  privateKey: `0x${string}`;
  slippage?: number;
  backend?: SwapBackend;
}): Promise<SwapResult | null> {
  const backend = params.backend ?? "jumper";
  const account = getAccount(params.privateKey);

  const quote = await lifiQuote(
    {
      fromChain: params.fromChain,
      toChain: params.toChain,
      fromToken: params.fromToken,
      toToken: params.toToken,
      fromAmount: params.amount.toString(),
      fromAddress: account.address,
      toAddress: account.address,
      slippage: params.slippage,
    },
    backend,
  );
  if (!quote) {
    log.warn("No quote available");
    return null;
  }

  log.info(`Quote [${backend}]: type=${quote.type} toAmount=${quote.estimate.toAmount}`);

  // Approve
  const spender = (quote.estimate.approvalAddress || LIFI_DIAMOND) as `0x${string}`;
  await approveIfNeeded(
    params.fromChain,
    params.fromToken,
    spender,
    params.amount,
    params.privateKey,
  );

  // Verify calldata on-chain
  const isCrossChain = params.fromChain !== params.toChain;
  const verified = await verifyCalldata(
    params.fromChain,
    quote.transactionRequest.data as `0x${string}`,
    account.address,
    isCrossChain ? params.toChain : undefined,
  );
  if (!verified) {
    log.warn("Calldata verification failed — aborting swap");
    return null;
  }

  // Snapshot destination balance before sending (for cross-chain arrival detection)
  let balanceBefore = 0n;
  if (isCrossChain) {
    balanceBefore = await getBalance(params.toChain, params.toToken, account.address);
  }

  // Send source tx
  const result = await sendAndWait(params.fromChain, params.privateKey, {
    to: quote.transactionRequest.to as `0x${string}`,
    data: quote.transactionRequest.data as `0x${string}`,
    value: quote.transactionRequest.value ? BigInt(quote.transactionRequest.value) : undefined,
  });
  if (result.status === "reverted") {
    log.error(`Swap reverted: ${result.hash}`);
    return null;
  }

  let amountOut = BigInt(quote.estimate.toAmountMin);

  // Cross-chain: wait for funds to arrive
  if (isCrossChain) {
    const newBal = await waitForArrival(
      params.toChain,
      params.toToken,
      account.address,
      balanceBefore,
    );
    amountOut = newBal - balanceBefore;
  }

  log.info(`Swap complete: ${result.hash} amountOut=${amountOut}`);
  return { amountOut, sourceTxHash: result.hash };
}

/**
 * Get token balance for an account on a chain.
 */
export async function getBalance(
  chainId: ChainId,
  token: `0x${string}`,
  account: `0x${string}`,
): Promise<bigint> {
  const pub = getPublicClient(chainId);
  return (await pub.readContract({
    address: token,
    abi: [ABIS.erc20.balanceOf],
    functionName: "balanceOf",
    args: [account],
  })) as bigint;
}
