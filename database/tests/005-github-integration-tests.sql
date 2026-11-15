\set ON_ERROR_STOP on

BEGIN;

-- Two projects, one owner per project, and one backlog/task per project.
INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000601', 'github006@example.test',
        'test-hash', 'GitHub Test User', now(), now());

INSERT INTO projects (id, name, created_by, status, created_at, updated_at)
VALUES
 ('00000000-0000-4000-8000-000000000611', 'GitHub project A', '00000000-0000-4000-8000-000000000601', 'active', now(), now()),
 ('00000000-0000-4000-8000-000000000612', 'GitHub project B', '00000000-0000-4000-8000-000000000601', 'active', now(), now());

INSERT INTO project_members (project_id, user_id, role, joined_at)
VALUES
 ('00000000-0000-4000-8000-000000000611', '00000000-0000-4000-8000-000000000601', 'owner', now()),
 ('00000000-0000-4000-8000-000000000612', '00000000-0000-4000-8000-000000000601', 'owner', now());

INSERT INTO specifications (id, project_id, uploaded_by, version, title, content)
VALUES
 ('00000000-0000-4000-8000-000000000621', '00000000-0000-4000-8000-000000000611', '00000000-0000-4000-8000-000000000601', 1, 'Specification A', 'Test text'),
 ('00000000-0000-4000-8000-000000000622', '00000000-0000-4000-8000-000000000612', '00000000-0000-4000-8000-000000000601', 1, 'Specification B', 'Test text');

INSERT INTO backlogs (id, project_id, specification_id, version)
VALUES
 ('00000000-0000-4000-8000-000000000631', '00000000-0000-4000-8000-000000000611', '00000000-0000-4000-8000-000000000621', 1),
 ('00000000-0000-4000-8000-000000000632', '00000000-0000-4000-8000-000000000612', '00000000-0000-4000-8000-000000000622', 1);

INSERT INTO tasks (id, backlog_id, task_type, title)
VALUES
 ('00000000-0000-4000-8000-000000000641', '00000000-0000-4000-8000-000000000631', 'task', 'Task A1'),
 ('00000000-0000-4000-8000-000000000642', '00000000-0000-4000-8000-000000000632', 'task', 'Task B1'),
 ('00000000-0000-4000-8000-000000000643', '00000000-0000-4000-8000-000000000631', 'task', 'Task A2');

INSERT INTO github_connections
 (id, project_id, connected_by, installation_id, repository_id, repository_owner, repository_name)
VALUES
 ('00000000-0000-4000-8000-000000000651', '00000000-0000-4000-8000-000000000611', '00000000-0000-4000-8000-000000000601', 900001, 800001, 'teamai', 'repo-a'),
 ('00000000-0000-4000-8000-000000000652', '00000000-0000-4000-8000-000000000612', '00000000-0000-4000-8000-000000000601', 900002, 800002, 'teamai', 'repo-b');

-- TEST 1: no second GitHub connection for the same project.
DO $test$
BEGIN
  BEGIN
    INSERT INTO github_connections
      (id, project_id, connected_by, installation_id, repository_id, repository_owner, repository_name)
    VALUES
      ('00000000-0000-4000-8000-000000000653', '00000000-0000-4000-8000-000000000611',
       '00000000-0000-4000-8000-000000000601', 900003, 800003, 'teamai', 'duplicate');
    RAISE EXCEPTION 'FAIL: duplicate connection accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: duplicate project connection rejected';
  END;
END
$test$;

-- TEST 2: positive repository ID required.
DO $test$
BEGIN
  BEGIN
    INSERT INTO github_connections
      (id, project_id, connected_by, installation_id, repository_id, repository_owner, repository_name)
    VALUES
      ('00000000-0000-4000-8000-000000000654', '00000000-0000-4000-8000-000000000611',
       '00000000-0000-4000-8000-000000000601', 900004, -1, 'teamai', 'invalid');
    RAISE EXCEPTION 'FAIL: invalid repository ID accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: invalid repository ID rejected';
  END;
END
$test$;

-- TEST 3: connection and backlog cannot belong to different projects.
DO $test$
BEGIN
  BEGIN
    INSERT INTO github_issues
      (id, project_id, connection_id, backlog_id, task_id)
    VALUES
      ('00000000-0000-4000-8000-000000000661', '00000000-0000-4000-8000-000000000611',
       '00000000-0000-4000-8000-000000000651', '00000000-0000-4000-8000-000000000632',
       '00000000-0000-4000-8000-000000000642');
    RAISE EXCEPTION 'FAIL: cross-project issue accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-project issue rejected';
  END;
