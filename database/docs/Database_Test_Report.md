# Team AI Orchestrator — Database Verification and Test Report

**Project:** Team AI Orchestrator  
**Database:** PostgreSQL 16.16 with pgvector 0.8.7  
**Schema management:** Liquibase 5.0.4  
**Report date:** 15 November 2026  
**Status:** Development database verification; not a production certification

## 1. Purpose and scope

This report documents evidence collected during database development and verification. It addresses schema reproducibility, referential and business-rule integrity, access controls, concurrency handling, and query performance. The primary application database is `team_ai_db`. A separate database, `team_ai_repro_check`, was used for the clean-schema migration test. A second, fully independent PostgreSQL container (`team-ai-postgres-repro`, port 5434) and a fresh Docker volume were then used to verify clean infrastructure initialization. Both exercises avoided destructive changes to the development database.

## 2. Database design summary

The application schema consists of **27 domain tables** organized into seven logical modules:

| Module | Domain tables |
|---|---:|
| Core & Access | 3 |
| Planning | 4 |
| Shared Project Memory | 5 |
| GitHub Integration | 2 |
| AI & Chat | 4 |
| Conflict Detection & ML | 6 |
| Analytics & Events | 3 |
| **Total** | **27** |

The schema uses primary and foreign keys, CHECK and UNIQUE constraints, dedicated indexes, database triggers, and a reporting view. The installed `vector` extension supports embedding storage and vector operations. The application uses an OLTP-oriented relational design.

## 3. Verification summary

| Verification | Evidence/result | Status |
|---|---|---|
| Clean-schema deployment | `team_ai_repro_check` went from 0 to 27 domain tables following application startup | PASS |
| Liquibase migration history | 12 entries (001–012), each `EXECUTED` | PASS |
| pgvector availability | `vector`, version `0.8.7` in the reproducibility database | PASS |
| Example application permissions | `team_ai_app` has `SELECT` and `INSERT` on `public.projects`; no `CREATE` permission on `public` schema | PASS |
| Database integrity suite | 78 previously executed SQL checks across nine test scripts | Reported PASS; retain original test logs |
| Concurrent ownership modification | Session-level row-lock test using `NOWAIT` | Previously verified |
| Concurrent outbox claiming | Separate workers claimed different entries using `FOR UPDATE SKIP LOCKED` | Previously verified |
| Schema audit | 27 tables; 55 foreign keys; 103 CHECK constraints; 27 PK constraints; 27 UNIQUE constraints; one reporting view | Previously verified |
| Index validity | 0 invalid indexes in the recorded schema audit | Previously verified |
| Fresh Docker-volume deployment | New PostgreSQL container and volume; roles created automatically; 12 Liquibase migrations, 27 tables, pgvector and example privileges verified; Spring Boot started | PASS |
| Deployment to an independently provisioned host | Not performed; distinct from the verified fresh-volume container test | NOT TESTED |

**Evidence quality note:** The migration, extension, table-count, and example permission results, and the fresh-volume bootstrap, were confirmed using command output on 15 November 2026. The test-suite, audit, and performance findings are prior development-session records; attach or commit the original output logs for independent review.

## 4. Clean-schema reproducibility

### 4.1 Method

1. Create a separate empty PostgreSQL database named `team_ai_repro_check` within the existing PostgreSQL container.
2. Configure Spring Boot's datasource and Liquibase URLs for the new database using session-local environment variables.
3. Run the backend with Liquibase enabled and Hibernate schema validation configured (`spring.jpa.hibernate.ddl-auto=validate`).
4. Query PostgreSQL catalog tables and Liquibase history after the startup attempt.

### 4.2 Recorded evidence

**Domain table count**

```sql
SELECT count(*)
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename NOT IN ('databasechangelog', 'databasechangeloglock');
```

Observed result: **27**.

**Liquibase migration records**

```sql
SELECT id, exectype
FROM databasechangelog
ORDER BY orderexecuted;
```

