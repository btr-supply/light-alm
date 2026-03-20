/**
 * OCI runtime resolver — detects podman (preferred) or docker,
 * resolves the API socket path, and can auto-start the runtime.
 */

export interface OciRuntime {
  name: "podman" | "docker";
  /** API socket path or TCP URL */
  socket: string;
}

/** Check if a binary exists on PATH. */
function hasBinary(bin: string): boolean {
  return Bun.spawnSync(["which", bin]).exitCode === 0;
}

/** Check if a runtime daemon is responsive. */
function runtimeReady(bin: string): boolean {
  return Bun.spawnSync([bin, "info"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}

/**
 * Resolve OCI runtime: podman first, then docker.
 * Synchronous — safe to call at process startup before any async work.
 */
export function resolveOciRuntime(): OciRuntime {
  const envHost = process.env.DOCKER_HOST;

  // Explicit DOCKER_HOST — honour it, just detect which binary to use
  if (envHost) {
    const name = hasBinary("podman") ? "podman" : "docker";
    return { name, socket: envHost };
  }

  // Podman running?
  if (runtimeReady("podman")) {
    return { name: "podman", socket: "/var/run/docker.sock" };
  }

  // Docker running?
  if (runtimeReady("docker")) {
    return { name: "docker", socket: "/var/run/docker.sock" };
  }

  // Binary exists but daemon not running — we can try to start it
  if (hasBinary("podman")) return { name: "podman", socket: "/var/run/docker.sock" };
  if (hasBinary("docker")) return { name: "docker", socket: "/var/run/docker.sock" };

  throw new Error("No OCI runtime found (need podman or docker)");
}

/** Poll `<bin> info` until it succeeds or timeout. */
async function pollReady(bin: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (runtimeReady(bin)) return;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`${bin} did not become ready within ${timeoutMs / 1000}s`);
}

/** Ensure the resolved runtime is responsive, starting it if necessary. */
export async function ensureRuntimeReady(rt: OciRuntime): Promise<void> {
  if (runtimeReady(rt.name)) return;

  if (rt.name === "podman") {
    Bun.spawn(["podman", "machine", "start"], { stdout: "ignore", stderr: "ignore" });
  } else {
    // macOS: open Docker.app; Linux: systemctl
    if (process.platform === "darwin") {
      Bun.spawn(["open", "-a", "Docker"], { stdout: "ignore", stderr: "ignore" });
    } else {
      Bun.spawn(["systemctl", "start", "docker"], { stdout: "ignore", stderr: "ignore" });
    }
  }

  await pollReady(rt.name);
}
