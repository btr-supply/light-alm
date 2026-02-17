import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  type Account,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, bsc, polygon, base, arbitrum, avalanche } from "viem/chains";
import type { ChainId, PairConfig } from "../types";
import { chains, getChain } from "../config/chains";
import { ABIS } from "../config/dexs";
import {
  PERMIT2,
  GAS_BUFFER_NUM,
  GAS_BUFFER_DEN,
  TX_RECEIPT_TIMEOUT_MS,
  MAX_UINT160,
  PERMIT2_EXPIRY_SEC,
} from "../config/params";
import { log, errMsg } from "../utils";

const hyperEvm = defineChain({
  id: 999,
  name: "HyperEVM",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [chains[999].rpc] } },
});

// Shared viem chain objects by chainId (single source of truth)
const VIEM_CHAINS: Record<number, Chain> = {
  1: mainnet,
  56: bsc,
  137: polygon,
  8453: base,
  42161: arbitrum,
  43114: avalanche,
  999: hyperEvm,
};

// Cache clients per (chainId, pk) combo
const publicClients = new Map<number, PublicClient>();
const walletClients = new Map<string, WalletClient>();

// Cache account derivation (keyed by private key for uniqueness)
const accountCache = new Map<string, Account>();

export function getPublicClient(chainId: ChainId): PublicClient {
  if (!publicClients.has(chainId)) {
    const chain = getChain(chainId);
    const viemChain = VIEM_CHAINS[chainId];
    publicClients.set(
      chainId,
      createPublicClient({
        chain: viemChain,
        transport: http(chain.rpc),
      }) as PublicClient,
    );
  }
  return publicClients.get(chainId)!;
}

export function getWalletClient(chainId: ChainId, privateKey: `0x${string}`): WalletClient {
  const account = getAccount(privateKey);
  const key = `${chainId}:${account.address}`;
  if (!walletClients.has(key)) {
    const chain = getChain(chainId);
    const viemChain = VIEM_CHAINS[chainId];
    walletClients.set(
      key,
      createWalletClient({
        account,
        chain: viemChain,
        transport: http(chain.rpc),
      }),
    );
  }
  return walletClients.get(key)!;
}

export function getAccount(privateKey: `0x${string}`): Account {
  if (!accountCache.has(privateKey)) {
    accountCache.set(privateKey, privateKeyToAccount(privateKey));
  }
  return accountCache.get(privateKey)!;
}

export interface TxResult {
  hash: `0x${string}`;
  status: "success" | "reverted";
  gasUsed: bigint;
  gasPrice: bigint;
  logs: readonly {
    topics: readonly `0x${string}`[];
    data: `0x${string}`;
    address: `0x${string}`;
  }[];
}

/**
 * Thrown when eth_call pre-flight simulation reverts.
 * Prevents spending gas on transactions that would fail.
 */
export class SimulationError extends Error {
  constructor(
    public readonly chainId: ChainId,
    public readonly to: `0x${string}`,
    cause: string,
  ) {
    super(`TX simulation reverted on chain ${chainId} to=${to}: ${cause}`);
    this.name = "SimulationError";
  }
}

/**
 * Send a transaction with pre-flight eth_call simulation, gas buffer, and receipt polling.
 * Simulation catches reverts before spending gas. Gas buffer prevents out-of-gas on complex calls.
 */

