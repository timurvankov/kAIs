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
