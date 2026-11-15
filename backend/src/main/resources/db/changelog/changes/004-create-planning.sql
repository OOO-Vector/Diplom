
--liquibase formatted sql

--changeset teamai:004-create-planning

CREATE TABLE specifications (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    uploaded_by UUID NOT NULL,
    version INTEGER NOT NULL,
    title VARCHAR(200) NOT NULL,
    original_filename VARCHAR(255),
    content TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'uploaded',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_spec_project
        FOREIGN KEY (project_id) REFERENCES projects(id),
    CONSTRAINT fk_spec_uploader
        FOREIGN KEY (uploaded_by) REFERENCES users(id),
    CONSTRAINT uq_spec_project_version
        UNIQUE (project_id, version),
    CONSTRAINT uq_spec_project_id
        UNIQUE (project_id, id),
    CONSTRAINT ck_spec_version CHECK (version > 0),
    CONSTRAINT ck_spec_title CHECK (length(btrim(title)) > 0),
    CONSTRAINT ck_spec_content CHECK (length(btrim(content)) > 0),
    CONSTRAINT ck_spec_status CHECK (
        status IN ('uploaded', 'processing', 'processed', 'failed')
    )
);

CREATE TABLE backlogs (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    specification_id UUID NOT NULL,
    version INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at TIMESTAMPTZ,

    CONSTRAINT fk_backlog_spec_project
        FOREIGN KEY (project_id, specification_id)
        REFERENCES specifications(project_id, id),
    CONSTRAINT uq_backlog_spec_version
        UNIQUE (specification_id, version),
    CONSTRAINT ck_backlog_version CHECK (version > 0),
    CONSTRAINT ck_backlog_status CHECK (
        status IN ('draft', 'approved', 'published')
    ),
    CONSTRAINT ck_backlog_approval CHECK (
        (status = 'draft' AND approved_at IS NULL)
        OR
        (status IN ('approved', 'published') AND approved_at IS NOT NULL)
    )
);

CREATE TABLE tasks (
    id UUID PRIMARY KEY,
    backlog_id UUID NOT NULL,
    parent_task_id UUID,
    task_type VARCHAR(12) NOT NULL,
    title VARCHAR(250) NOT NULL,
    description TEXT,
    acceptance_criteria TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    priority SMALLINT NOT NULL DEFAULT 3,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_task_backlog
        FOREIGN KEY (backlog_id) REFERENCES backlogs(id),
    CONSTRAINT uq_task_backlog_id UNIQUE (backlog_id, id),
    CONSTRAINT fk_task_parent_same_backlog
        FOREIGN KEY (backlog_id, parent_task_id)
        REFERENCES tasks(backlog_id, id)
        DEFERRABLE INITIALLY IMMEDIATE,
    CONSTRAINT ck_task_not_own_parent CHECK (
        parent_task_id IS NULL OR parent_task_id <> id
    ),
    CONSTRAINT ck_task_type CHECK (
        task_type IN ('epic', 'story', 'task')
    ),
    CONSTRAINT ck_task_title CHECK (length(btrim(title)) > 0),
    CONSTRAINT ck_task_status CHECK (
        status IN (
            'draft', 'ready', 'in_progress',
            'in_review', 'done', 'cancelled'
        )
    ),
    CONSTRAINT ck_task_priority CHECK (priority BETWEEN 1 AND 5),
    CONSTRAINT ck_task_sort CHECK (sort_order >= 0),
    CONSTRAINT ck_task_timestamps CHECK (updated_at >= created_at)
);

CREATE TABLE task_dependencies (
    backlog_id UUID NOT NULL,
    blocking_task_id UUID NOT NULL,
    blocked_task_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_task_dependencies
        PRIMARY KEY (
            backlog_id, blocking_task_id, blocked_task_id
        ),
    CONSTRAINT fk_dep_blocking_same_backlog
        FOREIGN KEY (backlog_id, blocking_task_id)
        REFERENCES tasks(backlog_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_dep_blocked_same_backlog
        FOREIGN KEY (backlog_id, blocked_task_id)
        REFERENCES tasks(backlog_id, id)
        ON DELETE CASCADE,
    CONSTRAINT ck_dep_no_self_reference CHECK (
        blocking_task_id <> blocked_task_id
    )
);

CREATE INDEX ix_specifications_uploaded_by
    ON specifications (uploaded_by);

CREATE INDEX ix_backlogs_project
    ON backlogs (project_id);

CREATE INDEX ix_tasks_backlog_status
    ON tasks (backlog_id, status);

CREATE INDEX ix_tasks_parent
    ON tasks (backlog_id, parent_task_id);

CREATE INDEX ix_dependencies_blocked
    ON task_dependencies (backlog_id, blocked_task_id);

--rollback DROP TABLE IF EXISTS task_dependencies;
--rollback DROP TABLE IF EXISTS tasks;
--rollback DROP TABLE IF EXISTS backlogs;
--rollback DROP TABLE IF EXISTS specifications;
