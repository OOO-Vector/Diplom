# System design document (SDD)

## Team AI orchestrator

**Target architecture:** Modular monolith (Spring Boot 3.x / Java 21) + Single-page application (React 18+ / TypeScript / Vite)

---

## 1. Architectural strategy and technology stack

### 1.1 Architectural pattern: Modular monolith
To maximize execution velocity for a two-developer engineering team while maintaining domain boundaries and code quality, Team AI orchestrator follows a Modular monolith architecture.

Rather than deploying distributed microservices—which introduce network overhead, distributed tracing complexity and complex multi-repo CI/CD—all domain modules reside within a single Spring Boot application instance. Domain modules communicate internally via strongly typed Java interface contracts and Spring application events. Database-level encapsulation (composite keys and explicit project scoping) guarantees that modules operate within their respective tenant boundaries, enabling seamless microservice extraction in the future if scaling needs dictate.

### 1.2 Technology stack
* **Frontend:** React 18+, TypeScript, Vite, Tailwind CSS, TanStack Query (React Query).
* **Backend monolith:** Java 21, Spring Boot 3.x, Spring Data JPA, Spring Security, Flyway (DB migrations).
* **Database and vector search:** PostgreSQL 16+ with `pgvector` extension (HNSW indexing with cosine distance).
* **External integrations:** OpenAI REST API / Azure OpenAI (using Spring AI / RestClient for structured JSON outputs and embeddings), GitHub REST API v3 via Spring `RestClient`.

---

## 2. High-level architecture component diagram

**See system_arch_component_diagram.png file in this folder**

## 3. Subsystem and module specifications

### 3.1 Web SPA frontend (React + TypeScript)
* **Responsibility:** Workspace navigation, specification uploads, interactive DAG backlog editing, ADR version management, conflict warning inspection, RAG chat assistant and AI activity dashboards.
* **Communication:** REST JSON calls over HTTPS using JWT authentication. Uses TanStack Query for server-state caching and Optimistic UI updates.

### 3.2 Security and RBAC module (`com.orchestrator.security`)
* **Responsibility:** Handles JWT authentication, request context injection, and project-level role validation (`PROJECT_OWNER` vs. `MEMBER`).
* **Enforcement:** Validates `project_id` access rights on every API endpoint. Restricts ADR approvals, task publishing, repository configuration, and conflict overrides strictly to `PROJECT_OWNER`.

### 3.3 Core backend and specification module (`com.orchestrator.core`)
* **Responsibility:** Workspace entity management, user setup, specification text extraction (`TXT` / text-layer `PDF`), task entity persistence, and dependency validation.
* **DAG validation logic:** Includes `TaskDependencyValidator` to run Depth-First Search (DFS) or recursive CTE graph checks. Uses an optimistic locking `version` counter on task entities to prevent race conditions during concurrent DAG edits.

### 3.4 AI decomposition module (`com.orchestrator.decomposition`)
* **Responsibility:** Transforms raw specification text into structured task hierarchies (Epics, tasks, subtasks) complete with mandatory `acceptance_criteria` and dependency edges using LLM JSON schema targets. Passes outputs to `TaskDependencyValidator` before persisting draft tasks.

### 3.5 Shared project memory (`com.orchestrator.memory`)
* **Responsibility:** Manages Architectural decision records (ADRs) and their version states (`PROPOSED`, `APPROVED`, `SUPERSEDED`, `REJECTED`).
* **Event publishing:** When a `PROJECT_OWNER` approves a new ADR version, it marks previous active versions as `SUPERSEDED` and fires `AdrApprovedEvent` via Spring `ApplicationEventPublisher`.

### 3.6 Context engine / RAG module (`com.orchestrator.rag`)
* **Responsibility:** Listens for `AdrApprovedEvent`, splits approved text into passages, calculates SHA-256 `chunk_hash`, stores `chunk_index`, generates vector embeddings via the external API and persists chunks to `memory_chunks`.
* **RAG search:** Performs cosine similarity queries filtering strictly by `WHERE project_id = :projectId AND status = 'APPROVED'`. Tracks status via `indexing_status` (`PENDING`, `INDEXED`, `FAILED`).

### 3.7 Conflict detection module (`com.orchestrator.conflict`)
* **Responsibility:** Evaluates proposed decisions against active approved ADRs. Stores `checked_content_hash` along with check results (`NO_CONFLICT`, `POSSIBLE_CONFLICT`, `INSUFFICIENT_CONTEXT`) and evidence references to detect staleness if the proposal is subsequently edited.
* **Overrides:** Requires and stores written justifications in `conflict_overrides` when an Owner overrides a `POSSIBLE_CONFLICT` warning.

### 3.8 GitHub integration module (`com.orchestrator.github`)
* **Responsibility:** Reads repository credentials from `github_integrations` and manages task publication to GitHub Issues via GitHub REST API v3. Ensures idempotency by checking and updating existing `github_issue_id` references.

### 3.9 Analytics module (`com.orchestrator.analytics`)
* **Responsibility:** Listens asynchronously to internal application events to populate `ai_operation_logs`. Records `operation_type`, `operation_status` (`SUCCESS`, `FAILED`, `TIMEOUT`), token consumption (`prompt_tokens`, `completion_tokens`), generation latency, active human review time, error messages and human decision outcomes (`ACCEPTED`, `MODIFIED`, `REJECTED`).

---

## 4. Interaction patterns and sequence flows

### 4.1 Internal monolith communication
1. **Synchronous in-process calls:** Used for immediate queries and transactional validations (e.g., `ConflictDetectionService` querying `ContextEngine.retrieveContext()`).
2. **Asynchronous application events:** Used for non-blocking secondary processes:
   * `AdrApprovedEvent`: Triggers asynchronous chunking and vector indexing in `ContextEngine`.
   * `AIOperationEvent`: Triggers background metric logging in `AnalyticsModule` without delaying HTTP API responses.

### 4.2 Sequence diagram: decision proposal and hash-pinned conflict check

**See Sequence_diagram.png file in this folder**
