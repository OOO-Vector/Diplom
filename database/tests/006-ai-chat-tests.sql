\set ON_ERROR_STOP on

BEGIN;

-- Fixture: two projects, valid owners, two operations, two chat sessions,
-- three sources and two chunks. Everything is rolled back below.
INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
VALUES
 ('00000000-0000-4000-8000-000000000701', 'chat007a@example.test', 'test-hash', 'Chat Test A', now(), now()),
 ('00000000-0000-4000-8000-000000000702', 'chat007b@example.test', 'test-hash', 'Chat Test B', now(), now());

INSERT INTO projects (id, name, created_by, status, created_at, updated_at)
VALUES
 ('00000000-0000-4000-8000-000000000711', 'Chat Project A', '00000000-0000-4000-8000-000000000701', 'active', now(), now()),
 ('00000000-0000-4000-8000-000000000712', 'Chat Project B', '00000000-0000-4000-8000-000000000702', 'active', now(), now());

INSERT INTO project_members (project_id, user_id, role, joined_at)
VALUES
 ('00000000-0000-4000-8000-000000000711', '00000000-0000-4000-8000-000000000701', 'owner', now()),
 ('00000000-0000-4000-8000-000000000712', '00000000-0000-4000-8000-000000000702', 'owner', now());

SET CONSTRAINTS ALL IMMEDIATE;

INSERT INTO ai_operations (id, project_id, initiated_by, operation_type)
VALUES
 ('00000000-0000-4000-8000-000000000741', '00000000-0000-4000-8000-000000000711', '00000000-0000-4000-8000-000000000701', 'context_chat'),
 ('00000000-0000-4000-8000-000000000742', '00000000-0000-4000-8000-000000000712', '00000000-0000-4000-8000-000000000702', 'context_chat');

INSERT INTO chat_sessions (id, project_id, created_by, title)
VALUES
 ('00000000-0000-4000-8000-000000000751', '00000000-0000-4000-8000-000000000711', '00000000-0000-4000-8000-000000000701', 'Chat A'),
 ('00000000-0000-4000-8000-000000000752', '00000000-0000-4000-8000-000000000712', '00000000-0000-4000-8000-000000000702', 'Chat B');

INSERT INTO knowledge_sources (id, project_id, source_type, title)
VALUES
 ('00000000-0000-4000-8000-000000000721', '00000000-0000-4000-8000-000000000711', 'manual', 'Source A1'),
 ('00000000-0000-4000-8000-000000000722', '00000000-0000-4000-8000-000000000712', 'manual', 'Source B'),
 ('00000000-0000-4000-8000-000000000723', '00000000-0000-4000-8000-000000000711', 'manual', 'Source A2');

INSERT INTO knowledge_chunks (id, source_id, chunk_index, content)
VALUES
 ('00000000-0000-4000-8000-000000000731', '00000000-0000-4000-8000-000000000721', 0, 'Project A architecture'),
 ('00000000-0000-4000-8000-000000000732', '00000000-0000-4000-8000-000000000722', 0, 'Project B architecture'),
 ('00000000-0000-4000-8000-000000000733', '00000000-0000-4000-8000-000000000721', 1, 'Project A API contracts'),
 ('00000000-0000-4000-8000-000000000734', '00000000-0000-4000-8000-000000000721', 2, 'Project A coding rules');

INSERT INTO chat_messages (id, project_id, session_id, author_id, sender, content)
VALUES ('00000000-0000-4000-8000-000000000761', '00000000-0000-4000-8000-000000000711',
        '00000000-0000-4000-8000-000000000751', '00000000-0000-4000-8000-000000000701',
        'user', 'What architecture do we use?');

INSERT INTO chat_messages (id, project_id, session_id, ai_operation_id, sender, content)
VALUES ('00000000-0000-4000-8000-000000000762', '00000000-0000-4000-8000-000000000711',
        '00000000-0000-4000-8000-000000000751', '00000000-0000-4000-8000-000000000741',
        'assistant', 'We use a modular monolith.');

-- 1: reject an operation with an invalid status.
DO $test$ BEGIN
  BEGIN
    INSERT INTO ai_operations (id, project_id, initiated_by, operation_type, status)
    VALUES ('00000000-0000-4000-8000-000000000743', '00000000-0000-4000-8000-000000000711',
            '00000000-0000-4000-8000-000000000701', 'context_chat', 'unknown');
    RAISE EXCEPTION 'FAIL: invalid AI status accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: invalid AI status rejected';
  END;
END $test$;

-- 2: usage metrics must not be negative.
DO $test$ BEGIN
  BEGIN
    UPDATE ai_operations SET input_tokens = -5
    WHERE id = '00000000-0000-4000-8000-000000000741';
    RAISE EXCEPTION 'FAIL: negative tokens accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: negative tokens rejected';
  END;
