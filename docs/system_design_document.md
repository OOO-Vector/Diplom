# System Design & Architecture Specification

## Team AI Orchestrator

**Version:** 1.0  
**Date:** November 2026  
**Architecture Style:** Modular Monolith (Spring Boot) + Web SPA (React / TypeScript)  

---

## 1. Architectural Strategy & Technology Stack

To balance maintainability, execution speed, and domain boundaries for a **two-developer implementation team**, the system follows a **Modular Monolith** architectural pattern on the backend. 

### 1.1 Tech Stack
* **Frontend:** React 18+, TypeScript, Vite, Tailwind CSS / Shadcn UI.
* **Backend:** Java 21, Spring Boot 3.x (Spring Web, Spring Security, Spring Data JPA).
* **Database & Vector Search:** PostgreSQL 16+ with `pgvector` extension.
* **External Integration Clients:**
  * **AI Provider API:** OpenAI REST API / Azure OpenAI (using Spring AI or RestClient with structured JSON response mode).
  * **GitHub Integration:** GitHub REST API v3 via Spring `RestClient`.

---

## 2. High-Level System Architecture & Component Diagram

The system consists of a single React SPA client interacting via REST/JSON with a Spring Boot application. Inside the backend monolith, domain modules communicate through strongly-typed Java interface contracts and Spring Application Events.

```mermaid
componentDiagram
    title Component Diagram — Team AI Orchestrator System Architecture

    package "Client Layer" {
        [React Web SPA] as Frontend
    }

    package "Spring Boot Modular Monolith (Core Backend)" {
        
        package "API & Security Layer" {
            [REST Controllers] as Controllers
            [Security & RBAC] as Security Module
        }

        package "Domain Modules" {
            [AI Decomposition Module] as AIDecomp
            [Shared Project Memory (ADR)] as SharedMemory
            [Context Engine / RAG] as ContextEngine
            [Conflict Detection Module] as ConflictDetector
            [GitHub Integration Module] as GitHubSync
            [Analytics Module] as AnalyticsModule
        }

        package "Data Access Layer (Spring Data JPA)" {
            [Repositories & Trans. Managers] as DAL
        }
    }

    package "Data & Storage Layer" {
        database "PostgreSQL + pgvector" as DB
    }

    package "External Services" {
        cloud "External LLM / Embeddings API" as LLMService
        cloud "GitHub REST API" as GitHubAPI
    }

    %% Relationships and Interactions
    Frontend --> Controllers : HTTPS / REST JSON

    Controllers --> SecurityModule : Auth / RBAC check
    Controllers --> AIDecomp : Trigger decomposition
    Controllers --> SharedMemory : Manage ADRs & versions
    Controllers --> ConflictDetector : Execute conflict check
    Controllers --> ContextEngine : Query grounded chat
    Controllers --> GitHubSync : Publish tasks
    Controllers --> AnalyticsModule : Read operation metrics

    ConflictDetector --> ContextEngine : Retrieve relevant ADR chunks
    ConflictDetector --> LLMService : Send draft + context for analysis
    AIDecomp --> LLMService : Send spec text for JSON parsing
    ContextEngine --> LLMService : Generate embeddings / Grounded QA
    ContextEngine --> DB : Vector similarity search (HNSW / Cosine)

    SharedMemory --> ContextEngine : Publish approved ADR event (Trigger re-embedding)
    AIDecomp --> AnalyticsModule : Record decomposition event
    ConflictDetector --> AnalyticsModule : Record conflict check outcome
    
    GitHubSync --> GitHubAPI : Create / Update Issues
    
    AIDecomp --> DAL
    SharedMemory --> DAL
    ContextEngine --> DAL
    ConflictDetector --> DAL
    GitHubSync --> DAL
    AnalyticsModule --> DAL

    DAL --> DB : SQL / pgvector queries
```

---

## 3. Detailed Component Specification

