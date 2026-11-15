--liquibase formatted sql

--changeset teamai:006-create-github-integration

-- Needed to enforce project ownership of a backlog using composite foreign keys.
ALTER TABLE backlogs
    ADD CONSTRAINT uq_backlogs_project_id UNIQUE (project_id, id);

-- One GitHub repository connection per project for the MVP.
-- OAuth/App tokens must be stored in a secret manager, not in this table.
CREATE TABLE github_connections (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    connected_by UUID NOT NULL,
    installation_id BIGINT NOT NULL,
    repository_id BIGINT NOT NULL,
    repository_owner VARCHAR(100) NOT NULL,
    repository_name VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_github_connection_project
        FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT fk_github_connection_user
        FOREIGN KEY (connected_by) REFERENCES users(id),
    CONSTRAINT uq_github_connection_project UNIQUE (project_id),
    CONSTRAINT uq_github_connection_project_id UNIQUE (project_id, id),
    CONSTRAINT ck_github_installation_id CHECK (installation_id > 0),
    CONSTRAINT ck_github_repository_id CHECK (repository_id > 0),
    CONSTRAINT ck_github_repository_owner CHECK (
        length(btrim(repository_owner)) > 0
        AND repository_owner = btrim(repository_owner)
    ),
    CONSTRAINT ck_github_repository_name CHECK (
        length(btrim(repository_name)) > 0
        AND repository_name = btrim(repository_name)
    ),
    CONSTRAINT ck_github_connection_status CHECK (
        status IN ('active', 'disconnected', 'error')
    ),
    CONSTRAINT ck_github_connection_timestamps CHECK (updated_at >= created_at)
);

-- This table tracks the mapping between internal tasks and GitHub Issues.
-- Composite FKs guarantee that the connection, backlog, and task share a project.
CREATE TABLE github_issues (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    connection_id UUID NOT NULL,
    backlog_id UUID NOT NULL,
    task_id UUID NOT NULL,
    github_issue_id BIGINT,
    github_issue_number INTEGER,
    github_issue_url TEXT,
    sync_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    last_error TEXT,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_github_issue_connection_same_project
        FOREIGN KEY (project_id, connection_id)
        REFERENCES github_connections(project_id, id),
    CONSTRAINT fk_github_issue_backlog_same_project
        FOREIGN KEY (project_id, backlog_id)
        REFERENCES backlogs(project_id, id),
    CONSTRAINT fk_github_issue_task_same_backlog
        FOREIGN KEY (backlog_id, task_id)
        REFERENCES tasks(backlog_id, id),
    CONSTRAINT uq_github_issue_task UNIQUE (connection_id, task_id),
    CONSTRAINT ck_github_issue_id CHECK (
        github_issue_id IS NULL OR github_issue_id > 0
    ),
    CONSTRAINT ck_github_issue_number CHECK (
        github_issue_number IS NULL OR github_issue_number > 0
    ),
    CONSTRAINT ck_github_issue_url CHECK (
        github_issue_url IS NULL OR length(btrim(github_issue_url)) > 0
    ),
    CONSTRAINT ck_github_issue_sync_status CHECK (
        sync_status IN ('pending', 'synced', 'failed')
    ),
    CONSTRAINT ck_github_issue_synced_details CHECK (
        sync_status <> 'synced'
        OR (github_issue_number IS NOT NULL AND github_issue_url IS NOT NULL)
    ),
    CONSTRAINT ck_github_issue_timestamps CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX ux_github_issue_number_per_connection
    ON github_issues (connection_id, github_issue_number)
    WHERE github_issue_number IS NOT NULL;

CREATE UNIQUE INDEX ux_github_issue_external_id_per_connection
    ON github_issues (connection_id, github_issue_id)
    WHERE github_issue_id IS NOT NULL;

CREATE INDEX ix_github_connections_connected_by
    ON github_connections (connected_by);

CREATE INDEX ix_github_issues_project_sync_status
    ON github_issues (project_id, sync_status);

CREATE INDEX ix_github_issues_backlog
    ON github_issues (backlog_id);

--rollback DROP TABLE IF EXISTS github_issues;
--rollback DROP TABLE IF EXISTS github_connections;
--rollback ALTER TABLE backlogs DROP CONSTRAINT IF EXISTS uq_backlogs_project_id;
