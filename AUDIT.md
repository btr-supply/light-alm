# AUDIT.md — Cross-Validated Findings (3 Independent Audits)

> Generated 2026-02-16. Issues ranked by severity, cross-validated across 3 independent auditors.
> Legend: [A1/A2/A3] = confirmed by Audit 1/2/3. More confirmations = higher confidence.

---

## LOW / MINOR

### L3. API has no auth, CORS * [A1, A3]

### L8. `approveIfNeeded` over-approves by 2x (tx.ts:190)
Approves `amount * 2n` to reduce future approval txs. Low risk: spender is always a known PM/router/diamond, but leaves a larger-than-necessary allowance window. Consider exact approval or `type(uint256).max` with explicit revoke.

### L9. `waitForArrival` balance polling may misattribute deposits (swap.ts:265)
Polls `balanceOf` and returns when `bal > balanceBefore`. If two deposits arrive close together (e.g., a manual transfer + the bridge), the delta may include the unrelated deposit. Low severity since the system is the sole operator of these accounts.

### L10. No per-account nonce mutex (tx.ts)
`sendAndWait` relies on viem auto-nonce. Safe only if there is never concurrent `sendAndWait` for the same account+chain. The scheduler currently runs pairs sequentially, but there is no enforcement preventing parallel execution in future.

---

## TEST COVERAGE GAPS

### Missing test scenarios:
- Cross-chain swap flow (swapTokens end-to-end)
- Concurrent nonce handling
- Tick math edge cases (price near 0, near bounds)
- `sendAndWait` simulation failure path (SimulationError thrown before gas spent)
- Gas buffer correctness (estimateGas * 120%)

---

## IMPLEMENTATION PRIORITY

### Phase 1: Execution Blockers — DONE
1. CR1 — Fixed: liquidity read from on-chain positions() after mint; burn reads on-chain liquidity
2. CR2 — Fixed: dexes registry keys now use DexId values directly
3. CR5 — Fixed: candle aggregation uses absolute periods from M1
4. CR6 — Fixed: burn slippage set to 0n (protection from atomic collect)
5. CR3+CR4 — Fixed: concentration multiplier removed; baseApr annualization corrected
6. H4 — Fixed: Math.min changed to Math.max in baseRangeWidth
7. H6 — Fixed: 12h minimum holding period added to decision engine
8. H8 — Fixed: sequential approvals (nonce safety)
9. M5 — Fixed: 2-minute timeout on waitForTransactionReceipt
10. L1 — Fixed: removed unused MTF_WEIGHTS and MTF_CANDLES.m1/m5

### Phase 2: Correctness — DONE
- H1 — Fixed: allocation totalCapitalUsd with post-deposit dilution
- H2 — Fixed: cross-chain bridging via swapTokens
- H3 — Fixed: token ratio rebalancing between burn and mint
- H5 — Fixed: filter unsupported DEX pools
- H7 — Fixed: retry logic for failed mints
- M1 — Fixed: entryValueUsd uses decimal-adjusted amounts
- M4 — Fixed: RS proportional allocation based on entryValueUsd
- M6 — Fixed: removed zero-address USDT for HyperEVM
- M8 — Fixed: V4 pool filtering with debug log

### Phase 2b: Review Fixes — DONE
- R1 — Fixed: PRA/RS sequential mint balance depletion (snapshot balances upfront)

### Phase 3: Testing — 200 PASS, 0 FAIL
- Unit tests: executor (21), positions (22), scheduler (17), ohlc (19), api (18) + original 10 files (116)
- Mock-heavy tests (executor, scheduler cycle) run in subprocess isolation to prevent mock.module leaking
- Remaining: E2E tests for multi-chain open/close/rebalance

