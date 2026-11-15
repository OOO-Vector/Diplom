\set ON_ERROR_STOP on

BEGIN;
DO $test$
DECLARE
    v_user UUID := gen_random_uuid();
    v_project UUID := gen_random_uuid();
    v_project2 UUID := gen_random_uuid();
    v_spec UUID := gen_random_uuid();
    v_spec2 UUID := gen_random_uuid();
    v_backlog UUID := gen_random_uuid();
    v_backlog2 UUID := gen_random_uuid();
    v_task_a UUID := gen_random_uuid();
    v_task_b UUID := gen_random_uuid();
    v_task_c UUID := gen_random_uuid();
    v_caught BOOLEAN;
BEGIN
    INSERT INTO users(id, email, password_hash, display_name, created_at, updated_at)
    VALUES (v_user, 'planning-' || v_user || '@example.test', 'test-hash', 'Planning Tester', now(), now());
    INSERT INTO projects(id, name, created_by, status, created_at, updated_at)
    VALUES (v_project, 'Planning Test A', v_user, 'active', now(), now()),
           (v_project2, 'Planning Test B', v_user, 'active', now(), now());
    INSERT INTO project_members(project_id, user_id, role, joined_at)
    VALUES (v_project, v_user, 'owner', now()),
           (v_project2, v_user, 'owner', now());
    INSERT INTO specifications(id, project_id, uploaded_by, version, title, content)
    VALUES (v_spec, v_project, v_user, 1, 'Requirements A', 'Test specification'),
           (v_spec2, v_project2, v_user, 1, 'Requirements B', 'Test specification');

    -- TEST 1: Cannot duplicate a specification version within a project.
    v_caught := false;
    BEGIN
        INSERT INTO specifications(id, project_id, uploaded_by, version, title, content)
        VALUES (gen_random_uuid(), v_project, v_user, 1, 'Duplicate', 'Text');
    EXCEPTION WHEN unique_violation THEN v_caught := true;
    END;
    IF NOT v_caught THEN RAISE EXCEPTION 'FAIL: duplicate specification version accepted'; END IF;
    RAISE NOTICE 'PASS: duplicate specification version rejected';

    -- TEST 2: A backlog cannot point to another project's specification.
    v_caught := false;
    BEGIN
        INSERT INTO backlogs(id, project_id, specification_id, version)
        VALUES (gen_random_uuid(), v_project2, v_spec, 1);
    EXCEPTION WHEN foreign_key_violation THEN v_caught := true;
    END;
    IF NOT v_caught THEN RAISE EXCEPTION 'FAIL: cross-project backlog accepted'; END IF;
    RAISE NOTICE 'PASS: cross-project backlog rejected';

    INSERT INTO backlogs(id, project_id, specification_id, version)
    VALUES (v_backlog, v_project, v_spec, 1),
           (v_backlog2, v_project2, v_spec2, 1);

    -- TEST 3: Invalid task type is rejected.
    v_caught := false;
    BEGIN
        INSERT INTO tasks(id, backlog_id, task_type, title)
        VALUES (gen_random_uuid(), v_backlog, 'banana', 'Invalid');
    EXCEPTION WHEN check_violation THEN v_caught := true;
    END;
    IF NOT v_caught THEN RAISE EXCEPTION 'FAIL: invalid task type accepted'; END IF;
    RAISE NOTICE 'PASS: invalid task type rejected';

    INSERT INTO tasks(id, backlog_id, task_type, title)
    VALUES (v_task_a, v_backlog, 'epic', 'Epic A'),
           (v_task_b, v_backlog, 'task', 'Task B'),
           (v_task_c, v_backlog2, 'task', 'Task C');

    -- TEST 4: A task may not depend on itself.
    v_caught := false;
    BEGIN
        INSERT INTO task_dependencies(backlog_id, blocking_task_id, blocked_task_id)
        VALUES (v_backlog, v_task_a, v_task_a);
    EXCEPTION WHEN check_violation THEN v_caught := true;
    END;
    IF NOT v_caught THEN RAISE EXCEPTION 'FAIL: self-dependency accepted'; END IF;
    RAISE NOTICE 'PASS: self-dependency rejected';

    -- TEST 5: Dependencies cannot cross backlogs.
    v_caught := false;
    BEGIN
        INSERT INTO task_dependencies(backlog_id, blocking_task_id, blocked_task_id)
        VALUES (v_backlog, v_task_a, v_task_c);
    EXCEPTION WHEN foreign_key_violation THEN v_caught := true;
    END;
    IF NOT v_caught THEN RAISE EXCEPTION 'FAIL: cross-backlog dependency accepted'; END IF;
    RAISE NOTICE 'PASS: cross-backlog dependency rejected';

    -- TEST 6: A valid dependency and parent relation work.
    UPDATE tasks SET parent_task_id = v_task_a WHERE id = v_task_b;
    INSERT INTO task_dependencies(backlog_id, blocking_task_id, blocked_task_id)
    VALUES (v_backlog, v_task_a, v_task_b);
    IF NOT EXISTS (
        SELECT 1 FROM task_dependencies
        WHERE backlog_id = v_backlog AND blocking_task_id = v_task_a AND blocked_task_id = v_task_b
    ) THEN RAISE EXCEPTION 'FAIL: valid dependency missing'; END IF;
    RAISE NOTICE 'PASS: valid parent and dependency accepted';
END
$test$;
ROLLBACK;
\echo Planning integrity tests finished: test fixtures rolled back.
