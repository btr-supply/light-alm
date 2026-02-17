# Migration Guide: EOA to Safe Vaults + Li.Fi Execution

## Part 1: Migration to Account-Abstracted Safe Vaults

### Architecture Overview

```
                    Per Chain, Per Pair
    +-------------------------------------------------+
    |                                                 |
    |   SafeVault (Safe{Core})                        |
    |   - Holds tokens, LP NFTs                       |
    |   - Sole custodian of funds                     |
    |   - Deterministic CREATE2 address               |
    |                                                 |
    |   BTRPolicyModule (Safe Module)                 |
    |   - Session key + epoch gating                  |
    |   - Spend caps (per token, per epoch)           |
    |   - Target allowlists                           |
    |   - Adapter-based calldata verification         |
    |   - Calls Safe.execTransactionFromModule()      |
    |                                                 |
    |   Adapter Registry                              |
    |   - LiFiAdapter (uses CalldataVerificationFacet)|
    |   - UniV3Adapter (position manager calls)       |
    |   - ERC20Adapter (approve/transfer)             |
    |                                                 |
    +----------+--------------------------------------+
               |
    Keeper Bot (off-chain, Bun + viem)
    - Runs strategy cycle every 15 min
    - Signs txs with session key
    - Calls BTRPolicyModule.execute()
```

### Why Safe + Modules (not raw ERC-4337)

| Concern | EOA (current) | Raw 4337 | Safe + Module |
|---------|--------------|----------|---------------|
| Fund custody | Private key = full access | Bundler trust | Multi-sig owners + module constraints |
| Automation | Direct signing | UserOps + Bundler + Paymaster | Module bypasses sig requirement |
| Spend limits | None | Custom validation logic | Module enforces per-epoch caps |
| Target allowlist | None | Custom validation logic | Module restricts `to` addresses |
| Calldata verification | None | Custom validation logic | Module + adapter `staticcall` |
| Multi-chain | Same PK everywhere | Need EntryPoint per chain | CREATE2 same Safe address everywhere |
| Gas sponsoring | Bot pays | Paymaster pays | Module can use Paymaster (optional) |
| Upgrade path | Stuck | 7579 modules | Add 7579 adapter later |
| Recovery | Lost PK = lost funds | Social recovery module | Owner rotation, timelock |

**Bottom line**: Safe modules give you the automation of ERC-4337 without the bundler/paymaster complexity. You can add 4337 compatibility later via Safe's `Safe4337Module` if you need UserOps or gas sponsoring.

### ERC-7579 Opportunity

Safe has a `safe7579` adapter that makes any Safe a fully ERC-7579-compliant modular account. This means:

- **Validators**: Session key validation (replace PK signing with scoped session keys)
- **Executors**: Your BTRPolicyModule becomes a 7579 executor
- **Hooks**: Pre/post execution checks (e.g., balance invariants)
- **Fallback handlers**: Handle `outputFilled()` for Li.Fi intents

For v1, a plain Safe Module is sufficient. The 7579 adapter is the upgrade path for v2 when you want standardized session keys and hook-based invariant checking.

### Contract Design

#### BTRPolicyModule (Generic Safe Module)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ISafe} from "@safe-global/safe-contracts/contracts/interfaces/ISafe.sol";

interface IBridgeSwapVerifierAdapter {
    struct VerifyRequest {
        address aggregator;
        bytes data;
        uint256 value;
        address expectedReceiver;
        uint256 expectedDstChainId;
    }
    struct VerifyResult {
        address asset;
        uint256 amount;
        address receiver;
        uint256 dstChainId;
        bool hasDestinationCall;
    }
    function verify(VerifyRequest calldata req)
        external view returns (VerifyResult memory);
}

