# Refresh session persistence

[Migration 013](../../backend/src/main/resources/db/changelog/changes/013-create-refresh-sessions.sql) adds
`refresh_token_families` and `refresh_sessions`: 29 application tables and 13 changesets in total.
Families provide a stable lock, owner, absolute expiry and revocation record independent of token generations.
Production authentication services are separate; public API contracts are unchanged.

## Schema and constraints

### refresh_token_families

| Column | Type / constraints | Meaning |
|---|---|---|
| id | UUID PK | Stable login-family ID and row-lock target |
| user_id | UUID NOT NULL, FK users(id) | One immutable owner, inherited by every family token |
| issued_at | timestamptz NOT NULL, finite | Initial login instant supplied by backend Clock |
| expires_at | timestamptz NOT NULL, finite | Exactly issued_at + 168 hours; absolute expiry |
| revoked_at | nullable timestamptz, finite and >= issued_at | Family revocation, including replay/logout; may be recorded after expiry |

UNIQUE(id, issued_at, expires_at) is the composite FK target for token lifetime. Indexes on user_id and expires_at
support account lookup and privileged retention queries. An empty family can exist while initial issuance is being
prepared; the future service creates family and first token in one transaction.

### refresh_sessions

| Column | Type / constraints | Meaning |
|---|---|---|
| id | UUID PK | Token-generation record ID |
| family_id | UUID NOT NULL | Stable family reference |
| family_issued_at, expires_at | timestamptz NOT NULL | Copied immutable family lifetime; composite FK prevents divergence/sliding expiry |
| token_hash | bytea NOT NULL, UNIQUE, octet_length=32 | SHA-256 digest of the opaque refresh credential |
| issued_at | timestamptz NOT NULL, finite, family_issued_at <= issued_at < expires_at | Generation issuance |
| consumed_at | nullable timestamptz, finite, issued_at <= consumed_at < expires_at | Successful rotation consumed this credential |
| revoked_at | nullable timestamptz, finite and >= issued_at | Optional generation revocation; may coexist with consumed state |
| replacement_id | nullable UUID, UNIQUE, not self | Successor in the same family; present iff consumed_at is present |

Composite deferred FK (family_id, replacement_id) → (family_id, id) requires a real same-family successor at COMMIT.
It allows consume-before-insert within one transaction. UNIQUE(replacement_id) forbids two predecessors sharing a successor.
A partial unique index on family_id where consumed_at/revoked_at are NULL allows at most one locally available generation.
Expiry and family revocation are also required to decide whether it is usable; the partial index alone is not authorization.
The UNIQUE(family_id,id) index supplies family lookup; a separate expires_at index supports eventual cleanup.
No ON DELETE CASCADE: accidental deletion of users/families cannot erase refresh history.

SHA-256 is computed before INSERT in future application code from >=32 random bytes (opaque base64url credential).
Only the 32-byte digest is persisted; no raw-token column exists. The database verifies byte length/uniqueness,
not mathematical provenance: it cannot distinguish a 32-byte raw value from a digest. Caller discipline and tests
must ensure hashing. Integration fixtures actually generate random bytes and hash them with SHA-256.

Dates use timestamptz and injected backend time, with no implicit database-generated login/rotation instant.
168 hours is used rather than a calendar 7-day interval so daylight-saving transitions cannot alter the absolute TTL.
No CHECK against now(): expiry is evaluated when processing a request, not by time-dependent row constraints.

## Least-privilege grants

| Role | New tables |
|---|---|
| app_read | No access to refresh digests/metadata |
| app_write / inherited team_ai_app | SELECT, INSERT on both tables; UPDATE(revoked_at) on families; UPDATE(consumed_at,revoked_at,replacement_id) on sessions |
| Migration owner / privileged maintenance | Owns DDL and eventual retention cleanup |

No app DELETE, TRUNCATE, DDL, identity/hash/lifetime UPDATE or Liquibase history access.
Retention cleanup requires a separately reviewed privileged job/role, never granting DDL to the application.

## Transaction and locking protocol

Future login creates a family and its initial token in one transaction. Rotation, logout and replay use READ COMMITTED:

1. Resolve the digest and lock the stable family first, without first locking the token generation:

   ```sql
   SELECT f.*
   FROM refresh_token_families f
   JOIN refresh_sessions s ON s.family_id = f.id
   WHERE s.token_hash = :sha256_digest
   FOR UPDATE OF f;
   ```

2. Re-read token state in a separate statement after acquiring the lock. Check active user, family/token expiry,
   revocation and consumption using a fresh Clock instant after any lock wait.
3. For rotation, consume the predecessor with its replacement ID, then insert the successor with unchanged family
   lifetime. The deferred FK permits this order; rollback leaves the predecessor available.
4. For replay or logout, revoke the family while retaining history. Commit replay revocation before returning 401;
   do not undo it through a rollback-causing exception. Never clear revocation on retries.
5. Return JWT/cookie only after commit; perform no remote calls under the lock.

Old-token replay and current-token rotation contend on the same family row; unrelated families remain independent.
Multi-family commands lock IDs in deterministic order. Account disabling needs a compatible user/family lock order;
family locking alone does not serialize user-status changes. Higher isolation levels need an explicit retry policy.

DDL enforces structural constraints, not the complete state machine. Forward-only transitions, successor chronology,
cycle prevention, rejection of revoked families, user checks and lock discipline remain application responsibilities.
Keep family and consumed/revoked rows until at least family expiry. Cleanup requires an agreed retention policy and
privileged operation respecting FK ordering/deferral. Migration rollback drops both tables and loses refresh history;
it is not a routine session cleanup mechanism.

## Running schemaTest

Requires JDK 21 and Docker. From `backend/`:

```powershell
.\gradlew.bat schemaTest --rerun-tasks --console=plain
```

The suite uses the production Liquibase master and actual role initialization script on two disposable
`pgvector/pgvector:pg16` Testcontainers with random ports and generated credentials. It does not load `.env`,
start Spring/Hibernate or connect to the development database. Docker failures fail the suite rather than skip it.
Only test-owned containers are cleaned up. Versions follow Gradle configuration; the image tag is mutable.

Coverage: clean 001-013 installation; populated 001-012 upgrade preserving checksums/history/data; idempotent update;
digest, lifetime and replacement constraints; commit-time FK rollback; actual application-role permissions;
and old/current-generation lock contention with committed revocation visibility.
This does not run the 78 historical SQL checks or production auth flows; DB-014 remains separate work.

`schemaTest` is explicit, not part of ordinary `test`/`check`; CI must invoke it directly.
Local XML: `backend/build/test-results/schemaTest/`.
Local HTML: `backend/build/reports/tests/schemaTest/index.html`.
Generated results are ignored by Git; report run outcomes in [Issue #14](https://github.com/OOO-Vector/Diplom/issues/14)
with the tested commit and environment. This document supplements the historical Data Dictionary/ERD for the new tables.