export async function sendAndWait(
  chainId: ChainId,
  privateKey: `0x${string}`,
  tx: { to: `0x${string}`; data: `0x${string}`; value?: bigint },
): Promise<TxResult> {
  const wallet = getWalletClient(chainId, privateKey);
  const pub = getPublicClient(chainId);
  const account = wallet.account!;
  const value = tx.value ?? 0n;

  const callParams = { account, to: tx.to, data: tx.data, value } as const;

  // Pre-flight: eth_call simulation catches reverts before spending gas
  let gasEstimate: bigint;
  try {
    await pub.call(callParams);
    gasEstimate = await pub.estimateGas(callParams);
  } catch (e: unknown) {
    throw new SimulationError(chainId, tx.to, errMsg(e));
  }

  const gas = (gasEstimate * GAS_BUFFER_NUM) / GAS_BUFFER_DEN;

  const hash = await wallet.sendTransaction({
    to: tx.to,
    data: tx.data,
    value,
    gas,
    account,
    chain: wallet.chain,
  });

  log.info(`TX sent: ${hash} on chain ${chainId} (gas=${gas})`);

  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT_MS });
  const status = receipt.status === "success" ? "success" : "reverted";
  log.info(`TX ${status}: ${hash} gasUsed=${receipt.gasUsed}/${gas}`);

  return {
    hash,
    status,
    gasUsed: receipt.gasUsed,
    gasPrice: receipt.effectiveGasPrice ?? 0n,
    logs: receipt.logs.map((l) => ({ topics: l.topics, data: l.data, address: l.address })),
  };
}

/**
 * Approve token spending if current allowance is insufficient.
 */
export async function approveIfNeeded(
  chainId: ChainId,
  token: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint,
  privateKey: `0x${string}`,
) {
  const pub = getPublicClient(chainId);
  const account = getAccount(privateKey);
  const allowance = (await pub.readContract({
    address: token,
    abi: [ABIS.erc20.allowance],
    functionName: "allowance",
    args: [account.address, spender],
  })) as bigint;
  if (allowance < amount) {
    const data = encodeFunctionData({
      abi: [ABIS.erc20.approve],
      functionName: "approve",
      args: [spender, amount * 2n],
    });
    await sendAndWait(chainId, privateKey, { to: token, data });
    log.debug(`Approved ${token} for ${spender}`);
  }
}

/**
 * Approve a token via Permit2 (used by V4 PositionManagers).
 * Step 1: ERC20 approve to Permit2 contract.
 * Step 2: Permit2.approve(token, spender, amount, expiration).
 */
async function approveViaPermit2(
  chainId: ChainId,
  token: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint,
  privateKey: `0x${string}`,
) {
  // Step 1: Approve Permit2 to pull tokens
  await approveIfNeeded(chainId, token, PERMIT2, amount, privateKey);

  // Step 2: Set Permit2 allowance for the spender
  const pub = getPublicClient(chainId);
  const account = getAccount(privateKey);
  const [currentAmount, expiration] = (await pub.readContract({
    address: PERMIT2,
    abi: [ABIS.permit2.allowance],
    functionName: "allowance",
    args: [account.address, token, spender],
  })) as [bigint, number, number];

  const now = Math.floor(Date.now() / 1000);
  const p2Amount = amount > MAX_UINT160 ? MAX_UINT160 : amount;
  if (currentAmount < p2Amount || expiration < now) {
    const data = encodeFunctionData({
      abi: [ABIS.permit2.approve],
      functionName: "approve",
      args: [token, spender, p2Amount, now + PERMIT2_EXPIRY_SEC],
    });
    await sendAndWait(chainId, privateKey, { to: PERMIT2, data });
    log.debug(`Permit2 approved ${token} for ${spender}`);
  }
}

type ApprovalStrategy = "erc20" | "permit2";

/**
 * Approve both tokens of a pair sequentially (avoids nonce collisions).
 * Uses ERC20 direct approval or Permit2 depending on strategy.
 */
export async function approveTokenPair(
  pair: PairConfig,
  chain: ChainId,
  spender: `0x${string}`,
  amount0: bigint,
  amount1: bigint,
  privateKey: `0x${string}`,
  strategy: ApprovalStrategy = "erc20",
): Promise<void> {
  const approve = strategy === "permit2" ? approveViaPermit2 : approveIfNeeded;
  await approve(chain, pair.token0.addresses[chain], spender, amount0, privateKey);
  await approve(chain, pair.token1.addresses[chain], spender, amount1, privateKey);
}

/** Require a non-nullish address, throwing a descriptive error if missing. */
export function requireAddress(addr: `0x${string}` | undefined, label: string): `0x${string}` {
  if (!addr) throw new Error(`Missing address: ${label}`);
  return addr;
}
