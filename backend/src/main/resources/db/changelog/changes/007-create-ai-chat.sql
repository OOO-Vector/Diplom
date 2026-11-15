--liquibase formatted sql

--changeset teamai:007-create-ai-chat splitStatements:false

-- AI execution records, including optional usage metrics.
CREATE TABLE ai_operations (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    initiated_by UUID NOT NULL,
    operation_type VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'queued',
    provider VARCHAR(80),
    model_name VARCHAR(100),
    input_tokens INTEGER,
    output_tokens INTEGER,
    duration_ms BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error_message TEXT,

    CONSTRAINT fk_ai_operations_project FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT fk_ai_operations_initiator FOREIGN KEY (initiated_by) REFERENCES users(id),
    CONSTRAINT uq_ai_operations_project_id UNIQUE (project_id, id),
    CONSTRAINT ck_ai_operations_type CHECK (
        operation_type IN ('task_decomposition', 'context_chat', 'conflict_check', 'context_indexing')
    ),
    CONSTRAINT ck_ai_operations_status CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    CONSTRAINT ck_ai_operations_metrics CHECK (
        (input_tokens IS NULL OR input_tokens >= 0)
        AND (output_tokens IS NULL OR output_tokens >= 0)
        AND (duration_ms IS NULL OR duration_ms >= 0)
    ),
    CONSTRAINT ck_ai_operations_started_time CHECK (started_at IS NULL OR started_at >= created_at),
    CONSTRAINT ck_ai_operations_finished_time CHECK (
        finished_at IS NULL OR (started_at IS NOT NULL AND finished_at >= started_at)
    ),
    CONSTRAINT ck_ai_operations_lifecycle CHECK (
        (status = 'queued' AND started_at IS NULL AND finished_at IS NULL)
        OR (status = 'running' AND started_at IS NOT NULL AND finished_at IS NULL)
        OR (status IN ('completed', 'failed') AND started_at IS NOT NULL AND finished_at IS NOT NULL)
    ),
    CONSTRAINT ck_ai_operations_error_state CHECK (
        (status = 'failed' AND error_message IS NOT NULL AND length(btrim(error_message)) > 0)
        OR (status <> 'failed' AND error_message IS NULL)
    )
);

-- Sessions are project-scoped; authorization is enforced by the backend.
CREATE TABLE chat_sessions (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    created_by UUID NOT NULL,
    title VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_chat_sessions_project FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT fk_chat_sessions_creator FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT uq_chat_sessions_project_id UNIQUE (project_id, id),
    CONSTRAINT ck_chat_sessions_title CHECK (title IS NULL OR length(btrim(title)) > 0),
    CONSTRAINT ck_chat_sessions_timestamps CHECK (updated_at >= created_at)
);

-- Redundant project_id enables composite FKs that prevent cross-project links.
CREATE TABLE chat_messages (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    session_id UUID NOT NULL,
    author_id UUID,
    ai_operation_id UUID,
    sender VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_chat_messages_session FOREIGN KEY (project_id, session_id)
        REFERENCES chat_sessions(project_id, id),
    CONSTRAINT fk_chat_messages_author FOREIGN KEY (author_id) REFERENCES users(id),
    CONSTRAINT fk_chat_messages_operation FOREIGN KEY (project_id, ai_operation_id)
        REFERENCES ai_operations(project_id, id),
    CONSTRAINT uq_chat_messages_project_id UNIQUE (project_id, id),
    CONSTRAINT ck_chat_messages_sender CHECK (sender IN ('user', 'assistant', 'system')),
    CONSTRAINT ck_chat_messages_author CHECK ((sender = 'user') = (author_id IS NOT NULL)),
    CONSTRAINT ck_chat_messages_operation_sender CHECK (ai_operation_id IS NULL OR sender = 'assistant'),
    CONSTRAINT ck_chat_messages_content CHECK (length(btrim(content)) > 0)
);

-- An existing chunk must belong to its declared source. This unique pair
-- is needed for an ordinary composite foreign key (without a trigger).
ALTER TABLE knowledge_chunks
    ADD CONSTRAINT uq_knowledge_chunks_source_id UNIQUE (source_id, id);

-- A citation is valid only when the message and knowledge source are in
-- the same project AND the chunk belongs to that specific knowledge source.
CREATE TABLE chat_message_sources (
    project_id UUID NOT NULL,
    message_id UUID NOT NULL,
    source_id UUID NOT NULL,
    chunk_id UUID NOT NULL,
    citation_order INTEGER NOT NULL,

    CONSTRAINT pk_chat_message_sources PRIMARY KEY (message_id, chunk_id),
    CONSTRAINT fk_citations_message FOREIGN KEY (project_id, message_id)
        REFERENCES chat_messages(project_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_citations_source FOREIGN KEY (project_id, source_id)
        REFERENCES knowledge_sources(project_id, id),
    CONSTRAINT fk_citations_chunk_source FOREIGN KEY (source_id, chunk_id)
        REFERENCES knowledge_chunks(source_id, id),
    CONSTRAINT uq_chat_citations_order UNIQUE (message_id, citation_order),
    CONSTRAINT ck_chat_citations_order CHECK (citation_order > 0)
);

CREATE INDEX ix_ai_operations_project_created ON ai_operations (project_id, created_at DESC);
CREATE INDEX ix_ai_operations_initiated_by ON ai_operations (initiated_by);
CREATE INDEX ix_chat_sessions_project_updated ON chat_sessions (project_id, updated_at DESC);
CREATE INDEX ix_chat_sessions_created_by ON chat_sessions (created_by);
CREATE INDEX ix_chat_messages_session_timeline ON chat_messages (session_id, created_at, id);
CREATE INDEX ix_chat_messages_operation ON chat_messages (ai_operation_id) WHERE ai_operation_id IS NOT NULL;
CREATE INDEX ix_chat_messages_author ON chat_messages (author_id) WHERE author_id IS NOT NULL;
CREATE INDEX ix_chat_citations_source ON chat_message_sources (project_id, source_id);
CREATE INDEX ix_chat_citations_chunk ON chat_message_sources (source_id, chunk_id);

--rollback DROP TABLE IF EXISTS chat_message_sources;
--rollback ALTER TABLE knowledge_chunks DROP CONSTRAINT IF EXISTS uq_knowledge_chunks_source_id;
--rollback DROP TABLE IF EXISTS chat_messages;
--rollback DROP TABLE IF EXISTS chat_sessions;
--rollback DROP TABLE IF EXISTS ai_operations;