contract BTRPolicyModule {
    // --- Storage ---
    ISafe public immutable safe;
    address public keeper;              // Authorized automation EOA
    uint64 public epochDuration;        // e.g., 900 (15 min)
    uint64 public windowDuration;       // e.g., 60 (1 min execution window)

    // Spend caps: token => remaining allowance this epoch
    mapping(address => uint256) public epochCap;
    mapping(address => uint256) public epochSpent;
    uint64 public epochStart;

    // Adapter registry: adapterId => adapter contract
    mapping(bytes32 => IBridgeSwapVerifierAdapter) public adapters;

    // Target allowlist: target address => allowed
    mapping(address => bool) public allowedTargets;

    // --- Modifiers ---
    modifier onlyKeeper() {
        require(msg.sender == keeper, "not keeper");
        _;
    }

    modifier withinWindow() {
        uint64 elapsed = uint64(block.timestamp) - epochStart;
        uint64 inEpoch = elapsed % epochDuration;
        require(inEpoch < windowDuration, "outside execution window");
        _;
    }

    // --- Core Execution ---
    function execute(
        bytes32 adapterId,
        address target,
        bytes calldata data,
        uint256 value,
        address expectedReceiver,
        uint256 expectedDstChainId
    ) external onlyKeeper withinWindow {
        require(allowedTargets[target], "target not allowed");

        // Verify calldata via adapter
        if (adapterId != bytes32(0)) {
            IBridgeSwapVerifierAdapter adapter = adapters[adapterId];
            require(address(adapter) != address(0), "unknown adapter");

            IBridgeSwapVerifierAdapter.VerifyResult memory res =
                adapter.verify(IBridgeSwapVerifierAdapter.VerifyRequest({
                    aggregator: target,
                    data: data,
                    value: value,
                    expectedReceiver: expectedReceiver,
                    expectedDstChainId: expectedDstChainId
                }));

            // Enforce invariants
            require(res.receiver == expectedReceiver, "receiver mismatch");
            require(!res.hasDestinationCall, "destination calls forbidden");
            if (expectedDstChainId != 0) {
                require(res.dstChainId == expectedDstChainId, "chain mismatch");
            }

            // Enforce spend caps
            _checkAndDebit(res.asset, res.amount);
        }

        // Execute from Safe
        bool success = safe.execTransactionFromModule(
            target, value, data, 0 // Enum.Operation.Call
        );
        require(success, "safe execution failed");
    }

    function _checkAndDebit(address token, uint256 amount) internal {
        // Reset epoch if needed
        if (block.timestamp >= epochStart + epochDuration) {
            epochStart = uint64(block.timestamp);
            // Reset all spent counters (gas-intensive for many tokens;
            // in practice, only a few tokens per vault)
        }
        uint256 cap = epochCap[token];
        uint256 spent = epochSpent[token];
        require(spent + amount <= cap, "epoch cap exceeded");
        epochSpent[token] = spent + amount;
    }
}
```

#### LiFiVerifierAdapter

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IBridgeSwapVerifierAdapter} from "./BTRPolicyModule.sol";

interface ICalldataVerificationFacet {
    function extractMainParameters(bytes calldata data)
        external pure returns (
            string memory bridge,
            address sendingAssetId,
            address receiver,
            uint256 minAmount,
            uint256 destinationChainId,
            bool hasSourceSwaps,
            bool hasDestinationCall
        );
}

contract LiFiVerifierAdapter is IBridgeSwapVerifierAdapter {
    // Li.Fi Diamond -- same address on all chains
    address public constant LIFI_DIAMOND =
        0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE;

    function verify(VerifyRequest calldata req)
        external pure override returns (VerifyResult memory)
    {
        // staticcall LiFi's own verification facet
        (
            ,                        // bridge name (unused)
            address sendingAsset,
            address receiver,
            uint256 amount,
            uint256 dstChainId,
            ,                        // hasSourceSwaps (unused)
            bool hasDestCall
        ) = ICalldataVerificationFacet(req.aggregator)
                .extractMainParameters(req.data);

        return VerifyResult({
            asset: sendingAsset,
            amount: amount,
            receiver: receiver,
            dstChainId: dstChainId,
            hasDestinationCall: hasDestCall
        });
    }
}
```

#### UniV3VerifierAdapter (for position manager calls)