### Phase 4: Code Cleanup — DONE
- C2 — Fixed: BSC USDC/USDT 18 decimals via `chainDecimals` + `tokenDecimals()` helper
- L2 — Fixed: `approveIfNeeded` deduplicated to `src/execution/tx.ts`
- L5 — Fixed: RateLimiter promise chain reset after resolution
- L6 — Fixed: `PoolConfig.dex` typed as `DexId` instead of `string`
- DEXType dead import removed from `src/config/dexs.ts`
- `withRetry` removed from executor.ts, replaced with `retry` from utils.ts
- `SECONDS_PER_YEAR` deduplicated to `src/config/params.ts`
- `IMBALANCE_THRESHOLD` constant extracted to `src/config/params.ts`
- CORS headers deduplicated to `CORS_HEADERS` constant in `src/api.ts`
- `mapAnalysisRow` helper deduplicated PoolAnalysis mapping in `src/data/store.ts`
- `mergeForceParams` exported from scheduler.ts, test uses real function

### Phase 5: Multi-DEX Adapters — 40/41 pools operable
- Registered 4 V3-compatible DEXes: Pangolin, Blackhole (Algebra), Pharaoh, Project X
- Registered Ramses PM on HyperEVM (999) and Uniswap V3 PM on BSC (56)
- Registered 3 Trader Joe LB routers (V2, V2.1, V2.2) on Avalanche
- Fixed DEX_FAMILY: Blackhole correctly mapped to ALGEBRA (was V3)
- New adapter: `positions-lb.ts` — LB mint/burn via router with bin distributions
- New adapter: `positions-v4.ts` — V4 mint/burn via action-encoded modifyLiquidities
- Added V4 PositionManager addresses (Uni V4: 6 chains, PCS V4: BSC)
- Updated pool filter: V4 pools (bytes32 IDs) pass when V4 PM exists
- Updated fee reader: V4 via StateView, LB via getBinStep
- Only Hybra V4 (HyperEVM) remains unsupported (PM address not published)

### Phase 6: DRY Refactoring — DONE
- `TX_DEADLINE_SEC`, `DEFAULT_SLIPPAGE_BPS`, `SECONDS_PER_DAY`, `ZERO_ADDR`, `txDeadline()` centralized in `src/config/params.ts`
- `MintResult`, `BurnResult` interfaces, `findPool()` helper moved to `src/types.ts`
- `errMsg()`, `sortTokens()` added to `src/utils.ts`; replaced 11+ inline patterns
- `computeEntryValueUsd()` centralized in `src/config/tokens.ts`
- `buildAndSaveMintResult()` factory in `positions.ts` — eliminates 3x Position construction duplication
- `encodeMintActions`/`encodePcsMintActions` merged into single parameterized function
- `readRawFeeTier` dead code removed (replaced by `readFeeTier` from `fees.ts`)
- `baseRangeWidth` consolidated: `range.ts` exports shared function, `optimizer.ts` imports + adds floor
- `queryV4`/`queryPcsV4` merged into `queryV4Family` with boolean parameter
- V4/PCS_V4 fee branches in `fees.ts` merged into single conditional
- HyperEVM RPC derived from `chains.ts` (single source of truth)
- `mergeWeightedCandles` exported from `ohlc.ts`; test uses real function
- `STABLE_TOKENS` centralized in `params.ts`; scheduler imports from there
- Executor `rebalanceTokenRatio` swap branches consolidated
- `Position.dex` and `AllocationEntry.dex` typed as `DexId` (was `string`)
- Test helpers extracted to `tests/helpers.ts` (neutralForces, synth generators, silenceLog)
- Dashboard: `StatGrid`, `ProgressBar` reusable components extracted
- Dashboard: `CHAIN_NAME` + `chainName()` added to `shared/format.ts`; HyperEVM added to `CHAIN_COLOR`

### Phase 7: Epoch Snapshots & Analytics — DONE
- `EpochSnapshot` interface added to `shared/types.ts`
- `epoch_snapshots` table + `saveEpochSnapshot`/`getEpochSnapshots`/`getPairAllocations` in `store.ts`
- Scheduler calls `saveEpochSnapshot` after each decision epoch
- `GET /api/pairs/:id/snapshots` endpoint with time-range + limit filtering
- `GET /api/pairs/:id/allocations` updated to support `?limit=N`
- Dashboard: `PnlSummary.svelte` component with fee/gas/P&L aggregation
- Dashboard: portfolio summary card in `PairList.svelte`
- Dashboard: `analyses` + `snapshots` stores removed (unused by any component)
- Dashboard: `PriceChart` `$effect` fix (tracks array reference, not `.length`)
- Dashboard: `fmtGasCost` utility moved to `shared/format.ts`
- Tests: 13 new (epoch snapshot store + API), 200 total pass