END $test$;

-- 3: a completed operation requires start and finish timestamps.
DO $test$ BEGIN
  BEGIN
    UPDATE ai_operations SET status = 'completed'
    WHERE id = '00000000-0000-4000-8000-000000000741';
    RAISE EXCEPTION 'FAIL: incomplete operation lifecycle accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: incomplete operation lifecycle rejected';
  END;
END $test$;

-- 4: message and session must belong to the same project.
DO $test$ BEGIN
  BEGIN
    INSERT INTO chat_messages (id, project_id, session_id, sender, content)
    VALUES ('00000000-0000-4000-8000-000000000764', '00000000-0000-4000-8000-000000000711',
            '00000000-0000-4000-8000-000000000752', 'system', 'Wrong project');
    RAISE EXCEPTION 'FAIL: cross-project chat session accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-project chat session rejected';
  END;
END $test$;

-- 5: the referenced AI operation must be in the same project.
DO $test$ BEGIN
  BEGIN
    INSERT INTO chat_messages (id, project_id, session_id, ai_operation_id, sender, content)
    VALUES ('00000000-0000-4000-8000-000000000765', '00000000-0000-4000-8000-000000000711',
            '00000000-0000-4000-8000-000000000751', '00000000-0000-4000-8000-000000000742',
            'assistant', 'Wrong AI operation');
    RAISE EXCEPTION 'FAIL: cross-project AI operation accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-project AI operation rejected';
  END;
END $test$;

-- 6: a user message requires a human author.
DO $test$ BEGIN
  BEGIN
    INSERT INTO chat_messages (id, project_id, session_id, sender, content)
    VALUES ('00000000-0000-4000-8000-000000000766', '00000000-0000-4000-8000-000000000711',
            '00000000-0000-4000-8000-000000000751', 'user', 'Missing author');
    RAISE EXCEPTION 'FAIL: anonymous user message accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: anonymous user message rejected';
  END;
END $test$;

-- 7: message cannot cite a source from another project.
DO $test$ BEGIN
  BEGIN
    INSERT INTO chat_message_sources (project_id, message_id, source_id, chunk_id, citation_order)
    VALUES ('00000000-0000-4000-8000-000000000711', '00000000-0000-4000-8000-000000000762',
            '00000000-0000-4000-8000-000000000722', '00000000-0000-4000-8000-000000000732', 1);
    RAISE EXCEPTION 'FAIL: cross-project citation accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-project citation rejected';
  END;
END $test$;

-- 8: chunk must belong to the declared source, even within the same project.
DO $test$ BEGIN
  BEGIN
    INSERT INTO chat_message_sources (project_id, message_id, source_id, chunk_id, citation_order)
    VALUES ('00000000-0000-4000-8000-000000000711', '00000000-0000-4000-8000-000000000762',
            '00000000-0000-4000-8000-000000000723', '00000000-0000-4000-8000-000000000731', 1);
    RAISE EXCEPTION 'FAIL: mismatched chunk/source accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: mismatched chunk/source rejected';
  END;
END $test$;

-- Valid citations, with independent citation positions.
INSERT INTO chat_message_sources (project_id, message_id, source_id, chunk_id, citation_order)
VALUES
 ('00000000-0000-4000-8000-000000000711', '00000000-0000-4000-8000-000000000762',
  '00000000-0000-4000-8000-000000000721', '00000000-0000-4000-8000-000000000731', 1),
 ('00000000-0000-4000-8000-000000000711', '00000000-0000-4000-8000-000000000762',
  '00000000-0000-4000-8000-000000000721', '00000000-0000-4000-8000-000000000733', 2);

-- 9: citation_order is unique for one message.
DO $test$ BEGIN
  BEGIN
    INSERT INTO chat_message_sources (project_id, message_id, source_id, chunk_id, citation_order)
    VALUES ('00000000-0000-4000-8000-000000000711', '00000000-0000-4000-8000-000000000762',
            '00000000-0000-4000-8000-000000000721', '00000000-0000-4000-8000-000000000734', 1);
    RAISE EXCEPTION 'FAIL: duplicate citation order accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: duplicate citation order rejected';
  END;
END $test$;

-- 10: valid grounded conversation and two citations exist.
DO $test$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM chat_message_sources
  WHERE message_id = '00000000-0000-4000-8000-000000000762';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL: expected 2 valid citations, got %', v_count;
  END IF;
  RAISE NOTICE 'PASS: valid grounded conversation with two citations accepted';
END $test$;

ROLLBACK;
\echo AI and Chat integrity checks finished: test fixtures rolled back.
