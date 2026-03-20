/**
 * Pool coverage audit — checks GeckoTerminal + ABI availability for all POOL_REGISTRY entries.
 *
 * For each pool:
 * 1. Checks if toPoolConfigs() includes it (PositionManager exists)
 * 2. Fetches GeckoTerminal — reports 404s (V4 bytes32 IDs expected to fail)
 * 3. For V3 addresses on Etherscan-supported chains — fetches ABI, reports failures
 *
 * Usage: bun scripts/pool-audit.ts
 */

import { POOL_REGISTRY, toPoolConfigs } from "../src/config/pools";
import { geckoNetwork } from "../src/config/chains";
import { GECKO_API_BASE, GECKO_RATE_LIMIT_MS } from "../src/config/params";

const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY ?? "";
const ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api";

// Etherscan V2 supports these chain IDs
const ETHERSCAN_CHAINS = new Set([1, 56, 137, 8453, 42161, 43114]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface AuditRow {
  chain: number;
  dex: string;
  pool: string;
  isV4: boolean;
  hasPositionManager: boolean;
  geckoStatus: "ok" | "404" | "error" | "skipped";
  geckoTvl: number | null;
  abiStatus: "ok" | "no_source" | "error" | "skipped";
}

async function checkGecko(chain: number, poolId: string): Promise<{ status: string; tvl: number | null }> {
  let network: string;
  try {
    network = geckoNetwork(chain);
  } catch {
    return { status: "skipped", tvl: null };
  }

  const url = `${GECKO_API_BASE}/networks/${network}/pools/${poolId}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return { status: "404", tvl: null };
    if (!res.ok) return { status: "error", tvl: null };
    const json = (await res.json()) as { data?: { attributes?: { reserve_in_usd?: string } } };
    const tvl = parseFloat(json.data?.attributes?.reserve_in_usd ?? "0") || null;
    return { status: "ok", tvl };
  } catch {
    return { status: "error", tvl: null };
  }
}

async function checkAbi(chain: number, address: string): Promise<string> {
  if (!ETHERSCAN_CHAINS.has(chain)) return "skipped";
  if (!ETHERSCAN_API_KEY) return "skipped";

  const url = `${ETHERSCAN_V2_BASE}?chainid=${chain}&module=contract&action=getabi&address=${address}&apikey=${ETHERSCAN_API_KEY}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return "error";
    const json = (await res.json()) as { status: string; result: string };
    if (json.status === "1" && json.result.startsWith("[")) return "ok";
    return "no_source";
  } catch {
    return "error";
  }
}

async function main() {
  const pairId = "USDC-USDT";
  const entries = POOL_REGISTRY[pairId];
  if (!entries) {
    console.error(`No entries in POOL_REGISTRY for ${pairId}`);
    process.exit(1);
  }

  const activeConfigs = toPoolConfigs(entries);
  const activeSet = new Set(activeConfigs.map((p) => `${p.chain}:${p.address}`));

  console.log(`\nAuditing ${entries.length} pools for ${pairId}\n`);
  if (!ETHERSCAN_API_KEY) {
    console.log("⚠ ETHERSCAN_API_KEY not set — ABI checks will be skipped\n");
  }

  const rows: AuditRow[] = [];

  for (const entry of entries) {
    const isV4 = entry.id.length !== 42;
    const key = `${entry.chain}:${entry.id}`;
    const hasPositionManager = activeSet.has(key);

    // GeckoTerminal check (skip V4 bytes32 IDs — they won't have Gecko pools)
    let geckoResult: { status: string; tvl: number | null };
    if (isV4) {
      geckoResult = { status: "skipped", tvl: null };
    } else {
      geckoResult = await checkGecko(entry.chain, entry.id);
      await sleep(GECKO_RATE_LIMIT_MS);
    }

    // ABI check (only for V3 42-char addresses on Etherscan-supported chains)
    let abiStatus: string;
    if (isV4) {
      abiStatus = "skipped";
    } else {
      abiStatus = await checkAbi(entry.chain, entry.id);
      if (abiStatus !== "skipped") await sleep(250); // Etherscan rate limit
    }

    rows.push({
      chain: entry.chain,
      dex: entry.dex,
      pool: isV4 ? `${entry.id.slice(0, 10)}…${entry.id.slice(-6)}` : entry.id,
      isV4,
      hasPositionManager,
      geckoStatus: geckoResult.status as AuditRow["geckoStatus"],
      geckoTvl: geckoResult.tvl,
      abiStatus: abiStatus as AuditRow["abiStatus"],
    });
  }

  // Print results table
  const pad = (s: string, n: number) => s.padEnd(n);
  const header = [
    pad("Chain", 7),
    pad("DEX", 18),
    pad("Pool", 48),
    pad("V4", 4),
    pad("PM", 4),
    pad("Gecko", 8),
    pad("TVL", 14),
    pad("ABI", 10),
  ].join(" | ");

  console.log(header);
  console.log("-".repeat(header.length));

  for (const r of rows) {
    const tvlStr = r.geckoTvl ? `$${(r.geckoTvl / 1000).toFixed(0)}k` : "-";
    console.log(
      [
        pad(String(r.chain), 7),
        pad(r.dex, 18),
        pad(r.pool, 48),
        pad(r.isV4 ? "yes" : "no", 4),
        pad(r.hasPositionManager ? "yes" : "no", 4),
        pad(r.geckoStatus, 8),
        pad(tvlStr, 14),
        pad(r.abiStatus, 10),
      ].join(" | "),
    );
  }

  // Summary
  const total = rows.length;
  const withPM = rows.filter((r) => r.hasPositionManager).length;
  const geckoOk = rows.filter((r) => r.geckoStatus === "ok").length;
  const gecko404 = rows.filter((r) => r.geckoStatus === "404").length;
  const geckoSkipped = rows.filter((r) => r.geckoStatus === "skipped").length;
  const abiOk = rows.filter((r) => r.abiStatus === "ok").length;
  const abiNoSource = rows.filter((r) => r.abiStatus === "no_source").length;
  const abiSkipped = rows.filter((r) => r.abiStatus === "skipped").length;

  console.log(`\n--- Summary ---`);
  console.log(`Total pools: ${total}`);
  console.log(`With PositionManager: ${withPM}/${total}`);
  console.log(`GeckoTerminal: ${geckoOk} ok, ${gecko404} 404, ${geckoSkipped} skipped`);
  console.log(`Etherscan ABI: ${abiOk} ok, ${abiNoSource} no source, ${abiSkipped} skipped`);

  // Flag issues
  const issues = rows.filter(
    (r) =>
      (!r.isV4 && r.geckoStatus !== "ok") ||
      (!r.isV4 && r.abiStatus === "no_source") ||
      (!r.hasPositionManager && !r.isV4),
  );
  if (issues.length) {
    console.log(`\n⚠ ${issues.length} issue(s) found:`);
    for (const r of issues) {
      const problems: string[] = [];
      if (!r.hasPositionManager) problems.push("no PM");
      if (r.geckoStatus === "404") problems.push("gecko 404");
      if (r.geckoStatus === "error") problems.push("gecko error");
      if (r.abiStatus === "no_source") problems.push("no ABI");
      console.log(`  ${r.chain}:${r.pool} (${r.dex}) — ${problems.join(", ")}`);
    }
  } else {
    console.log("\nAll V3 pools have Gecko + ABI coverage.");
  }
}

main().catch(console.error);