### Phase 8: Audit Fixes (M2, M3, M7, L4, L7) — DONE
- M2 — Fixed: continuous LVR term `(sigma^2/2) * sqrt(p) / (sqrt(pH)-sqrt(pL)) * dt` added per Milionis et al.
- M3 — Fixed: `getRecentYields` queries `epoch_snapshots` for net yield (APR - gas - IL), falls back to gross APR
- M7 — Fixed: overfitting check returns `-Infinity` (hard rejection) instead of `valFit * 0.5` penalty
- L4 — Fixed: RSI uses Wilder's exponential smoothing `(prevAvg*(period-1)+current)/period`
- L7 — Fixed: M15 candles precomputed once in scheduler, passed to `compositeForces` via `precomputedM15` param

### Phase 9: Frontend Quality — DONE
- **shadcn-svelte** installed with alert, badge, card, progress, table components
- **Svelte 5 runes**: `stores.ts` → `stores.svelte.ts` using `$state` class pattern (no more `writable`/`get`)
- All components migrated from `$storeName` to `app.property` reactive access
- **AdvancedStats decomposed**: KillSwitchAlert, OptimizerParams, RegimeStatus, PositionList extracted as atomic components
- **AlertBanner** extracted: deduplicates error alert markup (was in App.svelte + AdvancedStats)
- **SECTION_HEADER**: `mb-2` included in constant, removed manual additions
- **Font sizes**: `text-[11px]` → `text-xs`, consistent 2-tier system (10px/xs)
- **Redundant `font-mono`**: removed from all components (body is already monospace)
- `$lib` path alias configured in tsconfig.json + vite.config.ts

### Phase 10: Code-Sharing (Frontend ↔ Backend) — DONE
- **Tick math** consolidated: `tickToPrice`/`priceToTick` in `shared/format.ts`; removed `1.0001` magic from 4 files (PriceChart, range.ts, decision.ts, positions-v4.ts)
- **DEX display names**: `DEX_NAME` + `dexName()` in `shared/format.ts`
- **OpType union**: `TxLogEntry.opType` narrowed from `string` to `"burn" | "mint" | "swap"` in shared + backend types
- **Chain names**: all dashboard components use `chainName()` from `shared/format.ts`
- **Gas cost**: `fmtGasCost()` used in TxLog from `shared/format.ts` (no more inline `1e18` division)
- **Stale `.js` files**: removed `shared/format.js` + `shared/types.js` (were shadowing `.ts` exports for Vite)

### Phase 11: Aggressive DRY Consolidation — DONE
- **captureChainBalances()** helper in `executor.ts` — replaces 2 duplicate inline balance-fetching loops
- **scaleByPct()** helper in `executor.ts` — replaces 4 inline `bigint * pct` calculations
- **getLatestPrice()** helper in `executor.ts` — replaces inline IIFE
- **compositeForces** single-pass loop in `forces.ts` — 9 `.reduce()` calls → 1 loop
- **sqrtBounds()** helper in `optimizer.ts` — shared by `lpValue` + `hodlValue`
- **Pool lookup Map** in `allocation.ts` — O(N) linear scan → O(1) Map lookup
- **toBaseRange()** helper in `scheduler.ts` — replaces 2 duplicate inline object constructions
- **cap()** from `shared/format` used in `optimizer.ts` — replaces `Math.min(Math.max())` patterns
- **Named constants**: `CANDLES_1H`, `TRAILING_EPOCHS`, `EPOCHS_PER_YEAR` replace magic numbers
- **failedMintResult()** factory in `positions.ts` — eliminates duplicate mint failure construction
- **failedBurnResult()** factory in `positions.ts` — eliminates 4x duplicate burn failure objects across V3/LB/V4
- **readPositionLiquidity()** helper in `positions.ts` — deduplicates 2 identical on-chain position reads
- **approveTokenPair()** in `tx.ts` — replaces 3x duplicate sequential approve patterns in V3/LB/V4
- **encodeV4Actions()** in `positions-v4.ts` — shared by mint + burn action encoding
- **Bigint constants** (`MAX_UINT128`, `Q96`, `E18`) centralized in `config/params.ts`
- **`<Section>` component** — replaces 7 duplicate section header + empty state patterns in dashboard
- **forceColor/statusColor/opIcon** moved to `theme.ts` — single source for display logic
- Deleted stale `dashboard/src/lib/utils.js`
- `ZERO_ADDR` used in `pool-query.ts` (was hardcoded hex string)
- **V4 `preSlot0` param** in `resolveUniV4PoolKey`/`resolvePcsV4PoolKey` — eliminates 2 redundant `getSlot0` RPC calls per V4 mint
- **`geckoNetwork` field eliminated** — derived from `chains[id].gecko` via `geckoNetwork()` helper; removed from 38 pool entries, `PoolConfig`, `PoolEntry`, `toPoolConfigs`, `loadPoolsFromEnv`
- **`logBurn`/`logMint`** helpers in `executor.ts` — replaces 4 verbose inline `logTransaction` calls