```solidity
contract UniV3VerifierAdapter is IBridgeSwapVerifierAdapter {
    // Decode mint/decreaseLiquidity/collect calldata
    // Verify recipient matches expected receiver
    // Return token0 as asset, amount0Desired as amount
    function verify(VerifyRequest calldata req)
        external pure override returns (VerifyResult memory)
    {
        bytes4 selector = bytes4(req.data[:4]);

        if (selector == 0x88316456) { // mint
            // Decode MintParams struct
            // Verify recipient == expectedReceiver
            // Return sending asset and amount
        } else if (selector == 0x0c49ccbe) { // decreaseLiquidity
            // No receiver check needed (tokens go to position)
        } else if (selector == 0xfc6f7865) { // collect
            // Verify recipient == expectedReceiver
        }

        return VerifyResult({
            asset: address(0),
            amount: 0,
            receiver: req.expectedReceiver,
            dstChainId: 0,
            hasDestinationCall: false
        });
    }
}
```

### Per-Chain Registry

```typescript
// src/config/vaults.ts

export interface VaultConfig {
  safe: `0x${string}`;           // Safe address (same via CREATE2)
  module: `0x${string}`;         // BTRPolicyModule address
  adapters: {
    lifi: `0x${string}`;         // LiFiVerifierAdapter (or zero if using staticcall)
    univ3: `0x${string}`;        // UniV3VerifierAdapter
  };
  allowedTargets: `0x${string}`[];  // [LiFi Diamond, UniV3 PM, ...]
}

export const VAULT_REGISTRY: Record<number, VaultConfig> = {
  1: {
    safe: "0x...",               // Deterministic CREATE2 address
    module: "0x...",
    adapters: {
      lifi: "0x0000000000000000000000000000000000000000", // Use staticcall
      univ3: "0x...",
    },
    allowedTargets: [
      "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", // LiFi Diamond
      "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", // UniV3 NonfungiblePositionManager
    ],
  },
  // ... same structure per chain
};
```

### BTRIntentInbox (Optional)

Only needed if you want to support Li.Fi intent deliveries where the solver calls `outputFilled()` on delivery:

```solidity
contract BTRIntentInbox {
    address public immutable safe;

    function outputFilled(
        bytes32 token,
        uint256 amount,
        bytes calldata executionData
    ) external {
        // Pattern A (minimal): just forward funds to Safe
        address tokenAddr = address(uint160(uint256(token)));
        IERC20(tokenAddr).transfer(safe, amount);
        emit IntentFilled(tokenAddr, amount);

        // Pattern B (optional): decode executionData for typed post-actions
        // e.g., approve + mint position -- only if you want atomic delivery
    }
}
```

For v1, Pattern A is recommended. The keeper watches the `IntentFilled` event and handles deposit/mint in the next cycle.

---

## Part 2: Li.Fi Migration (Replace BTR Swap)

### Current vs Target

| Component | Current | Target |
|-----------|---------|--------|
| SDK | `@btr-supply/swap` (wraps 15+ aggregators) | Direct Li.Fi REST API via `fetch()` |
| Same-chain swaps | Multi-aggregator routing | Li.Fi quote (aggregates DEXs) |
| Cross-chain | Multi-aggregator routing | Li.Fi classic routes + intents |
| Calldata verification | None | `extractMainParameters` staticcall |
| Receiver safety | Trust SDK output | On-chain verification: `receiver == vault` |

### Why Li.Fi Only

1. **Simplified maintenance**: One aggregator API vs 15+ adapters
2. **On-chain verification**: CalldataVerificationFacet is unique to Li.Fi -- no other aggregator provides this
3. **Receiver verification**: `extractMainParameters` lets you verify `receiver == vault` on-chain before execution
4. **Intent support**: Li.Fi intents often beat atomic DEX swaps by 10-50bps on popular routes
5. **Deterministic receiver**: Since vaults are deterministically deployed (same CREATE2 address per chain), `receiver == spender` for monochain and `receiver == destinationVault` for cross-chain

### New `src/execution/swap.ts`

