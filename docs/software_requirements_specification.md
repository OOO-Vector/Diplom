# Software requirements specification (SRS)
## Team AI orchestrator
 
**Target platform:** PostgreSQL (with `pgvector`), Java 21 / Spring Boot, React / TypeScript / Vite  

---

## 1. Introduction

### 1.1 Purpose
This SRS establishes the formal functional and non-functional requirements for the Team AI orchestrator system. The document details the minimum viable product (MVP) design, boundary conditions, data constraints, security expectations, and formal acceptance criteria derived from the business analysis and project domain.

### 1.2 Scope
Team AI orchestrator is a human-supervised collaborative web application designed for small software development teams. The platform:
- Ingests human-written text/PDF project specifications.
- Generates structured, acyclic task hierarchies (Epics, Tasks, Subtasks) with acceptance criteria and dependency graphs.
- Enforces human review and approval prior to publishing tasks to GitHub Issues.
- Maintains a Shared Project Memory storing versioned Architectural Decision Records (ADRs).
- Performs vector similarity search (RAG via `pgvector`) over approved ADRs to provide grounded contextual assistance and on-demand warnings regarding potential technical conflicts.
- Tracks and logs AI operations, review durations, and human approval/rejection metrics.

*Out of Scope for MVP:* Autonomous code generation/merging, automatic IDE/Copilot session interception, OCR processing of scanned PDFs, and enterprise SSO integrations.

---

## 2. System roles and access control (RBAC)

The system enforces strict role-based access control (RBAC) and project-level data isolation. Users must belong to a project to access any of its assets.

| Role | Permissions and responsibilities |
| :--- | :--- |
| **Project owner** | Full administrative rights over a specific project. Can create projects, manage project memberships, edit/confirm generated task backlogs, approve/supersede architectural decision versions, record manual conflict overrides with written justifications, and view AI activity analytics. |
| **Member** | Authenticated team participant. Can upload project specifications, request AI task decomposition, submit architectural decision proposals, perform RAG-based context queries, edit task descriptions/dependencies, and request conflict pre-checks. Cannot approve decision versions or publish unreviewed backlogs without explicit Owner status. |

---

## 3. System constraints

### 3.1 Architectural and technical constraints
1. **DBMS engine:** PostgreSQL 16+ with the `pgvector` extension enabled for storing dense vector embeddings ($1536$-dimensional vectors for RAG operations).
2. **Data normalization:** Relational schema normalized up to Third Normal Form (3NF).
3. **Data isolation:** All primary entity tables (`specifications`, `tasks`, `task_dependencies`, `architecture_decisions`, `memory_chunks`, `conflict_checks`, `ai_operation_logs`) MUST contain an explicit `project_id` foreign key. Cross-project data retrieval or cross-tenant contamination is strictly prohibited.
4. **Task graph integrity:** The task dependency graph MUST remain a Directed Acyclic Graph (DAG). Self-referential dependencies or cyclic chains are rejected at the database/API level.
5. **Security constraints:** Passwords must be hashed using strong modern cryptographic algorithms (e.g., Argon2 or bcrypt). No plain-text credentials or API secrets may be stored or written to logs. Application service accounts MUST run without DBMS superuser privileges.

---

## 4. Functional requirements

### 4.1 Epic 01: Project setup and specification import
- **FR-EP1-01 (Project and role setup):** The system shall allow an authenticated user to create a workspace project, assigning themselves as Project owner and inviting users as Members or Owners.
- **FR-EP1-02 (Specification ingestion):** The system shall support uploading `.txt` and text-layer `.pdf` specification documents up to the system size limit (e.g., 10MB). Scanned-only PDFs without extractable text must be rejected with a user-friendly error message.

### 4.2 Epic 02: AI task decomposition and dependency management
- **FR-EP2-01 (AI task generation):** The system shall parse uploaded specifications via LLM and propose a structured hierarchy of epics, tasks, and subtasks complete with title, description, acceptance criteria, and initial dependency edges (`blocking_task_id` $\rightarrow$ `blocked_task_id`).
- **FR-EP2-02 (DAG validation):** Prior to saving or confirming task structures, the server shall validate that no cyclic dependencies exist.
- **FR-EP2-03 (Human backlog confirmation):** Generated task proposals remain in `DRAFT` state until a Project owner or authorized Member reviews, optionally edits, and explicitly confirms the backlog.

### 4.3 Epic 03: Shared project memory and ADR versioning
- **FR-EP3-01 (Architectural decision proposals):** Members can submit proposed architectural decisions containing title, rationale, and formal decision content. Newly submitted items receive state `PROPOSED`.
- **FR-EP3-02 (Version lifecycle and approval):** Only a Project owner can transition a decision version to `APPROVED`. Upon approval of a new decision version:
  1. The prior active version transitions automatically to `SUPERSEDED`.
  2. The new version text is chunked, embedded, and stored in `memory_chunks`.
- **FR-EP3-03 (Isolated chunk indexing):** `memory_chunks` must be indexed via HNSW for cosine distance vector search, filtered strictly by `project_id` and active `APPROVED` status.

