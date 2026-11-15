-- Core database integrity checks for Team AI Orchestrator.
-- Designed for PostgreSQL 16 / Liquibase migration 002.
-- Run with: docker exec -i team-ai-postgres psql -X -v ON_ERROR_STOP=1 -U team_ai_admin -d team_ai_db < database\tests\001-core-integrity.sql
-- Fixtures and changes are rolled back at the end.

\set ON_ERROR_STOP on
BEGIN;

-- Test fixtures
INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
VALUES
 ('11111111-1111-4111-8111-111111111111', 'core-test-owner@example.invalid', 'test-hash-not-a-real-password', 'Test Owner', now(), now()),
 ('22222222-2222-4222-8222-222222222222', 'core-test-member@example.invalid', 'test-hash-not-a-real-password', 'Test Member', now(), now());

INSERT INTO projects (id, name, created_by, status, created_at, updated_at)
VALUES ('33333333-3333-4333-8333-333333333333', 'Core Integrity Test', '11111111-1111-4111-8111-111111111111', 'active', now(), now());

INSERT INTO project_members (project_id, user_id, role, joined_at)
VALUES ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'owner', now());

-- Each block fails if the expected constraint does not reject the invalid row.
DO $$
BEGIN
  BEGIN
    INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
    VALUES ('44444444-4444-4444-8444-444444444444', 'CORE-TEST-OWNER@example.invalid', 'test-hash', 'Duplicate', now(), now());
    RAISE EXCEPTION 'FAIL: case-insensitive email uniqueness was not enforced';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: email is unique ignoring case';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO projects (id, name, created_by, status, created_at, updated_at)
    VALUES ('55555555-5555-4555-8555-555555555555', 'Invalid Status', '11111111-1111-4111-8111-111111111111', 'unknown', now(), now());
    RAISE EXCEPTION 'FAIL: invalid project status was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: invalid project status rejected';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO project_members (project_id, user_id, role, joined_at)
    VALUES ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'owner', now());
    RAISE EXCEPTION 'FAIL: multiple project owners accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: second project owner rejected';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO project_members (project_id, user_id, role, joined_at)
    VALUES ('66666666-6666-4666-8666-666666666666', '22222222-2222-4222-8222-222222222222', 'member', now());
    RAISE EXCEPTION 'FAIL: non-existent project reference accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: foreign key rejects non-existent project';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
    VALUES ('77777777-7777-4777-8777-777777777777', 'invalid-empty-name@example.invalid', 'test-hash', '    ', now(), now());
    RAISE EXCEPTION 'FAIL: blank display name accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: blank display name rejected';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO project_members (project_id, user_id, role, joined_at)
    VALUES ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'owner', now());
    RAISE EXCEPTION 'FAIL: duplicate membership accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: duplicate membership rejected';
  END;
END $$;

ROLLBACK;
\echo 'Core integrity checks finished: test fixtures rolled back.'
