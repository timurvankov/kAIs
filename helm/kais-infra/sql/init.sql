CREATE TABLE IF NOT EXISTS cell_events (
    id BIGSERIAL PRIMARY KEY,
    cell_name TEXT NOT NULL,
    namespace TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cell_events_cell ON cell_events(namespace, cell_name);
CREATE INDEX idx_cell_events_type ON cell_events(event_type);
CREATE INDEX idx_cell_events_created ON cell_events(created_at);
