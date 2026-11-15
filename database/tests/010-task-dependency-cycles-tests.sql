\set ON_ERROR_STOP on
\pset pager off

BEGIN;

INSERT INTO users (id,email,password_hash,display_name,created_at,updated_at)
VALUES ('00000000-0000-4000-8000-000000001001','cycles010@example.test','test-hash','Cycle Test User',now(),now());

INSERT INTO projects (id,name,created_by,status,created_at,updated_at)
VALUES ('00000000-0000-4000-8000-000000001011','Cycle Test Project','00000000-0000-4000-8000-000000001001','active',now(),now());

INSERT INTO project_members (project_id,user_id,role,joined_at)
VALUES ('00000000-0000-4000-8000-000000001011','00000000-0000-4000-8000-000000001001','owner',now());

INSERT INTO specifications (id,project_id,uploaded_by,version,title,content)
VALUES ('00000000-0000-4000-8000-000000001021','00000000-0000-4000-8000-000000001011','00000000-0000-4000-8000-000000001001',1,'Test Specification','Cycle testing specification');

INSERT INTO backlogs (id,project_id,specification_id,version,status)
VALUES ('00000000-0000-4000-8000-000000001031','00000000-0000-4000-8000-000000001011','00000000-0000-4000-8000-000000001021',1,'draft');

INSERT INTO tasks (id,backlog_id,task_type,title)
VALUES
('00000000-0000-4000-8000-000000001041','00000000-0000-4000-8000-000000001031','task','A'),
('00000000-0000-4000-8000-000000001042','00000000-0000-4000-8000-000000001031','task','B'),
('00000000-0000-4000-8000-000000001043','00000000-0000-4000-8000-000000001031','task','C'),
('00000000-0000-4000-8000-000000001044','00000000-0000-4000-8000-000000001031','task','D'),
('00000000-0000-4000-8000-000000001045','00000000-0000-4000-8000-000000001031','task','E');

-- Finish the valid fixture's deferred project-ownership check first.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- TEST 1: valid chain A -> B -> C is allowed.
INSERT INTO task_dependencies (backlog_id, blocking_task_id, blocked_task_id)
VALUES
('00000000-0000-4000-8000-000000001031','00000000-0000-4000-8000-000000001041','00000000-0000-4000-8000-000000001042'),
('00000000-0000-4000-8000-000000001031','00000000-0000-4000-8000-000000001042','00000000-0000-4000-8000-000000001043');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
DO $test$ BEGIN
    IF (SELECT count(*) FROM task_dependencies WHERE backlog_id = '00000000-0000-4000-8000-000000001031') <> 2 THEN
        RAISE EXCEPTION 'FAIL: valid chain not inserted';
    END IF;
    RAISE NOTICE 'PASS: valid acyclic chain accepted';
END $test$;

-- TEST 2: B -> A would create a two-edge cycle A -> B -> A.
DO $test$
DECLARE rejected boolean := false;
BEGIN
    BEGIN
        INSERT INTO task_dependencies (backlog_id,blocking_task_id,blocked_task_id)
        VALUES ('00000000-0000-4000-8000-000000001031','00000000-0000-4000-8000-000000001042','00000000-0000-4000-8000-000000001041');
        SET CONSTRAINTS ALL IMMEDIATE;
    EXCEPTION WHEN check_violation THEN
        rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'FAIL: two-edge cycle accepted'; END IF;
    RAISE NOTICE 'PASS: two-edge cycle rejected';
END $test$;

-- TEST 3: C -> A would create A -> B -> C -> A.
DO $test$
DECLARE rejected boolean := false;
BEGIN
    BEGIN
        INSERT INTO task_dependencies (backlog_id,blocking_task_id,blocked_task_id)
        VALUES ('00000000-0000-4000-8000-000000001031','00000000-0000-4000-8000-000000001043','00000000-0000-4000-8000-000000001041');
        SET CONSTRAINTS ALL IMMEDIATE;
    EXCEPTION WHEN check_violation THEN
        rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'FAIL: three-edge cycle accepted'; END IF;
    RAISE NOTICE 'PASS: three-edge cycle rejected';
END $test$;

-- TEST 4: valid longer chain A -> B -> C -> D -> E.
INSERT INTO task_dependencies (backlog_id,blocking_task_id,blocked_task_id)
VALUES
('00000000-0000-4000-8000-000000001031','00000000-0000-4000-8000-000000001043','00000000-0000-4000-8000-000000001044'),
('00000000-0000-4000-8000-000000001031','00000000-0000-4000-8000-000000001044','00000000-0000-4000-8000-000000001045');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
DO $test$ BEGIN
    IF (SELECT count(*) FROM task_dependencies WHERE backlog_id = '00000000-0000-4000-8000-000000001031') <> 4 THEN
        RAISE EXCEPTION 'FAIL: valid longer chain not inserted';
    END IF;
    RAISE NOTICE 'PASS: valid five-task chain accepted';
END $test$;

-- TEST 5: E -> A would close a five-edge cycle.
DO $test$
DECLARE rejected boolean := false;
BEGIN
    BEGIN
        INSERT INTO task_dependencies (backlog_id,blocking_task_id,blocked_task_id)
        VALUES ('00000000-0000-4000-8000-000000001031','00000000-0000-4000-8000-000000001045','00000000-0000-4000-8000-000000001041');
        SET CONSTRAINTS ALL IMMEDIATE;
    EXCEPTION WHEN check_violation THEN
        rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'FAIL: five-edge cycle accepted'; END IF;
    RAISE NOTICE 'PASS: five-edge cycle rejected';
END $test$;

-- TEST 6: changing an existing valid edge to a cyclic edge is rejected.
DO $test$
DECLARE rejected boolean := false;
BEGIN
    BEGIN
        UPDATE task_dependencies
        SET blocked_task_id = '00000000-0000-4000-8000-000000001041'
        WHERE backlog_id = '00000000-0000-4000-8000-000000001031'
          AND blocking_task_id = '00000000-0000-4000-8000-000000001044'
          AND blocked_task_id = '00000000-0000-4000-8000-000000001045';
        SET CONSTRAINTS ALL IMMEDIATE;
    EXCEPTION WHEN check_violation THEN
        rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'FAIL: cyclic UPDATE accepted'; END IF;
    RAISE NOTICE 'PASS: cyclic UPDATE rejected';
END $test$;

-- TEST 7: removing A -> B before inserting E -> A breaks the would-be cycle.
DELETE FROM task_dependencies
WHERE backlog_id = '00000000-0000-4000-8000-000000001031'
  AND blocking_task_id = '00000000-0000-4000-8000-000000001041'
  AND blocked_task_id = '00000000-0000-4000-8000-000000001042';
INSERT INTO task_dependencies (backlog_id,blocking_task_id,blocked_task_id)
VALUES ('00000000-0000-4000-8000-000000001031','00000000-0000-4000-8000-000000001045','00000000-0000-4000-8000-000000001041');
SET CONSTRAINTS ALL IMMEDIATE;
DO $test$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM task_dependencies
        WHERE backlog_id = '00000000-0000-4000-8000-000000001031'
          AND blocking_task_id = '00000000-0000-4000-8000-000000001045'
          AND blocked_task_id = '00000000-0000-4000-8000-000000001041'
    ) THEN RAISE EXCEPTION 'FAIL: safe edge replacement failed'; END IF;
    RAISE NOTICE 'PASS: edge replacement that preserves acyclicity accepted';
END $test$;

ROLLBACK;
\echo Task dependency cycle checks finished: fixtures rolled back.
