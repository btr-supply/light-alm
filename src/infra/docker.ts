/**
 * Docker Engine API client for container-based worker management.
 * Supports both Unix socket (direct) and TCP (docker-socket-proxy) transports.
 */

const API_VERSION = "v1.47";

export interface DockerConfig {
  /** Docker socket path or TCP URL (e.g. "tcp://docker-proxy:2375") */
  host: string;
  /** Docker network for spawned containers to join */
  network: string;
  /** Image name for worker containers */
  image: string;
}

interface FetchOpts extends RequestInit {
  unix?: string;
}

const DOCKER_TIMEOUT_MS = 30_000;

async function docker<T = unknown>(
  cfg: DockerConfig,
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string>,
  timeoutMs = DOCKER_TIMEOUT_MS,
): Promise<{ status: number; data: T }> {
  const qs = query ? "?" + new URLSearchParams(query).toString() : "";
  const opts: FetchOpts = { method, signal: AbortSignal.timeout(timeoutMs) };
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }

  let url: string;
  if (cfg.host.startsWith("tcp://")) {
    url = `${cfg.host.replace("tcp://", "http://")}/${API_VERSION}${path}${qs}`;
  } else {
    url = `http://localhost/${API_VERSION}${path}${qs}`;
    opts.unix = cfg.host;
  }

  const res = await fetch(url, opts);
  const data = (await res.json().catch(() => null)) as T;
  return { status: res.status, data };
}

// ---- Container Lifecycle ----

const WORKER_ENV_PREFIXES = ["POOLS_", "RPC_", "HTTP_RPCS_"];
const WORKER_FORWARD_KEYS = [
  "O2_ORG",
  "O2_TOKEN",
  "O2_URL",
  "LOG_LEVEL",
  "DRAGONFLY_URL",
  "INTERVAL_SEC",
  "MAX_POSITIONS",
  "PRA_THRESHOLD",
  "RS_THRESHOLD",
];

type WorkerType = "collector" | "strategy";

function buildWorkerEnv(pairId: string, workerType: WorkerType): string[] {
  const pkKey = `PK_${pairId.replace(/-/g, "_")}`;
  const envKey = workerType === "collector" ? "COLLECTOR_PAIR_ID" : "WORKER_PAIR_ID";
  const env: string[] = [`${envKey}=${pairId}`, "NODE_ENV=production"];
  // Forward only this pair's private key (not all PK_*)
  if (process.env[pkKey]) env.push(`${pkKey}=${process.env[pkKey]}`);
  // Forward matching prefixed vars
  for (const [key, val] of Object.entries(process.env)) {
    if (val && WORKER_ENV_PREFIXES.some((p) => key.startsWith(p))) {
      env.push(`${key}=${val}`);
    }
  }
  // Forward individual vars
  for (const key of WORKER_FORWARD_KEYS) {
    if (process.env[key]) env.push(`${key}=${process.env[key]}`);
  }
  return env;
}

function containerName(pairId: string, workerType: WorkerType): string {
  return `btr-${workerType}-${pairId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
}

export async function createWorkerContainer(
  cfg: DockerConfig,
  pairId: string,
  workerType: WorkerType = "strategy",
): Promise<string> {
  const name = containerName(pairId, workerType);

  // Remove existing container with same name (leftover from crash)
  await removeContainer(cfg, name).catch(() => {});

  const entryFile = workerType === "collector" ? "src/collector.ts" : "src/worker.ts";
  const body = {
    Image: cfg.image,
    Cmd: ["bun", entryFile, pairId],
    Hostname: name,
    Env: buildWorkerEnv(pairId, workerType),
    Labels: {
      "btr.role": workerType,
      "btr.pair": pairId,
      "btr.managed-by": "orchestrator",
    },
    StopSignal: "SIGTERM",
    StopTimeout: 30,
    HostConfig: {
      Memory: 512 * 1024 * 1024,
      MemoryReservation: 256 * 1024 * 1024,
      NanoCpus: 500_000_000,
      PidsLimit: 256,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      ReadonlyRootfs: true,
      Tmpfs: { "/tmp": "rw,noexec,nosuid,size=64m" },
      RestartPolicy: { Name: "no" },
      NetworkMode: cfg.network,
      LogConfig: {
        Type: "json-file",
        Config: { "max-size": "10m", "max-file": "3" },
      },
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [cfg.network]: { Aliases: [name] },
      },
    },
  };

  const { status, data } = await docker<{ Id: string }>(cfg, "POST", "/containers/create", body, {
    name,
  });
  if (status !== 201) {
    throw new Error(`Container create failed (${status}): ${JSON.stringify(data)}`);
  }
  return data.Id;
}

export async function startContainer(cfg: DockerConfig, id: string): Promise<void> {
  const { status } = await docker(cfg, "POST", `/containers/${id}/start`);
  if (status !== 204 && status !== 304) {
    throw new Error(`Container start failed (${status})`);
  }
}

export async function stopContainer(cfg: DockerConfig, id: string, timeoutSec = 30): Promise<void> {
  const { status } = await docker(cfg, "POST", `/containers/${id}/stop`, undefined, {
    t: String(timeoutSec),
  });
  if (status !== 204 && status !== 304) {
    throw new Error(`Container stop failed (${status})`);
  }
}

export async function killContainer(
  cfg: DockerConfig,
  id: string,
  signal = "SIGKILL",
): Promise<void> {
  await docker(cfg, "POST", `/containers/${id}/kill`, undefined, { signal });
}

export async function removeContainer(cfg: DockerConfig, id: string): Promise<void> {
  await docker(cfg, "DELETE", `/containers/${id}`, undefined, { force: "true" });
}

export interface ContainerState {
  running: boolean;
  exitCode: number | null;
  oomKilled: boolean;
}

export async function inspectContainer(cfg: DockerConfig, id: string): Promise<ContainerState> {
  const { status, data } = await docker<{
    State: { Running: boolean; ExitCode: number; OOMKilled: boolean };
  }>(cfg, "GET", `/containers/${id}/json`);
  if (status !== 200) return { running: false, exitCode: null, oomKilled: false };
  return {
    running: data.State.Running,
    exitCode: data.State.Running ? null : data.State.ExitCode,
    oomKilled: data.State.OOMKilled,
  };
}

/** Remove all containers with btr.managed-by=orchestrator label. */
export async function cleanupStaleContainers(cfg: DockerConfig): Promise<number> {
  const filters = JSON.stringify({ label: ["btr.managed-by=orchestrator"] });
  const { data } = await docker<{ Id: string }[]>(cfg, "GET", "/containers/json", undefined, {
    all: "true",
    filters,
  });
  if (!data?.length) return 0;
  await Promise.allSettled(data.map((c) => removeContainer(cfg, c.Id)));
  return data.length;
}
