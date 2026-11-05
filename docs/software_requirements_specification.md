# Software requirements specification (SRS)

## Team AI orchestrator

**Target Platform:** PostgreSQL 16+ (with `pgvector`), Java 21 / Spring Boot 3.x, React 18+ / TypeScript / Vite

---

## 1. Introduction

### 1.1 Purpose
This Software requirements specification (SRS) defines the formal functional, non-functional, structural and verification requirements for the Team AI orchestrator platform. The document establishes the boundary conditions, data constraints, security guarantees, role definitions and testable acceptance checks based on the underlying business analysis (BA).

### 1.2 Scope and business goals
Team AI orchestrator is a human-supervised collaborative workspace designed for software development teams. The platform addresses specific bottlenecks identified in team development workflows:
1. **Inefficient task decomposition and dependency tracking (BG-01):** Converts raw specification documents into structured, acyclic task backlogs (Epics, tasks, subtasks) with explicit blocking relationships and acceptance criteria.
2. **Fragmented project knowledge and architectural drift (BG-02):** Maintains a Shared project memory storing versioned Architectural decision records (ADRs).
3. **Inconsistent technical proposals (BG-03):** Performs vector similarity search (RAG via `pgvector`) over approved ADRs to provide grounded contextual assistance and pre-check technical proposals for potential conflicts.
4. **Unmeasured AI effort and review overhead (BG-04):** Records AI operation execution metrics, token counts, human review durations and approval/rejection outcomes.

*Out of Scope for MVP:* Autonomous code writing/merging, automatic IDE/Copilot background session recording, OCR of scanned-only PDFs and enterprise SSO integrations.

---

## 2. System roles and access control (RBAC)

The system enforces strict role-based access control (RBAC) and tenant isolation at the API and database levels. Every user operation is evaluated against their role within a given `project_id`.

| Role | Permissions and responsibilities | Disambiguation and enforcement |
| :--- | :--- | :--- |
| **Project owner** | Full administrative control over a specific workspace. Can manage memberships, configure GitHub integration, edit and confirm task backlogs, approve task structures for GitHub publishing, transition ADR versions to `APPROVED`, record mandatory conflict overrides with written justifications, and access AI operation analytics. | **Exclusive rights:** Only Project owners can transition tasks to `APPROVED` or `PUBLISHED_TO_GITHUB`, approve ADR versions, record conflict overrides or alter repository tokens. |
| **Member** | Authenticated team participant. Can upload specifications, request AI task decomposition, edit draft task details and dependency edges, submit ADR proposals, perform RAG contextual chat queries and execute conflict pre-checks. | **Restrictions:** Cannot approve ADR versions, execute manual conflict overrides, publish tasks to external issue trackers or manage project integrations. Server responds with HTTP `403 Forbidden` if attempted. |

---

## 3. Architectural constraints and system boundaries

### 3.1 Data integrity and database normalization
1. **Relational engine:** PostgreSQL 16+ using Third normal form (3NF) across all relational entities.
2. **Vector engine (`pgvector`):** Vector storage using the `vector` data type. Embedding dimension is configurable via environment settings (`vector(${EMBEDDING_DIM:1536})`) to support different models (e.g., OpenAI `text-embedding-3-small`/`large` or custom local models).
3. **Cross-tenant data isolation:** Every primary data entity (`specifications`, `tasks`, `task_dependencies`, `architecture_decisions`, `decision_versions`, `memory_chunks`, `conflict_checks`, `ai_operation_logs`, `github_integrations`) MUST incorporate an explicit `project_id` reference. Database foreign key constraints use composite keys `(id, project_id)` to prevent cross-project referencing.
4. **Task graph integrity (DAG):** The task dependency structure MUST remain a Directed Acyclic Graph (DAG). Cyclic relationships or self-referential dependencies are rejected at the service and database levels.
5. **Security constraints:** Passwords must be hashed using strong modern cryptographic algorithms (e.g., Argon2 or bcrypt). Plaintext passwords, tokens or API secrets must never be logged or exposed in API payloads.

---

## 4. Functional requirements

### 4.1 Epic 01: Project setup and specification import
* **FR-EP1-01 (Workspace and role management):** The system shall allow an authenticated user to create a project workspace, automatically assigning the creator as `PROJECT_OWNER`. The Owner can invite users as `MEMBER` or `OWNER`.
* **FR-EP1-02 (GitHub repository configuration):** The system shall allow a Project owner to configure GitHub integration settings (repository owner, repository name, encrypted access token and default branch) stored in `github_integrations`.
* **FR-EP1-03 (Specification ingestion):** The system shall support uploading `.txt` and text-layer `.pdf` specification documents up to 10MB. Scanned-only PDFs without extractable text must be rejected with an explicit validation error message.

