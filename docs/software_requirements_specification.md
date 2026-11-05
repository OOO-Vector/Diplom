# Software requirements specification (SRS)

## Team AI orchestrator

**Target platform:** PostgreSQL 16+ (with `pgvector`), Java 21 / Spring Boot 3.x, React 18+ / TypeScript / Vite

---

## 1. Introduction

### 1.1 Purpose
This Software requirements specification (SRS) establishes the formal functional, non-functional, structural and verification requirements for the Team AI orchestrator platform. The document defines system boundaries, database constraints, tenant isolation mechanisms, unified role-based access control and testable acceptance criteria based on the Business analysis (BA).

### 1.2 Scope and business goals
Team AI orchestrator is a human-supervised collaborative workspace designed for software development teams. The platform addresses specific bottlenecks identified in development workflows:
1. **Inefficient task decomposition and dependency tracking (BG-01):** Transforms specification documents into structured, acyclic task backlogs (Epics, tasks, subtasks) with explicit acceptance criteria, separate approval/execution states and DAG cycle safeguards.
2. **Fragmented project knowledge and architectural drift (BG-02):** Maintains a Shared project memory storing versioned Architectural decision records (ADRs).
3. **Inconsistent technical proposals (BG-03):** Performs vector similarity search (RAG via `pgvector`) over active approved ADRs to provide grounded contextual assistance and version-pinned conflict checks.
4. **Unmeasured AI effort and review overhead (BG-04):** Records execution metrics, token counts, human review durations and approval/rejection outcomes.

**Out of scope for MVP:** Autonomous code execution/merging, background Copilot session recording, OCR of scanned PDFs and enterprise SSO integrations.

---

## 2. System roles and access control (RBAC)

The system enforces strict role-based access control (RBAC) and tenant isolation at the API and database levels. Roles are standardized across all documents and schema definitions as `PROJECT_OWNER` and `PROJECT_MEMBER`.

| Role | Permissions and responsibilities | Disambiguation and enforcement |
| :--- | :--- | :--- |
| **PROJECT_OWNER** | Administrative control over a workspace. Manages memberships, configures GitHub integrations, approves task backlogs for GitHub publishing, transitions ADR versions to `APPROVED`, records mandatory conflict overrides with written justifications and accesses AI analytics. | **Exclusive rights:** Only `PROJECT_OWNER` users can set task `approval_status = 'APPROVED'`, approve ADR versions, record conflict overrides, trigger GitHub publication or edit repository tokens. |
| **PROJECT_MEMBER** | Authenticated team participant. Uploads specifications, requests AI task decomposition, edits draft task details/dependencies, updates task `execution_status` (`IN_PROGRESS`, `DONE`), submits ADR proposals, queries RAG chat and executes conflict pre-checks. | **Restrictions:** Cannot approve ADR versions, execute manual conflict overrides, publish tasks to external issue trackers or alter project integrations. Server responds with HTTP `403 Forbidden` if attempted. |

---

## 3. Architectural constraints and system boundaries

### 3.1 Data integrity and database normalization
1. **Relational engine:** PostgreSQL 16+ using Third normal form (3NF) across all relational entities.
2. **Vector engine (`pgvector`):** Vector storage using the `vector(1536)` data type, matching OpenAI `text-embedding-3-small`. Indexing uses HNSW with cosine distance filtering strictly on `indexing_status = 'INDEXED'` and active `APPROVED` ADR versions.
3. **Cross-tenant data isolation:** Every primary entity (`specifications`, `tasks`, `task_dependencies`, `architecture_decisions`, `decision_versions`, `memory_chunks`, `conflict_checks`, `ai_operation_logs`, `github_integrations`) MUST incorporate an explicit `project_id` foreign key. To ensure `project_id` is never cleared when related specifications are removed, `tasks.specification_id` uses an independent single-column foreign key (`ON DELETE SET NULL`), maintaining `tasks.project_id` as `NOT NULL`.
4. **Task graph integrity (DAG) and concurrency control:** Task dependency graphs MUST remain Directed Acyclic Graphs (DAGs). Graph updates acquire transactional advisory locks (`pg_advisory_xact_lock`) and verify optimistic locking (`version` counter) to prevent race conditions during parallel updates.
5. **Task status separation:** Task lifecycle is strictly divided into three distinct orthogonal fields:
   - `approval_status`: `DRAFT` $\rightarrow$ `CONFIRMED` $\rightarrow$ `APPROVED` (managed by `PROJECT_OWNER`).
   - `execution_status`: `BACKLOG` $\rightarrow$ `IN_PROGRESS` $\rightarrow$ `DONE` (managed by team members during execution).
   - `github_sync_status`: `NOT_SYNCED` $\rightarrow$ `SYNCING` $\rightarrow$ `SYNCED` $\rightarrow$ `FAILED`.
