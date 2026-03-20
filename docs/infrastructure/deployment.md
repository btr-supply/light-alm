# Deployment

Docker Compose manages the infrastructure stack. Two modes are provided: **dev** (DB only, services run locally) and **prod** (fully containerized).

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose V2
- [Bun](https://bun.sh) (dev mode only)

## Environment

Copy `.env.example` to `.env` and configure:

| Variable | Required | Description |
|----------|----------|-------------|
| `PK_<PAIR>` | yes | EOA private key per trading pair |
| `PAIRS` | yes | Comma-separated active pairs (e.g. `USDC-USDT`) |
| `O2_PASSWORD` | prod | OpenObserve root password (dev default: `btr_dev_2024`) |
| `O2_TOKEN` | prod | Base64-encoded `user:password` for O2 HTTP ingestion |
| `API_TOKEN` | prod | Bearer token for admin API endpoints |
| `DRAGONFLY_URL` | no | Redis URL (default: `redis://localhost:6379`) |
| `O2_URL` | no | OpenObserve URL (disabled when unset) |
| `O2_ORG` | no | OpenObserve organization (default: `default`) |
| `API_PORT` | no | API listen port (default: `3001`) |
| `LOG_LEVEL` | no | `debug` / `info` / `warn` / `error` (default: `info`) |
| `INTERVAL_SEC` | no | Scheduler cycle in seconds (default: `900`) |
| `ORCHESTRATOR_MODE` | no | `docker` (container-per-worker) or `process` (default) |
| `DOCKER_HOST` | no | Docker socket/proxy URL (default: `/var/run/docker.sock`) |
| `DOCKER_NETWORK` | no | Docker network for workers (default: `agentic-alm_btr-net`) |
| `DOCKER_IMAGE` | no | Image for worker containers (default: `btr-alm`) |

## Dev Mode

Runs DragonflyDB and OpenObserve in Docker. Backend and dashboard run locally with hot reload.

```bash
# Terminal 1 — infrastructure + orchestrator + API (watch mode)
bun run dev

# Terminal 2 — dashboard (Vite dev server with HMR)
bun run dev:front
```

### Endpoints

| Service | URL |
|---------|-----|
| Backend API | http://localhost:3001 |
| Dashboard | http://localhost:5173 |
| DragonflyDB | redis://localhost:6379 |
| OpenObserve UI | http://localhost:5080 (admin@btr.supply / `O2_PASSWORD`) |

### Scripts

| Script | What it does |
|--------|-------------|
| `bun run dev` | Starts Docker infra, runs orchestrator + API with `--watch` |
| `bun run dev:infra` | Starts only DragonflyDB + OpenObserve containers |
| `bun run dev:api` | API server only with `--watch` |
| `bun run dev:back` | Orchestrator + API with `--watch` |
| `bun run dev:front` | Dashboard Vite dev server (port 5173, proxies `/api` to :3001) |

### How it works

Docker Compose uses [profiles](https://docs.docker.com/compose/profiles/) to separate infrastructure from application services. The `api`, `orchestrator`, and `dashboard` services are tagged with `profiles: [prod]`, so a plain `docker compose up -d` only starts the DB stack.

In dev mode, `bun run dev` starts Docker infra then spawns both the orchestrator and API server as child processes with `--watch` for hot reload.

The dashboard's Vite dev server proxies `/api/*` requests to `http://localhost:3001` (see `dashboard/vite.config.ts`), so the frontend works seamlessly against the local backend.

## Prod Mode

Five services run in Docker: DragonflyDB, OpenObserve, API, orchestrator, and dashboard. The API and orchestrator are **decoupled** — the orchestrator can crash or restart without affecting API availability.

```bash
# Start (builds images if needed)
bun run prod

# Stop
bun run prod:down
```

### Endpoints

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:80 |
| Backend API | http://localhost:3001 |
| DragonflyDB | redis://localhost:6379 |
| OpenObserve UI | http://localhost:5080 |

### Container details

| Service | Image | Port | Notes |
|---------|-------|------|-------|
| `dragonfly` | `dragonflydb/dragonfly` | 6379 | 256 MB max, 2 threads, persistent volume |
| `openobserve` | `zinclabs/openobserve` | 5080 | Persistent volume, telemetry disabled |
| `docker-proxy` | `tecnativa/docker-socket-proxy` | 2375 | Restricts Docker API access for orchestrator |
| `api` | `btr-alm` | 3001 | Stateless, reads DragonflyDB + O2 |
| `orchestrator` | `btr-alm` | — | Spawns worker containers via docker-proxy |
| `dashboard` | `dashboard/Dockerfile` | 80 | Static SPA served by busybox httpd |

### Worker containers

In prod mode, the orchestrator spawns worker containers via the Docker socket proxy. Each worker runs as a sibling container with resource limits:

- **Memory**: 512 MB hard limit, 256 MB soft limit
- **CPU**: 0.5 cores per worker
- **Capabilities**: All dropped, `no-new-privileges`
- **Restart**: Managed by orchestrator (not Docker restart policy)
- **Network**: Joins `btr-net` for DragonflyDB/O2 access

Workers are labeled `btr.managed-by=orchestrator` and cleaned up automatically on orchestrator startup (crash recovery).

All ports bind to `127.0.0.1` only (not exposed to the network). Use a reverse proxy (nginx, Caddy) for external access.

### Startup order

Services start with dependency health checks:

```
dragonfly (healthy) ──┐
                      ├── api (healthy) ── dashboard
openobserve (healthy) ┘

dragonfly (healthy) ──┐
                      ├── orchestrator ──> worker containers (via docker-proxy)
openobserve (healthy) ┘
```

The API and orchestrator start independently — neither depends on the other.

## Volumes

| Volume | Service | Path | Purpose |
|--------|---------|------|---------|
| `dragonfly-data` | dragonfly | `/data` | State persistence across restarts |
| `o2-data` | openobserve | `/data` | Log and metrics storage |

To reset all data:

```bash
docker compose --profile prod down -v
```

## See Also

- [Process Orchestration](./orchestrator.md) — worker spawning, DragonflyDB locks
- [REST API](./api.md) — endpoints, authentication
- [Observability](./observability.md) — OpenObserve streams, log ingestion
