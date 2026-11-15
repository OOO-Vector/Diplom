\set ON_ERROR_STOP on
BEGIN;

-- Test fixtures for two project scopes (all changes rolled back).
INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000801', 'conflictml008@example.test', 'test-hash', 'ML Test User', now(), now());
INSERT INTO projects (id, name, created_by, status, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000811', 'ML project A', '00000000-0000-4000-8000-000000000801', 'active', now(), now()),
       ('00000000-0000-4000-8000-000000000812', 'ML project B', '00000000-0000-4000-8000-000000000801', 'active', now(), now());
INSERT INTO project_members (project_id, user_id, role, joined_at)
VALUES ('00000000-0000-4000-8000-000000000811', '00000000-0000-4000-8000-000000000801', 'owner', now()), ('00000000-0000-4000-8000-000000000812', '00000000-0000-4000-8000-000000000801', 'owner', now());
INSERT INTO architectural_decisions (id, project_id, decision_key, title, created_by)
VALUES ('00000000-0000-4000-8000-000000000821', '00000000-0000-4000-8000-000000000811', 'ADR-A1', 'Decision A1', '00000000-0000-4000-8000-000000000801'),
       ('00000000-0000-4000-8000-000000000822', '00000000-0000-4000-8000-000000000811', 'ADR-A2', 'Decision A2', '00000000-0000-4000-8000-000000000801'),
       ('00000000-0000-4000-8000-000000000823', '00000000-0000-4000-8000-000000000812', 'ADR-B1', 'Decision B1', '00000000-0000-4000-8000-000000000801');
INSERT INTO decision_versions (id, decision_id, version, context_text, decision_text, created_by)
VALUES ('00000000-0000-4000-8000-000000000831', '00000000-0000-4000-8000-000000000821', 1, 'context', 'Use REST', '00000000-0000-4000-8000-000000000801'),
       ('00000000-0000-4000-8000-000000000832', '00000000-0000-4000-8000-000000000822', 1, 'context', 'Use GraphQL', '00000000-0000-4000-8000-000000000801'),
       ('00000000-0000-4000-8000-000000000833', '00000000-0000-4000-8000-000000000823', 1, 'context', 'Use SOAP', '00000000-0000-4000-8000-000000000801');
INSERT INTO ai_operations (id, project_id, initiated_by, operation_type)
VALUES ('00000000-0000-4000-8000-000000000841', '00000000-0000-4000-8000-000000000811', '00000000-0000-4000-8000-000000000801', 'conflict_check'),
       ('00000000-0000-4000-8000-000000000842', '00000000-0000-4000-8000-000000000812', '00000000-0000-4000-8000-000000000801', 'conflict_check');
INSERT INTO ml_datasets (id, name, version, origin, content_sha256)
VALUES ('00000000-0000-4000-8000-000000000851', 'adr-pairs', 'v1', 'synthetic', repeat('a', 64));
INSERT INTO ml_training_examples
  (id, dataset_id, statement_a, statement_b, pair_sha256, expected_label, data_split)
VALUES ('00000000-0000-4000-8000-000000000852', '00000000-0000-4000-8000-000000000851', 'Use REST', 'Use GraphQL', repeat('b',64), 'conflict', 'train');
INSERT INTO ml_models
 (id, dataset_id, name, version, model_type, algorithm, artifact_uri,
  artifact_sha256, training_config, training_seed, precision_score, recall_score, f1_score, trained_at, is_active)
VALUES ('00000000-0000-4000-8000-000000000861', '00000000-0000-4000-8000-000000000851', 'adr-conflict-classifier', 'v1', 'binary_classifier', 'logistic_regression',
 'models/adr-v1.joblib', repeat('c',64), '{"vectorizer":"tfidf"}'::jsonb, 42,
 0.8, 0.75, 0.7742, now(), true);
INSERT INTO conflict_checks
 (id, project_id, proposed_decision_id, proposed_version_id, ai_operation_id, result, explanation)
VALUES ('00000000-0000-4000-8000-000000000871', '00000000-0000-4000-8000-000000000811', '00000000-0000-4000-8000-000000000821', '00000000-0000-4000-8000-000000000831', '00000000-0000-4000-8000-000000000841', 'possible_conflict', 'API approach differs');
INSERT INTO conflict_evidence
 (id, project_id, conflict_check_id, related_decision_id, decision_version_id, evidence_text)
VALUES ('00000000-0000-4000-8000-000000000881', '00000000-0000-4000-8000-000000000811', '00000000-0000-4000-8000-000000000871', '00000000-0000-4000-8000-000000000822', '00000000-0000-4000-8000-000000000832', 'REST versus GraphQL');
INSERT INTO ml_predictions
 (id, project_id, conflict_check_id, compared_decision_id, compared_version_id, model_id, prediction, confidence_score)
VALUES ('00000000-0000-4000-8000-000000000891', '00000000-0000-4000-8000-000000000811', '00000000-0000-4000-8000-000000000871', '00000000-0000-4000-8000-000000000822', '00000000-0000-4000-8000-000000000832', '00000000-0000-4000-8000-000000000861', 'conflict', 0.91);

-- TEST 1: duplicate dataset version rejected
DO $test$
BEGIN
  BEGIN
    INSERT INTO ml_datasets(id,name,version,origin,content_sha256) VALUES ('00000000-0000-4000-8000-000000000853', 'adr-pairs','v1','synthetic',repeat('d',64));
    RAISE EXCEPTION 'FAIL: duplicate dataset version rejected';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: duplicate dataset version rejected';
  END;
END
$test$;

-- TEST 2: invalid dataset digest rejected
DO $test$
BEGIN
  BEGIN
    INSERT INTO ml_datasets(id,name,version,origin,content_sha256) VALUES ('00000000-0000-4000-8000-000000000854', 'bad-digest','v1','synthetic','INVALID');
    RAISE EXCEPTION 'FAIL: invalid dataset digest rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: invalid dataset digest rejected';
  END;
END
$test$;

-- TEST 3: invalid training label rejected
DO $test$
BEGIN
  BEGIN
    INSERT INTO ml_training_examples(id,dataset_id,statement_a,statement_b,pair_sha256,expected_label,data_split) VALUES ('00000000-0000-4000-8000-000000000855','00000000-0000-4000-8000-000000000851','a','b',repeat('e',64),'maybe','train');
    RAISE EXCEPTION 'FAIL: invalid training label rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: invalid training label rejected';
  END;
END
$test$;

-- TEST 4: invalid dataset split rejected
DO $test$
BEGIN
  BEGIN
    INSERT INTO ml_training_examples(id,dataset_id,statement_a,statement_b,pair_sha256,expected_label,data_split) VALUES ('00000000-0000-4000-8000-000000000856','00000000-0000-4000-8000-000000000851','a','b',repeat('f',64),'conflict','production');
    RAISE EXCEPTION 'FAIL: invalid dataset split rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: invalid dataset split rejected';
  END;
END
$test$;

-- TEST 5: duplicate training pair rejected
DO $test$
BEGIN
  BEGIN
    INSERT INTO ml_training_examples(id,dataset_id,statement_a,statement_b,pair_sha256,expected_label,data_split) VALUES ('00000000-0000-4000-8000-000000000857','00000000-0000-4000-8000-000000000851','a','b',repeat('b',64),'conflict','test');
    RAISE EXCEPTION 'FAIL: duplicate training pair rejected';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: duplicate training pair rejected';
  END;
END
$test$;

-- TEST 6: model score outside range rejected
DO $test$
BEGIN
  BEGIN
    INSERT INTO ml_models(id,dataset_id,name,version,model_type,algorithm,artifact_uri,artifact_sha256,training_config,precision_score,trained_at) VALUES ('00000000-0000-4000-8000-000000000862','00000000-0000-4000-8000-000000000851','bad-score','v1','classifier','lr','file',repeat('d',64),'{}'::jsonb,1.1,now());
    RAISE EXCEPTION 'FAIL: model score outside range rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: model score outside range rejected';
  END;
END
$test$;

-- TEST 7: second active version rejected
DO $test$
BEGIN
  BEGIN
    INSERT INTO ml_models(id,dataset_id,name,version,model_type,algorithm,artifact_uri,artifact_sha256,training_config,trained_at,is_active) VALUES ('00000000-0000-4000-8000-000000000863','00000000-0000-4000-8000-000000000851','adr-conflict-classifier','v2','classifier','lr','file',repeat('d',64),'{}'::jsonb,now(),true);
    RAISE EXCEPTION 'FAIL: second active version rejected';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: second active version rejected';
  END;
END
$test$;

-- TEST 8: cross-project proposed decision rejected
DO $test$
BEGIN
  BEGIN
    INSERT INTO conflict_checks(id,project_id,proposed_decision_id,proposed_version_id,result) VALUES ('00000000-0000-4000-8000-000000000872','00000000-0000-4000-8000-000000000811','00000000-0000-4000-8000-000000000823','00000000-0000-4000-8000-000000000833','no_conflict');
    RAISE EXCEPTION 'FAIL: cross-project proposed decision rejected';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-project proposed decision rejected';
  END;
END
$test$;

-- TEST 9: mismatched proposed decision version rejected
DO $test$
BEGIN
  BEGIN
    INSERT INTO conflict_checks(id,project_id,proposed_decision_id,proposed_version_id,result) VALUES ('00000000-0000-4000-8000-000000000873','00000000-0000-4000-8000-000000000811','00000000-0000-4000-8000-000000000821','00000000-0000-4000-8000-000000000832','no_conflict');
    RAISE EXCEPTION 'FAIL: mismatched proposed decision version rejected';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: mismatched proposed decision version rejected';
  END;
END
$test$;

-- TEST 10: cross-project AI operation rejected
DO $test$
BEGIN
  BEGIN
    INSERT INTO conflict_checks(id,project_id,proposed_decision_id,proposed_version_id,ai_operation_id,result) VALUES ('00000000-0000-4000-8000-000000000874','00000000-0000-4000-8000-000000000811','00000000-0000-4000-8000-000000000821','00000000-0000-4000-8000-000000000831','00000000-0000-4000-8000-000000000842','no_conflict');
    RAISE EXCEPTION 'FAIL: cross-project AI operation rejected';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-project AI operation rejected';
  END;
END
$test$;

-- TEST 11: conflict without explanation rejected
DO $test$
BEGIN
  BEGIN
    INSERT INTO conflict_checks(id,project_id,proposed_decision_id,proposed_version_id,result) VALUES ('00000000-0000-4000-8000-000000000875','00000000-0000-4000-8000-000000000811','00000000-0000-4000-8000-000000000821','00000000-0000-4000-8000-000000000831','possible_conflict');
    RAISE EXCEPTION 'FAIL: conflict without explanation rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: conflict without explanation rejected';
  END;
END
$test$;

-- TEST 12: cross-project evidence rejected
DO $test$
BEGIN
  BEGIN
    INSERT INTO conflict_evidence(id,project_id,conflict_check_id,related_decision_id,decision_version_id,evidence_text) VALUES ('00000000-0000-4000-8000-000000000882','00000000-0000-4000-8000-000000000811','00000000-0000-4000-8000-000000000871','00000000-0000-4000-8000-000000000823','00000000-0000-4000-8000-000000000833','Unrelated');
    RAISE EXCEPTION 'FAIL: cross-project evidence rejected';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-project evidence rejected';
  END;
END
$test$;

-- TEST 13: evidence decision/version mismatch rejected
DO $test$
BEGIN
  BEGIN
    INSERT INTO conflict_evidence(id,project_id,conflict_check_id,related_decision_id,decision_version_id,evidence_text) VALUES ('00000000-0000-4000-8000-000000000883','00000000-0000-4000-8000-000000000811','00000000-0000-4000-8000-000000000871','00000000-0000-4000-8000-000000000822','00000000-0000-4000-8000-000000000831','Mismatched');
    RAISE EXCEPTION 'FAIL: evidence decision/version mismatch rejected';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: evidence decision/version mismatch rejected';
  END;
END
$test$;

-- TEST 14: cross-project prediction comparison rejected
DO $test$
BEGIN
  BEGIN
    INSERT INTO ml_predictions(id,project_id,conflict_check_id,compared_decision_id,compared_version_id,model_id,prediction) VALUES ('00000000-0000-4000-8000-000000000892','00000000-0000-4000-8000-000000000811','00000000-0000-4000-8000-000000000871','00000000-0000-4000-8000-000000000823','00000000-0000-4000-8000-000000000833','00000000-0000-4000-8000-000000000861','conflict');
    RAISE EXCEPTION 'FAIL: cross-project prediction comparison rejected';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-project prediction comparison rejected';
  END;
END
$test$;

-- TEST 15: prediction confidence above one rejected
DO $test$
BEGIN
  BEGIN
    INSERT INTO ml_predictions(id,project_id,conflict_check_id,compared_decision_id,compared_version_id,model_id,prediction,confidence_score) VALUES ('00000000-0000-4000-8000-000000000893','00000000-0000-4000-8000-000000000811','00000000-0000-4000-8000-000000000871','00000000-0000-4000-8000-000000000821','00000000-0000-4000-8000-000000000831','00000000-0000-4000-8000-000000000861','conflict',1.2);
    RAISE EXCEPTION 'FAIL: prediction confidence above one rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: prediction confidence above one rejected';
  END;
END
$test$;

-- TEST 16: duplicate prediction for same comparison rejected
DO $test$
BEGIN
  BEGIN
    INSERT INTO ml_predictions(id,project_id,conflict_check_id,compared_decision_id,compared_version_id,model_id,prediction) VALUES ('00000000-0000-4000-8000-000000000894','00000000-0000-4000-8000-000000000811','00000000-0000-4000-8000-000000000871','00000000-0000-4000-8000-000000000822','00000000-0000-4000-8000-000000000832','00000000-0000-4000-8000-000000000861','no_conflict');
    RAISE EXCEPTION 'FAIL: duplicate prediction for same comparison rejected';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: duplicate prediction for same comparison rejected';
  END;
END
$test$;

-- TEST 17: valid dataset, example, model, conflict check, evidence and prediction.
DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ml_predictions p
    JOIN conflict_evidence e ON e.conflict_check_id = p.conflict_check_id
      AND e.decision_version_id = p.compared_version_id
    JOIN ml_models m ON m.id = p.model_id
    JOIN ml_datasets d ON d.id = m.dataset_id
    WHERE p.id = '00000000-0000-4000-8000-000000000891' AND e.id = '00000000-0000-4000-8000-000000000881' AND d.id = '00000000-0000-4000-8000-000000000851'
  ) THEN
    RAISE EXCEPTION 'FAIL: valid ML conflict pipeline not linked';
  END IF;
  RAISE NOTICE 'PASS: valid ML conflict pipeline accepted';
END
$test$;

ROLLBACK;
\echo Conflict Detection and ML integrity checks finished: test fixtures rolled back.
