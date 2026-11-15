
\set ON_ERROR_STOP on
\pset pager off

BEGIN;

-- Candidate index for Q1: backlog pagination
CREATE INDEX ix_tasks_backlog_status_order_test
ON tasks (backlog_id, status, sort_order, id);

-- Candidate index for Q2: accepted decisions
CREATE INDEX ix_decisions_project_status_order_test
ON architectural_decisions
    (project_id, status, updated_at DESC, id);

\echo === Q1: tasks with candidate index ===

EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, title, status, priority, sort_order
FROM tasks
WHERE backlog_id =
    '00000000-0000-4000-8000-00000000f031'
  AND status = 'ready'
ORDER BY sort_order, id
LIMIT 50;

\echo === Q2: decisions with candidate index ===

EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, decision_key, title, updated_at
FROM architectural_decisions
WHERE project_id =
    '00000000-0000-4000-8000-00000000f011'
  AND status = 'accepted'
ORDER BY updated_at DESC, id
LIMIT 100;

ROLLBACK;

\echo Index experiment finished: candidate indexes rolled back.
