CREATE TABLE IF NOT EXISTS review_diffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    file_path VARCHAR(512) NOT NULL,
    action VARCHAR(16) NOT NULL,
    old_content TEXT,
    new_content TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(ticket_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_review_diffs_ticket ON review_diffs(ticket_id);