END
$test$;

-- TEST 4: task must belong to the indicated backlog.
DO $test$
BEGIN
  BEGIN
    INSERT INTO github_issues
      (id, project_id, connection_id, backlog_id, task_id)
    VALUES
      ('00000000-0000-4000-8000-000000000662', '00000000-0000-4000-8000-000000000611',
       '00000000-0000-4000-8000-000000000651', '00000000-0000-4000-8000-000000000631',
       '00000000-0000-4000-8000-000000000642');
    RAISE EXCEPTION 'FAIL: task/backlog mismatch accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: task/backlog mismatch rejected';
  END;
END
$test$;

-- TEST 5: synced issue must have an issue number and URL.
DO $test$
BEGIN
  BEGIN
    INSERT INTO github_issues
      (id, project_id, connection_id, backlog_id, task_id, sync_status)
    VALUES
      ('00000000-0000-4000-8000-000000000663', '00000000-0000-4000-8000-000000000611',
       '00000000-0000-4000-8000-000000000651', '00000000-0000-4000-8000-000000000631',
       '00000000-0000-4000-8000-000000000641', 'synced');
    RAISE EXCEPTION 'FAIL: incomplete synced issue accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: incomplete synced issue rejected';
  END;
END
$test$;

-- Create valid synchronized mapping.
INSERT INTO github_issues
 (id, project_id, connection_id, backlog_id, task_id, github_issue_id,
  github_issue_number, github_issue_url, sync_status, last_synced_at)
VALUES
 ('00000000-0000-4000-8000-000000000664', '00000000-0000-4000-8000-000000000611',
  '00000000-0000-4000-8000-000000000651', '00000000-0000-4000-8000-000000000631',
  '00000000-0000-4000-8000-000000000641', 700001, 101,
  'https://github.com/teamai/repo-a/issues/101', 'synced', now());

-- TEST 6: one GitHub issue mapping per task/connection.
DO $test$
BEGIN
  BEGIN
    INSERT INTO github_issues
      (id, project_id, connection_id, backlog_id, task_id)
    VALUES
      ('00000000-0000-4000-8000-000000000665', '00000000-0000-4000-8000-000000000611',
       '00000000-0000-4000-8000-000000000651', '00000000-0000-4000-8000-000000000631',
       '00000000-0000-4000-8000-000000000641');
    RAISE EXCEPTION 'FAIL: duplicate task mapping accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: duplicate task mapping rejected';
  END;
END
$test$;

-- TEST 7: same GitHub issue number cannot map to two tasks.
DO $test$
BEGIN
  BEGIN
    INSERT INTO github_issues
      (id, project_id, connection_id, backlog_id, task_id,
       github_issue_number, github_issue_url, sync_status)
    VALUES
      ('00000000-0000-4000-8000-000000000666', '00000000-0000-4000-8000-000000000611',
       '00000000-0000-4000-8000-000000000651', '00000000-0000-4000-8000-000000000631',
       '00000000-0000-4000-8000-000000000643', 101,
       'https://github.com/teamai/repo-a/issues/101', 'synced');
    RAISE EXCEPTION 'FAIL: duplicate GitHub issue number accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: duplicate GitHub issue number rejected';
  END;
END
$test$;

-- TEST 8: valid pending mapping accepted.
INSERT INTO github_issues
 (id, project_id, connection_id, backlog_id, task_id)
VALUES
 ('00000000-0000-4000-8000-000000000667', '00000000-0000-4000-8000-000000000611',
  '00000000-0000-4000-8000-000000000651', '00000000-0000-4000-8000-000000000631',
  '00000000-0000-4000-8000-000000000643');

DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM github_issues
    WHERE id = '00000000-0000-4000-8000-000000000667'
      AND sync_status = 'pending'
  ) THEN
    RAISE EXCEPTION 'FAIL: valid pending issue missing';
  END IF;
  RAISE NOTICE 'PASS: valid synced and pending issue mappings accepted';
END
$test$;

ROLLBACK;
\echo GitHub Integration integrity checks finished: test fixtures rolled back.
