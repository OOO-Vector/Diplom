# System design and architecture specification

## Team AI orchestrator

**Architecture style:** Modular monolith (Spring Boot) + Web SPA (React / TypeScript)  

---

## 1. Architectural strategy and technology stack

To balance maintainability and execution speed the system follows a Modular monolith architectural pattern on the backend. 

### 1.1 Tech stack
* **Frontend:** React 18+, TypeScript, Vite, Tailwind CSS / Shadcn UI.
* **Backend:** Java 21, Spring Boot 3.x (Spring Web, Spring Security, Spring Data JPA).
* **Database and vector search:** PostgreSQL 16+ with `pgvector` extension.
* **External integration clients:**
  * **AI provider API:** OpenAI REST API / Azure OpenAI (using Spring AI or RestClient with structured JSON response mode).
  * **GitHub integration:** GitHub REST API v3 via Spring `RestClient`.

---

## 2. High-level system architecture and component diagram

The system consists of a single React SPA client interacting via REST/JSON with a Spring Boot application. Inside the backend monolith, domain modules communicate through strongly-typed Java interface contracts and Spring application events.

---

## 3. Detailed component specification

### 3.1 Web SPA frontend (React + TypeScript)
* **Responsibility:** User interface providing workspace navigation, specification upload, interactive task DAG editing, ADR version history, conflict warning resolution, grounded chat, and analytics dashboard.
* **Communication:** Asynchronous REST API calls via HTTP (`fetch` / Axios) with bearer JWT authentication.

### 3.2 Security and RBAC module (`com.orchestrator.security`)
* **Responsibility:** Handles JWT authentication and project-level role authorization (`PROJECT_OWNER`, `PROJECT_MEMBER`).
* **Enforcement:** Validates `project_id` access rights on every request to guarantee strict cross-tenant isolation before delegating to domain services.

### 3.3 AI decomposition module (`com.orchestrator.decomposition`)
* **Responsibility:** Ingests specifications (`TXT`/`PDF`), strips raw text, invokes LLM to draft epics/tasks/subtasks with acceptance criteria, and enforces Directed Acyclic Graph (DAG) cycle checking.
* **Interactions:** Emits timing metrics to `AnalyticsModule`. Calls `LLMService` with structured JSON schema targets.

### 3.4 Shared Project Memory (ADR) (`com.orchestrator.memory`)
* **Responsibility:** Manages the lifecycle of ADRs (`PROPOSED`, `APPROVED`, `SUPERSEDED`, `REJECTED`).
* **Interactions:** On transition of an ADR version to `APPROVED`, fires `AdrVersionApprovedEvent` via Spring Event Publisher to notify the `ContextEngine`.

### 3.5 Context engine / RAG module (`com.orchestrator.rag`)
* **Responsibility:** Text chunking, embedding generation via external API, storing vector embeddings in PostgreSQL `memory_chunks` table, and executing similarity vector search using `pgvector` (`hnsw` index with cosine distance).
* **Isolation:** Enforces `WHERE project_id = :projectId AND status = 'APPROVED'` on all vector queries.

### 3.6 Conflict detection module (`com.orchestrator.conflict`)
* **Responsibility:** Compares new ADR proposals against active approved ADRs. Requests context from `ContextEngine`, constructs conflict prompts for the LLM, and logs result statuses (`NO_CONFLICT`, `POSSIBLE_CONFLICT`, `INSUFFICIENT_CONTEXT`).
* **Interactions:** Requires written justification stored in `conflict_overrides` when an Owner overrides a `POSSIBLE_CONFLICT` state.

### 3.7 GitHub integration module (`com.orchestrator.github`)
* **Responsibility:** Asynchronous synchronization of confirmed local tasks to GitHub Issues. Handles remote issue creation, status sync, and idempotency checks using stored `github_issue_id` references.

### 3.8 Analytics module (`com.orchestrator.analytics`)
* **Responsibility:** Records duration metrics (`generation_duration_ms`, `review_duration_ms`) and human review outcomes (`ACCEPTED`, `MODIFIED`, `REJECTED`). Exposes aggregated KPI data for the frontend dashboard.

---

## 4. Module interaction patterns and data flow

### 4.1 Internal communication
1. **Direct synchronous service calls:** For simple data mutations and validations (e.g., `ConflictDetector` calling `ContextEngine.retrieveContext(projectId, proposalText)`).
2. **Spring application events (Decoupled async):** Used for non-blocking secondary operations. For example:
   * When `SharedMemory` approves a decision, it publishes `AdrApprovedEvent`.
   * `ContextEngine` listens to `AdrApprovedEvent` asynchronously, requests vector embeddings from the external API, and saves them to `memory_chunks`.

### 4.2 Error handling and resilience
* **External LLM / GitHub failures:** External API client calls are wrapped with Spring `@Retryable` and timeout controls.
* **Transactional boundaries:** Database operations use `@Transactional`. Failures during external REST calls (e.g., GitHub down) trigger a rollback or mark the task as `FAILED_TO_SYNC` without invalidating the local database state.
