# Software requirements specification (SRS)

## Team AI orchestrator

**Version:** 1.3 (Synchronized and revised)  
**Date:** November 2026  
**Target platform:** PostgreSQL 16+ (with `pgvector`), Java 21 / Spring Boot 3.x, React 18+ / TypeScript / Vite

---

## 1. Introduction

### 1.1 Purpose
This Software Requirements Specification (SRS) establishes the formal functional, non-functional, structural, and verification requirements for the **Team AI orchestrator** platform. The document defines system boundaries, database constraints, tenant isolation mechanisms, unified role-based access control (RBAC), resilience protocols, and testable acceptance criteria aligned with the Business Analysis (BA).

### 1.2 Scope and business goals
Team AI orchestrator is a human-supervised collaborative workspace designed for software development teams. The platform addresses four core business goals derived from the BA study:
1. **Inefficient task decomposition and coordination (BG-01):** Converts specification documents into structured, acyclic task backlogs (Epics, Tasks, Subtasks) with explicit acceptance criteria, separated approval/execution states, and DAG cycle safeguards.
2. **Fragmented project knowledge and inconsistent decisions (BG-02):** Maintains **Shared Project Memory** storing versioned Architectural Decision Records (ADRs).
3. **Decision consistency and conflict detection (BG-03):** Performs vector similarity search (RAG via `pgvector`) over active approved ADRs to provide grounded contextual assistance and version-pinned conflict checks.
4. **AI activity transparency and review effort logging (BG-04):** Records operation statuses, execution metrics, token counts, human review durations, and review outcomes (`ACCEPTED`, `MODIFIED`, `REJECTED`).

*Out of Scope for MVP:* Autonomous code execution/merging, background IDE/Copilot session recording, OCR of scanned PDFs, and enterprise SSO integrations.

---

## 2. System roles and access control (RBAC)

The system enforces strict role-based access control (RBAC) and tenant isolation at the API and database levels. Roles are standardized across all system documentation and schema definitions as `PROJECT_OWNER` and `PROJECT_MEMBER`.

| Role | Permissions and responsibilities | Disambiguation and enforcement |
| :--- | :--- | :--- |
| **PROJECT_OWNER** | Administrative control over a workspace. Manages memberships, configures GitHub integrations, approves task backlogs for GitHub publishing, transitions ADR versions to `APPROVED`, records mandatory conflict overrides with written justifications, and accesses AI activity analytics. | **Exclusive Rights:** Only `PROJECT_OWNER` users can set task `approval_status = 'APPROVED'`, approve ADR versions, record conflict overrides, trigger GitHub issue publication, or edit repository integration tokens. |
| **PROJECT_MEMBER** | Authenticated team participant. Uploads specifications, requests AI task decomposition, edits draft task details/dependencies, updates task `execution_status` (`IN_PROGRESS`, `DONE`), submits ADR proposals, queries RAG chat, and executes conflict pre-checks. | **Restrictions:** Cannot approve ADR versions, execute manual conflict overrides, publish tasks to external issue trackers, or alter project integrations. Server responds with HTTP `403 Forbidden` if attempted. |

---

## 3. System constraints and architectural rules

### 3.1 Data integrity and relational normalization
1. **Relational Engine:** PostgreSQL 16+ using Third Normal Form (3NF) across all relational entities.
2. **Vector Engine (`pgvector`):** Vector storage using `vector(1536)` (matching OpenAI `text-embedding-3-small`). Indexing uses HNSW cosine similarity. `memory_chunks.embedding` allows `NULL` while `indexing_status = 'PENDING'`, becoming `NOT NULL` once populated and set to `INDEXED`.
3. **Cross-Tenant Data Isolation:** Every primary entity (`specifications`, `tasks`, `task_dependencies`, `architecture_decisions`, `decision_versions`, `memory_chunks`, `conflict_checks`, `ai_operation_logs`, `github_integrations`) MUST incorporate an explicit `project_id` foreign key. To ensure `project_id` is never cleared when a specification is removed, `tasks` uses a composite foreign key `(specification_id, project_id) REFERENCES specifications(id, project_id) ON DELETE SET NULL`, preserving `tasks.project_id` as `NOT NULL`.
4. **Task Graph Integrity (DAG) and Concurrency Control:** Task dependency graphs MUST remain Directed Acyclic Graphs (DAGs). Graph updates acquire transactional advisory locks (`pg_advisory_xact_lock`) and verify optimistic locking (`version` counter) to prevent race conditions during parallel updates.
5. **Task Status Separation:** Task lifecycle is strictly divided into three distinct orthogonal attributes:
   - `approval_status`: `DRAFT` $\rightarrow$ `CONFIRMED` $\rightarrow$ `APPROVED` (managed by `PROJECT_OWNER`).
   - `execution_status`: `BACKLOG` $\rightarrow$ `IN_PROGRESS` $\rightarrow$ `DONE` (managed by team members during execution).
   - `github_sync_status`: `NOT_SYNCED` $\rightarrow$ `SYNCING` $\rightarrow$ `SYNCED` $\rightarrow$ `FAILED`.
