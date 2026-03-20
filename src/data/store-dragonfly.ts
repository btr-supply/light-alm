import type { RedisClient } from "bun";
import type { Position } from "../types";
import { bigintReplacer } from "../utils";

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

/**
 * DragonflyDB-backed CRUD store for per-entity hot state.
 * One instance per worker, bound to a single entityId (strategy name or pair ID).
 *
 * Key layout:
 *   {prefix}:{entityId}:positions        HASH  field=id -> JSON(Position)
 *   {prefix}:{entityId}:optimizer        STRING  JSON({vec, fitness})
 *   {prefix}:{entityId}:epoch            STRING  integer
 *   {prefix}:{entityId}:regime_suppress  STRING  integer (suppress-until-epoch)
 *   {prefix}:{entityId}:candle_cursor    STRING  integer (latest candle ts)
 */
export class DragonflyStore {
  private keys: {
    positions: string;
    optimizer: string;
    epoch: string;
    regimeSuppress: string;
    candleCursor: string;
  };

  constructor(
    private redis: RedisClient,
    private entityId: string,
    prefix = "btr:pair",
  ) {
    const base = `${prefix}:${entityId}`;
    this.keys = {
      positions: `${base}:positions`,
      optimizer: `${base}:optimizer`,
      epoch: `${base}:epoch`,
      regimeSuppress: `${base}:regime_suppress`,
      candleCursor: `${base}:candle_cursor`,
    };
  }

  // ---- Private helpers ----

  private async getNum(key: string): Promise<number> {
    const raw = await this.redis.get(key);
    return raw ? Number(raw) : 0;
  }

  private async setNum(key: string, val: number): Promise<void> {
    await this.redis.set(key, String(val));
  }

  private async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    return raw ? JSON.parse(raw) as T : null;
  }

  private async setJson<T>(key: string, val: T): Promise<void> {
    await this.redis.set(key, JSON.stringify(val));
  }

  // ---- Positions ----

  async savePosition(p: Position): Promise<void> {
    await this.redis.send("HSET", [this.keys.positions, p.id, JSON.stringify(p, bigintReplacer)]);
  }

  async getPositions(): Promise<Position[]> {
    const all = await this.redis.send("HVALS", [this.keys.positions]);
    if (!all || !Array.isArray(all)) return [];
    return (all as string[]).map(parsePosition);
  }

  async deletePosition(id: string): Promise<void> {
    await this.redis.send("HDEL", [this.keys.positions, id]);
  }

  // ---- Optimizer State ----

  getOptimizerState() { return this.getJson<{ vec: number[]; fitness: number }>(this.keys.optimizer); }
  saveOptimizerState(vec: number[], fitness: number) { return this.setJson(this.keys.optimizer, { vec, fitness }); }

  // ---- Epoch Counter ----

  getEpoch() { return this.getNum(this.keys.epoch); }

  async incrementEpoch(): Promise<number> {
    const val = await this.redis.send("INCR", [this.keys.epoch]);
    return Number(val);
  }

  // ---- Regime Suppress ----

  getRegimeSuppressUntil() { return this.getNum(this.keys.regimeSuppress); }
  setRegimeSuppressUntil(epoch: number) { return this.setNum(this.keys.regimeSuppress, epoch); }

  // ---- Candle Cursor (latest stored candle timestamp) ----

  getLatestCandleTs() { return this.getNum(this.keys.candleCursor); }
  setLatestCandleTs(ts: number) { return this.setNum(this.keys.candleCursor, ts); }

  // ---- Cleanup (for worker shutdown / entity removal) ----

  async deleteAll(): Promise<void> {
    await this.redis.send("DEL", Object.values(this.keys));
  }
}
