# System Architecture

## Process Topology

```mermaid
graph TD
    O[Orchestrator + API :3001] -->|Bun.spawn| W1 & W2

    subgraph Workers
        W1[Worker: pair A]
        W2[Worker: pair B]
    end

    subgraph Data
        DF[(DragonflyDB)]
        O2[(OpenObserve)]
    end

    subgraph External
        CEX[CEX APIs · ccxt]
        GECKO[GeckoTerminal]
        CHAINS[EVM Chains · viem]
        BRIDGE[Li.Fi / Jumper]
    end

    O <-->|lock / config| DF
    W1 & W2 <-->|state| DF
    W1 & W2 -->|logs+epochs| O2
    W1 & W2 <--> CHAINS
    W1 & W2 --> CEX & GECKO & BRIDGE
```

The **orchestrator** (`src/orchestrator.ts`) is a singleton process protected by a DragonflyDB lock (TTL 60s, refreshed every 10s). It spawns one worker per configured pair, monitors heartbeats, and respawns crashed workers with exponential backoff (capped at 5 minutes, max 20 retries).

Each **worker** (`src/worker.ts`) is an independent Bun process with its own DragonflyStore, scheduler loop, and DragonflyDB lock. Workers publish `WorkerState` JSON to DragonflyDB and listen on a pub/sub control channel for SHUTDOWN/RESTART commands.

The **API server** runs inside the orchestrator process. It reads worker state from DragonflyDB and historical data from OpenObserve.

## Data Flow

```mermaid
graph LR
    CEX[CEX OHLC] --> F[Fetch]
    Gecko[GeckoTerminal] --> F
    F --> Forces[3-Force Model]
    F --> PA[Pool Analysis]
    Forces --> Opt[Optimizer]
    PA --> WF[Water-Fill]
    Opt --> Range[Range]
    Range --> D[Decide]
    WF --> D
    D --> E[Execute]
    E --> Burn
    E --> Swap/Bridge
    E --> Mint
```

## Module Map

| Directory | Purpose |
|-----------|---------|
| `src/config/` | Static configuration: chains, DEXes, pools, pairs, tokens, params |
| `src/data/` | Data ingestion: OHLC (ccxt), GeckoTerminal, DragonflyStore, O2 queries |
| `src/strategy/` | Signal computation: forces, range, optimizer, allocation, decision |
| `src/execution/` | On-chain operations: V3/Algebra, V4, LB position adapters |
| `src/infra/` | Infrastructure: Redis client, OpenObserve logger, structured logger |
| `src/adapters/` | Pool state queries (on-chain reads via viem) |

Key top-level files:

| File | Role |
|------|------|
| `src/orchestrator.ts` | Process supervisor, health monitor, API host |
| `src/worker.ts` | Single-pair process: lock, DragonflyStore, scheduler, heartbeat |
| `src/scheduler.ts` | 5-step cycle loop (fetch/compute/decide/execute/log) |
| `src/executor.ts` | PRA and RS execution orchestration (burn/swap/mint) |
| `src/state.ts` | In-memory `PairRuntime` registry, `WorkerState` serialization |
| `src/api.ts` | HTTP API (Bun.serve) |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun (TypeScript, no transpilation) |
| EVM RPC | viem (multicall, contract reads/writes) |
| CEX data | ccxt (Binance, Bybit, OKX, MEXC, Gate, Bitget) |
| Pool data | GeckoTerminal REST API |
| Hot state | DragonflyDB (positions, optimizer, epoch, candle cursor) |
| Coordination | DragonflyDB (Redis-compatible, Bun built-in `RedisClient`) |
| Telemetry | OpenObserve (HTTP buffered ingestion) |
| Swap/Bridge | Li.Fi / Jumper API |
| Token approvals | Permit2 (canonical address) |

## See Also

- [Decision Engine](strategy/decision.md) -- the decide step in detail
- [3-Force Model](strategy/forces.md) -- the compute step's signal engine
- [Range Optimizer](strategy/optimizer.md) -- online parameter tuning
- [Glossary](glossary.md) -- domain terms
