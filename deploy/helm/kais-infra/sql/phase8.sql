-- Phase 8: Recursive Ecosystems — cell tree, budget ledger, spawn requests

-- Cell tree (supplements K8s ownerReferences with queryable hierarchy)
CREATE TABLE IF NOT EXISTS cell_tree (
  cell_id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES cell_tree(cell_id) ON DELETE CASCADE,
  root_id TEXT NOT NULL,
  depth INT NOT NULL DEFAULT 0,
  path TEXT NOT NULL,                -- materialized path: "root/parent/child"
  descendant_count INT NOT NULL DEFAULT 0,
  namespace TEXT NOT NULL DEFAULT 'default',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cell_tree_root ON cell_tree(root_id);
CREATE INDEX IF NOT EXISTS idx_cell_tree_parent ON cell_tree(parent_id);
CREATE INDEX IF NOT EXISTS idx_cell_tree_namespace ON cell_tree(namespace);

-- Budget ledger (append-only for auditability)
CREATE TABLE IF NOT EXISTS budget_ledger (
  id BIGSERIAL PRIMARY KEY,
  cell_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('allocate', 'spend', 'reclaim', 'top_up')),
  amount NUMERIC NOT NULL,
  from_cell_id TEXT,                  -- for allocate/top_up: parent
  to_cell_id TEXT,                    -- for allocate/top_up: child
  balance_after NUMERIC NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_ledger_cell ON budget_ledger(cell_id, created_at DESC);

-- Budget balances (materialized from ledger, updated on each operation)
CREATE TABLE IF NOT EXISTS budget_balances (
  cell_id TEXT PRIMARY KEY,
  allocated NUMERIC NOT NULL DEFAULT 0,
  spent NUMERIC NOT NULL DEFAULT 0,
  delegated NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Spawn requests (approval workflow)
CREATE TABLE IF NOT EXISTS spawn_requests (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  namespace TEXT NOT NULL DEFAULT 'default',
  requestor_cell_id TEXT NOT NULL,
  requested_spec JSONB NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spawn_requests_status ON spawn_requests(status);
CREATE INDEX IF NOT EXISTS idx_spawn_requests_requestor ON spawn_requests(requestor_cell_id);

-- NATS credentials (per-Cell authentication)
CREATE TABLE IF NOT EXISTS nats_credentials (
  id BIGSERIAL PRIMARY KEY,
  cell_id TEXT NOT NULL,
  namespace TEXT NOT NULL DEFAULT 'default',
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  permissions JSONB NOT NULL,            -- {publish: [...], subscribe: [...]}
  created_at TIMESTAMPTZ DEFAULT now(),
  revoked_at TIMESTAMPTZ                 -- NULL = active
);

CREATE INDEX IF NOT EXISTS idx_nats_creds_cell ON nats_credentials(cell_id);
CREATE INDEX IF NOT EXISTS idx_nats_creds_active ON nats_credentials(cell_id) WHERE revoked_at IS NULL;

-- Audit log (append-only, immutable)
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor TEXT NOT NULL,                    -- user name or cell ID
  action TEXT NOT NULL,                   -- create, update, delete, approve, etc.
  resource_type TEXT NOT NULL,            -- cells, formations, missions, budgets, etc.
  resource_id TEXT,                       -- specific resource name/ID
  namespace TEXT NOT NULL DEFAULT 'default',
  detail JSONB,                           -- request body, result, etc.
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  status_code INT                         -- HTTP status code if from API
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_time ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id);