6. **GitHub Publication Resilience & Recovery:** Parallel attempts to publish tasks execute row-level locking (`SELECT ... FOR UPDATE`) and enforce unique constraints on `(project_id, github_issue_id)`. If an external call times out while in `SYNCING` status, a background reconciliation process queries the GitHub API using the task client token and payload hash before retrying to prevent duplicate issue creation.
7. **Version-Pinned Conflict Checks:** Conflict pre-checks are bound to a specific proposal version (`proposed_version_id`) and content hash (`checked_content_hash`). Modifying the underlying proposal invalidates prior checks, setting check status to `RECHECK_REQUIRED`.

---

## 4. Functional requirements

### 4.1 Epic 01: Specification and decomposition (EP-01)
* **FR-EP1-01 (Workspace and role setup):** The system shall allow an authenticated user to create a project workspace, automatically assigning the creator as `PROJECT_OWNER`. Owners can invite users as `PROJECT_MEMBER` or `PROJECT_OWNER`.
* **FR-EP1-02 (GitHub integration setup):** A `PROJECT_OWNER` can configure repository settings (owner, repo name, encrypted access token, default branch) stored in `github_integrations`.
* **FR-EP1-03 (Specification ingestion):** Supports uploading `.txt` and text-layer `.pdf` files up to 10MB. Image-only PDFs must be rejected with an explicit validation error message.
* **FR-EP1-04 (AI task decomposition):** Parses specifications via LLM structured output (`decomposition_schema.json`) to generate Epics, Tasks, and Subtasks. Each item contains `title`, `description`, `acceptance_criteria`, `task_type`, `approval_status = 'DRAFT'`, `execution_status = 'BACKLOG'`, and initial dependency links.
* **FR-EP1-05 (DAG cycle safeguards and review):** Validates generated graph acyclicity using recursive DFS under advisory locking. Backlog confirmation requires `PROJECT_OWNER` review.

### 4.2 Epic 02: Shared project memory (EP-02)
* **FR-EP2-01 (Architectural decision proposals):** Members can submit proposed architectural decisions containing title, rationale, and content (status `PROPOSED`).
* **FR-EP2-02 (Version approval and superseding):** Only a `PROJECT_OWNER` can set an ADR version to `APPROVED`. Upon approval, prior active versions automatically transition to `SUPERSEDED`.
* **FR-EP2-03 (Asynchronous vector indexing):** Upon approval, text passages are chunked, assigned `chunk_index`, hashed (`chunk_hash`), embedded via OpenAI API (`vector(1536)`), and updated from `indexing_status = 'PENDING'` to `'INDEXED'`.

### 4.3 Epic 03: Potential-conflict checks (EP-03)
* **FR-EP3-01 (Version-pinned conflict pre-check):** Evaluates proposals against active approved ADRs. Checks are pinned to `proposed_version_id` and `checked_content_hash`. Proposal modifications set status to `RECHECK_REQUIRED`.
* **FR-EP3-02 (Mandatory human conflict override):** Approving an ADR proposal with a `POSSIBLE_CONFLICT` warning requires a `PROJECT_OWNER` to submit a mandatory written justification stored in `conflict_overrides`.

### 4.4 Epic 04: Tasks, GitHub, chat and analytics (EP-04)
* **FR-EP4-01 (Task lifecycle management):** Members can update task `execution_status`. Transitioning `approval_status` from `DRAFT` to `CONFIRMED` and `APPROVED` requires `PROJECT_OWNER` action.
* **FR-EP4-02 (Filtered grounded context assistant):** RAG chat queries execute SQL vector similarity filtering strictly by `mc.project_id = :projectId AND mc.indexing_status = 'INDEXED' AND dv.status = 'APPROVED'`. Answers cite sources; queries returning similarity below $0.70$ yield `INSUFFICIENT_CONTEXT`.
* **FR-EP4-03 (Race-safe GitHub issue publishing):** `PROJECT_OWNER` users can publish `APPROVED` tasks to GitHub. Row locks and reconciliation routines ensure network failures or retries do not create duplicate issues.
* **FR-EP4-04 (AI operation analytics):** All AI operations log to `ai_operation_logs` with `operation_type`, `operation_status` (`SUCCESS`, `FAILED`, `TIMEOUT`), model name, token usage (`prompt_tokens`, `completion_tokens`), latency, error messages, and human review outcomes (`ACCEPTED`, `MODIFIED`, `REJECTED`).

