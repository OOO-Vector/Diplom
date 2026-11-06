# Team AI orchestrator

Team AI orchestrator is a human-supervised collaborative platform designed to streamline task preparation, architectural decision management and AI activity transparency for software development teams.

---

## 1. Core capabilities

* **Specification ingestion and task decomposition (EP-01):** Uploads `.txt` or text-layer `.pdf` files, parses requirements via LLM, generates structured Epics/Tasks/Subtasks with explicit acceptance criteria and enforces Directed Acyclic Graph (DAG) cycle checking.
* **Shared project memory and ADR versioning (EP-02):** Stores versioned Architectural Decision Records (ADRs) with an automated approval workflow (`PROPOSED`, `APPROVED`, `SUPERSEDED`, `REJECTED`).
* **Version-pinned conflict pre-checks and RAG (EP-03 & EP-04):** Vector similarity search (`pgvector`) over active `APPROVED` ADRs provides grounded contextual Q&A and flags potential technical contradictions before new decisions are adopted.
* **Resilient GitHub integration (EP-04):** Race-safe, idempotent publication of confirmed tasks to GitHub Issues with background recovery.
* **AI activity analytics (EP-04):** Full logging of operation statuses, token consumption, latency metrics and human review outcomes (`ACCEPTED`, `MODIFIED`, `REJECTED`).

---

## 2. Technology stack

* **Frontend:** React 18+, TypeScript, Vite, Tailwind CSS, TanStack Query.
* **Backend:** Java 21, Spring Boot 3.x, Spring Data JPA, Spring Security, Flyway.
* **Database and vector search:** PostgreSQL 16+ with `pgvector` (`vector(1536)` HNSW cosine index).
* **Integrations:** OpenAI REST API (`text-embedding-3-small`), GitHub REST API v3.

---

## 3. Project structure

```
.
├── docs/
│   ├── requirements/
│   │   └── SRS.md                    # Software requirements specification
│   └── architecture/
│       ├── system-design.md          # Modular monolith system design document
│       ├── ai-design.md              # AI subsystem, schemas & RAG specification
│       ├── db-schema.sql             # Flyway PostgreSQL + pgvector DDL script
│       └── DB_desc.md                # Data dictionary & ER diagram description
└── README.md                         # Project overview and developer setup guide
```

---

## 4. Local development setup

### 4.1 Prerequisites
* Docker Engine and Docker Compose
* Java 21 SDK
* Node.js 20+ & npm

### 4.2 Database setup with Docker
To run PostgreSQL with `pgvector` enabled:

```bash
docker run --name orchestrator-db \
  -e POSTGRES_DB=orchestrator \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  -d pgvector/pgvector:pg16
```

### 4.3 Applying database migrations
Connect to PostgreSQL and execute `docs/architecture/db-schema.sql` or let Flyway automatically execute migration scripts during Spring Boot startup.

---

## 5. Security and RBAC guidelines
* **Standardized roles:** `PROJECT_OWNER` and `PROJECT_MEMBER`.
* **Exclusive rights:** Only `PROJECT_OWNER` can approve task backlogs, approve ADR versions, execute conflict overrides or publish tasks to GitHub.
* **Cross-tenant isolation:** All requests require a valid JWT token and project access validation. Queries filter strictly by `project_id`.
