# Team AI Orchestrator

**Team AI Orchestrator** is a diploma project for coordinating AI-assisted software development in a shared project context. The intended workflow starts with a project specification, produces a structured task backlog, and supports subsequent synchronization with GitHub Issues.

The project is being developed incrementally. **The PostgreSQL database foundation is implemented and tested; the application-level orchestration and user-facing functionality are still under development.** Features described below as planned should not be interpreted as implemented.

## Project Goals

- Turn project requirements into a reviewable, dependency-aware task backlog.
- Keep architectural decisions, API contracts, and other project knowledge in a shared context.
- Detect potentially conflicting decisions and surface supporting evidence.
- Integrate approved work items with GitHub Issues.
- Provide AI assistance and operational analytics for a development team.
- Develop and evaluate a trainable ML component as part of the diploma requirements.

## Current Implementation Status

| Area | Status |
| --- | --- |
| PostgreSQL schema (29 application tables after 013) | Implemented; CORE-01 pending review |
| Liquibase schema migrations (13 changesets) | 001–012 baseline plus 013 refresh persistence |
| Database roles, permissions, constraints, and indexes | Implemented |
| SQL integrity tests, audits, and query benchmarks | Executed and documented |
| Clean Docker-volume database initialization | Verified |
| Spring Boot application bootstrap and database connection | Verified |
| Registration, login, JWT and current user | CORE-02/03 implemented for external review; refresh rotation/logout remain CORE-04 |
| GitHub synchronization, AI orchestration, project-memory services | Planned / not yet implemented |
| Trainable ML component and end-user interface | Planned / not yet implemented |

The application implements the initial Core authentication endpoints with explicit Spring Security configuration. Other domain APIs remain planned.

## Technology Stack

| Component | Technology |
| --- | --- |
| Backend | Java 21, Spring Boot 4.0.9, Spring Data JPA |
| Build system | Gradle 9.8.2 (wrapper included) |
| Database | PostgreSQL 16 with pgvector |
| Database migrations | Liquibase |
| Local infrastructure | Docker Compose |
| Architecture | Modular monolith (planned application structure) |
| Frontend, AI/LLM provider, ML implementation | To be finalized and implemented |

## Repository Structure

```text
.
├── backend/
│   ├── src/main/java/                        # Spring Boot entry point
│   ├── src/main/resources/
│   │   ├── application.properties            # Local application configuration
│   │   └── db/changelog/                     # Liquibase master file and SQL migrations
│   ├── src/test/                             # Java tests
│   ├── build.gradle
│   └── gradlew.bat / gradlew
├── database/
│   ├── audit/                                # Schema and privilege audits
│   ├── docs/                                 # Data Dictionary, ER diagrams, test report
│   ├── documentation/                        # Metadata exports and export queries
│   ├── performance/                          # Benchmark scripts and recorded results
│   ├── security/                             # PostgreSQL role initialization
│   ├── tests/                                # SQL integrity and concurrency tests
│   └── README.md                             # Detailed database documentation
├── compose.yaml                              # Local PostgreSQL (port 5433)
├── compose.repro.yaml                        # Isolated reproducibility instance (port 5434)
├── .env.example                              # Environment-variable template
└── .gitignore
```

Additional frontend and ML directories will be introduced as those components are developed.

## Local Setup

### Prerequisites

- Java Development Kit **21**
- Docker with Docker Compose
- Git

The project includes a Gradle wrapper; a separate Gradle installation is not required.

### 1. Configure Environment Variables

From the **repository root**, create a local environment file:

**Windows CMD**

```cmd
copy .env.example .env
```

**Linux / macOS**

```bash
cp .env.example .env
```

Edit `.env` and set strong, different passwords:

```dotenv
POSTGRES_PASSWORD=replace_with_admin_password
DB_APP_PASSWORD=replace_with_app_password
```

The Docker Compose configuration reads these values from the root `.env` file. **Do not commit `.env` or real credentials.**

### 2. Start PostgreSQL

From the repository root:

```bash
docker compose up -d
```

The local PostgreSQL instance is available on **`127.0.0.1:5433`**; its database is named `team_ai_db`.

On the first startup with an empty Docker volume, `database/security/002-init-roles.sh` creates the `app_read`, `app_write`, and `team_ai_app` roles. These initialization scripts do **not** rerun automatically against an existing data volume.

### 3. Start the Backend

The backend requires database and authentication configuration in its process environment:

- `DB_PASSWORD`: the same administrative password as `POSTGRES_PASSWORD` in `.env`, used by Liquibase.
- `DB_APP_PASSWORD`: the application database password from `.env`, used by Spring DataSource.
- `APP_ALLOWED_ORIGINS`: comma-separated exact HTTPS origins without trailing slashes or paths.
- `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_KEY_ID`: deployment-specific identifiers; no defaults.
- `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`: Spring resource locations (`file:/...`) for an externally mounted PKCS#8 private PEM and X.509 public PEM, matching RSA keys of at least 2048 bits. Keep key files outside Git.