---

## 5. Non-functional requirements (NFRs) and KPIs

### 5.1 Non-functional requirements
* **NFR-01 Security:** 100% of defined unauthorized cross-project access test cases rejected (HTTP `403 Forbidden`); zero API secrets in logs or error responses. Passwords stored using modern hashing (Argon2 / bcrypt).
* **NFR-02 Performance:** p95 CRUD response time $\le 1.0$s for 20 concurrent test clients on recorded setup (LLM latency measured separately).
* **NFR-03 Data freshness:** 95% of persisted analytics events visible within 10s with 5s polling in test environment.
* **NFR-04 Reliability:** System shall reject invalid AI JSON, cyclic task dependencies, and unauthorized requests without persisting inconsistent data. LLM timeouts and GitHub API failures produce explicit error messages.
* **NFR-05 Test coverage:** At least 70% line coverage for agreed core backend code, supported by CI report.
* **NFR-06 Usability:** At least 80% of attempts at predefined core user scenarios completed successfully without moderator assistance during usability testing (3-5 participants). All primary asynchronous operations provide loading, success, empty, and error feedback.
* **NFR-07 Availability:** During a controlled two-hour local stability test, at least 99% of valid API requests receive successful responses (excluding simulated external provider failures).
* **NFR-08 Provenance:** 100% of factual decision citations resolve to an active `APPROVED` record in `INDEXED` status in the correct project.

### 5.2 Key performance indicators (KPIs)
* **KPI-01 (BG-01):** Median backlog preparation time at least 20% lower than manual planning on matched specifications.
* **KPI-02 (BG-02):** Precision@5 $\ge 0.80$ on $\ge 20$ labeled evaluation queries.
* **KPI-03 (BG-03):** Precision $\ge 0.80$ and Recall $\ge 0.70$ across pre-labeled test decision pairs.
* **KPI-04 (BG-04):** Log review outcome and duration for $\ge 95\%$ of completed AI operations.

---

## 6. Acceptance criteria (User stories and verification matrix)

### US-01: Workspace setup and roles (EP-01)
* **Given** an authenticated user, **When** they create a project, **Then** the project is persisted and creator assigned `PROJECT_OWNER`.
* **Given** a `PROJECT_MEMBER`, **When** attempting to approve an ADR version or publish to GitHub, **Then** server returns HTTP `403 Forbidden`.

### US-03: AI task hierarchy proposal and cycle rejection (EP-01)
* **Given** an uploaded specification, **When** decomposition succeeds, **Then** a schema-valid draft with title, acceptance criteria, `approval_status = 'DRAFT'`, and `execution_status = 'BACKLOG'` is returned.
* **Given** a graph edit introducing a cycle ($A \rightarrow B \rightarrow A$), **When** submitted, **Then** server acquires advisory lock, detects cycle, rejects change, and preserves original graph.

### US-06: ADR approval and version superseding (EP-02)
* **Given** an active ADR version $v1$ (`APPROVED`), **When** `PROJECT_OWNER` approves version $v2$, **Then** $v1$ becomes `SUPERSEDED`, $v2$ becomes `APPROVED`, and vector chunks for $v2$ update to `indexing_status = 'INDEXED'`.

### US-07 & US-08: Conflict detection and mandatory override (EP-03)
* **Given** a proposed decision, **When** checked, **Then** system returns `POSSIBLE_CONFLICT` with source codes and saves `checked_content_hash`.
* **Given** a proposal modified after a check, **When** inspected, **Then** check status changes to `RECHECK_REQUIRED`.
* **Given** a `POSSIBLE_CONFLICT` status, **When** `PROJECT_OWNER` approves without justification, **Then** approval is blocked until written justification is saved in `conflict_overrides`.

### US-10: GitHub Issue publishing idempotency and recovery (EP-04)
* **Given** two parallel publish requests for an `APPROVED` task, **When** executed, **Then** row locking ensures a single GitHub issue is created, populating `github_issue_id` and setting `github_sync_status = 'SYNCED'`.
* **Given** a publish request that timed out while in `SYNCING` state, **When** retried or reconciled, **Then** backend queries GitHub API for payload hash before re-issuing create request, avoiding duplicate issues.