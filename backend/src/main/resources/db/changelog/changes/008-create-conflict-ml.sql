--liquibase formatted sql

--changeset teamai:008-create-conflict-ml splitStatements:false

-- The dataset registry is global: a trained model can serve multiple projects.
CREATE TABLE ml_datasets (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    version VARCHAR(50) NOT NULL,
    description TEXT,
    origin VARCHAR(50) NOT NULL,
    content_sha256 VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_ml_datasets_name_version UNIQUE (name, version),
    CONSTRAINT ck_ml_datasets_identity CHECK (length(btrim(name)) > 0 AND length(btrim(version)) > 0),
    CONSTRAINT ck_ml_datasets_origin CHECK (origin IN ('synthetic', 'public', 'anonymized', 'mixed')),
    CONSTRAINT ck_ml_datasets_digest CHECK (content_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE ml_training_examples (
    id UUID PRIMARY KEY,
    dataset_id UUID NOT NULL,
    statement_a TEXT NOT NULL,
    statement_b TEXT NOT NULL,
    pair_sha256 VARCHAR(64) NOT NULL,
    expected_label VARCHAR(20) NOT NULL,
    data_split VARCHAR(12) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_ml_examples_dataset FOREIGN KEY (dataset_id) REFERENCES ml_datasets(id),
    CONSTRAINT uq_ml_examples_dataset_pair UNIQUE (dataset_id, pair_sha256),
    CONSTRAINT ck_ml_examples_statements CHECK (length(btrim(statement_a)) > 0 AND length(btrim(statement_b)) > 0),
    CONSTRAINT ck_ml_examples_digest CHECK (pair_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_ml_examples_label CHECK (expected_label IN ('conflict', 'no_conflict')),
    CONSTRAINT ck_ml_examples_split CHECK (data_split IN ('train', 'validation', 'test'))
);

CREATE TABLE ml_models (
    id UUID PRIMARY KEY,
    dataset_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    version VARCHAR(50) NOT NULL,
    model_type VARCHAR(50) NOT NULL,
    algorithm VARCHAR(100) NOT NULL,
    artifact_uri TEXT NOT NULL,
    artifact_sha256 VARCHAR(64) NOT NULL,
    training_config JSONB NOT NULL,
    training_seed INTEGER,
    precision_score NUMERIC(5,4),
    recall_score NUMERIC(5,4),
    f1_score NUMERIC(5,4),
    trained_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT fk_ml_models_dataset FOREIGN KEY (dataset_id) REFERENCES ml_datasets(id),
    CONSTRAINT uq_ml_models_name_version UNIQUE (name, version),
    CONSTRAINT ck_ml_models_identity CHECK (
        length(btrim(name)) > 0 AND length(btrim(version)) > 0
        AND length(btrim(model_type)) > 0 AND length(btrim(algorithm)) > 0
    ),
    CONSTRAINT ck_ml_models_artifact CHECK (length(btrim(artifact_uri)) > 0),
    CONSTRAINT ck_ml_models_digest CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_ml_models_training_config CHECK (jsonb_typeof(training_config) = 'object'),
    CONSTRAINT ck_ml_models_precision CHECK (precision_score IS NULL OR precision_score BETWEEN 0 AND 1),
    CONSTRAINT ck_ml_models_recall CHECK (recall_score IS NULL OR recall_score BETWEEN 0 AND 1),
    CONSTRAINT ck_ml_models_f1 CHECK (f1_score IS NULL OR f1_score BETWEEN 0 AND 1)
);

-- Only one active version of each model family is allowed.
CREATE UNIQUE INDEX ux_ml_models_one_active_per_name ON ml_models (name) WHERE is_active;

-- Add a version-ownership FK target without altering earlier changelog files.
ALTER TABLE decision_versions
    ADD CONSTRAINT uq_decision_versions_decision_id UNIQUE (decision_id, id);

CREATE TABLE conflict_checks (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    proposed_decision_id UUID NOT NULL,
    proposed_version_id UUID NOT NULL,
    ai_operation_id UUID,
    result VARCHAR(30) NOT NULL,
    explanation TEXT,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_conflict_project FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT fk_conflict_proposed_decision FOREIGN KEY (project_id, proposed_decision_id)
        REFERENCES architectural_decisions(project_id, id),
    CONSTRAINT fk_conflict_proposed_version FOREIGN KEY (proposed_decision_id, proposed_version_id)
        REFERENCES decision_versions(decision_id, id),
    CONSTRAINT fk_conflict_operation FOREIGN KEY (project_id, ai_operation_id)
        REFERENCES ai_operations(project_id, id),
    CONSTRAINT uq_conflict_project_id UNIQUE (project_id, id),
    CONSTRAINT uq_conflict_proposal_id UNIQUE (proposed_version_id, id),
    CONSTRAINT ck_conflict_result CHECK (result IN ('possible_conflict', 'no_conflict', 'insufficient_context')),
    CONSTRAINT ck_conflict_explanation CHECK (
        result = 'no_conflict' OR (explanation IS NOT NULL AND length(btrim(explanation)) > 0)
    )
);

CREATE TABLE conflict_evidence (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    conflict_check_id UUID NOT NULL,
    related_decision_id UUID NOT NULL,
    decision_version_id UUID NOT NULL,
    evidence_text TEXT NOT NULL,
    CONSTRAINT fk_evidence_check FOREIGN KEY (project_id, conflict_check_id)
        REFERENCES conflict_checks(project_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_evidence_decision FOREIGN KEY (project_id, related_decision_id)
        REFERENCES architectural_decisions(project_id, id),
    CONSTRAINT fk_evidence_version FOREIGN KEY (related_decision_id, decision_version_id)
        REFERENCES decision_versions(decision_id, id),
    CONSTRAINT uq_evidence_pair UNIQUE (conflict_check_id, decision_version_id),
    CONSTRAINT ck_evidence_text CHECK (length(btrim(evidence_text)) > 0)
);

CREATE TABLE ml_predictions (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    conflict_check_id UUID NOT NULL,
    compared_decision_id UUID NOT NULL,
    compared_version_id UUID NOT NULL,
    model_id UUID NOT NULL,
    prediction VARCHAR(20) NOT NULL,
    confidence_score NUMERIC(5,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_prediction_check FOREIGN KEY (project_id, conflict_check_id)
        REFERENCES conflict_checks(project_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_prediction_decision FOREIGN KEY (project_id, compared_decision_id)
        REFERENCES architectural_decisions(project_id, id),
    CONSTRAINT fk_prediction_version FOREIGN KEY (compared_decision_id, compared_version_id)
        REFERENCES decision_versions(decision_id, id),
    CONSTRAINT fk_prediction_model FOREIGN KEY (model_id) REFERENCES ml_models(id),
    CONSTRAINT uq_prediction_comparison UNIQUE (conflict_check_id, compared_version_id, model_id),
    CONSTRAINT ck_prediction_label CHECK (prediction IN ('conflict', 'no_conflict')),
    CONSTRAINT ck_prediction_confidence CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1)
);

CREATE INDEX ix_ml_examples_dataset_split ON ml_training_examples (dataset_id, data_split);
CREATE INDEX ix_ml_models_dataset ON ml_models (dataset_id);
CREATE INDEX ix_conflict_project_checked ON conflict_checks (project_id, checked_at DESC);
CREATE INDEX ix_conflict_proposed ON conflict_checks (proposed_version_id, checked_at DESC);
CREATE INDEX ix_conflict_operation ON conflict_checks (ai_operation_id) WHERE ai_operation_id IS NOT NULL;
CREATE INDEX ix_evidence_related_version ON conflict_evidence (decision_version_id);
CREATE INDEX ix_predictions_model ON ml_predictions (model_id);
CREATE INDEX ix_predictions_check ON ml_predictions (conflict_check_id);

--rollback DROP TABLE IF EXISTS ml_predictions;
--rollback DROP TABLE IF EXISTS conflict_evidence;
--rollback DROP TABLE IF EXISTS conflict_checks;
--rollback ALTER TABLE decision_versions DROP CONSTRAINT IF EXISTS uq_decision_versions_decision_id;
--rollback DROP TABLE IF EXISTS ml_models;
--rollback DROP TABLE IF EXISTS ml_training_examples;
--rollback DROP TABLE IF EXISTS ml_datasets;