**Important:** Spring Boot does not automatically load the root `.env` file in this setup. Set all variables in the terminal or your IDE run configuration before starting the backend. The commands below show the database portion; authentication configuration above is also required. Use a same-origin HTTPS proxy for browser cookies.

**Windows CMD** (from `backend/`):

```cmd
set "DB_PASSWORD=your_admin_password"
set "DB_APP_PASSWORD=your_app_password"
gradlew.bat bootRun
```

**Linux / macOS** (from `backend/`):

```bash
export DB_PASSWORD='your_admin_password'
export DB_APP_PASSWORD='your_app_password'
./gradlew bootRun
```

The backend connects to PostgreSQL on port **5433**. On startup, Liquibase applies outstanding database migrations; Hibernate is configured with `ddl-auto=validate` rather than generating tables automatically.

The application uses separate accounts for schema migration (`team_ai_admin`) and regular database access (`team_ai_app`).

### 4. Verify the Database

Run from any directory with access to Docker:

```cmd
docker exec team-ai-postgres psql -U team_ai_admin -d team_ai_db -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('databasechangelog', 'databasechangeloglock');"
```

The expected result after Liquibase has run through 013 is **29** application tables (27 in the historical 001–012 baseline).

To inspect the migration history:

```cmd
docker exec team-ai-postgres psql -U team_ai_admin -d team_ai_db -c "SELECT id, exectype FROM databasechangelog ORDER BY orderexecuted;"
```

The expected current history contains **13** executed changesets (`001`–`013`).

> **Data safety:** Do not use `docker compose down -v` on the development stack unless you intentionally want to delete its persisted PostgreSQL data.

## Database Design

The current schema is organized into seven logical modules:

| Module | Tables |
| --- | ---: |
| Core & Access | 5 |
| Planning | 4 |
| Shared Project Memory | 5 |
| GitHub Integration | 2 |
| AI & Chat | 4 |
| Conflict Detection & ML | 6 |
| Analytics & Events | 3 |
| **Total** | **29** |

Database safeguards include foreign keys, unique and check constraints, project-ownership enforcement, cycle prevention for task dependencies, explicit application privileges, and indexes for frequently accessed queries.

For detailed design and evidence, see:

- [Database README](database/README.md)
- [Data Dictionary](database/docs/Team_AI_Orchestrator_Data_Dictionary.docx)
- [Full ER diagram (PNG)](database/docs/erd/full-schema.png) and [DBML source](database/docs/erd/full-schema.dbml)
- [Modular ER diagrams](database/docs/erd/modules/)
- [Database test report](database/docs/Database_Test_Report.md)
- [CORE-01 refresh schema, locking and verification](database/docs/CORE-01_Refresh_Sessions.md)

## Testing and Reproducibility

From `backend/`, run `gradlew.bat test securitySpike schemaTest bootJar --console=plain` (or `./gradlew` on Unix).
`test` uses disposable PostgreSQL 16/pgvector through Testcontainers and the real migrations, with separate app/admin roles;
it generates temporary RSA keys and credentials, independent of the local `.env` and development database.
`securitySpike` is the isolated SET-01 library suite; `schemaTest` verifies clean install, 001–012 upgrade and 013 constraints/grants.
Docker must be running. Reports remain local under `backend/build/reports/tests/` and are ignored by Git.
These suites do not rerun all 78 historical SQL checks tracked separately by DB-014.

Database development has included **78 SQL integrity checks**, schema and role audits, concurrency scenarios, and performance experiments. These tests are stored separately from the Java test suite in `database/tests/`.

A clean PostgreSQL instance, initialized on a separate Docker volume, was used to verify automatic role setup, execution of all 12 migrations, creation of 27 tables, pgvector availability, application permissions, and successful Spring Boot startup.

That historical result covers 001–012. For migration 013, run `gradlew.bat schemaTest` from `backend/`
(JDK 21 and Docker required). It applies real Liquibase migrations on isolated PostgreSQL 16/pgvector Testcontainers,
checks clean installation and a populated 001–012 upgrade, constraints, grants and family locking.
It never starts the Spring application or connects to the configured development database. DB-014 and the full 78-check rerun remain separate work.

For an **isolated** database-initialization check, the repository includes `compose.repro.yaml`, which binds PostgreSQL to port **5434** and uses a separate Docker volume. It is not the normal development environment. The database test report documents the recorded verification evidence and limitations.

## Development Notes

- Work under the existing Git branching workflow; active development is carried out on `develop`.
- Add new database changes through **new Liquibase changesets** rather than editing migrations already applied to shared environments.
- Keep credentials out of source control, terminal screenshots, and test logs.
- Update the Data Dictionary and ER diagrams when the schema changes.
- Distinguish implemented capabilities from planned functionality in documentation and demonstrations.

## Project Status

**Active diploma development — not production-ready.** The database and deployment foundation is in place. REST APIs, application services, GitHub integration workflows, AI-assisted features, the trainable ML component, and the frontend remain areas of ongoing development.
