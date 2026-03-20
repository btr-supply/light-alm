import { describe, expect, test } from "bun:test";
import { KEYS } from "../../src/infra/redis";

describe("Redis KEYS: collector namespace", () => {
  test("collector keys are namespaced under btr:collector:", () => {
    expect(KEYS.collectorLock("USDC-USDT")).toBe("btr:collector:USDC-USDT:lock");
    expect(KEYS.collectorHeartbeat("USDC-USDT")).toBe("btr:collector:USDC-USDT:heartbeat");
    expect(KEYS.collectorState("USDC-USDT")).toBe("btr:collector:USDC-USDT:state");
    expect(KEYS.collectorRestarting("USDC-USDT")).toBe("btr:collector:USDC-USDT:restarting");
    expect(KEYS.collectors).toBe("btr:collectors");
    expect(KEYS.configCollectors).toBe("btr:config:collectors");
  });

  test("shared data keys are namespaced under btr:data:", () => {
    expect(KEYS.dataCandles("USDC-USDT")).toBe("btr:data:USDC-USDT:candles");
    expect(KEYS.dataSnapshots("USDC-USDT")).toBe("btr:data:USDC-USDT:snapshots");
    expect(KEYS.dataTs("USDC-USDT")).toBe("btr:data:USDC-USDT:ts");
  });

  test("collector and strategy worker keys don't collide for same pair", () => {
    const pairId = "USDC-USDT";
    expect(KEYS.collectorLock(pairId)).not.toBe(KEYS.workerLock(pairId));
    expect(KEYS.collectorHeartbeat(pairId)).not.toBe(KEYS.workerHeartbeat(pairId));
    expect(KEYS.collectorState(pairId)).not.toBe(KEYS.workerState(pairId));
  });
});