### 4.2 Epic 02: AI task decomposition and dependency management
* **FR-EP2-01 (AI task decomposition):** The system shall process uploaded specifications via LLM structured outputs to generate a hierarchical backlog of epics, tasks and subtasks. Each generated task MUST contain a non-empty `title`, `description`, `acceptance_criteria`, `task_type` (`EPIC`, `TASK`, `SUBTASK`), and initial dependency links (`blocking_task_id` $\rightarrow$ `blocked_task_id`).
* **FR-EP2-02 (DAG cycle prevention and concurrency control):** Prior to saving or editing task dependency edges, the backend shall validate the graph for cycles using Depth-first search (DFS) or recursive CTEs. Tasks use an optimistic locking `version` counter to prevent concurrent cycle creation.
* **FR-EP2-03 (Task lifecycle and backlog approval):** Generated tasks start in `DRAFT` state. A `MEMBER` or `OWNER` may edit details. Transitioning tasks from `DRAFT` to `CONFIRMED` and `APPROVED` requires explicit approval by a `PROJECT_OWNER`.

### 4.3 Epic 03: Shared project memory and ADR versioning
* **FR-EP3-01 (ADR authoring and proposal):** Members can submit proposed architectural decisions containing title, rationale and content. New submissions receive status `PROPOSED`.
* **FR-EP3-02 (Version lifecycle and approval):** Only a `PROJECT_OWNER` can transition an ADR version to `APPROVED`. Upon approval:
  1. The prior active version transitions automatically to `SUPERSEDED`.
  2. The newly approved version text is chunked, hashed, embedded, and saved to `memory_chunks`.
* **FR-EP3-03 (RAG chunk indexing and tracking):** Text chunks store their position (`chunk_index`), cryptographic hash (`chunk_hash`), and vector embedding. The indexing lifecycle is tracked via `indexing_status` (`PENDING`, `INDEXED`, `FAILED`). Vector searches filter strictly by `project_id` and active `APPROVED` decision status.

### 4.4 Epic 04: Conflict detection, context retrieval and GitHub integration
* **FR-EP4-01 (Conflict detection and hash pinning):** When a user triggers a conflict pre-check on a proposed decision or task, the system queries `memory_chunks` for relevant approved context and passes it to the LLM. The result status (`NO_CONFLICT`, `POSSIBLE_CONFLICT`, `INSUFFICIENT_CONTEXT`) and evidence citations (`evidence_source_ids`) are saved alongside a `checked_content_hash` to detect staleness if the proposal text is later modified.
* **FR-EP4-02 (Mandatory human conflict override):** If a proposal receives a `POSSIBLE_CONFLICT` status, a `PROJECT_OWNER` can approve it only by providing a mandatory written justification stored in `conflict_overrides`.
* **FR-EP4-03 (Grounded contextual assistant):** The system shall provide a RAG chat interface. All answers must include source citations to approved ADR versions. If no relevant chunks meet the similarity threshold, the system must report `INSUFFICIENT_CONTEXT` rather than hallucinating details.
* **FR-EP4-04 (Idempotent GitHub issue publishing):** `PROJECT_OWNER` users can publish `APPROVED` tasks to the configured GitHub repository. The backend uses `github_integrations` credentials to create remote issues, saving remote `github_issue_id` and `github_issue_url`. Subsequent publish requests for an already synced task must update the existing issue rather than create duplicates.
* **FR-EP4-05 (AI operation and analytics tracking):** All AI operations (decomposition, conflict checks, RAG queries) MUST be logged in `ai_operation_logs`. Logs capture `operation_type`, `operation_status` (`SUCCESS`, `FAILED`, `TIMEOUT`), model name, token usage (`prompt_tokens`, `completion_tokens`), generation duration (`generation_duration_ms`), active human review duration (`review_duration_ms`), error messages and review outcome (`ACCEPTED`, `MODIFIED`, `REJECTED`).

---

## 5. Non-functional requirements and key performance indicators

