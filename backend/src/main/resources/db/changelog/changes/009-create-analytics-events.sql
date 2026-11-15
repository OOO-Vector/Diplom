--liquibase formatted sql

--changeset teamai:009-create-analytics-events splitStatements:false

-- Human review of an AI result. Multiple review rounds per operation are possible.
CREATE TABLE review_events (
    id UUID PRIMARY KEY,
    ai_operation_id UUID NOT NULL,
    reviewer_id UUID NOT NULL,
    outcome VARCHAR(20) NOT NULL,
    duration_ms BIGINT,
    corrections_count INTEGER NOT NULL DEFAULT 0,
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_review_operation FOREIGN KEY (ai_operation_id) REFERENCES ai_operations(id),
    CONSTRAINT fk_review_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(id),
    CONSTRAINT ck_review_outcome CHECK (outcome IN ('accepted', 'modified', 'rejected')),
    CONSTRAINT ck_review_duration CHECK (duration_ms IS NULL OR duration_ms >= 0),
    CONSTRAINT ck_review_corrections CHECK (corrections_count >= 0)
);

-- Project activity timeline; system events may omit actor_id.
CREATE TABLE activity_events (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    actor_id UUID,
    event_type VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_activity_project FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT fk_activity_actor FOREIGN KEY (actor_id) REFERENCES users(id),
    CONSTRAINT ck_activity_event_type CHECK (length(btrim(event_type)) > 0),
    CONSTRAINT ck_activity_entity_pair CHECK ((entity_type IS NULL) = (entity_id IS NULL)),
    CONSTRAINT ck_activity_entity_type CHECK (entity_type IS NULL OR length(btrim(entity_type)) > 0)
);

-- Transactional outbox for reliable asynchronous processing.
-- Worker delivery and retry logic belongs in the backend, not in this migration.
CREATE TABLE outbox_events (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    aggregate_type VARCHAR(50) NOT NULL,
    aggregate_id UUID NOT NULL,
    deduplication_key VARCHAR(150),
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,

    CONSTRAINT fk_outbox_project FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT uq_outbox_project_deduplication UNIQUE (project_id, deduplication_key),
    CONSTRAINT ck_outbox_status CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
    CONSTRAINT ck_outbox_retry_count CHECK (retry_count >= 0),
    CONSTRAINT ck_outbox_identity CHECK (length(btrim(event_type)) > 0 AND length(btrim(aggregate_type)) > 0),
    CONSTRAINT ck_outbox_deduplication CHECK (deduplication_key IS NULL OR length(btrim(deduplication_key)) > 0),
    CONSTRAINT ck_outbox_payload_object CHECK (jsonb_typeof(payload) = 'object'),
    
    CONSTRAINT ck_outbox_envelope CHECK (
        jsonb_exists(payload, 'event_id')
        AND jsonb_exists(payload, 'schema_version')
        AND jsonb_exists(payload, 'occurred_at')
        AND jsonb_exists(payload, 'data')
    ),

    CONSTRAINT ck_outbox_attempt_time CHECK (next_attempt_at >= created_at),
    CONSTRAINT ck_outbox_processed_time CHECK (processed_at IS NULL OR processed_at >= created_at),
    CONSTRAINT ck_outbox_processed_state CHECK ((status = 'processed') = (processed_at IS NOT NULL)),
    CONSTRAINT ck_outbox_last_error CHECK (last_error IS NULL OR length(btrim(last_error)) > 0)
);

CREATE INDEX ix_review_events_operation_time ON review_events (ai_operation_id, reviewed_at DESC);
CREATE INDEX ix_review_events_reviewer_time ON review_events (reviewer_id, reviewed_at DESC);
CREATE INDEX ix_activity_events_project_time ON activity_events (project_id, occurred_at DESC);
CREATE INDEX ix_activity_events_type_time ON activity_events (project_id, event_type, occurred_at DESC);
CREATE INDEX ix_outbox_dispatch ON outbox_events (status, next_attempt_at);
CREATE INDEX ix_outbox_project_time ON outbox_events (project_id, created_at DESC);

-- Dashboard: no duration recorded is NOT equivalent to a 0ms duration.
CREATE VIEW v_ai_review_stats AS
SELECT a.project_id,
       r.outcome,
       count(*) AS review_count,
       count(r.duration_ms) AS measured_duration_count,
       count(*) - count(r.duration_ms) AS missing_duration_count,
       round(avg(r.duration_ms)::numeric, 2) AS avg_duration_ms,
       sum(r.corrections_count) AS total_corrections
FROM review_events r
JOIN ai_operations a ON a.id = r.ai_operation_id
GROUP BY a.project_id, r.outcome;

--rollback DROP VIEW IF EXISTS v_ai_review_stats;
--rollback DROP TABLE IF EXISTS outbox_events;
--rollback DROP TABLE IF EXISTS activity_events;
--rollback DROP TABLE IF EXISTS review_events;