### Phase 12: Transaction Safety (tx.ts / swap.ts audit)
- **SimulationError** class in `tx.ts` — typed error for pre-flight `eth_call` failures (replaces generic `Error`)
- **Gas buffer** (120%) in `sendAndWait` — `estimateGas * 120 / 100` protects against tight estimates on diamond proxies and V4 modifyLiquidities
- **Explicit gas param** passed to `sendTransaction` — prevents viem from re-estimating (state may have changed between simulation and send)
- **Structured logging** — TX sent log now includes gas limit; TX receipt log shows `gasUsed/gasLimit` ratio for monitoring

### Phase 13: DRY Consolidation Audit — DONE
- **`queryV3Style()`** in `pool-query.ts` — merges `queryV3`/`queryAlgebra`/`queryAerodrome` into single configurable function with `V3_STYLE` lookup table (-33 lines)
- **`readV4State()`** in `positions-v4.ts` — deduplicates identical slot0+tickSpacing read logic from `resolveUniV4PoolKey`/`resolvePcsV4PoolKey`
- **ABI centralization** — LB router ABIs (addLiquidity, removeLiquidity, approveForAll, isApprovedForAll, balanceOf) moved to `ABIS.lbRouter` in `dexs.ts`; V4 PM ABIs moved to `ABIS.v4pm`; PoolKey components moved to `ABIS.v4PoolKey` (-91 lines from positions-lb.ts, -53 lines from positions-v4.ts)
- **Dead code removed** — unused `DECREASE_LIQUIDITY` constant and `getPositionLiquidity` ABI
- **Chart colors** — 8 hardcoded hex values in `PriceChart.svelte` extracted to `CHART` constant in `theme.ts` (single source of truth)
- **CORS test fix** — api.test.ts updated to match actual "GET, POST, OPTIONS" headers
- Net: -59 lines across 4 backend files; 200 tests pass

### Phase 14: Frontend Conciseness — DONE
- **Unused API fetches removed**: `analyses` + `snapshots` endpoints dropped from poll cycle (7 fetches per interval down to 5)
- **PriceChart $effect cleanup**: `void` dependency hints removed; `updateData()` inlined into `$effect` body with props accessed before early-return guard for correct dependency tracking
- **Dead code**: `PoolAnalysis`/`EpochSnapshot` type imports removed from stores + api modules

### Phase 15: Theme Centralization — DONE
- **`TEXT` tokens** in `theme.ts`: `primary`, `value`, `secondary`, `label`, `dim`, `positive`, `negative` — semantic text color roles replacing 30+ hardcoded `text-zinc-*`/`text-green-*`/`text-red-*` classes across 12 components
- **`LAYOUT` tokens**: `sidebarW` (`w-60`), `panelW` (`w-80`), `chartH` (`360`) — panel/chart sizing centralized
- **`SMALL` token**: `text-[10px]` non-standard size used in Forces, StrategyDetail, TxLog, ProgressBar
- **`ALERT` tokens**: `box`, `title`, `msg` — AlertBanner styling centralized
- **Cross-references**: `SECTION_HEADER`, `EMPTY_STATE`, `statusColor` now reference `TEXT` tokens (single source of truth)
- All 12 components updated: AlertBanner, App, Allocations, Forces, PairList, PnlSummary, PositionList, PriceChart, ProgressBar, RegimeStatus, StatGrid, StrategyDetail, TxLog
- 200 tests pass, 0 type errors, 0 lint warnings

