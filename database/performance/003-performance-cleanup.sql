\set ON_ERROR_STOP on
\pset pager off
\timing on

-- This removes ONLY the dedicated synthetic performance fixture project.
-- Do not change the IDs unless the seed was intentionally changed.
BEGIN;

DO $guard$
BEGIN
 IF EXISTS (SELECT 1 FROM projects
            WHERE id='00000000-0000-4000-8000-00000000f011'
              AND name <> 'PERFORMANCE TEST - TEMPORARY') THEN
    RAISE EXCEPTION 'Refusing cleanup: project ID exists but name is unexpected';
 END IF;
END;
$guard$;

DELETE FROM review_events r
USING ai_operations a
WHERE r.ai_operation_id=a.id
  AND a.project_id='00000000-0000-4000-8000-00000000f011';

DELETE FROM chat_message_sources cms
USING chat_messages m
WHERE cms.message_id=m.id
  AND m.project_id='00000000-0000-4000-8000-00000000f011';

DELETE FROM chat_messages WHERE project_id='00000000-0000-4000-8000-00000000f011';
DELETE FROM chat_sessions WHERE project_id='00000000-0000-4000-8000-00000000f011';
DELETE FROM ai_operations WHERE project_id='00000000-0000-4000-8000-00000000f011';
DELETE FROM outbox_events WHERE project_id='00000000-0000-4000-8000-00000000f011';
DELETE FROM architectural_decisions WHERE project_id='00000000-0000-4000-8000-00000000f011';
DELETE FROM tasks WHERE backlog_id='00000000-0000-4000-8000-00000000f031';
DELETE FROM backlogs WHERE project_id='00000000-0000-4000-8000-00000000f011';
DELETE FROM specifications WHERE project_id='00000000-0000-4000-8000-00000000f011';
DELETE FROM project_members WHERE project_id='00000000-0000-4000-8000-00000000f011';
DELETE FROM projects WHERE id='00000000-0000-4000-8000-00000000f011';
DELETE FROM users WHERE id='00000000-0000-4000-8000-00000000f001' AND email='performance-fixture@example.test';

COMMIT;
\echo Performance fixtures removed.
