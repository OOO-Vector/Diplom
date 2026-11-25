--liquibase formatted sql

--changeset teamai:013-create-refresh-sessions

-- Stable lock target for all generations of a login session.
CREATE TABLE refresh_token_families (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,

    CONSTRAINT fk_refresh_family_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT uq_refresh_family_lifetime UNIQUE (id, issued_at, expires_at),
    CONSTRAINT ck_refresh_family_lifetime CHECK (
        isfinite(issued_at) AND isfinite(expires_at)
        AND expires_at = issued_at + INTERVAL '168 hours'
    ),
    -- Replay may be discovered after expiry; revocation is still recorded.
    CONSTRAINT ck_refresh_family_revoked CHECK (
        revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at >= issued_at)
    )
);

CREATE TABLE refresh_sessions (
    id UUID PRIMARY KEY,
    family_id UUID NOT NULL,
    -- Copied lifetime is constrained by FK, never extended by rotation.
    family_issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    token_hash BYTEA NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    replacement_id UUID,

    CONSTRAINT fk_refresh_session_family FOREIGN KEY (family_id, family_issued_at, expires_at)
        REFERENCES refresh_token_families(id, issued_at, expires_at),
    CONSTRAINT uq_refresh_session_hash UNIQUE (token_hash),
    CONSTRAINT ck_refresh_session_hash CHECK (octet_length(token_hash) = 32),
    CONSTRAINT uq_refresh_session_family_id UNIQUE (family_id, id),
    CONSTRAINT uq_refresh_session_replacement UNIQUE (replacement_id),
    CONSTRAINT fk_refresh_session_replacement FOREIGN KEY (family_id, replacement_id)
        REFERENCES refresh_sessions(family_id, id)
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT ck_refresh_session_issued CHECK (
        isfinite(issued_at) AND issued_at >= family_issued_at AND issued_at < expires_at
    ),
    CONSTRAINT ck_refresh_session_consumed CHECK (
        consumed_at IS NULL OR (isfinite(consumed_at) AND consumed_at >= issued_at AND consumed_at < expires_at)
    ),
    CONSTRAINT ck_refresh_session_revoked CHECK (
        revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at >= issued_at)
    ),
    CONSTRAINT ck_refresh_session_replacement_state CHECK (
        (consumed_at IS NULL) = (replacement_id IS NULL)
    ),
    CONSTRAINT ck_refresh_session_not_self CHECK (replacement_id IS NULL OR replacement_id <> id)
);

-- State transitions remain application commands under a family row lock.
-- Consume the old row before inserting its successor; the FK is deferred to COMMIT.
CREATE UNIQUE INDEX ux_refresh_session_available_per_family
    ON refresh_sessions (family_id) WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX ix_refresh_families_user ON refresh_token_families (user_id);
CREATE INDEX ix_refresh_families_expiry ON refresh_token_families (expires_at);
CREATE INDEX ix_refresh_sessions_expiry ON refresh_sessions (expires_at);
-- uq_refresh_session_family_id already supplies a family-prefix index.

-- Sensitive token digests are not exposed to the general read-only role.
GRANT SELECT, INSERT ON refresh_token_families, refresh_sessions TO app_write;
GRANT UPDATE (revoked_at) ON refresh_token_families TO app_write;
GRANT UPDATE (consumed_at, revoked_at, replacement_id) ON refresh_sessions TO app_write;
-- No DELETE: preserve replay evidence. Retention cleanup is a separate privileged task.
-- No identity/hash/lifetime UPDATE, DDL, TRUNCATE or Liquibase history permissions.

--rollback DROP TABLE IF EXISTS refresh_sessions;
--rollback DROP TABLE IF EXISTS refresh_token_families;