### Phase 16: Singleton Orchestration & Observability — DONE
- **Process-per-strategy architecture**: orchestrator spawns one worker per pair via `Bun.spawn`, monitors heartbeats, respawns on failure
- **DragonflyDB synchronization**: singleton locks (orchestrator + per-worker), heartbeat keys with TTL auto-expiry, worker state published as JSON
- **New files**:
  - `src/config/pairs.ts` — extracted `loadPairConfigs`/`loadPoolsFromEnv` from index.ts (shared by orchestrator + CLI)
  - `src/infra/redis.ts` — Bun `RedisClient` factory, key schema constants, lock helpers (acquire/refresh/release via Lua CAS), state helpers
  - `src/infra/o2.ts` — OpenObserve HTTP client with buffered ingestion (flush every 5s or 100 entries)
  - `src/infra/logger.ts` — structured dual-sink logger (console + O2), backward-compatible format
  - `src/orchestrator.ts` — main process: DragonflyDB lock, worker spawning, health-check loop (10s), API server, graceful shutdown with 30s drain
  - `src/worker.ts` — single-strategy process: worker lock, SQLite, scheduler loop, heartbeat (15s), pub/sub control channel subscription
- **Modified files**:
  - `src/utils.ts` — logger delegates to structured logger; `errMsg` re-exported from `shared/format`
  - `src/state.ts` — added `WorkerState` type + `toWorkerState` helper; registry preserved for CLI mode
  - `src/api.ts` — dual-mode: orchestrated (Redis state + read-only SQLite) or legacy (in-memory registry); new endpoints: `GET /api/orchestrator/status`, `POST /api/orchestrator/workers/:id/restart`
  - `src/index.ts` — `run` delegates to orchestrator; `status` reads from DragonflyDB with SQLite fallback; `cycle` unchanged
- **Singleton enforcement**: orchestrator lock (NX+TTL), per-worker lock (NX+TTL), API port binding, dashboard read-only
- **Zero dependency added**: uses Bun's built-in `RedisClient` (no ioredis)
- **Dashboard**: zero changes required — same API, same port, same response format
- 200 tests pass, 0 fail

### Phase 17: SOA/HA Resilience & OpenObserve Hardening — DONE
- **CR-1** — `WORKER_LOCK_TTL` increased from 60s to 900s (15 min) — safely exceeds longest operation (bridge 10min + tx 2min)
- **CR-2** — `AbortSignal.timeout(30s)` on all external `fetch()` calls (Gecko, Jumper, Li.Fi, O2); ccxt constructor `timeout` added
- **H-1** — Fixed dead-code backoff bug: `nextRetryAt` check was always true → workers never respawned. Rewritten as 3-state machine (detect → wait → respawn). Kill+respawn race fixed (removed immediate respawn after kill)
- **H-3** — Redis subscriber `connectSubscriber()` retries on setup failure with 15s backoff
- **H-4** — SIGHUP config hot-reload: reconciles workers with current config (spawn new, stop removed)
- **H-5** — `log.info/warn/error` accept optional `LogFields`; `withFields` at scheduler cycle results + executor PRA/RS entry points; `LogFields` re-exported from `utils.ts`
- **M-1** — Heartbeat failures logged at warn level (was silently swallowed)
- **M-2** — O2 buffer cap: `O2_MAX_BUFFER_PER_STREAM = 10_000` entries/stream, drops oldest; warn-once on startup when O2 unconfigured
- **M-3** — API bearer token auth (`API_TOKEN` env) on `POST /restart`; CORS `Access-Control-Allow-Headers` includes `Authorization`
- **M-4** — `db.close()` in worker shutdown (before `log.shutdown()`)
- **M-5** — Absolute path via `import.meta.url` in `Bun.spawn` (orchestrator + index)
- **L-1** — Removed unused `CHANNELS.workerStatus`
- **L-4** — Parallel shutdown: `Promise.allSettled` + SIGKILL(9) escalation after grace period
- **X-1** — `WORKER_STATE_TTL_MS` centralized in `params.ts` (was hardcoded in redis.ts)
- **Bonus** — Fixed `LB_LB_DEFAULT_BIN_RANGE` / `LB_LB_ID_SLIPPAGE` double-prefix typo in `positions-lb.ts`
- Constants: `FETCH_TIMEOUT_MS`, `O2_FETCH_TIMEOUT_MS`, `O2_MAX_BUFFER_PER_STREAM`, `WORKER_STATE_TTL_MS` added to `params.ts`
- 200 tests pass, 0 fail, 0 type errors

