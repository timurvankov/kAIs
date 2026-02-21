-- Phase 3.1: Experiment Engine tables

CREATE TABLE IF NOT EXISTS experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  namespace TEXT NOT NULL DEFAULT 'default',
  spec JSONB NOT NULL,
  status JSONB NOT NULL DEFAULT '{"phase": "Pending"}',
  analysis JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(name, namespace)
);

CREATE TABLE IF NOT EXISTS experiment_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID REFERENCES experiments(id) ON DELETE CASCADE,
  run_number INT NOT NULL,
  variables JSONB NOT NULL,
  repeat_number INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  metrics JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_experiment ON experiment_runs(experiment_id, status);

CREATE TABLE IF NOT EXISTS experiment_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES experiment_runs(id) ON DELETE CASCADE,
  cell_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_traces_run ON experiment_traces(run_id, timestamp);

CREATE TABLE IF NOT EXISTS protocol_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_name TEXT NOT NULL,
  from_cell TEXT NOT NULL,
  to_cell TEXT NOT NULL,
  current_state TEXT NOT NULL,
  history JSONB NOT NULL DEFAULT '[]',
  formation_id UUID,
  run_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
