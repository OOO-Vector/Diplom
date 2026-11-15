\set ON_ERROR_STOP on

BEGIN;

INSERT INTO users (id,email,password_hash,display_name,created_at,updated_at) VALUES
 ('00000000-0000-4000-8000-000000000501','memory005@example.test','test-hash','Memory Test',now(),now());

INSERT INTO projects (id,name,created_by,status,created_at,updated_at) VALUES
 ('00000000-0000-4000-8000-000000000511','Memory A','00000000-0000-4000-8000-000000000501','active',now(),now()),
 ('00000000-0000-4000-8000-000000000512','Memory B','00000000-0000-4000-8000-000000000501','active',now(),now());

INSERT INTO project_members (project_id,user_id,role,joined_at) VALUES
 ('00000000-0000-4000-8000-000000000511','00000000-0000-4000-8000-000000000501','owner',now()),
 ('00000000-0000-4000-8000-000000000512','00000000-0000-4000-8000-000000000501','owner',now());

INSERT INTO architectural_decisions (id,project_id,decision_key,title,created_by) VALUES
 ('00000000-0000-4000-8000-000000000521','00000000-0000-4000-8000-000000000511','ADR-001','Modular monolith','00000000-0000-4000-8000-000000000501'),
 ('00000000-0000-4000-8000-000000000522','00000000-0000-4000-8000-000000000511','ADR-002','Database choice','00000000-0000-4000-8000-000000000501'),
 ('00000000-0000-4000-8000-000000000523','00000000-0000-4000-8000-000000000512','ADR-001','Other project decision','00000000-0000-4000-8000-000000000501');

-- TEST 1: Duplicate decision key in same project
DO $test$
BEGIN
  BEGIN
    INSERT INTO architectural_decisions(id,project_id,decision_key,title,created_by)
    VALUES ('00000000-0000-4000-8000-000000000524','00000000-0000-4000-8000-000000000511','ADR-001','Duplicate','00000000-0000-4000-8000-000000000501');
    RAISE EXCEPTION 'FAIL: duplicate decision key accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: duplicate decision key rejected';
  END;
END
$test$;

INSERT INTO decision_versions(id,decision_id,version,context_text,decision_text,created_by)
VALUES ('00000000-0000-4000-8000-000000000531','00000000-0000-4000-8000-000000000521',1,'Architecture requirement','Use modular monolith','00000000-0000-4000-8000-000000000501');

-- TEST 2: Cannot reuse version number
DO $test$
BEGIN
  BEGIN
    INSERT INTO decision_versions(id,decision_id,version,context_text,decision_text,created_by)
    VALUES ('00000000-0000-4000-8000-000000000532','00000000-0000-4000-8000-000000000521',1,'New context','New choice','00000000-0000-4000-8000-000000000501');
    RAISE EXCEPTION 'FAIL: duplicate version accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: duplicate decision version rejected';
  END;
END
$test$;

-- TEST 3: Resolution may not mix projects
DO $test$
BEGIN
  BEGIN
    INSERT INTO decision_resolutions(id,project_id,decision_id,related_decision_id,resolution_type)
    VALUES ('00000000-0000-4000-8000-000000000541','00000000-0000-4000-8000-000000000511',
            '00000000-0000-4000-8000-000000000521','00000000-0000-4000-8000-000000000523','conflict');
    RAISE EXCEPTION 'FAIL: cross-project resolution accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-project resolution rejected';
  END;
END
$test$;

-- TEST 4: Source cannot cite decision from another project
DO $test$
BEGIN
  BEGIN
    INSERT INTO knowledge_sources(id,project_id,source_type,decision_id,title)
    VALUES ('00000000-0000-4000-8000-000000000551','00000000-0000-4000-8000-000000000511',
            'decision','00000000-0000-4000-8000-000000000523','Wrong project');
    RAISE EXCEPTION 'FAIL: cross-project knowledge source accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-project knowledge source rejected';
  END;
END
$test$;

-- TEST 5: Source type and reference must match
DO $test$
BEGIN
  BEGIN
    INSERT INTO knowledge_sources(id,project_id,source_type,title)
    VALUES ('00000000-0000-4000-8000-000000000552','00000000-0000-4000-8000-000000000511','decision','No decision id');
    RAISE EXCEPTION 'FAIL: missing source reference accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: missing source reference rejected';
  END;
END
$test$;

INSERT INTO knowledge_sources(id,project_id,source_type,decision_id,title)
VALUES ('00000000-0000-4000-8000-000000000553','00000000-0000-4000-8000-000000000511',
        'decision','00000000-0000-4000-8000-000000000521','Architecture ADR');

INSERT INTO knowledge_chunks(id,source_id,chunk_index,content,embedding,embedding_model)
VALUES ('00000000-0000-4000-8000-000000000561','00000000-0000-4000-8000-000000000553',0,
        'The project uses a modular monolith.','[0.1,0.2,0.3]'::vector,'test-embedding-model');

-- TEST 6: Chunk position must be unique within a source
DO $test$
BEGIN
  BEGIN
    INSERT INTO knowledge_chunks(id,source_id,chunk_index,content)
    VALUES ('00000000-0000-4000-8000-000000000562','00000000-0000-4000-8000-000000000553',0,'Duplicate index');
    RAISE EXCEPTION 'FAIL: duplicate chunk index accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: duplicate chunk index rejected';
  END;
END
$test$;

-- TEST 7: Valid same-project decision resolution is accepted
INSERT INTO decision_resolutions(id,project_id,decision_id,related_decision_id,resolution_type)
VALUES ('00000000-0000-4000-8000-000000000542','00000000-0000-4000-8000-000000000511',
        '00000000-0000-4000-8000-000000000521','00000000-0000-4000-8000-000000000522','conflict');
DO $test$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM decision_resolutions WHERE id='00000000-0000-4000-8000-000000000542') THEN
    RAISE EXCEPTION 'FAIL: valid resolution not created';
  END IF;
  RAISE NOTICE 'PASS: valid decision, source, chunk and resolution accepted';
END
$test$;

ROLLBACK;
\echo Project Memory integrity checks finished: test fixtures rolled back.
