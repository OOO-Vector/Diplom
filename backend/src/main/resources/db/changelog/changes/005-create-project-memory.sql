--liquibase formatted sql

--changeset teamai:005-create-project-memory

-- A decision has a stable identity; its text/history lives in decision_versions.
CREATE TABLE architectural_decisions (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    decision_key VARCHAR(80) NOT NULL,
    title VARCHAR(250) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'proposed',
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_decision_project FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT fk_decision_creator FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT uq_decision_project_key UNIQUE (project_id, decision_key),
    CONSTRAINT uq_decision_project_id UNIQUE (project_id, id),
    CONSTRAINT ck_decision_key_nonempty CHECK (length(btrim(decision_key)) > 0 AND decision_key = btrim(decision_key)),
    CONSTRAINT ck_decision_title_nonempty CHECK (length(btrim(title)) > 0),
    CONSTRAINT ck_decision_status CHECK (status IN ('proposed', 'accepted', 'rejected', 'superseded')),
    CONSTRAINT ck_decision_timestamps CHECK (updated_at >= created_at)
);

CREATE TABLE decision_versions (
    id UUID PRIMARY KEY,
    decision_id UUID NOT NULL,
    version INTEGER NOT NULL,
    context_text TEXT NOT NULL,
    decision_text TEXT NOT NULL,
    rationale TEXT,
    consequences TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_decision_version_decision FOREIGN KEY (decision_id) REFERENCES architectural_decisions(id),
    CONSTRAINT fk_decision_version_author FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT uq_decision_version UNIQUE (decision_id, version),
    CONSTRAINT ck_decision_version_positive CHECK (version > 0),
    CONSTRAINT ck_decision_context_nonempty CHECK (length(btrim(context_text)) > 0),
    CONSTRAINT ck_decision_text_nonempty CHECK (length(btrim(decision_text)) > 0)
);

-- Resolution records connect two different decisions in the same project.
CREATE TABLE decision_resolutions (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    decision_id UUID NOT NULL,
    related_decision_id UUID NOT NULL,
    resolution_type VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    resolution_notes TEXT,
    resolved_by UUID,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_resolution_project FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT fk_resolution_decision FOREIGN KEY (project_id, decision_id)
        REFERENCES architectural_decisions(project_id, id),
    CONSTRAINT fk_resolution_related FOREIGN KEY (project_id, related_decision_id)
        REFERENCES architectural_decisions(project_id, id),
    CONSTRAINT fk_resolution_user FOREIGN KEY (resolved_by) REFERENCES users(id),
    CONSTRAINT ck_resolution_distinct CHECK (decision_id <> related_decision_id),
    CONSTRAINT ck_resolution_type CHECK (resolution_type IN ('conflict', 'supersession')),
    CONSTRAINT ck_resolution_status CHECK (status IN ('pending', 'resolved', 'dismissed')),
    CONSTRAINT ck_resolution_completion CHECK (
        (status = 'pending' AND resolved_by IS NULL AND resolved_at IS NULL)
        OR (status IN ('resolved', 'dismissed') AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
    )
);

-- Knowledge can come from a specification, decision, manual upload, or GitHub.
CREATE TABLE knowledge_sources (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    source_type VARCHAR(20) NOT NULL,
    specification_id UUID,
    decision_id UUID,
    title VARCHAR(250) NOT NULL,
    source_uri TEXT,
    content_hash VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_knowledge_project FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT fk_knowledge_spec FOREIGN KEY (project_id, specification_id)
        REFERENCES specifications(project_id, id),
    CONSTRAINT fk_knowledge_decision FOREIGN KEY (project_id, decision_id)
        REFERENCES architectural_decisions(project_id, id),
    CONSTRAINT uq_knowledge_project_id UNIQUE (project_id, id),
    CONSTRAINT ck_knowledge_type CHECK (source_type IN ('specification', 'decision', 'manual', 'github')),
    CONSTRAINT ck_knowledge_title CHECK (length(btrim(title)) > 0),
    CONSTRAINT ck_knowledge_reference CHECK (
        (source_type = 'specification' AND specification_id IS NOT NULL AND decision_id IS NULL)
        OR (source_type = 'decision' AND decision_id IS NOT NULL AND specification_id IS NULL)
        OR (source_type IN ('manual', 'github') AND specification_id IS NULL AND decision_id IS NULL)
    ),
    CONSTRAINT ck_knowledge_github_uri CHECK (
        source_type <> 'github' OR (source_uri IS NOT NULL AND length(btrim(source_uri)) > 0)
    ),
    CONSTRAINT ck_knowledge_timestamps CHECK (updated_at >= created_at)
);

-- Vector dimension stays open until an embedding model is selected.
CREATE TABLE knowledge_chunks (
    id UUID PRIMARY KEY,
    source_id UUID NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding vector,
    embedding_model VARCHAR(150),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_chunk_source FOREIGN KEY (source_id) REFERENCES knowledge_sources(id) ON DELETE CASCADE,
    CONSTRAINT uq_chunk_index UNIQUE (source_id, chunk_index),
    CONSTRAINT ck_chunk_index CHECK (chunk_index >= 0),
    CONSTRAINT ck_chunk_content CHECK (length(btrim(content)) > 0),
    CONSTRAINT ck_chunk_embedding_metadata CHECK (
        (embedding IS NULL AND embedding_model IS NULL)
        OR (embedding IS NOT NULL AND embedding_model IS NOT NULL AND length(btrim(embedding_model)) > 0)
    )
);

CREATE INDEX ix_decisions_project_status ON architectural_decisions (project_id, status);
CREATE INDEX ix_decisions_creator ON architectural_decisions (created_by);
CREATE INDEX ix_decision_versions_created ON decision_versions (decision_id, created_at DESC);
CREATE INDEX ix_resolutions_decision ON decision_resolutions (project_id, decision_id);
CREATE INDEX ix_resolutions_related ON decision_resolutions (project_id, related_decision_id);
CREATE INDEX ix_resolutions_status ON decision_resolutions (project_id, status);
CREATE INDEX ix_knowledge_project_type ON knowledge_sources (project_id, source_type);
CREATE INDEX ix_knowledge_spec ON knowledge_sources (specification_id) WHERE specification_id IS NOT NULL;
CREATE INDEX ix_knowledge_decision ON knowledge_sources (decision_id) WHERE decision_id IS NOT NULL;
-- No vector ANN index yet: it needs a selected embedding dimension/distance metric.

--rollback DROP TABLE IF EXISTS knowledge_chunks;
--rollback DROP TABLE IF EXISTS knowledge_sources;
--rollback DROP TABLE IF EXISTS decision_resolutions;
--rollback DROP TABLE IF EXISTS decision_versions;
--rollback DROP TABLE IF EXISTS architectural_decisions;