6. **Idempotent GitHub publication and race prevention:** Parallel attempts to publish tasks to GitHub execute row-level locking (`SELECT ... FOR UPDATE`) and enforce unique constraints on `(project_id, github_issue_id)` to prevent duplicate issue creation.
7. **Version-pinned conflict checks:** Conflict pre-checks are bound to a specific proposal version (`proposed_version_id`) and content hash (`checked_content_hash`). Modifying the underlying proposal invalidates prior checks, marking them `RECHECK_REQUIRED`.

---

## 4. Functional requirements

### 4.1 Epic 01: Project setup and specification import
* **FR-EP1-01 (Workspace and role management):** The system shall allow an authenticated user to create a project workspace, automatically assigning the creator as `PROJECT_OWNER`. Owners can invite users as `PROJECT_MEMBER` or `PROJECT_OWNER`.
* **FR-EP1-02 (GitHub integration setup):** A `PROJECT_OWNER` can configure GitHub integration settings (repository owner, repository name, encrypted access token, default branch) stored in `github_integrations`.
* **FR-EP1-03 (Specification ingestion):** Supports uploading `.txt` and text-layer `.pdf` files up to 10MB. Image-only PDFs must be rejected with an explicit validation error.

### 4.2 Epic 02: AI task decomposition and dependency management
* **FR-EP2-01 (AI task decomposition):** The system processes uploaded specifications via LLM structured output (`decomposition_schema.json`) to generate epics, tasks and subtasks. Each task contains a `title`, `description`, `acceptance_criteria`, `task_type`, `approval_status = 'DRAFT'`, `execution_status = 'BACKLOG'`, and initial dependency links.
* **FR-EP2-02 (DAG cycle safeguards and concurrency):** Prior to persisting dependency changes, the server acquires a project-scoped advisory lock, validates the graph for cycles using recursive DFS and checks optimistic locking counters (`version`).
* **FR-EP2-03 (Separated task lifecycle):** Members can update task `execution_status`. Transitioning `approval_status` from `DRAFT` to `CONFIRMED` and `APPROVED` requires explicit `PROJECT_OWNER` action.

### 4.3 Epic 03: Shared project memory and ADR versioning
* **FR-EP3-01 (ADR authoring and proposal):** Members can submit proposed architectural decisions containing title, rationale and content (status `PROPOSED`).
* **FR-EP3-02 (Version lifecycle and event indexing):** Only a `PROJECT_OWNER` can set an ADR version to `APPROVED`. Upon approval:
  1. Prior active versions automatically transition to `SUPERSEDED`.
  2. Text passages are chunked, hashed (`chunk_hash`), assigned sequential `chunk_index` and embedded via OpenAI API (`vector(1536)`).
  3. `memory_chunks` records update from `indexing_status = 'PENDING'` to `'INDEXED'`.

### 4.4 Epic 04: Conflict detection, RAG and GitHub integration
* **FR-EP4-01 (Version-pinned conflict pre-check):** Evaluates proposals against active approved ADRs. Checks are pinned to `proposed_version_id` and `checked_content_hash`. Editing a proposal resets check status to `RECHECK_REQUIRED`.
* **FR-EP4-02 (Mandatory human conflict override):** Approving an ADR proposal with a `POSSIBLE_CONFLICT` warning requires a `PROJECT_OWNER` to submit a mandatory written justification stored in `conflict_overrides`.
* **FR-EP4-03 (Filtered grounded context assistant):** RAG chat queries execute SQL vector similarity filtering strictly by `mc.project_id = :projectId AND mc.indexing_status = 'INDEXED' AND dv.status = 'APPROVED'`. Answers include citations; queries returning similarity below threshold ($< 0.70$) return `INSUFFICIENT_CONTEXT`.
* **FR-EP4-04 (Race-safe GitHub issue publishing):** `PROJECT_OWNER` users can publish `APPROVED` tasks to GitHub. The backend acquires row locks on target tasks, ensuring parallel requests update existing remote issues rather than creating duplicates.
* **FR-EP4-05 (AI operation analytics):** All AI operations are recorded in `ai_operation_logs` with `operation_type`, `operation_status` (`SUCCESS`, `FAILED`, `TIMEOUT`), model name, token usage (`prompt_tokens`, `completion_tokens`), latency, error messages and review outcomes (`ACCEPTED`, `MODIFIED`, `REJECTED`).