### 4.4 Epic 04: Conflict detection, RAG chat and GitHub integration
- **FR-EP4-01 (Potential conflict pre-check):** When a user drafts a new decision or task proposal, the system shall execute vector similarity search against active approved ADRs in the project context. The LLM shall analyze the retrieved chunks and return one of three statuses: `NO_CONFLICT`, `POSSIBLE_CONFLICT`, or `INSUFFICIENT_CONTEXT`, accompanied by source citations (`evidence_source_ids`).
- **FR-EP4-02 (Human conflict override):** If a proposal flags `POSSIBLE_CONFLICT`, a Project Owner may approve it only by submitting a mandatory, written justification stored in `conflict_overrides`.
- **FR-EP4-03 (Grounded contextual assistant):** Users can issue free-text queries against project knowledge. RAG answers must cite exact source decision IDs. If no matching context is retrieved above the similarity threshold, the system must report `INSUFFICIENT_CONTEXT` rather than inventing information.
- **FR-EP4-04 (GitHub issue publishing):** Confirmed tasks can be published to a connected GitHub repository using the GitHub REST API. Successfully published tasks store remote `github_issue_id` and `github_issue_url` fields. Re-publishing an already linked task must update the existing issue rather than create duplicates.
- **FR-EP4-05 (AI operation analytics):** The system shall track AI operational logs (`ai_operation_logs`), recording operational type, generation time (`generation_duration_ms`), active human review time (`review_duration_ms`), and final outcome (`ACCEPTED`, `MODIFIED`, `REJECTED`).

---

## 5. Non-functional requirements (NFRs)

- **NFR-01 (Security and data isolation):** 100% of API endpoints must enforce project access authorization. Attempting cross-project resource access must return HTTP `403 Forbidden`. Passwords must be hashed; API keys must be loaded from secure environment configurations.
- **NFR-02 (API performance):** 95th percentile (p95) CRUD operations response time must be $\le 1.0$ second under 20 concurrent clients on standard deployment setup (excluding external LLM call latency).
- **NFR-03 (Data freshness and analytics):** 95% of recorded AI analytics events must be reflected in the analytics UI within 10 seconds.
- **NFR-04 (Reliability and fault tolerance):** Invalid AI JSON output, network timeouts, or GitHub API failures must produce non-destructive error handling. Failed external calls must not corrupt internal transactional states.
- **NFR-05 (Provenance and RAG accuracy):** 100% of returned citations in RAG answers and conflict checks must map directly to valid, un-superseded `APPROVED` decision records belonging strictly to the requesting project.

---

## 6. Acceptance criteria (User stories and verification matrix)

The following Given/When/Then acceptance checks define the mandatory conditions for MVP verification:

### US-01: Project setup and roles
- **Given** an authenticated user,  
  **When** they create a new project workspace,  
  **Then** the project is persisted and the creator is assigned the `OWNER` role in `project_members`.
- **Given** a user with `MEMBER` role,  
  **When** they attempt to approve an ADR version or publish tasks to GitHub,  
  **Then** the server rejects the request with an HTTP `403 Forbidden` error.

### US-02: Specification upload
- **Given** a valid `.txt` or text-layer `.pdf` document within size limits,  
  **When** uploaded to a project,  
  **Then** its raw content is stored in `specifications`.
- **Given** a image-only/scanned PDF,  
  **When** uploaded,  
  **Then** the system rejects the file and returns a descriptive validation error message.

### US-03: AI task decomposition and DAG rejection
- **Given** a valid uploaded specification,  
  **When** AI task decomposition is triggered,  
  **Then** a schema-valid draft structure of Epics, Tasks, Subtasks, and acceptance criteria is returned.
- **Given** a task dependency graph edit that introduces a cyclic link (e.g., Task $A \rightarrow B \rightarrow A$),  
  **When** submitted for validation,  
  **Then** the server rejects the change, preserves the original graph, and highlights the cycle error.

### US-06: ADR approval and version superseding
- **Given** a decision with active version $v1$ (`APPROVED`),  
  **When** the Project Owner approves a new proposed version $v2$,  
  **Then** version $v1$ is updated to `SUPERSEDED`, version $v2$ is set to `APPROVED`, and only $v2$ chunks are indexed in `memory_chunks` for context retrieval.

### US-07 & US-08: Conflict detection and mandatory override
- **Given** a proposed decision that contradicts an existing approved ADR,  
  **When** a conflict check is performed,  
  **Then** the system returns status `POSSIBLE_CONFLICT` along with the source ADR code.
- **Given** a `POSSIBLE_CONFLICT` status,  
  **When** the Project Owner attempts to approve without filling in the justification text,  
  **Then** approval is blocked until a valid written justification is provided and stored in `conflict_overrides`.

### US-10: GitHub Issue publishing idempotency
- **Given** an approved local task already published to GitHub (`github_issue_id` is present),  
  **When** the user triggers publication again,  
  **Then** the system updates the existing GitHub Issue rather than creating a duplicate item.