### 3.1 Web SPA Frontend (React + TypeScript)
* **Responsibility:** User interface providing workspace navigation, specification upload, interactive task DAG editing, ADR version history, conflict warning resolution, grounded chat, and analytics dashboard.
* **Communication:** Asynchronous REST API calls via HTTP (`fetch` / Axios) with bearer JWT authentication.

### 3.2 Security & RBAC Module (`com.orchestrator.security`)
* **Responsibility:** Handles JWT authentication and project-level role authorization (`PROJECT_OWNER`, `PROJECT_MEMBER`).
* **Enforcement:** Validates `project_id` access rights on every request to guarantee strict cross-tenant isolation before delegating to domain services.

### 3.3 AI Decomposition Module (`com.orchestrator.decomposition`)
* **Responsibility:** Ingests specifications (`TXT`/`PDF`), strips raw text, invokes LLM to draft Epics/Tasks/Subtasks with acceptance criteria, and enforces Directed Acyclic Graph (DAG) cycle checking.
* **Interactions:** Emits timing metrics to `AnalyticsModule`. Calls `LLMService` with structured JSON schema targets.

### 3.4 Shared Project Memory (ADR) (`com.orchestrator.memory`)
* **Responsibility:** Manages the lifecycle of Architectural Decision Records (`PROPOSED`, `APPROVED`, `SUPERSEDED`, `REJECTED`).
* **Interactions:** On transition of an ADR version to `APPROVED`, fires `AdrVersionApprovedEvent` via Spring Event Publisher to notify the `ContextEngine`.

### 3.5 Context Engine / RAG Module (`com.orchestrator.rag`)
* **Responsibility:** Text chunking, embedding generation via external API, storing vector embeddings in PostgreSQL `memory_chunks` table, and executing similarity vector search using `pgvector` (`hnsw` index with cosine distance).
* **Isolation:** Enforces `WHERE project_id = :projectId AND status = 'APPROVED'` on all vector queries.

### 3.6 Conflict Detection Module (`com.orchestrator.conflict`)
* **Responsibility:** Compares new ADR proposals against active approved ADRs. Requests context from `ContextEngine`, constructs conflict prompts for the LLM, and logs result statuses (`NO_CONFLICT`, `POSSIBLE_CONFLICT`, `INSUFFICIENT_CONTEXT`).
* **Interactions:** Requires written justification stored in `conflict_overrides` when an Owner overrides a `POSSIBLE_CONFLICT` state.

### 3.7 GitHub Integration Module (`com.orchestrator.github`)
* **Responsibility:** Asynchronous synchronization of confirmed local tasks to GitHub Issues. Handles remote issue creation, status sync, and idempotency checks using stored `github_issue_id` references.

### 3.8 Analytics Module (`com.orchestrator.analytics`)
* **Responsibility:** Records duration metrics (`generation_duration_ms`, `review_duration_ms`) and human review outcomes (`ACCEPTED`, `MODIFIED`, `REJECTED`). Exposes aggregated KPI data for the frontend dashboard.

---

## 4. Module Interaction Patterns & Data Flow

### 4.1 Internal Communication
1. **Direct Synchronous Service Calls:** For simple data mutations and validations (e.g., `ConflictDetector` calling `ContextEngine.retrieveContext(projectId, proposalText)`).
2. **Spring Application Events (Decoupled Async):** Used for non-blocking secondary operations. For example:
   * When `SharedMemory` approves a decision, it publishes `AdrApprovedEvent`.
   * `ContextEngine` listens to `AdrApprovedEvent` asynchronously, requests vector embeddings from the external API, and saves them to `memory_chunks`.

### 4.2 Error Handling & Resilience
* **External LLM / GitHub Failures:** External API client calls are wrapped with Spring `@Retryable` and timeout controls.
* **Transactional Boundaries:** Database operations use `@Transactional`. Failures during external REST calls (e.g., GitHub down) trigger a rollback or mark the task as `FAILED_TO_SYNC` without invalidating the local database state.