Observed: **12 rows**, all `EXECUTED`:

```text
001-enable-pgvector
002-create-core
003-core-ownership
004-create-planning
005-create-project-memory
006-create-github-integration
007-create-ai-chat
008-create-conflict-ml
009-create-analytics-events
010-prevent-task-dependency-cycles
011-grant-app-privileges
012-optimize-indexes
```

**Extension verification**

```sql
SELECT extname, extversion
FROM pg_extension
WHERE extname = 'vector';
```

Observed: `vector | 0.8.7`.

**Example access verification**

```sql
SELECT
  has_table_privilege('team_ai_app', 'public.projects', 'SELECT') AS can_read,
  has_table_privilege('team_ai_app', 'public.projects', 'INSERT') AS can_insert,
  has_schema_privilege('team_ai_app', 'public', 'CREATE') AS can_create_tables;
```

Observed: `true | true | false`.

### 4.3 Interpretation and limitation of the first exercise

The first exercise established that the schema, extension and migration history could be reconstructed in a new database **within an existing configured PostgreSQL container**. The separate fresh-volume exercise documented below additionally verified database role initialization and application startup. These results do not establish deployment to a separate host or production readiness.

### 4.4 Fresh PostgreSQL Docker-volume deployment (15 November 2026)

An isolated `pgvector/pgvector:pg16` container (`team-ai-postgres-repro`) was provisioned with a newly created Docker volume and mapped to local port `5434`; the existing development container on port `5433` remained untouched. The `database/security/002-init-roles.sh` script was mounted under `/docker-entrypoint-initdb.d/`, using the application's password supplied through environment variables.

The PostgreSQL startup log showed three `CREATE ROLE` operations, two `GRANT ROLE` operations, and `Database application roles initialized.` The Spring Boot backend was then started with its datasource and Liquibase URLs pointed at port `5434`. Liquibase reported all 12 changesets executed successfully, and the backend subsequently started. An initial backend startup attempt encountered an occupied HTTP port (`8081`); resolving that port conflict allowed application startup. This conflict did not affect the successful database migrations.

The user-reported follow-up checks on the independent container confirmed **27 application tables**, **12 executed changesets**, **pgvector 0.8.7**, and example privilege values **`SELECT=true`, `INSERT=true`, `schema CREATE=false`** for `team_ai_app`. These observations verify clean-volume PostgreSQL setup, role initialization, schema migration, and application connection in the tested local environment.

**Limitations:** This exercise was not a deployment to a separate machine or an independent production environment. Terminal command transcripts and fresh-environment logs should be archived if the assessor requires independent evidence of the run.

## 5. Integrity and automated SQL tests

The SQL integrity tests were organized by module as follows:

| Script | Checks |
|---|---:|
| `001-core-integrity.sql` | 6 |
| `002-core-ownership-tests.sql` | 3 |
| `003-planning-integrity-tests.sql` | 6 |
| `004-project-memory-tests.sql` | 7 |
| `005-github-integration-tests.sql` | 8 |
| `006-ai-chat-tests.sql` | 10 |
| `007-conflict-ml-tests.sql` | 17 |
| `008-analytics-events-tests.sql` | 14 |
| `010-task-dependency-cycles-tests.sql` | 7 |
| **Total** | **78** |

Prior testing covered data-integrity rules including project ownership, task dependencies, constraints and relationships across the modules, and cycle prevention. The database includes deferred constraint triggers that enforce single ownership of a project, and a recursive cycle-detection mechanism for task dependencies.

The `009-concurrency-setup.sql` script prepares persistent test fixtures and is **not** counted among the 78 automated checks. Its cleanup must be addressed after concurrency testing.

**Evidence to retain:** original `psql` output for each test script, pass/fail indicators, PostgreSQL version, date, and database name. A summary count without logs is less reproducible.

## 6. Concurrency checks

Two manual two-session scenarios were previously exercised:

