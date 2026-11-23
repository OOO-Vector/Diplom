# Team AI Orchestrator — Database

## Overview

The Team AI Orchestrator database uses PostgreSQL 16 with the pgvector extension.

The database supports project management, AI-assisted task decomposition, shared project memory, GitHub integration, AI conversations, conflict detection, machine learning, and analytics.

The current changelog contains 29 application tables organized into seven logical modules (13 changesets).
The historical 001–012 baseline contains 27 tables; CORE-01 adds two refresh persistence tables in 013.

## Technology Stack

- PostgreSQL 16
- pgvector 0.8.7 (verified in the test environment)
- Liquibase 5
- Spring Boot and Spring Data JPA
- Docker Compose

## Database Modules

| Module | Tables |
|---|---:|
| Core & Access | 5 |
| Planning | 4 |
| Shared Project Memory | 5 |
| GitHub Integration | 2 |
| AI & Chat | 4 |
| Conflict Detection & ML | 6 |
| Analytics & Events | 3 |
| **Total** | **29** |

## Database Initialization

The PostgreSQL instance is provisioned using Docker Compose.

Application database roles are initialized using `security/002-init-roles.sh` during the first initialization of an empty PostgreSQL data directory.

The initialization process creates three roles:

- `app_read` — read-only role.
- `app_write` — write role inheriting `app_read`.
- `team_ai_app` — application login inheriting `app_write`.

Database schema creation and subsequent changes are managed through Liquibase migrations located in:

`../backend/src/main/resources/db/changelog/`

The application uses separate database credentials for administrative migrations and application access.

## Local Deployment

1. Create a `.env` file from `.env.example` and configure database passwords.
2. Start PostgreSQL from the project root:

   `docker compose up -d`

3. Start the Spring Boot application from `backend/` with `DB_PASSWORD` and `DB_APP_PASSWORD` configured in its environment:

   `gradlew.bat bootRun`

Liquibase automatically applies outstanding migrations when the Spring Boot application starts.

The default local PostgreSQL port is `5433`.

## Database Security

The application connects using the restricted `team_ai_app` account.

Database migrations use the separate administrative account `team_ai_admin`.

The database implements role-based permissions and integrity constraints. The application role is not granted schema creation privileges.

## Integrity and Concurrency

The schema includes primary keys, foreign keys, unique constraints, CHECK constraints, indexes, and database-level business rules.

Additional integrity mechanisms include:

- Deferred constraint triggers enforcing project ownership.
- Prevention of cyclic task dependencies.
- Transactional concurrency controls.
- Outbox-based event processing.

## Testing and Validation

Database verification has included:

- 78 SQL integrity tests.
- Schema and privilege audits.
- Transaction concurrency tests.
- Query execution plan analysis.
- Index performance experiments.
- Database schema reproduction from Liquibase migrations.
- Fresh PostgreSQL initialization using an isolated Docker volume.

The historical fresh deployment verification of 001–012 confirmed:

| Verification | Result |
|---|---|
| Application tables | 27 |
| Liquibase migrations | 12 executed |
| pgvector | 0.8.7 |
| Application roles | Initialized successfully |
| Application privileges | Verified |
| Spring Boot database connection | Successful |

## Documentation

- `docs/CORE-01_Refresh_Sessions.md` — migration 013 schema, least-privilege grants, transaction/locking protocol and schemaTest instructions. Generated reports remain local; run outcomes are recorded in Issue #14. DB-014 and the 78 historical SQL checks are separate work.

- `docs/Team_AI_Orchestrator_Data_Dictionary.docx` — database entities, attributes, and constraints.
- `docs/erd/` — full and modular ER diagrams, including DBML source files.
- `docs/Database_Test_Report.md` — database testing and verification report.
- `documentation/` — SQL scripts and CSV exports for schema documentation.
- `audit/` — SQL audit queries and results.
- `tests/` — database integrity tests.
- `performance/` — performance benchmarks and index experiments.
- `security/` — database initialization and security scripts.

## Limitations

Successful database initialization does not independently verify complete application functionality or deployment to every production environment.

A production deployment requires secure credential management, backups, monitoring, and additional operational configuration.
