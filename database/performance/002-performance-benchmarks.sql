\set ON_ERROR_STOP on
\pset pager off
\timing on

-- Run after 001-performance-seed.sql. Read only; no rows modified.
-- Run twice to compare warm-cache results; capture both outputs.
SELECT current_database() AS database_name, current_setting('server_version') AS postgres_version;

\echo === Q1: paginated task backlog ===
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id,title,status,priority,sort_order
FROM tasks
WHERE backlog_id = '00000000-0000-4000-8000-00000000f031'
  AND status = 'ready'
ORDER BY sort_order,id
LIMIT 50;

\echo === Q2: accepted architectural decisions ===
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id,decision_key,title,updated_at
FROM architectural_decisions
WHERE project_id = '00000000-0000-4000-8000-00000000f011'
  AND status = 'accepted'
ORDER BY updated_at DESC,id
LIMIT 100;

\echo === Q3: recent chat messages ===
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id,sender,content,created_at
FROM chat_messages
WHERE session_id = '00000000-0000-4000-8000-00000000f041'
ORDER BY created_at DESC,id DESC
LIMIT 50;

\echo === Q4: pending outbox dispatch ===
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id,event_type,next_attempt_at
FROM outbox_events
WHERE status = 'pending'
  AND next_attempt_at <= now()
ORDER BY next_attempt_at,created_at,id
LIMIT 100;

\echo === Q5: project review analytics view ===
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT *
FROM v_ai_review_stats
WHERE project_id = '00000000-0000-4000-8000-00000000f011';

\echo === BENCHMARKS COMPLETE ===