### Phase 18: Remaining Audit Fixes (H6, M1, M3, M9, M10, A-4, L2, L4) — DONE
- **H-6** — Restart coordination key: worker sets `btr:worker:{pairId}:restarting` (60s TTL) before shutdown on RESTART command; orchestrator checks key and skips backoff on detection, resets `failCount` to 0
- **M-1** — Structured `{ pairId }` log fields added across worker lifecycle (acquired/started/shutting down/fatal), orchestrator health check (spawn/exit/heartbeat/error), executor (rebalance/bridge/mint)
- **M-3** — Data retention: `pruneOldData(db, retentionDays)` deletes from 6 time-series tables in transaction; `DATA_RETENTION_DAYS = 90` in params; called on worker startup
- **M-9** — Health check reads `WorkerState` from Redis; warns on `status === "error"` with error message; JSON.parse failure isolated (non-fatal)
- **M-10** — RO SQLite cache eviction: handles closed every 5 min, re-opened on next request
- **A-4** — Removed `PRAGMA journal_mode=WAL` from read-only Database handle in api.ts (redundant — writer already sets WAL)
- **C-1** — O2 dual-write for `pool_snapshots` and `optimizer_state` streams in scheduler.ts
- **L-2** — `await log.shutdown()` added to CLI `status` and `cycle` commands
- **L-4** — O2 token Base64 format validation (warn-only)
- Constants: `DATA_RETENTION_DAYS` added to `params.ts`
- 206 tests pass, 0 fail, 0 type errors

### Phase 19: Cross-Validated Audit Fixes — DONE
- **Dead code**: Removed `_totalLvrFrac` accumulation from `optimizer.ts` (accumulated but never read); removed `KS_PATHOLOGICAL_MAX` unused constant from `params.ts`
- **Config consolidation**: `DEFAULT_PRA_THRESHOLD`, `DEFAULT_RS_THRESHOLD`, `DEFAULT_INTERVAL_SEC`, `DEFAULT_MAX_POSITIONS` centralized in `params.ts`; `pairs.ts` imports from params (was hardcoded). Bounds validation added for PRA/RS thresholds (reject NaN, <=0, >=1)
- **Gas-cost gating**: `DecideOpts` interface added to `decide()` with `gasCostUsd` + `positionValueUsd`; PRA gate: expected gain over 7d must exceed 1.5x gas; RS gate: estimated fee loss must exceed 2x gas per position. `MIN_ABSOLUTE_APR_GAIN` (0.5%) prevents noise triggers when currentApr=0
- **Regime suppression HOLD**: `scheduler.ts` forces HOLD when `regime.suppressed` (was only suppressing optimizer, decisions still ran on stale params)
- **Regime widenFactor scope**: Applied to RS threshold (`Math.min(rsThreshold * widenFactor, 0.9)`) and PRA threshold (`Math.min(pra * widenFactor * 2, 0.9)`), not just range width
- **Optimizer resilience**: Wrapped optimizer in try-catch with defaults fallback; partial snapshot threshold (require >= 50% of pools)
- **Burn retry**: `BURN_RETRY_COUNT`/`BURN_RETRY_BACKOFF_MS` constants; `retry()` wraps `burnPosition` in both PRA and RS flows
- **Test cleanup**: Removed 10 `Array.isArray` tautologies from `api.test.ts`; replaced standalone checks with `toHaveLength()` assertions. Added `makePosition`/`makeAllocation`/`makeSnapshot` fixture factories to `tests/helpers.ts`. Fixed scheduler.isolated.ts snapshot volume to align with gas-cost gate
- 282 tests pass, 0 fail, 0 type errors
