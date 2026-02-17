# Contributing to BTR Agentic ALM

## Development Setup

1. Install [Bun](https://bun.sh) runtime
2. Clone the repository
3. Run `bun install` to install dependencies

## Project Guidelines

This project has specific requirements for toolchain, code quality, and testing.
**See [CLAUDE.md](./CLAUDE.md) for the authoritative project guidelines.**

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

1. Run `bun run check` to verify formatting, linting, and type safety
2. Run `bun test` to ensure all tests pass
3. Review your diff with `git diff --staged`

## Pull Requests

1. Create a feature branch from `main`
2. Make atomic commits following the guidelines above
3. Ensure all CI checks pass
4. Request review from maintainers
5. Address review feedback with new commits (not squashed)

## Code Review

All changes go through code review. The `AUDIT.md` file tracks findings — remove entries once fixed.
