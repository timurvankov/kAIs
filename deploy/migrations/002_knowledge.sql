-- Knowledge facts (metadata — actual graph data in Neo4j)
CREATE TABLE IF NOT EXISTS facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  scope_level TEXT NOT NULL,
  scope_realm TEXT,
  scope_formation TEXT,
  scope_cell TEXT,
  source_type TEXT NOT NULL,
  source_id UUID,
  confidence NUMERIC NOT NULL DEFAULT 0.5,
  valid_from TIMESTAMPTZ DEFAULT now(),
  valid_until TIMESTAMPTZ,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facts_scope ON facts(scope_level, scope_realm, scope_formation);
CREATE INDEX IF NOT EXISTS idx_facts_tags ON facts USING gin(tags);

-- Fact references (which missions used which facts)
CREATE TABLE IF NOT EXISTS fact_references (
  fact_id UUID REFERENCES facts(id) ON DELETE CASCADE,
  mission_id UUID,
  used_at TIMESTAMPTZ DEFAULT now(),
  was_helpful BOOLEAN,
  PRIMARY KEY (fact_id, mission_id)
);

-- Blueprint versions
CREATE TABLE IF NOT EXISTS blueprint_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_name TEXT NOT NULL,
  blueprint_namespace TEXT NOT NULL,
  version INT NOT NULL,
  spec JSONB NOT NULL,
  changes TEXT,
  experiment_source UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blueprint_versions ON blueprint_versions(blueprint_name, version DESC);

-- Blueprint usage tracking
CREATE TABLE IF NOT EXISTS blueprint_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_name TEXT NOT NULL,
  formation_id UUID,
  mission_id UUID,
  parameters JSONB NOT NULL,
  outcome TEXT,
  cost NUMERIC,
  duration_seconds INT,
  created_at TIMESTAMPTZ DEFAULT now()
);
