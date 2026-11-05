### Main entities and their relation description
## RBAC and project isolation (US-01, NFR-01)

- users: system users.
- projects: their projects.
- project_members: intermediate table with roles (OWNER, MEMBER, INVITED). All the other entities are tied to project_id to ensure data isolation between two projects.

## Specifications and decomposition (EP-01, US-02 - US-04, US-09)

- specifications: imported text of PDF documents.
- tasks: task structure hierarchy (Epics, tasks, subtasks). There is implemented support of parent relations (parent_task_id) and external identificators GitHub (github_issue_id, github_issue_url).
- task_dependencies: locking dependency tables (blocking_task_id is blocking blocked_task_id) with check for absence of cycles and similar project_id.

## Shared project memory: Architectural decisions (ADR) and versioning (EP-02, US-05, US-06)

- architecture_decisions: ADR logical container, connected with the project.
- decision_versions: decisions versions table (PROPOSED, APPROVED, SUPERSEDED, REJECTED statuses supported).
- memory_chunks: vector fragments (pgvector embeddings) for RAG search, strictly tied to decision_version_id. Only fragments from active versions with APPROVED statusgo to RAG.

## Conflicts check and justification for redefinitions (EP-03, US-07, US-08)

- conflict_checks: log of automatic AI or user proposal check for contradictions with approved ADR (status: NO_CONFLICT, POSSIBLE_CONFLICT, INSUFFICIENT_CONTEXT).
- conflict_overrides: stipulates a mandatory written justification of Team lead / Project owner in case AI warning is ignored or overridden.

## AI operations and checks analytics (EP-04, US-13)

- ai_operation_logs: storing metrics of generation time, active human review time and final statuses of approved AI proposals (ACCEPTED, MODIFIED, REJECTED).

## ER-diagram

```mermaid
erDiagram
    users ||--o{ project_members : "has memberships"
    projects ||--o{ project_members : "has members"
    projects ||--o| github_integrations : "configures"
    projects ||--o{ specifications : "contains"
    projects ||--o{ tasks : "owns"
    projects ||--o{ architecture_decisions : "has ADRs"
    
    tasks ||--o{ tasks : "parent/subtask"
    specifications ||--o{ tasks : "generated from"
    tasks ||--o{ task_dependencies : "blocking task"
    tasks ||--o{ task_dependencies : "blocked task"
    
    architecture_decisions ||--o{ decision_versions : "has history"
    users ||--o{ decision_versions : "authored by"
    decision_versions ||--o{ memory_chunks : "chunked & embedded"
    
    decision_versions ||--o{ conflict_checks : "checks proposal"
    users ||--o{ conflict_checks : "initiated by"
    conflict_checks ||--o| conflict_overrides : "has override"
    users ||--o{ conflict_overrides : "overridden by"
    
    projects ||--o{ ai_operation_logs : "tracks operations"
    users ||--o{ ai_operation_logs : "executed by"

    users {
        uuid id PK
        varchar email
        varchar password_hash
        varchar full_name
        timestamp_tz created_at
    }

    projects {
        uuid id PK
        varchar name
        text description
        timestamp_tz created_at
    }

    project_members {
        uuid project_id PK,FK
        uuid user_id PK,FK
        varchar role
        timestamp_tz joined_at
    }

    github_integrations {
        uuid id PK
        uuid project_id FK
        varchar repo_owner
        varchar repo_name
        text access_token_encrypted
        varchar default_branch
        timestamp_tz updated_at
    }

    specifications {
        uuid id PK
        uuid project_id FK
        varchar file_name
        varchar file_type
        text raw_content
        timestamp_tz uploaded_at
    }

    tasks {
        uuid id PK
        uuid project_id FK
        uuid specification_id FK
        uuid parent_task_id FK
        varchar title
        text description
        text acceptance_criteria
        varchar task_type
        varchar status
        bigint github_issue_id
        varchar github_issue_url
        bigint version
    }

    task_dependencies {
        uuid blocking_task_id PK,FK
        uuid blocked_task_id PK,FK
        uuid project_id FK
    }

    architecture_decisions {
        uuid id PK
        uuid project_id FK
        varchar decision_code
        timestamp_tz created_at
    }

    decision_versions {
        uuid id PK
        uuid decision_id FK
        uuid project_id FK
        integer version_number
        varchar title
        text rationale
        text content
        varchar status
        uuid created_by_user_id FK
    }

    memory_chunks {
        uuid id PK
        uuid decision_version_id FK
        uuid project_id FK
        integer chunk_index
        text chunk_text
        varchar chunk_hash
        vector embedding
        varchar indexing_status
    }

    conflict_checks {
        uuid id PK
        uuid project_id FK
        uuid proposed_version_id FK
        uuid initiated_by_user_id FK
        varchar checked_content_hash
        varchar status
        jsonb evidence_source_ids
    }

    conflict_overrides {
        uuid id PK
        uuid conflict_check_id FK
        uuid approved_by_user_id FK
        text justification
        timestamp_tz overridden_at
    }

    ai_operation_logs {
        uuid id PK
        uuid project_id FK
        uuid user_id FK
        varchar operation_type
        varchar operation_status
        varchar review_outcome
        varchar model_name
        integer prompt_tokens
        integer completion_tokens
        integer generation_duration_ms
        integer review_duration_ms
        text error_message
    }
```