---

## 5. Non-Functional requirements and key performance indicators

### 5.1 Non-functional requirements (NFRs)
* **NFR-01 (Tenant isolation):** 100% of API endpoints enforce project authorization. Cross-tenant access attempts return HTTP `403 Forbidden`.
* **NFR-02 (Performance):** 95th percentile (p95) API response time $\le 1.0$s for CRUD operations under 20 concurrent clients (excluding external LLM calls).
* **NFR-03 (Freshness):** 95% of recorded AI operation events appear in analytics within 10 seconds.
* **NFR-04 (Fault tolerance):** Malformed AI JSON responses, LLM timeouts, or GitHub rate limits trigger non-destructive error handling without corrupting transactional database state.
* **NFR-05 (RAG provenance):** 100% of returned citations resolve to active `APPROVED` ADR records in `INDEXED` status for the requesting project.
* **NFR-06 (Concurrency safety):** 0% duplicate GitHub issues or cyclic dependency insertions during simulated parallel API requests.

### 5.2 Key performance indicators (KPIs)
* **KPI-01 (Backlog speed):** Median backlog preparation time at least 20% lower than manual decomposition on matched specifications.
* **KPI-02 (Retrieval accuracy):** Precision@5 $\ge 0.80$ on a test set of $\ge 20$ labeled evaluation queries.
* **KPI-03 (Conflict precision and recall):** Precision $\ge 0.80$ and Recall $\ge 0.70$ across pre-labeled test decision pairs.
* **KPI-04 (Review transparency):** System records review outcomes and durations for $\ge 95\%$ of completed AI operations.

---

## 6. Acceptance criteria (User stories and verification matrix)

### US-01: Workspace setup and unified RBAC
* **Given** an authenticated user,  
  **When** they create a project,  
  **Then** the project is persisted and the creator is assigned `PROJECT_OWNER` in `project_members`.
* **Given** a user with `PROJECT_MEMBER` role,  
  **When** they attempt to approve an ADR version or publish tasks to GitHub,  
  **Then** the server rejects the request with HTTP `403 Forbidden`.

### US-03: AI task decomposition, acceptance criteria and cycle prevention
* **Given** an uploaded specification,  
  **When** decomposition is executed,  
  **Then** a schema-valid backlog complete with non-empty `acceptance_criteria`, `approval_status = 'DRAFT'`, and `execution_status = 'BACKLOG'` is created.
* **Given** a concurrent edit attempt that introduces a cycle ($A \rightarrow B \rightarrow A$),  
  **When** submitted,  
  **Then** the server acquires an advisory lock, detects the cycle, rejects the mutation and preserves the original graph.

### US-06: ADR approval and indexing state filtering
* **Given** an active ADR version $v1$ (`APPROVED`),  
  **When** the `PROJECT_OWNER` approves version $v2$,  
  **Then** version $v1$ becomes `SUPERSEDED`, version $v2$ becomes `APPROVED` and vector chunks for $v2$ are generated with `indexing_status = 'INDEXED'`.

### US-07 & US-08: Version-pinned conflict checks and overrides
* **Given** a proposed decision version,  
  **When** checked against active approved ADRs,  
  **Then** the system returns status `POSSIBLE_CONFLICT`, citing evidence and saving `checked_content_hash`.
* **Given** a proposal modified after a conflict check,  
  **When** inspected,  
  **Then** the check status updates to `RECHECK_REQUIRED` until re-evaluated.
* **Given** a `POSSIBLE_CONFLICT` warning,  
  **When** the `PROJECT_OWNER` approves without a justification,  
  **Then** approval is blocked until a written justification is stored in `conflict_overrides`.

### US-10: Idempotent GitHub publishing under parallel load
* **Given** two concurrent publish requests for the same `APPROVED` task,  
  **When** processed,  
  **Then** row locking ensures only one remote GitHub Issue is created, updating `github_sync_status = 'SYNCED'` and populating `github_issue_id`.
