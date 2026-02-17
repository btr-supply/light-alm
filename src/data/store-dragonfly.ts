import type { RedisClient } from "bun";
import type { Position, DexId } from "../types";

/** BigInt-safe JSON serializer for Position fields. */
const toJson = (v: unknown) =>
  JSON.stringify(v, (_, val) => (typeof val === "bigint" ? val.toString() : val));

/** Deserialize a Position from DragonflyDB JSON. */
function parsePosition(raw: string): Position {
  const p = JSON.parse(raw);
  return {
    ...p,
    liquidity: BigInt(p.liquidity),
    amount0: BigInt(p.amount0),
    amount1: BigInt(p.amount1),
  };
}

/** DragonflyDB key schema for per-pair CRUD state. */
const K = {
  positions: (pairId: string) => `btr:pair:${pairId}:positions`,
  optimizer: (pairId: string) => `btr:pair:${pairId}:optimizer`,
  epoch: (pairId: string) => `btr:pair:${pairId}:epoch`,
  regimeSuppress: (pairId: string) => `btr:pair:${pairId}:regime_suppress`,
  candleCursor: (pairId: string) => `btr:pair:${pairId}:candle_cursor`,
} as const;

/**
 * DragonflyDB-backed CRUD store for per-pair hot state.
 * One instance per worker, bound to a single pairId.
 *
 * Key layout:
 *   btr:pair:{pairId}:positions        HASH  field=id → JSON(Position)
 *   btr:pair:{pairId}:optimizer        STRING  JSON({vec, fitness})
 *   btr:pair:{pairId}:epoch            STRING  integer
 *   btr:pair:{pairId}:regime_suppress  STRING  integer (suppress-until-epoch)
 *   btr:pair:{pairId}:candle_cursor    STRING  integer (latest candle ts)
 */
export class DragonflyStore {
  constructor(
    private redis: RedisClient,
    private pairId: string,
  ) {}

  // ---- Positions ----

  async savePosition(p: Position): Promise<void> {
    await this.redis.send("HSET", [K.positions(this.pairId), p.id, toJson(p)]);
  }

  async getPositions(): Promise<Position[]> {
    const all = await this.redis.send("HVALS", [K.positions(this.pairId)]);
    if (!all || !Array.isArray(all)) return [];
    return (all as string[]).map(parsePosition);
  }

  async deletePosition(id: string): Promise<void> {
    await this.redis.send("HDEL", [K.positions(this.pairId), id]);
  }

  // ---- Optimizer State ----

  async getOptimizerState(): Promise<{ vec: number[]; fitness: number } | null> {
    const raw = await this.redis.get(K.optimizer(this.pairId));
    if (!raw) return null;
    return JSON.parse(raw) as { vec: number[]; fitness: number };
  }

  async saveOptimizerState(vec: number[], fitness: number): Promise<void> {
    await this.redis.set(K.optimizer(this.pairId), JSON.stringify({ vec, fitness }));
  }

  // ---- Epoch Counter ----

  async getEpoch(): Promise<number> {
    const raw = await this.redis.get(K.epoch(this.pairId));
    return raw ? Number(raw) : 0;
  }

  async incrementEpoch(): Promise<number> {
    const val = await this.redis.send("INCR", [K.epoch(this.pairId)]);
    return Number(val);
  }

  // ---- Regime Suppress ----

  async getRegimeSuppressUntil(): Promise<number> {
    const raw = await this.redis.get(K.regimeSuppress(this.pairId));
    return raw ? Number(raw) : 0;
  }

  async setRegimeSuppressUntil(epoch: number): Promise<void> {
    await this.redis.set(K.regimeSuppress(this.pairId), String(epoch));
  }

  // ---- Candle Cursor (latest stored candle timestamp) ----

  async getLatestCandleTs(): Promise<number> {
    const raw = await this.redis.get(K.candleCursor(this.pairId));
    return raw ? Number(raw) : 0;
  }

  async setLatestCandleTs(ts: number): Promise<void> {
    await this.redis.set(K.candleCursor(this.pairId), String(ts));
  }

  // ---- Cleanup (for worker shutdown / pair removal) ----

  async deleteAll(): Promise<void> {
    const keys = [
      K.positions(this.pairId),
      K.optimizer(this.pairId),
      K.epoch(this.pairId),
      K.regimeSuppress(this.pairId),
      K.candleCursor(this.pairId),
    ];
    await this.redis.send("DEL", keys);
  }
}
