# Contributing to kAIs

## Setup

```bash
git clone https://github.com/timurvankov/kAIs.git
cd kAIs
pnpm install
pnpm run build
```

Requirements: Node.js >= 22, pnpm >= 9.

## Development Workflow

1. Create a feature branch from `main`
2. Make changes, write tests
3. Run lint and tests locally
4. Push and open a PR — CI runs automatically

## Code Structure

```
packages/
  core/           # Shared schemas, types, utilities
  operator/       # K8s operator (CRD watchers, reconcilers)
  cell-runtime/   # Cell Pod entrypoint (LLM loop, tools)
  mind/           # LLM provider abstraction
  api/            # REST/WS API server
  cli/            # kais CLI tool
crds/             # Kubernetes CRD definitions
helm/             # Helm charts
tests/
  integration/    # Cross-package tests (Postgres + NATS)
  e2e/            # End-to-end tests (kind cluster + Ollama)
  llm-smoke/      # Real LLM provider smoke tests
```

## Running Tests

### Unit Tests

No external dependencies required:

```bash
pnpm run test:unit
```

### Integration Tests

Requires Postgres and NATS running locally:

```bash
# Start services
docker run -d --name kais-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=kais_test \
  postgres:16

docker run -d --name kais-nats -p 4222:4222 \
  nats:latest --jetstream

# Initialize schema
PGPASSWORD=test psql -h localhost -U postgres -d kais_test \
  -f helm/kais-infra/sql/init.sql \
  -f helm/kais-infra/sql/phase2.sql

# Run tests
POSTGRES_URL=postgres://postgres:test@localhost:5432/kais_test \
NATS_URL=nats://localhost:4222 \
pnpm run test:integration

# Cleanup
docker rm -f kais-pg kais-nats
```

### E2E Tests

Requires a kind cluster:

```bash
bash tests/e2e/setup.sh
pnpm run test:e2e
bash tests/e2e/teardown.sh
```

### LLM Smoke Tests

Requires an Anthropic API key:

```bash
ANTHROPIC_API_KEY=sk-... pnpm run test:llm-smoke
```

## Lint

```bash
pnpm run lint
```

Each package runs `tsc --noEmit`. Fix type errors before pushing.

## Code Style

- TypeScript strict mode across all packages
- ESM only (`"type": "module"`, `.js` extensions in imports)
- Zod for runtime schema validation, `z.infer<>` for type derivation
- Vitest for all test levels

## Building Docker Images

```bash
docker build -f Dockerfile.operator -t kais-operator .
docker build -f Dockerfile.cell -t kais-cell .
```

## Pull Requests

- All PRs target `main`
- CI must pass (unit + integration + e2e)
- Changes to `.github/`, `crds/`, or `helmfile.yaml` require owner review (CODEOWNERS)
- LLM smoke tests run only on `main` merges

## Architecture Decisions

- **CRDs over ConfigMaps** — Cells, Formations, Missions are first-class K8s resources
- **NATS JetStream** — durable messaging between cells, event persistence
- **Topology routing** — cells communicate through configurable topologies (mesh, star, hierarchy, ring, stigmergy, custom)
- **Budget enforcement** — cells track LLM costs and enforce per-cell and per-formation limits
- **ownerReferences** — K8s garbage collection handles cascade deletion (Formation -> Cells -> Pods)
