
\set ON_ERROR_STOP on

BEGIN;

-- Temporary test users
INSERT INTO users
    (id, email, password_hash, display_name, created_at, updated_at)
VALUES
(
    '00000000-0000-4000-8000-000000000301',
    'owner003a@example.test',
    'test-hash',
    'Owner A',
    now(),
    now()
),
(
    '00000000-0000-4000-8000-000000000302',
    'owner003b@example.test',
    'test-hash',
    'Owner B',
    now(),
    now()
);


-- TEST 1: project without an Owner must be rejected

DO $test$
DECLARE
    caught boolean := false;
BEGIN
    BEGIN
        INSERT INTO projects
            (id, name, created_by, status, created_at, updated_at)
        VALUES
            (
                '00000000-0000-4000-8000-000000000311',
                'Invalid Ownerless',
                '00000000-0000-4000-8000-000000000301',
                'active',
                now(),
                now()
            );

        SET CONSTRAINTS ALL IMMEDIATE;

    EXCEPTION WHEN check_violation THEN
        caught := true;
    END;

    IF NOT caught THEN
        RAISE EXCEPTION 'FAIL: ownerless project accepted';
    END IF;

    RAISE NOTICE 'PASS: ownerless project rejected';
END
$test$;


-- Create a valid project with two participants

INSERT INTO projects
    (id, name, created_by, status, created_at, updated_at)
VALUES
    (
        '00000000-0000-4000-8000-000000000312',
        'Transfer Test',
        '00000000-0000-4000-8000-000000000301',
        'active',
        now(),
        now()
    );

INSERT INTO project_members
    (project_id, user_id, role, joined_at)
VALUES
(
    '00000000-0000-4000-8000-000000000312',
    '00000000-0000-4000-8000-000000000301',
    'owner',
    now()
),
(
    '00000000-0000-4000-8000-000000000312',
    '00000000-0000-4000-8000-000000000302',
    'member',
    now()
);


-- TEST 2: cannot delete the last Owner

DO $test$
DECLARE
    caught boolean := false;
BEGIN
    BEGIN
        DELETE FROM project_members
        WHERE project_id =
            '00000000-0000-4000-8000-000000000312'
          AND user_id =
            '00000000-0000-4000-8000-000000000301';

        SET CONSTRAINTS ALL IMMEDIATE;

    EXCEPTION WHEN check_violation THEN
        caught := true;
    END;

    IF NOT caught THEN
        RAISE EXCEPTION 'FAIL: last Owner removal accepted';
    END IF;

    RAISE NOTICE 'PASS: last Owner removal rejected';
END
$test$;


-- TEST 3: transfer ownership in one transaction

UPDATE project_members
SET role = 'member'
WHERE project_id =
    '00000000-0000-4000-8000-000000000312'
  AND user_id =
    '00000000-0000-4000-8000-000000000301';

UPDATE project_members
SET role = 'owner'
WHERE project_id =
    '00000000-0000-4000-8000-000000000312'
  AND user_id =
    '00000000-0000-4000-8000-000000000302';

SET CONSTRAINTS ALL IMMEDIATE;

DO $test$
DECLARE
    owner_count integer;
BEGIN
    SELECT count(*)
    INTO owner_count
    FROM project_members
    WHERE project_id =
        '00000000-0000-4000-8000-000000000312'
      AND role = 'owner';

    IF owner_count <> 1 THEN
        RAISE EXCEPTION
            'FAIL: transfer did not preserve single Owner';
    END IF;

    RAISE NOTICE
        'PASS: transfer preserved exactly one Owner';
END
$test$;


ROLLBACK;

\echo Core ownership test changes rolled back.
