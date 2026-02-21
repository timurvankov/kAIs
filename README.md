# kAIs

Kubernetes-native multi-agent AI platform. Deploy autonomous AI agents as Kubernetes resources — they communicate via NATS, persist state in Postgres, and scale through Formations.

## Architecture

```
kubectl apply -f cell.yaml
         │
         ▼
┌─────────────────┐     ┌──────────┐     ┌──────────┐
│  kais-operator   │────▶│  Cell Pod │────▶│   NATS   │
│  (watches CRDs)  │     │  (agent)  │     │(messages)│
└─────────────────┘     └──────────┘     └──────────┘
         │                    │
         │              ┌──────────┐
         │              │ Postgres │
         │              │  (logs)  │
         │              └──────────┘
         ▼
┌─────────────────┐
│   Formation      │──▶ N x Cell Pods + topology routing
│   Mission        │──▶ multi-step task orchestration
└─────────────────┘
```

**Core abstractions:**

| Resource | Description |
|----------|-------------|
| **Cell** | Single AI agent — runs as a Pod with an LLM provider, tools, and a system prompt |
| **Formation** | Group of Cells with a communication topology (mesh, star, hierarchy, ring, custom) |
| **Mission** | Multi-step task assigned to a Formation — tracks progress, handles failures |

## Packages

| Package | Description |
|---------|-------------|
| `@kais/core` | Schemas (Zod), envelopes, retry, error types |
| `@kais/operator` | K8s operator — watches Cell/Formation/Mission CRDs, reconciles Pods |
| `@kais/cell-runtime` | Pod entrypoint — connects to NATS, runs LLM think loop, executes tools |
| `@kais/mind` | LLM provider abstraction (Anthropic, OpenAI, Ollama, Mock) |
| `@kais/api` | REST/WS API server — logs, usage, exec endpoints |
| `@kais/cli` | `kais` CLI — kubectl plugin for managing cells, formations, missions |

## Quick Start

### Prerequisites

- Node.js >= 22
- pnpm >= 9
- Kubernetes cluster (or kind for local dev)
- Helm

### Install

```bash
git clone https://github.com/timurvankov/kAIs.git
cd kAIs
pnpm install
pnpm run build
```

### Deploy to Cluster

```bash
# Apply CRDs
kubectl apply -f deploy/crds/

# Deploy infrastructure (Postgres, NATS)
helmfile -f deploy/helmfile.yaml apply

# Deploy operator
helm install kais-operator deploy/helm/kais-operator

# Deploy API server
helm install kais-api deploy/helm/kais-api
```

### Create Your First Cell

```yaml
# researcher.yaml
apiVersion: kais.io/v1
kind: Cell
metadata:
  name: researcher
spec:
  mind:
    provider: anthropic
    model: claude-sonnet-4-20250514
    systemPrompt: |
      You are a research assistant. When you receive a topic,
      search for information and report findings.
    temperature: 0.7
  tools:
    - name: web_search
    - name: send_message
  resources:
    maxTokensPerTurn: 4096
    maxCostPerHour: 0.50
```

```bash
kubectl apply -f researcher.yaml
kais status researcher
kais logs cell researcher
```

### Create a Formation

```yaml
apiVersion: kais.io/v1
kind: Formation
metadata:
  name: research-team
spec:
  cells:
    - name: lead
      replicas: 1
      spec:
        mind:
          provider: anthropic
          model: claude-sonnet-4-20250514
          systemPrompt: "You coordinate the research team."
        tools:
          - name: send_message
    - name: worker
      replicas: 3
      spec:
        mind:
          provider: ollama
          model: qwen2.5:7b
          systemPrompt: "You research topics assigned to you."
        tools:
          - name: web_search
          - name: send_message
  topology:
    type: star
    hub: lead
```

```bash
kubectl apply -f research-team.yaml
kais topology research-team
kais scale research-team worker 5
```

## More Examples

The `examples/` directory contains ready-to-use YAML manifests:

| Example | Description |
|---------|-------------|
| `researcher.yaml` | Single Cell with Anthropic — basic agent with tools |
| `ollama-local.yaml` | Single Cell with Ollama — free, self-hosted LLM |
| `research-team.yaml` | Formation with **star** topology — lead + 3 workers |
| `hierarchy-formation.yaml` | Formation with **hierarchy** — director → team leads → workers |
| `ring-consensus.yaml` | Formation with **ring** topology — iterative peer review |
| `stigmergy-swarm.yaml` | Formation with **stigmergy** — blackboard-based coordination |
| `custom-routing.yaml` | Formation with **custom** routing — explicit data pipeline |
| `code-review-mission.yaml` | Mission with completion checks — automated code review task |

```bash
# Try any example
kubectl apply -f examples/research-team.yaml
kais status research-team
```

## LLM Providers

| Provider | Config | Notes |
|----------|--------|-------|
| Anthropic | `provider: anthropic` | Requires `ANTHROPIC_API_KEY` |
| OpenAI | `provider: openai` | Requires `OPENAI_API_KEY` |
| Ollama | `provider: ollama` | Free, self-hosted. Set `OLLAMA_HOST` if not localhost |

## Testing

```bash
# Unit tests (598 tests, ~1s)
pnpm run test:unit

# Integration tests (requires Postgres + NATS)
POSTGRES_URL=postgres://postgres:test@localhost:5432/kais_test \
NATS_URL=nats://localhost:4222 \
pnpm run test:integration

# E2E tests (requires kind cluster)
pnpm run test:e2e

# LLM smoke tests (requires ANTHROPIC_API_KEY)
ANTHROPIC_API_KEY=sk-... pnpm run test:llm-smoke
```

## CI/CD

GitHub Actions runs 4 test levels on every PR:

1. **Unit** — lint + 598 tests, no external deps
2. **Integration** — Postgres + NATS service containers, tests cross-package flows
3. **E2E** — kind cluster + Ollama, tests full K8s lifecycle
4. **LLM Smoke** (main only) — real Anthropic API calls to verify provider integration

## License

[AGPL-3.0](LICENSE)
