
--liquibase formatted sql

--changeset teamai:012-optimize-indexes

-- Q1: Efficient paginated backlog retrieval.
-- Supports:
-- WHERE backlog_id = ? AND status = ?
-- ORDER BY sort_order, id
-- LIMIT ?

CREATE INDEX ix_tasks_backlog_status_order
ON tasks (
    backlog_id,
    status,
    sort_order,
    id
);

-- Q2: Efficient retrieval of architectural decisions.
-- Supports:
-- WHERE project_id = ? AND status = ?
-- ORDER BY updated_at DESC, id
-- LIMIT ?

CREATE INDEX ix_decisions_project_status_order
ON architectural_decisions (
    project_id,
    status,
    updated_at DESC,
    id
);

--rollback DROP INDEX IF EXISTS ix_decisions_project_status_order;
--rollback DROP INDEX IF EXISTS ix_tasks_backlog_status_order;
