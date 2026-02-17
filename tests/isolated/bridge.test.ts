import { describe, test, expect } from "bun:test";

async function runIsolated(file: string): Promise<{ pass: number; fail: number; output: string }> {
  const proc = Bun.spawn(["bun", "test", `./${file}`], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: import.meta.dir + "/..",
  });
  await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const output = stdout + stderr;
  const passMatch = output.match(/(\d+) pass/);
  const failMatch = output.match(/(\d+) fail/);
  return {
    pass: passMatch ? Number(passMatch[1]) : 0,
    fail: failMatch ? Number(failMatch[1]) : 0,
    output,
  };
}

describe("bridgeCrossChain (isolated)", () => {
  test("all bridge cross-chain tests pass", async () => {
    const { pass, fail, output } = await runIsolated("isolated/bridge.isolated.ts");
    if (fail > 0) throw new Error(`${fail} bridge test(s) failed:\n${output}`);
    expect(pass).toBeGreaterThanOrEqual(4);
  }, 30_000);
});
