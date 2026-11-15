
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO users
    (id, email, password_hash, display_name, created_at, updated_at)
VALUES
    ('00000000-0000-4000-8000-000000000901',
     'concurrency-owner@example.test', 'test-hash',
     'Concurrency Owner', now(), now()),
    ('00000000-0000-4000-8000-000000000902',
     'concurrency-member@example.test', 'test-hash',
     'Concurrency Member', now(), now());

INSERT INTO projects
    (id, name, created_by, status, created_at, updated_at)
VALUES
    ('00000000-0000-4000-8000-000000000911',
     'Concurrency Test Project',
     '00000000-0000-4000-8000-000000000901',
     'active', now(), now());

INSERT INTO project_members
    (project_id, user_id, role, joined_at)
VALUES
    ('00000000-0000-4000-8000-000000000911',
     '00000000-0000-4000-8000-000000000901',
     'owner', now()),
    ('00000000-0000-4000-8000-000000000911',
     '00000000-0000-4000-8000-000000000902',
     'member', now());

INSERT INTO outbox_events
    (id, project_id, event_type,
     aggregate_type, aggregate_id, payload)
VALUES
    ('00000000-0000-4000-8000-000000000921',
     '00000000-0000-4000-8000-000000000911',
     'github.issue.create', 'project',
     '00000000-0000-4000-8000-000000000911',
     '{"event_id":"event-921","schema_version":1,
       "occurred_at":"2026-11-15T12:00:00Z","data":{}}'::jsonb),
    ('00000000-0000-4000-8000-000000000922',
     '00000000-0000-4000-8000-000000000911',
     'github.issue.create', 'project',
     '00000000-0000-4000-8000-000000000911',
     '{"event_id":"event-922","schema_version":1,
       "occurred_at":"2026-11-15T12:00:00Z","data":{}}'::jsonb);

COMMIT;

\echo Concurrency fixtures created.
