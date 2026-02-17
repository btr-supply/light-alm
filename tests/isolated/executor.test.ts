/**
 * Executor tests use mock.module which is process-global in bun:test.
 * Running them in-process would contaminate shared modules (store, range, swap, tx)
 * used by other test files. This wrapper runs them in an isolated subprocess.
 */
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

describe("executor (isolated)", () => {
  test("all executor tests pass", async () => {
    const { pass, fail, output } = await runIsolated("isolated/executor.isolated.ts");
    if (fail > 0) throw new Error(`${fail} executor test(s) failed:\n${output}`);
    expect(pass).toBeGreaterThanOrEqual(23);
  }, 30_000);

  test("all scheduler cycle tests pass", async () => {
    const { pass, fail, output } = await runIsolated("isolated/scheduler.isolated.ts");
    if (fail > 0) throw new Error(`${fail} scheduler cycle test(s) failed:\n${output}`);
    expect(pass).toBeGreaterThanOrEqual(7);
  }, 30_000);
});
