\set ON_ERROR_STOP on
BEGIN;

-- Fixture: two projects with valid owners and one AI operation.
INSERT INTO users (id,email,password_hash,display_name,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000901','analytics009@example.test','test-hash','Review User',now(),now());
INSERT INTO projects (id,name,created_by,status,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000911','Analytics A','00000000-0000-4000-8000-000000000901','active',now(),now()), ('00000000-0000-4000-8000-000000000912','Analytics B','00000000-0000-4000-8000-000000000901','active',now(),now());
INSERT INTO project_members (project_id,user_id,role,joined_at) VALUES ('00000000-0000-4000-8000-000000000911','00000000-0000-4000-8000-000000000901','owner',now()), ('00000000-0000-4000-8000-000000000912','00000000-0000-4000-8000-000000000901','owner',now());
INSERT INTO ai_operations (id,project_id,initiated_by,operation_type,status,created_at,started_at,finished_at) VALUES ('00000000-0000-4000-8000-000000000921','00000000-0000-4000-8000-000000000911','00000000-0000-4000-8000-000000000901','task_decomposition','completed',now()-interval '2 minutes',now()-interval '1 minute',now());
INSERT INTO review_events (id,ai_operation_id,reviewer_id,outcome,duration_ms,corrections_count) VALUES ('00000000-0000-4000-8000-000000000931','00000000-0000-4000-8000-000000000921','00000000-0000-4000-8000-000000000901','accepted',NULL,0);
INSERT INTO activity_events (id,project_id,event_type,occurred_at) VALUES ('00000000-0000-4000-8000-000000000941','00000000-0000-4000-8000-000000000911','project.created',now());
INSERT INTO outbox_events (id,project_id,event_type,aggregate_type,aggregate_id,deduplication_key,payload,status,created_at,next_attempt_at) VALUES ('00000000-0000-4000-8000-000000000951','00000000-0000-4000-8000-000000000911','github.issue.publish','task','00000000-0000-4000-8000-000000000971','publish:971','{"event_id":"evt-951","schema_version":1,"occurred_at":"2026-11-15T12:00:00Z","data":{"task_id":"971"}}'::jsonb,'pending',now(),now());

-- TEST 1: review rejects invalid outcome
DO $test$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO review_events (id,ai_operation_id,reviewer_id,outcome) VALUES ('00000000-0000-4000-8000-000000000932','00000000-0000-4000-8000-000000000921','00000000-0000-4000-8000-000000000901','unknown');
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'FAIL: review rejects invalid outcome'; END IF;
  RAISE NOTICE 'PASS: review rejects invalid outcome';
END
$test$;

-- TEST 2: review rejects negative duration
DO $test$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO review_events (id,ai_operation_id,reviewer_id,outcome,duration_ms) VALUES ('00000000-0000-4000-8000-000000000933','00000000-0000-4000-8000-000000000921','00000000-0000-4000-8000-000000000901','accepted',-1);
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'FAIL: review rejects negative duration'; END IF;
  RAISE NOTICE 'PASS: review rejects negative duration';
END
$test$;

-- TEST 3: review rejects negative corrections
DO $test$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO review_events (id,ai_operation_id,reviewer_id,outcome,corrections_count) VALUES ('00000000-0000-4000-8000-000000000934','00000000-0000-4000-8000-000000000921','00000000-0000-4000-8000-000000000901','modified',-1);
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'FAIL: review rejects negative corrections'; END IF;
  RAISE NOTICE 'PASS: review rejects negative corrections';
END
$test$;

-- TEST 4: activity rejects blank event type
DO $test$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO activity_events(id,project_id,event_type) VALUES ('00000000-0000-4000-8000-000000000942','00000000-0000-4000-8000-000000000911','  ');
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'FAIL: activity rejects blank event type'; END IF;
  RAISE NOTICE 'PASS: activity rejects blank event type';
END
$test$;

-- TEST 5: activity rejects unmatched entity reference
DO $test$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO activity_events(id,project_id,event_type,entity_type) VALUES ('00000000-0000-4000-8000-000000000943','00000000-0000-4000-8000-000000000911','task.updated','task');
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'FAIL: activity rejects unmatched entity reference'; END IF;
  RAISE NOTICE 'PASS: activity rejects unmatched entity reference';
END
$test$;

-- TEST 6: outbox rejects payload array
DO $test$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO outbox_events(id,project_id,event_type,aggregate_type,aggregate_id,payload) VALUES ('00000000-0000-4000-8000-000000000952','00000000-0000-4000-8000-000000000911','x','task','00000000-0000-4000-8000-000000000971','[]'::jsonb);
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'FAIL: outbox rejects payload array'; END IF;
  RAISE NOTICE 'PASS: outbox rejects payload array';
END
$test$;

-- TEST 7: outbox rejects missing envelope key
DO $test$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO outbox_events(id,project_id,event_type,aggregate_type,aggregate_id,payload) VALUES ('00000000-0000-4000-8000-000000000953','00000000-0000-4000-8000-000000000911','x','task','00000000-0000-4000-8000-000000000971','{"event_id":"evt","data":{}}'::jsonb);
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'FAIL: outbox rejects missing envelope key'; END IF;
  RAISE NOTICE 'PASS: outbox rejects missing envelope key';
END
$test$;

-- TEST 8: outbox rejects negative retry count
DO $test$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    UPDATE outbox_events SET retry_count=-1 WHERE id='00000000-0000-4000-8000-000000000951';
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'FAIL: outbox rejects negative retry count'; END IF;
  RAISE NOTICE 'PASS: outbox rejects negative retry count';
END
$test$;

-- TEST 9: outbox rejects processed status without timestamp
DO $test$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    UPDATE outbox_events SET status='processed' WHERE id='00000000-0000-4000-8000-000000000951';
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'FAIL: outbox rejects processed status without timestamp'; END IF;
  RAISE NOTICE 'PASS: outbox rejects processed status without timestamp';
END
$test$;

-- TEST 10: outbox rejects processed timestamp on pending event
DO $test$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    UPDATE outbox_events SET processed_at=now() WHERE id='00000000-0000-4000-8000-000000000951';
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'FAIL: outbox rejects processed timestamp on pending event'; END IF;
  RAISE NOTICE 'PASS: outbox rejects processed timestamp on pending event';
END
$test$;

-- TEST 11: outbox rejects next_attempt before creation
DO $test$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    UPDATE outbox_events SET next_attempt_at=created_at-interval '1 second' WHERE id='00000000-0000-4000-8000-000000000951';
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'FAIL: outbox rejects next_attempt before creation'; END IF;
  RAISE NOTICE 'PASS: outbox rejects next_attempt before creation';
END
$test$;

-- TEST 12: outbox rejects duplicate deduplication key in project
DO $test$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO outbox_events(id,project_id,event_type,aggregate_type,aggregate_id,deduplication_key,payload) VALUES ('00000000-0000-4000-8000-000000000954','00000000-0000-4000-8000-000000000911','x','task','00000000-0000-4000-8000-000000000971','publish:971','{"event_id":"evt-954","schema_version":1,"occurred_at":"2026-11-15T12:00:00Z","data":{}}'::jsonb);
  EXCEPTION WHEN unique_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'FAIL: outbox rejects duplicate deduplication key in project'; END IF;
  RAISE NOTICE 'PASS: outbox rejects duplicate deduplication key in project';
END
$test$;

-- TEST 13: outbox rejects missing project
DO $test$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO outbox_events(id,project_id,event_type,aggregate_type,aggregate_id,payload) VALUES ('00000000-0000-4000-8000-000000000955','00000000-0000-4000-8000-000000000999','x','task','00000000-0000-4000-8000-000000000971','{"event_id":"evt-955","schema_version":1,"occurred_at":"2026-11-15T12:00:00Z","data":{}}'::jsonb);
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'FAIL: outbox rejects missing project'; END IF;
  RAISE NOTICE 'PASS: outbox rejects missing project';
END
$test$;

-- TEST 14: processed lifecycle is valid and the dashboard keeps NULL review durations unmeasured.
UPDATE outbox_events SET status='processed', processed_at=now(), retry_count=1 WHERE id='00000000-0000-4000-8000-000000000951';
INSERT INTO outbox_events (id,project_id,event_type,aggregate_type,aggregate_id,deduplication_key,payload) VALUES ('00000000-0000-4000-8000-000000000956','00000000-0000-4000-8000-000000000912','github.issue.publish','task','00000000-0000-4000-8000-000000000971','publish:971','{"event_id":"evt-956","schema_version":1,"occurred_at":"2026-11-15T12:00:00Z","data":{}}'::jsonb);
DO $test$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM outbox_events WHERE id='00000000-0000-4000-8000-000000000951' AND status='processed' AND processed_at IS NOT NULL AND retry_count=1) THEN RAISE EXCEPTION 'FAIL: valid processed outbox lifecycle'; END IF;
  IF NOT EXISTS (SELECT 1 FROM v_ai_review_stats WHERE project_id='00000000-0000-4000-8000-000000000911' AND outcome='accepted' AND review_count=1 AND measured_duration_count=0 AND missing_duration_count=1 AND avg_duration_ms IS NULL) THEN RAISE EXCEPTION 'FAIL: null review duration treated incorrectly'; END IF;
  IF NOT EXISTS (SELECT 1 FROM outbox_events WHERE id='00000000-0000-4000-8000-000000000956') THEN RAISE EXCEPTION 'FAIL: dedup key incorrectly global'; END IF;
  RAISE NOTICE 'PASS: processed lifecycle, project-scoped deduplication and accurate review stats';
END
$test$;

ROLLBACK;
\echo Analytics and Events integrity checks finished: fixtures rolled back.