### 5.1 Non-functional requirements (NFRs)
* **NFR-01 (Security and tenant isolation):** 100% of API requests must validate project access authorization. Attempting cross-tenant data access must return HTTP `403 Forbidden`.
* **NFR-02 (API performance):** 95th percentile (p95) CRUD operations response time must be $\le 1.0$ second under 20 concurrent clients (excluding external LLM network latency).
* **NFR-03 (Data freshness and analytics):** 95% of recorded AI operation and analytics events must be reflected in the analytics UI within 10 seconds.
* **NFR-04 (Reliability and fault tolerance):** Malformed AI JSON responses, external API timeouts, or GitHub rate limits must be handled gracefully without corrupting local transactional state.
* **NFR-05 (RAG provenance):** 100% of returned citations in RAG queries and conflict warnings must resolve to valid, un-superseded `APPROVED` decision records belonging strictly to the requesting project.
* **NFR-06 (Usability):** At least 80% of unassisted participants must complete standard core user scenarios successfully during usability evaluations.
* **NFR-07 (Prototype availability):** The application backend must maintain $\ge 99\%$ availability during controlled stability test runs.
* **NFR-08 (Test coverage):** Core domain modules (DAG validation, RBAC security, state transitions) must achieve $\ge 70\%$ line coverage in automated tests.

### 5.2 Key performance indicators (KPIs)
* **KPI-01 (Backlog preparation speed):** Median total backlog preparation time (including human edits) at least 20% lower than manual decomposition on matched specifications.
* **KPI-02 (Context retrieval accuracy):** Precision@5 $\ge 0.80$ on a predefined set of $\ge 20$ labeled evaluation queries.
* **KPI-03 (Conflict detection precision and recall):** Precision $\ge 0.80$ and Recall $\ge 0.70$ on a test set of at least 30 pre-labeled decision pairs.
* **KPI-04 (Review transparency):** System logs review outcomes (`ACCEPTED`, `MODIFIED`, `REJECTED`) and durations for $\ge 95\%$ of completed AI operations.

---

## 6. Acceptance criteria (User stories and verification matrix)

### US-01: Workspace setup & RBAC rights
* **Given** an authenticated user,  
  **When** they create a new project workspace,  
  **Then** the project is persisted and the creator is assigned `PROJECT_OWNER` in `project_members`.
* **Given** a user with `MEMBER` role,  
  **When** they attempt to approve an ADR version or publish tasks to GitHub,  
  **Then** the server rejects the request with HTTP `403 Forbidden`.

### US-02: Specification ingestion
* **Given** a readable `.txt` or text-layer `.pdf` file within 10MB,  
  **When** uploaded to a project,  
  **Then** its raw text is saved to `specifications`.
* **Given** a scanned-only/image PDF,  
  **When** uploaded,  
  **Then** the backend rejects the file and returns a descriptive validation error message.

### US-03: AI task decomposition and DAG validation
* **Given** an uploaded specification document,  
  **When** decomposition is executed,  
  **Then** a schema-valid JSON structure of epics, tasks and subtasks complete with non-empty `acceptance_criteria` is returned.
* **Given** a user edit that introduces a cyclic link (e.g., Task $A \rightarrow B \rightarrow A$),  
  **When** submitted for validation,  
  **Then** the server rejects the edit, preserves the original graph, and highlights the offending cycle.

### US-06: ADR approval and version lifecycle
* **Given** an ADR with active version $v1$ (`APPROVED`),  
  **When** the `PROJECT_OWNER` approves a new version $v2$,  
  **Then** version $v1$ becomes `SUPERSEDED`, version $v2$ becomes `APPROVED`, and only $v2$ text chunks are embedded and marked `INDEXED` in `memory_chunks`.

### US-07 & US-08: Conflict pre-check and mandatory override
* **Given** a proposed decision that contradicts an existing `APPROVED` ADR,  
  **When** a conflict pre-check is executed,  
  **Then** the system returns status `POSSIBLE_CONFLICT`, citing the conflicting ADR source code and saving the `checked_content_hash`.
* **Given** a `POSSIBLE_CONFLICT` status,  
  **When** the `PROJECT_OWNER` attempts to approve the proposal without supplying a justification,  
  **Then** approval is blocked until a written justification is provided and stored in `conflict_overrides`.

### US-10: Idempotent GitHub publishing
* **Given** an `APPROVED` task that has already been published to GitHub (`github_issue_id` exists),  
  **When** the Project Owner triggers publication again,  
  **Then** the system updates the existing remote GitHub Issue rather than creating a duplicate.
