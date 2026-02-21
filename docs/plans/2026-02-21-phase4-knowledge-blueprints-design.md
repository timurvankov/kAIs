# Phase 4: Knowledge Graph + Blueprints — Design

**Date:** 2026-02-21
**Status:** Approved
**Depends on:** Phase 3 (Experiment Engine, Protocols)

## Architecture

### Knowledge Service (Python + Graphiti + Neo4j)

New Python package `packages/knowledge/` — FastAPI server wrapping Graphiti for temporal knowledge management.

```
Cell Pod (TypeScript)              Knowledge Service (Python)           Neo4j
  |                                    |                                 |
  |-- HTTP POST /recall -------------->|                                 |
  |                                    |-- Graphiti hybrid search ------>|
  |                                    |<- nodes + edges ---------------|
  |<-- [fact1, fact2] ----------------|                                 |
  |                                    |                                 |
  |-- HTTP POST /remember ------------>|                                 |
  |                                    |-- Graphiti add_episode() ------>|
  |                                    |-- LLM entity extraction --> LLM|
  |<-- {factId} ----------------------|                                 |
```

**Communication:** HTTP REST (not gRPC) for simplicity. Cell-runtime calls knowledge service via `fetch()` using `KNOWLEDGE_SERVICE_URL` env var injected by the operator's pod-builder.

**Hierarchical scoping:** Modeled as Graphiti groups/node labels: `platform`, `realm:{ns}`, `formation:{name}`, `cell:{name}`. Each Cell sees its own scope + ancestor scopes (readonly upward).

### Blueprint CRD + Controller

New K8s custom resource for parameterized Formation + Mission templates.

- `spec.parameters[]` — typed parameters with defaults, validation
- `spec.formation` — Formation template with `{{ param }}` placeholders
- `spec.mission` — optional Mission template
- `spec.evidence` — links to experiments
- `status` — usageCount, avgSuccessRate, versions

Template rendering via **nunjucks** (Jinja2 port to Node.js) for conditional logic (`{% if %}`) and variable substitution.

BlueprintController watches Blueprint CRDs, tracks versions, updates usage stats. Instantiation done via CLI `kais blueprint use`.

### Knowledge Tools in Cell-Runtime

Three new optional tools (registered when `KNOWLEDGE_SERVICE_URL` is present):
- `recall` — search knowledge service for relevant facts
- `remember` — store a fact
- `correct` — invalidate a previous fact

Automatic knowledge injection: ContextAssembler queries knowledge service on Cell/Mission start, appends relevant facts to system prompt.

### Post-Mission Knowledge Extraction

Hook in MissionController after completion (success or failure):
- Gathers mission events, decisions, errors
- Single LLM call to extract 3-7 reusable facts
- Stores facts at formation scope via knowledge service

### Package Structure

```
packages/knowledge/
  pyproject.toml
  Dockerfile
  src/knowledge/
    main.py             # FastAPI app, routes
    store.py            # GraphitiKnowledgeStore
    models.py           # Pydantic models (Fact, SearchOptions)
    scoping.py          # Hierarchical scope resolution
    promotion.py        # Knowledge promotion logic
  tests/
    test_store.py
```

## Implementation Order

1. Core types — KnowledgeStore interface, Fact, Blueprint types in `@kais/core`
2. Python knowledge service — FastAPI + Graphiti + Neo4j, Dockerfile
3. Blueprint CRD + Controller — CRD YAML, BlueprintController, nunjucks rendering
4. Knowledge tools — recall/remember/correct in cell-runtime
5. Post-mission extraction — hook in MissionController
6. Infrastructure — Neo4j Helm chart, knowledge service deployment, pod-builder env var
7. CLI commands — knowledge + blueprint commands
8. Database migrations — facts, blueprint_versions, blueprint_usage tables
9. Tests + verification

## Key Decisions

- **Python knowledge service** (not TypeScript) — required by Graphiti library
- **HTTP REST** (not gRPC) — simplicity, debuggability
- **nunjucks** for Blueprint templates — full Jinja2 compatibility needed for conditionals
- **KnowledgeStore interface in TypeScript core** — abstract contract, HTTP client adapter in cell-runtime
- **No breaking changes** — Cells without knowledge tools work unchanged
