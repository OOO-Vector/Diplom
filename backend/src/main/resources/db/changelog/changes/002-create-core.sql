--liquibase formatted sql

--changeset teamai:002-create-core

-- 1. USERS

CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(254) NOT NULL,
    password_hash TEXT NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,

    CONSTRAINT ck_users_email_trimmed
        CHECK (
            length(btrim(email)) > 0
            AND email = btrim(email)
        ),

    CONSTRAINT ck_users_name_nonempty
        CHECK (length(btrim(display_name)) > 0),

    CONSTRAINT ck_users_hash_nonempty
        CHECK (length(btrim(password_hash)) > 0),

    CONSTRAINT ck_users_timestamps
        CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX ux_users_email_ci
    ON users (lower(email));


-- 2. PROJECTS

CREATE TABLE projects (
    id UUID PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    created_by UUID NOT NULL,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,

    CONSTRAINT fk_projects_created_by
        FOREIGN KEY (created_by)
        REFERENCES users(id),

    CONSTRAINT ck_projects_01
        CHECK (status IN ('active', 'archived')),

    CONSTRAINT ck_projects_name_nonempty
        CHECK (length(btrim(name)) > 0),

    CONSTRAINT ck_projects_timestamps
        CHECK (updated_at >= created_at)
);


-- 3. PROJECT MEMBERS

CREATE TABLE project_members (
    project_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role VARCHAR(20) NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL,

    CONSTRAINT pk_project_members
        PRIMARY KEY (project_id, user_id),

    CONSTRAINT fk_project_members_project
        FOREIGN KEY (project_id)
        REFERENCES projects(id),

    CONSTRAINT fk_project_members_user
        FOREIGN KEY (user_id)
        REFERENCES users(id),

    CONSTRAINT ck_project_members_01
        CHECK (role IN ('owner', 'member'))
);

-- One project cannot have two owners.
CREATE UNIQUE INDEX ux_project_members_single_owner
    ON project_members (project_id)
    WHERE role = 'owner';

-- Faster lookup of projects by user.
CREATE INDEX ix_project_members_user
    ON project_members (user_id);

-- Faster lookup by project creator.
CREATE INDEX ix_projects_created_by
    ON projects (created_by);
