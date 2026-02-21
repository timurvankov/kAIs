CREATE TABLE IF NOT EXISTS formations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  namespace TEXT NOT NULL DEFAULT 'default',
  spec JSONB NOT NULL,
  status JSONB NOT NULL DEFAULT '{"phase": "Pending"}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(name, namespace)
);

CREATE TABLE IF NOT EXISTS missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  namespace TEXT NOT NULL DEFAULT 'default',
  spec JSONB NOT NULL,
  status JSONB NOT NULL DEFAULT '{"phase": "Pending", "attempt": 0}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(name, namespace)
);

CREATE TABLE IF NOT EXISTS mission_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID REFERENCES missions(id) ON DELETE CASCADE,
  attempt INT NOT NULL,
  check_name TEXT NOT NULL,
  status TEXT NOT NULL,
  output TEXT,
  checked_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mission_checks ON mission_checks(mission_id, attempt);