- **Project ownership:** competing ownership changes were tested with row locking and `NOWAIT`, showing that concurrent modification can be blocked rather than silently violating the ownership invariant.
- **Outbox processing:** two sessions used `FOR UPDATE SKIP LOCKED` and selected distinct outbox records, demonstrating the intended non-overlapping work-claim pattern.

These are scenario checks, not a comprehensive high-load concurrency or isolation-level test suite. Retain the terminal transcripts if they are required for assessment.

## 7. Schema and security audit

The recorded read-only schema audit reported:

| Schema property | Recorded quantity |
|---|---:|
| Domain tables | 27 |
| Foreign-key constraints | 55 |
| CHECK constraints | 103 |
| Primary-key constraints | 27 |
| UNIQUE constraints | 27 |
| Constraint triggers for ownership invariant | 2 |
| Reporting views | 1 (`v_ai_review_stats`) |
| Invalid indexes | 0 |

An additional role audit recorded the intended membership pattern: `team_ai_app` inherits `app_write`, and `app_write` inherits `app_read`. The application's DML permissions were separated from migration privileges. The current clean-schema verification directly confirmed the example privileges on `public.projects`; a comprehensive per-table permissions recheck is still recommended for the report appendix.

## 8. Query performance and indexing

Previous synthetic-data experiments used approximately 55,000 domain rows and compared query plans before and after migration `012-optimize-indexes`.

| Query scenario | Recorded baseline (ms) | After indexes (ms) | Interpretation |
|---|---:|---:|---|
| Q1: task pagination | 1.641 | 0.096 | Approx. 17.1× faster in this run |
| Q2: decisions listing | 0.560 | 0.190 | Approx. 2.9× faster in this run |
| Q3: chat history | 0.036 | 0.089 | Slower in this run; no demonstrated improvement |
| Q4: outbox selection | 0.197 | 0.226 | Slower in this run; no demonstrated improvement |
| Q5: review statistics | 3.404 | 2.790 | Modest improvement in this run |

Migration `012` introduced two composite indexes:

```sql
-- Index keys (abbreviated; consult migration 012 for canonical DDL)
-- tasks(backlog_id, status, sort_order, id)
-- architectural_decisions(project_id, status, updated_at DESC, id)
```

The recorded execution plans indicated that the composite indexes can avoid unnecessary top-N sorting for Q1 and Q2. **Do not treat single-run execution timings as statistically reliable benchmarks**: caching, run order, row counts and hardware conditions can affect these values. Further runs with controlled warm-up, repetition and summary statistics are recommended before claiming sustained speedups.

## 9. Remaining tasks

- [ ] Preserve reproducibility and SQL-test terminal logs under `database/docs/evidence/` (remove credentials and personal data).
- [x] Verify PostgreSQL initialization, role creation and migrations on a fresh isolated Docker volume (local environment).
- [ ] Repeat deployment on an independent host if that is required for assessment or production readiness.
- [ ] Execute and archive the full SQL-test suite against the fresh test database.
- [ ] Re-run the full role audit against the fresh test database.
- [ ] Re-run performance experiments with repeated trials and record `EXPLAIN (ANALYZE, BUFFERS)` plans.
- [ ] Confirm the synthetic performance seed and concurrency fixtures have been cleaned from the development database where appropriate.
- [x] Check that the root `README.md` documents fresh local installation and migration instructions.

## 10. Conclusion

The development verification results support the conclusion that the Team AI Orchestrator database has a functioning, versioned, reproducible schema and an established body of integrity, security and performance testing. The clean-schema exercise reconstructed all 27 domain tables through 12 executed Liquibase migrations and verified pgvector 0.8.7 and example application privileges. An additional fresh Docker-volume exercise on 15 November 2026 verified automatic role initialization, database migration and successful Spring Boot startup on an isolated PostgreSQL container. Independent-host deployment and retained machine-readable test transcripts remain outstanding for stronger reproducibility and production-readiness claims.
