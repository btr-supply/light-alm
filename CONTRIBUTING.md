# Contributing to BTR Agentic ALM

## Development Setup

1. Install [Bun](https://bun.sh) runtime
2. Clone the repository
3. Run `bun install` to install dependencies

## Toolchain

- **Runtime & package manager**: `bun` and `bunx` — NEVER use `npm`, `npx`, `yarn`, or `node`
- **Type checking**: `bunx tsgo` — NEVER use `tsc`
- **Linting**: `bunx oxlint` — NEVER use `eslint`
- **Testing**: `bun test`

## Commit Strategy

### Atomic Commits

All changes must be committed as **small, logical units**. Each commit should:

1. **Do one thing** — A single logical change, not multiple unrelated changes
2. **Be self-contained** — The codebase should work after each commit
3. **Have a descriptive message** — Explain what and why, not just what

### Commit Message Format

```
<type>: <subject>

<body (optional)>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code refactoring without behavior change
- `test`: Adding or modifying tests
- `docs`: Documentation changes
- `chore`: Maintenance tasks, dependency updates
- `config`: Configuration changes

**Examples:**

```
feat: add volatility force calculation using Parkinson estimator

fix: correct tick alignment in V4 position minting

test: add unit tests for water-filling allocation algorithm

docs: document BTR force model in ARCHITECTURE.md
```

### Logical Unit Examples

| Good (Atomic) | Bad (Bloated) |
|---------------|---------------|
| `feat: add Redis client for distributed locking` | `feat: add Redis, logging, and fix bugs` |
| `test: add tests for GeckoTerminal API client` | `test: add all tests` |
| `refactor: extract position minting to separate function` | `refactor: clean up code` |

### Commit Granularity

- **One module = One commit** for initial setup
- **One test file = One commit** when adding tests
- **One feature = One commit** even if it touches multiple files

### Before Committing

1. Run `bunx oxlint` to check for linting issues
2. Run `bunx tsgo` to verify type safety
3. Run `bun test` to ensure all tests pass
4. Review your diff with `git diff --staged`

## Code Quality

Every implementation must be reviewed for:

- **Performance** — no unnecessary allocations, O(n) over O(n*k)
- **Genericity** — reusable patterns, no hardcoded values that should be configurable
- **Conciseness** — minimal code to achieve the goal, no dead code, no over-engineering

## Testing

### Test Categories

- **Unit tests** (`tests/unit/*.test.ts`): Pure function tests with no external dependencies
- **Integration tests** (`tests/integration/*.test.ts`): Tests against real external APIs (skip gracefully when unavailable)
- **E2E tests** (`tests/e2e/*.test.ts`): Full system flow tests
- **Isolated tests** (`tests/isolated/*.isolated.ts`): Tests requiring process isolation for `mock.module`

### Testing Rules

- Test **exported functions only** — never reimplement logic inline
- Every `expect()` must assert a **property of the system under test**, not a JS built-in
- No `expect(true).toBe(true)` or other tautologies
- Test names must match assertions
- Mock only I/O boundaries (fetch, DB, Redis, RPC) — never mock pure functions
- Helpers go in `tests/helpers.ts` — no duplicated setup

## Pull Requests

1. Create a feature branch from `main`
2. Make atomic commits following the guidelines above
3. Ensure all CI checks pass
4. Request review from maintainers
5. Address review feedback with new commits (not squashed)

## Code Review

All changes go through code review. The `AUDIT.md` file tracks findings — remove entries once fixed.