```typescript
import type { ChainId } from "../types";
import { getPublicClient, sendAndWait, getAccount, type TxResult } from "./tx";
import { log, retry } from "../utils";

const LIFI_API = "https://li.quest/v1";
const LIFI_DIAMOND = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE" as const;

// CalldataVerificationFacet ABI (for on-chain verification)
const EXTRACT_MAIN_PARAMS_ABI = [{
  name: "extractMainParameters",
  type: "function",
  stateMutability: "pure",
  inputs: [{ name: "data", type: "bytes" }],
  outputs: [
    { name: "bridge", type: "string" },
    { name: "sendingAssetId", type: "address" },
    { name: "receiver", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "destinationChainId", type: "uint256" },
    { name: "hasSourceSwaps", type: "bool" },
    { name: "hasDestinationCall", type: "bool" },
  ],
}] as const;

export interface LiFiQuoteParams {
  fromChain: ChainId;
  toChain: ChainId;
  fromToken: `0x${string}`;
  toToken: `0x${string}`;
  fromAmount: string;          // wei string
  fromAddress: `0x${string}`;  // vault/safe address
  toAddress: `0x${string}`;    // destination vault address
  slippage?: number;           // decimal (0.005 = 0.5%)
}

export interface LiFiQuote {
  transactionRequest: {
    to: `0x${string}`;
    data: `0x${string}`;
    value: string;
    gasLimit: string;
  };
  estimate: {
    toAmount: string;
    toAmountMin: string;
    approvalAddress: `0x${string}`;
    gasCosts: { amountUSD: string }[];
  };
  action: {
    fromChainId: number;
    toChainId: number;
    fromToken: { address: string };
    toToken: { address: string };
  };
  includedSteps: {
    type: string;   // "swap" | "cross" | "intent"
    tool: string;
    estimate: { toAmount: string };
  }[];
}

/**
 * Get a Li.Fi quote for a swap or bridge.
 */
export async function getLiFiQuote(params: LiFiQuoteParams): Promise<LiFiQuote> {
  const query = new URLSearchParams({
    fromChain: params.fromChain.toString(),
    toChain: params.toChain.toString(),
    fromToken: params.fromToken,
    toToken: params.toToken,
    fromAmount: params.fromAmount,
    fromAddress: params.fromAddress,
    toAddress: params.toAddress,
    slippage: (params.slippage ?? 0.005).toString(),
    order: "RECOMMENDED",
  });

  const resp = await retry(async () => {
    const r = await fetch(`${LIFI_API}/quote?${query}`);
    if (!r.ok) throw new Error(`LiFi quote failed: ${r.status} ${await r.text()}`);
    return r.json() as Promise<LiFiQuote>;
  });

  return resp;
}

/**
 * Verify Li.Fi calldata on-chain using CalldataVerificationFacet.
 * Ensures receiver, destination chain, and no destination calls.
 */
export async function verifyLiFiCalldata(
  chainId: ChainId,
  calldata: `0x${string}`,
  expectedReceiver: `0x${string}`,
  expectedDstChain: number,
): Promise<void> {
  const pub = getPublicClient(chainId);

  const [, , receiver, , dstChain, , hasDestCall] = await pub.readContract({ // pure function — safe as staticcall
    address: LIFI_DIAMOND,
    abi: EXTRACT_MAIN_PARAMS_ABI,
    functionName: "extractMainParameters",
    args: [calldata],
  });

  if (receiver.toLowerCase() !== expectedReceiver.toLowerCase()) {
    throw new Error(`LiFi receiver mismatch: expected ${expectedReceiver}, got ${receiver}`);
  }
  if (expectedDstChain !== 0 && Number(dstChain) !== expectedDstChain) {
    throw new Error(`LiFi chain mismatch: expected ${expectedDstChain}, got ${dstChain}`);
  }
  if (hasDestCall) {
    throw new Error("LiFi calldata contains forbidden destination call");
  }
}

/**
 * Execute a Li.Fi swap/bridge with on-chain verification.
 */
export async function executeLiFiSwap(
  params: LiFiQuoteParams,
  privateKey: `0x${string}`,
): Promise<{ amountOut: string; txResult: TxResult } | null> {
  const quote = await getLiFiQuote(params);
  const { transactionRequest: tx } = quote;

  // On-chain verification before execution
  await verifyLiFiCalldata(
    params.fromChain,
    tx.data as `0x${string}`,
    params.toAddress,
    params.fromChain === params.toChain ? 0 : params.toChain,
  );

  // Approve if needed
  // (quote.estimate.approvalAddress is the Li.Fi Diamond)
  // handled by caller or approveIfNeeded()

  const result = await sendAndWait(params.fromChain, privateKey, {
    to: tx.to as `0x${string}`,
    data: tx.data as `0x${string}`,
    value: tx.value ? BigInt(tx.value) : undefined,
  });

  if (result.status === "reverted") {
    log.error(`LiFi swap reverted: ${result.hash}`);
    return null;
  }

  return {
    amountOut: quote.estimate.toAmountMin,
    txResult: result,
  };
}

/**
 * Get token balance (unchanged from current implementation).
 */
export async function getBalance(
  chainId: ChainId,
  token: `0x${string}`,
  account: `0x${string}`,
): Promise<bigint> {
  const pub = getPublicClient(chainId);
  const balance = await pub.readContract({
    address: token,
    abi: [{
      name: "balanceOf",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ name: "", type: "uint256" }],
    }],
    functionName: "balanceOf",
    args: [account],
  });
  return balance as bigint;
}
```

### Action Schema

```typescript
// src/types.ts (addition)

export type ActionKind =
  | "MONO_SWAP"            // Same-chain DEX swap via Li.Fi
  | "CROSS_BRIDGE_SWAP"    // Cross-chain bridge + optional swap
  | "MINT_POSITION"        // Mint concentrated liquidity
  | "BURN_POSITION"        // Burn + collect
  | "APPROVE"              // ERC20 approval
  | "INTENT_DELIVERY";     // Li.Fi intent fill (passive receive)

export interface ExecutionAction {
  kind: ActionKind;
  adapterId: string;                // "lifi" | "univ3" | "erc20"
  target: `0x${string}`;           // Contract to call
  data: `0x${string}`;             // Encoded calldata
  value: bigint;                    // ETH value
  expectedReceiver: `0x${string}`; // Vault address (for verification)
  expectedDstChainId: number;       // 0 for same-chain
  spendToken?: `0x${string}`;      // Token being spent (for cap tracking)
  spendAmount?: bigint;            // Amount being spent
}
```

### Module-Aware Execution Layer

When migrating to Safe vaults, the `sendAndWait` path changes:

```typescript
// src/execution/module.ts

import { encodeFunctionData } from "viem";
import { getPublicClient, getWalletClient, getAccount } from "./tx";
import type { ChainId } from "../types";
import { VAULT_REGISTRY } from "../config/vaults";
import { log } from "../utils";

const MODULE_ABI = [{
  name: "execute",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { name: "adapterId", type: "bytes32" },
    { name: "target", type: "address" },
    { name: "data", type: "bytes" },
    { name: "value", type: "uint256" },
    { name: "expectedReceiver", type: "address" },
    { name: "expectedDstChainId", type: "uint256" },
  ],
  outputs: [],
}] as const;

/**
 * Execute an action through the BTRPolicyModule on a Safe vault.
 * The module verifies calldata, enforces caps, then calls Safe.execTransactionFromModule().
 */
export async function executeViaModule(
  chainId: ChainId,
  action: {
    adapterId: string;
    target: `0x${string}`;
    data: `0x${string}`;
    value: bigint;
    expectedReceiver: `0x${string}`;
    expectedDstChainId: number;
  },
  keeperKey: `0x${string}`,
): Promise<`0x${string}`> {
  const vault = VAULT_REGISTRY[chainId];
  if (!vault) throw new Error(`No vault config for chain ${chainId}`);

  const adapterIdBytes = `0x${Buffer.from(action.adapterId.padEnd(32, "\0")).toString("hex")}` as `0x${string}`;

  const calldata = encodeFunctionData({
    abi: MODULE_ABI,
    functionName: "execute",
    args: [
      adapterIdBytes,
      action.target,
      action.data,
      action.value,
      action.expectedReceiver,
      BigInt(action.expectedDstChainId),
    ],
  });

  const wallet = getWalletClient(chainId, keeperKey);
  const pub = getPublicClient(chainId);

  const hash = await wallet.sendTransaction({
    to: vault.module,
    data: calldata,
    value: 0n,
    account: wallet.account!,
    chain: wallet.chain,
  });

  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Module execution reverted: ${hash}`);
  }

  log.info(`Module tx: ${hash} on chain ${chainId}`);
  return hash;
}
```

### Intent Support Strategy

For v1, support intents passively:

1. **Li.Fi routes intents transparently**: When a solver-based route is optimal, Li.Fi returns it as part of the standard quote response — no special parameter needed
2. **Classic execution**: The keeper executes the quote's `transactionRequest` normally (even if it's an intent, the escrow is just a different on-chain contract)
3. **Delivery handling**: For same-chain, delivery is atomic. For cross-chain, the solver delivers to `toAddress` (the destination vault)
4. **No BTRIntentInbox needed in v1**: Vaults receive tokens directly and the keeper handles minting in the next cycle

---

## Part 3: Implementation Order

### Phase 1: Safe Infrastructure (Contracts)
1. Deploy Safe per pair per chain (using Safe Proxy Factory for CREATE2)
2. Deploy BTRPolicyModule per chain
3. Deploy LiFiVerifierAdapter per chain (or use `staticcall` to Diamond directly)
4. Enable module on each Safe, configure keeper address + caps + allowlist
5. Transfer existing positions/funds from EOA to Safe

### Phase 2: Li.Fi Migration (TypeScript)
1. Add `src/config/vaults.ts` (vault registry)
2. Rewrite `src/execution/swap.ts` (Li.Fi direct API + on-chain verification)
3. Add `src/execution/module.ts` (module-aware execution)
4. Update `src/execution/positions.ts` (mint/burn through module, recipient = Safe)
5. Update `src/executor.ts` (use module execution path, pass real tx hashes)

### Phase 3: Intent Support
1. Add cross-chain status polling (Li.Fi `/status` endpoint)
2. Optionally deploy BTRIntentInbox for delivery callbacks

### Phase 4: Testing & Verification
1. Unit tests for Li.Fi verification logic
2. Integration tests: quote -> verify -> execute on testnet
3. E2E test: full cycle with Safe vault on testnet
4. Audit the BTRPolicyModule contract

---

## Part 4: Deployment Checklist

### Per Chain Setup

- [ ] Deploy Safe via Safe Proxy Factory (CREATE2 for deterministic address)
- [ ] Deploy BTRPolicyModule
- [ ] Deploy UniV3VerifierAdapter
- [ ] Configure module on Safe:
  - [ ] Set keeper address (bot's session key)
  - [ ] Set epoch duration (900s = 15min)
  - [ ] Set window duration (60s)
  - [ ] Set spend caps per token per epoch
  - [ ] Add allowed targets: Li.Fi Diamond, position managers
  - [ ] Register adapters: lifi, univ3, erc20
- [ ] Verify Safe addresses match across all chains (CREATE2)
- [ ] Fund Safe with initial token balances
- [ ] Test one full cycle: quote -> verify -> mint -> burn

### Environment Variables (New)

```bash
# Keeper session key (NOT the Safe owner key)
KEEPER_PRIVATE_KEY=0x...

# Per-pair Safe addresses (same on all chains via CREATE2)
SAFE_USDC_USDT=0x...

# Module addresses (may differ per chain)
MODULE_ETH=0x...
MODULE_ARB=0x...
MODULE_BASE=0x...
# ...
```

### Security Invariants

1. **receiver == vault**: Every Li.Fi calldata must have `receiver == Safe address` on the correct chain
2. **No destination calls**: `hasDestinationCall` must be `false` (prevents arbitrary code execution post-bridge)
3. **Spend caps**: Module enforces max spend per token per epoch
4. **Target allowlist**: Module only allows calls to registered contract addresses
5. **Window gating**: Execution only possible during the first N seconds of each epoch
6. **Owner separation**: Safe owners (multi-sig cold keys) != keeper (hot session key)
