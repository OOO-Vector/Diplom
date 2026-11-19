# Team AI Orchestrator - Frontend Architecture Specification

---

## 1. Architectural Overview & Design Principles

The frontend of Team AI Orchestrator is a desktop-first Single-Page Application (SPA) built with React 18 and TypeScript. It serves as the human-in-the-loop (HITL) control plane where software teams upload specifications, review and edit AI-proposed backlogs, inspect architectural decision conflicts, query grounded project knowledge, and monitor AI operation metrics.

### Core Architectural Principles
1. **Strict Separation of Server State and Client State:** Asynchronous backend resources (projects, backlogs, tasks, ADRs, chat messages, analytics) are managed exclusively by TanStack Query, while synchronous ephemeral UI state (in-memory JWT access token, sidebar collapse state, active modals/drawers) is managed by Zustand.
2. **Backend-Authoritative Security & Validation:** UI role checks (`Owner` vs. `Member`) and Zod form schemas improve usability and prevent invalid submissions, but the backend remains the sole authority for RBAC, DAG acyclicity, and state transitions.
3. **Domain-Aligned Feature Modules:** Code is organized by business domain (`planning`, `decisions`, `chat`, `github`, `analytics`) mirroring the Spring Boot modular monolith (`SRS §11.2`), avoiding monolithic `components/` or `utils/` folders.
4. **Explicit Four-State UI Contract:** Every data-fetching view implements `Loading`, `Empty`, `Error` (RFC 9457 Problem Details), and `Populated` states (`NFR-UX-001`).
5. **Zero-Persistence Token Security:** In compliance with `DEC-02`, JWT access tokens (`15 min` TTL) live strictly in JavaScript memory; refresh tokens (`7 days` TTL) are handled via `HttpOnly; Secure; SameSite=Strict` cookies.

---

## 2. Technology Stack & Libraries (`DEC-11`)

| Layer / Concern | Library / Tool | Version | Justification & Usage |
|---|---|---|---|
| **Build Tool & Bundler** | Vite | `^5.4` | Fast HMR in development, optimized ESM production bundles, environment variable injection (`VITE_*`). |
| **UI Framework** | React + React DOM | `^18.3` | Component-based declarative UI with concurrent rendering support. |
| **Language** | TypeScript | `^5.6` (`strict: true`) | End-to-end compile-time type safety for API DTOs, domain enums, and component props. |
| **Routing** | React Router DOM | `^6.28` | Nested layouts, URL-driven project context (`/projects/:projectId/...`), and protected route guards. |
| **Server State & Polling** | TanStack Query (`@tanstack/react-query`) | `^5.60` | Declarative caching, request deduplication, optimistic/invalidated mutations, and conditional `refetchInterval` polling for async AI jobs (`FR-DEC-011`, `FR-ANL-007`). |
| **Client UI State** | Zustand | `^5.0` | Lightweight store for in-memory `accessToken`, current user profile, and global layout/drawer toggles. |
| **HTTP Client** | Axios | `^1.7` | Request/response interceptors for `Authorization: Bearer` injection, automatic `401` single-flight token refresh, and Problem Details normalization. |
| **Forms & Validation** | React Hook Form + `@hookform/resolvers` + Zod | `^7.53` / `^3.23` | Performant uncontrolled forms with schema-based validation matching backend DTO constraints (`FR-DEC-003`, `FR-CON-009`). |
| **Styling & UI Primitives** | Tailwind CSS + Radix UI Primitives + Lucide React | `^3.4` / `^1.1` | Utility-first styling with design tokens (`Poppins` font, WCAG AA contrast), accessible headless dialogs/tooltips/tabs (`NFR-UX-004`), and consistent iconography. |
| **Data Visualization** | Recharts | `^2.13` | Responsive bar/pie/line charts for AI review outcomes (`Accepted` / `Modified` / `Rejected`) and operation durations (`SCR-04`). |
| **Markdown & Citations** | `react-markdown` + `remark-gfm` | `^9.0` | Safe, XSS-free rendering of assistant responses and ADR descriptions without `dangerouslySetInnerHTML` (`NFR-SEC-006`). |
| **Testing & Quality** | Vitest, React Testing Library, MSW, Playwright, ESLint, Prettier | Latest | Unit/component tests, API contract mocking, E2E browser flows, and static code analysis (`DEC-15`). |

---

## 3. Directory and Component Structure

The frontend codebase resides in `/frontend` and follows a Feature-Sliced / Domain-Modular layout:

```text
frontend/
├── public/                         # Static favicon and assets
├── src/
│   ├── app/                        # Application bootstrap & global providers
│   │   ├── App.tsx                 # Root component composing providers & Router
│   │   ├── providers.tsx           # QueryClientProvider, AuthInitializer, ToastProvider
│   │   └── router.tsx              # Route definitions, ProtectedRoute, ProjectLayout
│   │
│   ├── shared/                     # Reusable cross-domain primitives (no business logic)
│   │   ├── api/
│   │   │   ├── httpClient.ts       # Axios instance, Bearer interceptor, 401 refresh queue
│   │   │   ├── problemDetails.ts   # RFC 9457 ProblemDetails TypeScript type & parser
│   │   │   └── queryKeys.ts        # Centralized hierarchical TanStack Query key factory
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── AppShell.tsx            # 3-tier layout (Sidebar + Header + Workspace)
│   │   │   │   ├── ProjectSidebar.tsx      # Collapsible project list, search, "+ New project"
│   │   │   │   ├── ModuleTopBar.tsx        # Tabs: [TASKS], [DECISIONS], [CHAT], [ANALYTICS], [SETTINGS]
│   │   │   │   └── ArchivedProjectBanner.tsx # Persistent read-only warning banner
│   │   │   ├── feedback/
│   │   │   │   ├── AsyncOperationBar.tsx   # Multi-step progress bar + live timer for AI jobs
│   │   │   │   ├── EmptyStateCard.tsx      # Standardized zero-data card with icon & CTA
│   │   │   │   ├── ErrorBanner.tsx         # ProblemDetails alert with correlationId & Retry
│   │   │   │   ├── SkeletonList.tsx        # Loading placeholders
│   │   │   │   └── StatusBadge.tsx         # Accessible icon+text badges for all domain enums
│   │   │   └── ui/                         # Base atomic UI elements (Button, Input, Modal, Drawer, Tooltip, Tabs)
│   │   ├── hooks/
│   │   │   ├── useOperationPolling.ts      # Reusable TanStack Query hook for GET /operations/{id}
│   │   │   ├── useProjectRole.ts           # Computes { isOwner, isMember, isArchived, canApprove, canMutate }
│   │   │   └── useUnsavedChangesGuard.ts   # Warns before navigating away from dirty forms
│   │   └── utils/
│   │       ├── dateFormat.ts               # ISO-8601 UTC to local display + UTC tooltip formatter
│   │       └── metricFormat.ts             # Renders null/undefined metrics as "N/A" (never 0)
│   │
│   ├── features/                   # Business domain modules (aligned with SRS §2.4 & §11.2)
│   │   ├── auth/                   # LoginPage, RegisterPage, authStore (Zustand), authApi
│   │   ├── projects/               # ProjectDashboardPage (SCR-01), CreateProjectModal, MemberTable, OwnershipTransferModal
│   │   ├── planning/               # TasksWorkspacePage (SCR-02), SpecUploadDropzone, BacklogTree, TaskDetailDrawer, DependencyEditor, CycleErrorAlert
│   │   ├── decisions/              # DecisionsPage (SCR-06), DecisionList, DecisionVersionDrawer, ProposeDecisionModal, ConflictCheckPanel, OverrideJustificationModal
│   │   ├── chat/                   # ChatWorkspacePage (SCR-03), ChatSessionList, MessageFeed, CitationChip, CitationPreviewDrawer, DocumentScopeSidebar
│   │   ├── github/                 # GithubSettingsCard (SCR-05), PublishTasksModal, IssueSyncBadge, ReconcileButton
│   │   └── analytics/              # AnalyticsDashboardPage (SCR-04), OutcomePieChart, DurationBarChart, ReviewMetricsTable
│   │
│   ├── main.tsx                    # ReactDOM.createRoot entry point
│   └── index.css                   # Tailwind directives & CSS custom properties
├── tests/
│   ├── setup.ts                    # Vitest setup, jest-dom matchers, MSW server lifecycle
│   ├── mocks/                      # MSW handlers & realistic domain fixtures
│   └── e2e/                        # Playwright end-to-end specs
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── playwright.config.ts
```

### How to Add a New Feature Module (Developer Guide)
1. Create a folder `src/features/<domain>/` with `api/`, `components/`, `hooks/`, `schemas/` (Zod), and `types.ts`.
2. Register query keys in `src/shared/api/queryKeys.ts`.
3. Define typed request/response DTOs matching `docs/api/openapi.yaml`.
4. Add a lazy-loaded route entry in `src/app/router.tsx` under `/projects/:projectId/<domain>` and add a tab in `ModuleTopBar.tsx` if top-level.
5. Enforce permissions via `useProjectRole()` and implement all four UI states (`Loading`, `Empty`, `Error`, `Populated`).

---

## 4. Routing Architecture

Routing is managed by React Router v6 (`createBrowserRouter`). The active `projectId` is encoded directly in the URL path so deep links, browser back/forward buttons, and citation links preserve exact project context.

| Route Path | Component | Access Guard | Screen ID | Description |
|---|---|---|---|---|
| `/login` | `LoginPage` | `PublicOnlyRoute` | - | Email/password login; redirects authenticated users to `/projects`. |
| `/register` | `RegisterPage` | `PublicOnlyRoute` | - | New account registration (`FR-AUTH-001`). |
| `/` | `Navigate to="/projects"` | `ProtectedRoute` | - | Root entry redirect. |
| `/projects` | `ProjectsEmptyOrRedirectPage` | `ProtectedRoute` | `SCR-01` | Auto-redirects to the user's most recent project or shows the "Create First Project" empty state. |
| `/projects/:projectId` | `ProjectLayout` (`AppShell`) | `ProtectedRoute` + `ProjectMemberGuard` | - | Loads project metadata & user's project role (`Owner`/`Member`); renders persistent Sidebar + Top Bar. |
| `/projects/:projectId/overview` | `ProjectDashboardPage` | Project Member | `SCR-01` | Project summary, member list, and member invitation/removal (`Owner`). |
| `/projects/:projectId/tasks` | `TasksWorkspacePage` | Project Member | `SCR-02` | Spec upload, AI decomposition progress, task tree editor, DAG validation, and GitHub export. |
| `/projects/:projectId/decisions` | `DecisionsPage` | Project Member | `SCR-06` | Active ADRs, version history, decision proposal, ML conflict check, and Owner approval/override. |
| `/projects/:projectId/chat` | `ChatWorkspacePage` | Project Member | `SCR-03` | Private RAG chat sessions, grounded Q&A, citation drawer, and spec scope filter. |
| `/projects/:projectId/analytics` | `AnalyticsDashboardPage` | Project Member | `SCR-04` | AI operation metrics, review outcome ratios, durations, and `N/A` handling. |
| `/projects/:projectId/settings` | `ProjectSettingsPage` | Project Member (`Owner` for writes) | `SCR-05` | General project settings, GitHub App repository connection/status, ownership transfer, and archiving. |
| `*` | `NotFoundPage` | Any | - | Controlled 404 fallback page with link back to workspace. |

---

## 5. State Management Strategy

Application state is strictly partitioned into three tiers to avoid synchronization bugs and stale data:

### 5.1 Server Cache State (TanStack Query v5)
All REST API data lives in TanStack Query's normalized cache, keyed hierarchically via `queryKeys.ts`:
- `['auth', 'me']` - Current authenticated user profile.
- `['projects']` - List of projects accessible to the user.
- `['projects', projectId]` - Project details, `status` (`active`/`archived`), and `currentUserRole` (`OWNER`/`MEMBER`).
- `['projects', projectId, 'backlogs', 'current']` - Active backlog draft/approved/published structure and task tree.
- `['projects', projectId, 'decisions']` - List of ADRs and version histories.
- `['projects', projectId, 'conflict-checks', checkId]` - Specific conflict check result and evidence.
- `['projects', projectId, 'chats', sessionId, 'messages']` - Private chat message feed.
- `['projects', projectId, 'operations', operationId]` - Asynchronous job state (`queued`, `running`, `completed`, `failed`).
- `['projects', projectId, 'analytics', period]` - Aggregated review and operation metrics.

**Polling & Invalidation Rules:**
- **Async Operations (`useOperationPolling`):** Uses `refetchInterval: (query) => (query.state.data?.status === 'queued' || query.state.data?.status === 'running' ? 2500 : false)`. Upon transitioning to `completed`, `onSuccess` invalidates the dependent domain query (e.g., `['projects', projectId, 'backlogs']` or `['projects', projectId, 'decisions']`).
- **Analytics Live Freshness (`NFR-PER-005`):** On `SCR-04`, `refetchInterval: 5000` with `refetchIntervalInBackground: false` ensures new events appear within $\le 5\text{ s}$ while the tab is focused.

### 5.2 Ephemeral Client & Auth Store (Zustand)
`useAuthStore` holds:
- `accessToken: string | null` (in memory only - cleared on page refresh and restored via silent `POST /api/v1/auth/refresh` before rendering protected routes).
- `user: UserSummary | null`
- `isInitializing: boolean`
- Actions: `setSession(token, user)`, `clearSession()`.

`useUiStore` holds:
- `isSidebarCollapsed: boolean`
- `selectedTaskId: string | null` (controls `TaskDetailDrawer`)
- `activeCitation: CitationPreview | null` (controls `CitationPreviewDrawer`)

### 5.3 Form & Local Draft State (React Hook Form + Zod)
- Complex forms (Decision Proposal, Task Edit Drawer, Override Justification Modal, Member Invite) use React Hook Form with Zod resolvers.
- Dirty state (`formState.isDirty`) feeds `useUnsavedChangesGuard` (`NFR-UX-006`) so users are warned before losing unsaved edits.

---

## 6. Backend REST API Interaction & Agreed Contracts

> **Contract Sign-Off Section (`V-03`, `V-07`):** The endpoints, request payloads, and response schemas below establish the binding frontend–backend REST contract to be codified in `docs/api/openapi.yaml`. All timestamps are ISO-8601 UTC strings; all entity IDs are UUID v4 strings.

### 6.1 Common Conventions & Error Contract (RFC 9457 Problem Details)
- **Base Path:** `/api/v1`
- **Headers:**
  - `Authorization: Bearer <accessToken>` (on all protected endpoints)
  - `Content-Type: application/json` (or `multipart/form-data` for specification upload)
  - `X-CSRF-TOKEN: <token>` (for cookie-backed `/auth/refresh` and `/auth/logout` per `DEC-02`)
- **Standard Error Payload (`application/problem+json`):**
```json
{
  "type": "https://team-ai-orchestrator.local/errors/cyclic-dependency",
  "title": "Cyclic Task Dependency Detected",
  "status": 409,
  "detail": "Adding dependency Task B -> Task A creates a cycle: A -> B -> A.",
  "instance": "/api/v1/projects/550e8400.../backlogs/770e8400.../dependencies",
  "code": "TASK_DEPENDENCY_CYCLE",
  "correlationId": "req-9f8a7b6c",
  "retryable": false,
  "fieldErrors": [
    { "field": "blockedByTaskId", "message": "Creates a circular dependency chain" }
  ]
}
```

---

### 6.2 Authentication & Session (`/api/v1/auth`)

| Method & Endpoint | Request Payload | Expected Success Response | Error Codes |
|---|---|---|---|
| `POST /auth/register` | `{ "email": "string", "displayName": "string", "password": "string (min 8)" }` | `201 Created`: `{ "user": { "id": "uuid", "email": "string", "displayName": "string" } }` | `400` (validation), `409` (`EMAIL_ALREADY_EXISTS`) |
| `POST /auth/login` | `{ "email": "string", "password": "string" }` | `200 OK` + `Set-Cookie: refresh_token=...; HttpOnly; Secure; SameSite=Strict`:<br>`{ "accessToken": "jwt", "expiresInSeconds": 900, "user": { "id": "uuid", "email": "string", "displayName": "string" } }` | `401` (`INVALID_CREDENTIALS`), `429` (rate limit) |
| `POST /auth/refresh` | Empty body (uses `HttpOnly` cookie) | `200 OK` + rotated `Set-Cookie`:<br>`{ "accessToken": "jwt", "expiresInSeconds": 900, "user": { ... } }` | `401` (`REFRESH_TOKEN_INVALID_OR_EXPIRED`) |
| `POST /auth/logout` | Empty body (uses `HttpOnly` cookie) | `204 No Content` (clears cookie & revokes DB refresh session) | `401` |
| `GET /auth/me` | - | `200 OK`: `{ "id": "uuid", "email": "string", "displayName": "string" }` | `401` |

---

### 6.3 Projects & Membership (`/api/v1/projects`)

| Method & Endpoint | Request Payload | Expected Success Response | Error Codes |
|---|---|---|---|
| `GET /projects` | Query: `?search=&page=0&size=20` | `200 OK`: `{ "items": [ { "id": "uuid", "name": "string", "description": "string", "status": "active\|archived", "currentUserRole": "OWNER\|MEMBER", "memberCount": 3, "updatedAt": "iso-utc" } ], "total": 1 }` | `401` |
| `POST /projects` | `{ "name": "string (1..120)", "description": "string (0..1000)" }` | `201 Created`: `{ "id": "uuid", "name": "string", "description": "string", "status": "active", "currentUserRole": "OWNER", "createdAt": "iso-utc" }` | `400`, `401` |
| `GET /projects/{projectId}` | - | `200 OK`: `{ "id": "uuid", "name": "string", "description": "string", "status": "active\|archived", "currentUserRole": "OWNER\|MEMBER", "githubConnection": { "status": "active\|disconnected\|error", "repositoryFullName": "org/repo" } \| null }` | `403`, `404` |
| `PATCH /projects/{projectId}` | `{ "name"?: "string", "description"?: "string" }` | `200 OK`: updated Project DTO | `403` (Member), `409` (`PROJECT_ARCHIVED`) |
| `POST /projects/{projectId}/archive` | Empty body | `200 OK`: `{ "id": "uuid", "status": "archived" }` | `403` (Member) |
| `GET /projects/{projectId}/members` | - | `200 OK`: `{ "items": [ { "userId": "uuid", "email": "string", "displayName": "string", "role": "OWNER\|MEMBER", "joinedAt": "iso-utc" } ] }` | `403` |
| `POST /projects/{projectId}/members` | `{ "email": "string" }` | `201 Created`: `{ "userId": "uuid", "email": "string", "displayName": "string", "role": "MEMBER", "joinedAt": "iso-utc" }` | `403` (Member), `404` (`USER_NOT_FOUND`), `409` (`ALREADY_MEMBER`) |
| `DELETE /projects/{projectId}/members/{userId}` | - | `204 No Content` | `403`, `409` (`CANNOT_REMOVE_SOLE_OWNER`) |
| `POST /projects/{projectId}/transfer-ownership` | `{ "newOwnerUserId": "uuid" }` | `200 OK`: `{ "previousOwnerId": "uuid", "newOwnerId": "uuid" }` | `403`, `400` (`TARGET_NOT_ACTIVE_MEMBER`) |

---

### 6.4 Specifications, AI Decomposition & Backlog (`/api/v1/projects/{projectId}/...`)

| Method & Endpoint | Request Payload | Expected Success Response | Error Codes |
|---|---|---|---|
| `POST /specifications` | `multipart/form-data`: `file` (`.txt` or `.pdf`, $\le 10\text{ MiB}$), `title` (optional) | `201 Created`: `{ "id": "uuid", "version": 1, "fileName": "srs.pdf", "status": "processed", "charCount": 14500, "uploadedBy": { "id": "uuid", "displayName": "string" }, "createdAt": "iso-utc" }` | `400` (`SCANNED_PDF_NO_TEXT`, `EMPTY_FILE`), `413` (`FILE_TOO_LARGE`), `415` (`UNSUPPORTED_MEDIA_TYPE`) |
| `GET /specifications` | - | `200 OK`: `{ "items": [ { "id": "uuid", "version": 1, "fileName": "string", "status": "uploaded\|processing\|processed\|failed", "createdAt": "iso-utc" } ] }` | `403` |
| `POST /specifications/{specId}/decompose` | `{ "instructions"?: "string" }` | `202 Accepted`: `{ "operationId": "uuid", "type": "BACKLOG_DECOMPOSITION", "status": "queued" }` | `409` (`PROJECT_ARCHIVED`), `429` (`AI_QUOTA_EXCEEDED`) |
| `GET /operations/{operationId}` | - | `200 OK`: `{ "operationId": "uuid", "type": "string", "status": "queued\|running\|completed\|failed", "stageLabel": "Validating DAG...", "resultResourceId": "uuid \| null", "error"?: { "code": "string", "detail": "string", "retryable": true }, "startedAt": "iso-utc", "completedAt": "iso-utc \| null" }` | `403`, `404` |
| `GET /backlogs/current` | - | `200 OK`: `{ "id": "uuid", "specificationId": "uuid \| null", "specificationVersion": 1, "status": "draft\|approved\|published", "revision": 3, "dagValid": true, "tasks": [ { "id": "uuid", "parentId": "uuid \| null", "type": "epic\|story\|task", "title": "string", "description": "string", "acceptanceCriteria": ["string"], "priority": 2, "status": "draft\|ready\|in_progress\|in_review\|done\|cancelled", "blockedByTaskIds": ["uuid"], "githubIssue": { "number": 42, "url": "https://github.com/...", "syncStatus": "pending\|synced\|failed\|unknown" } \| null } ] }` | `404` (`NO_BACKLOG_YET` $\rightarrow$ renders Empty State) |
| `POST /backlogs/{backlogId}/tasks` | `{ "parentId": "uuid \| null", "type": "epic\|story\|task", "title": "string", "description": "string", "acceptanceCriteria": ["string"], "priority": 1..5 }` | `201 Created`: created Task DTO + updated backlog `revision` | `400` (`INVALID_PARENT_TYPE`), `409` (`BACKLOG_PUBLISHED_IMMUTABLE`) |
| `PATCH /backlogs/{backlogId}/tasks/{taskId}` | `{ "revision": 3, "title"?: "string", "description"?: "string", "acceptanceCriteria"?: ["string"], "priority"?: 1..5, "status"?: "string", "parentId"?: "uuid \| null" }` | `200 OK`: updated Task DTO + `{ "approvalInvalidated": boolean, "revision": 4 }` | `409` (`STALE_REVISION`, `PARENT_CYCLE_DETECTED`) |
| `DELETE /backlogs/{backlogId}/tasks/{taskId}` | Query: `?revision=3` | `204 No Content` | `409` (`BACKLOG_PUBLISHED_IMMUTABLE`) |
| `POST /backlogs/{backlogId}/dependencies` | `{ "taskId": "uuid", "blockedByTaskId": "uuid", "revision": 4 }` | `201 Created`: `{ "taskId": "uuid", "blockedByTaskId": "uuid", "dagValid": true }` | `409` (`TASK_DEPENDENCY_CYCLE`, `SELF_DEPENDENCY`) |
| `DELETE /backlogs/{backlogId}/dependencies` | `{ "taskId": "uuid", "blockedByTaskId": "uuid" }` | `204 No Content` | `409` |
| `POST /backlogs/{backlogId}/approve` | `{ "revision": 4, "activeReviewDurationMs"?: 42000 }` | `200 OK`: `{ "id": "uuid", "status": "approved", "reviewOutcome": "accepted\|modified", "correctionsCount": 2, "approvedAt": "iso-utc" }` | `403` (Member), `409` (`STALE_REVISION`, `INVALID_DAG`) |

---

### 6.5 GitHub Integration (`/api/v1/projects/{projectId}/github`)

| Method & Endpoint | Request Payload | Expected Success Response | Error Codes |
|---|---|---|---|
| `POST /github/connect` | `{ "installationId": 123456, "repositoryFullName": "owner/repo" }` | `200 OK`: `{ "status": "active", "repositoryFullName": "owner/repo", "connectedAt": "iso-utc" }` | `403` (Member), `400` (`GITHUB_PERMISSION_DENIED`) |
| `DELETE /github/disconnect` | - | `204 No Content` (preserves historical issue mappings per `DEC-06`) | `403` (Member) |
| `POST /github/publish` | `{ "backlogId": "uuid", "taskIds": ["uuid"] }` | `202 Accepted`: `{ "operationId": "uuid", "status": "queued" }` (or `200 OK` summary with per-task `synced` / `failed` / `unknown` statuses) | `403` (non-member), `409` (`BACKLOG_NOT_APPROVED`, `GITHUB_NOT_CONNECTED`) |
| `POST /github/reconcile` | `{ "backlogId": "uuid" }` | `200 OK`: `{ "reconciledCount": 4, "unknownCount": 0, "failedCount": 0 }` | `502` (`GITHUB_API_UNAVAILABLE`) |

---

### 6.6 Shared Project Memory & Semantic Conflict Detection (`/api/v1/projects/{projectId}/...`)

| Method & Endpoint | Request Payload | Expected Success Response | Error Codes |
|---|---|---|---|
| `GET /decisions` | Query: `?status=accepted\|proposed\|rejected\|superseded` | `200 OK`: `{ "items": [ { "decisionId": "uuid", "code": "ADR-001", "currentVersionId": "uuid", "versionNumber": 1, "title": "string", "status": "accepted\|proposed\|rejected\|superseded", "indexingStatus": "pending\|processing\|indexed\|failed", "author": { "id": "uuid", "displayName": "string" }, "updatedAt": "iso-utc" } ] }` | `403` |
| `GET /decisions/{decisionId}` | - | `200 OK`: `{ "decisionId": "uuid", "code": "ADR-001", "versions": [ { "versionId": "uuid", "versionNumber": 2, "title": "string", "context": "string", "decisionText": "string", "rationale": "string", "sourceRef": "string", "status": "accepted", "indexingStatus": "indexed", "approvedBy": { "id": "uuid", "displayName": "string" } \| null, "createdAt": "iso-utc" } ] }` | `403`, `404` |
| `POST /decisions` | `{ "decisionId"?: "uuid (if proposing v2 of existing ADR)", "title": "string", "context": "string", "decisionText": "string", "rationale": "string", "sourceRef"?: "string" }` | `201 Created`: Decision version DTO (`status: "proposed"`) | `400`, `409` (`PROJECT_ARCHIVED`) |
| `POST /conflict-checks` | `{ "decisionVersionId": "uuid" }` | `200 OK` (or `202` + poll): `{ "checkId": "uuid", "decisionVersionId": "uuid", "result": "possible_conflict\|no_conflict\|insufficient_context", "modelVersion": "scdm-mlp-v1", "explanation": "string \| null", "explanationError": "string \| null", "evidence": [ { "comparedDecisionVersionId": "uuid", "decisionCode": "ADR-001", "versionNumber": 1, "title": "string", "snippet": "string", "predictedLabel": "conflict\|no_conflict", "score": 0.84, "threshold": 0.75 } ], "checkedAt": "iso-utc" }` | `502` (`ML_OR_EMBEDDING_UNAVAILABLE` - never returns `no_conflict`) |
| `POST /decisions/versions/{versionId}/resolve` | `{ "action": "approve\|reject\|request_revision", "conflictCheckId"?: "uuid", "overrideRationale"?: "string (required if possible_conflict + approve)", "acknowledgeInsufficientContext"?: boolean, "reviewComment"?: "string" }` | `200 OK`: `{ "versionId": "uuid", "status": "accepted\|rejected\|revision_requested", "supersededVersionId": "uuid \| null", "indexingStatus": "pending\|processing\|indexed\|failed" }` | `403` (Member), `400` (`OVERRIDE_RATIONALE_REQUIRED`), `409` (`STALE_CONFLICT_CHECK`) |
| `POST /decisions/versions/{versionId}/reindex` | Empty body | `202 Accepted`: `{ "versionId": "uuid", "indexingStatus": "processing" }` | `403` |

---

### 6.7 Grounded RAG Chat & Analytics (`/api/v1/projects/{projectId}/...`)

| Method & Endpoint | Request Payload | Expected Success Response | Error Codes |
|---|---|---|---|
| `GET /chats` | - | `200 OK`: `{ "items": [ { "sessionId": "uuid", "title": "string", "updatedAt": "iso-utc" } ] }` (strictly caller's private sessions) | `403` |
| `POST /chats` | `{ "title"?: "string" }` | `201 Created`: `{ "sessionId": "uuid", "title": "New Chat", "createdAt": "iso-utc" }` | `403` |
| `GET /chats/{sessionId}/messages` | - | `200 OK`: `{ "items": [ { "messageId": "uuid", "role": "user\|assistant", "content": "string", "insufficientContext": false, "citations": [ { "sourceType": "ADR_VERSION\|SPECIFICATION\|TASK", "sourceId": "uuid", "versionId": "uuid \| null", "chunkId": "uuid", "label": "ADR-001 v1", "excerpt": "string" } ], "createdAt": "iso-utc" } ] }` | `403` (even Owner cannot access another user's session), `404` |
| `POST /chats/{sessionId}/messages` | `{ "content": "string (1..4000)", "specificationIds"?: ["uuid"] }` | `200 OK`: Assistant Message DTO with `citations` and `insufficientContext` flag | `502` (`LLM_PROVIDER_ERROR`), `429` |
| `GET /analytics` | Query: `?period=7d\|30d\|all` | `200 OK`: `{ "period": "30d", "backlogReviews": { "totalCompleted": 5, "acceptedCount": 2, "modifiedCount": 2, "rejectedCount": 1, "acceptedRatio": 0.40, "modifiedRatio": 0.40, "rejectedRatio": 0.20, "meanCorrectionsCount": 3.5, "meanActiveReviewDurationMs": 85000 \| null }, "aiOperations": { "totalCount": 18, "completedCount": 16, "failedCount": 2, "meanDurationMs": 4200, "totalTokensUsed": 48200 \| null } }` | `403` |

---

## 7. Authentication, Error Handling, and Loading UX

### 7.1 Single-Flight Silent Token Refresh Flow
To prevent race conditions when multiple TanStack Query requests simultaneously receive `401 Unauthorized` after the `15 min` access JWT expires:
1. `httpClient.ts` intercepts any `401` response (excluding `/auth/login` and `/auth/refresh`).
2. If a refresh request is not already in flight, it initiates a single `POST /api/v1/auth/refresh` promise and queues concurrent failed requests.
3. On success, `useAuthStore` updates `accessToken`, and all queued requests are retried transparently with the new `Authorization: Bearer` header.
4. On refresh failure (`401`/`403`), `useAuthStore.clearSession()` executes, the TanStack Query cache is cleared (`queryClient.clear()`), and the router redirects to `/login?reason=session_expired`.

### 7.2 Standardized Error Mapping
- **`400 Bad Request` with `fieldErrors`:** Mapped directly into React Hook Form via `setError(field, { message })` so users see validation messages next to the offending input.
- **`403 Forbidden`:** Renders an inline permission banner or redirects to `/projects` if the user was removed from the project.
- **`409 Conflict`:** Handled contextually (e.g., `TASK_DEPENDENCY_CYCLE` opens the red DAG cycle banner; `STALE_REVISION` prompts the user to reload the latest backlog revision; `STALE_CONFLICT_CHECK` enables the `Re-run conflict check` button).
- **`429 Too Many Requests` / `502` / `503` / Network Timeout:** Renders `<ErrorBanner retryable={problem.retryable} correlationId={problem.correlationId} />` without clearing user-entered form text or chat drafts.

---

## 8. Reusable UI Components & Design System

To maintain visual consistency with `Ilya_Yakubski_UX_specification.docx` and meet `NFR-UX-001`–`005`:
- **Typography & Tokens:** `Poppins` font family with explicit scale (`h1` 24px/600, `h2` 18px/600, `body` 14px/400, `caption` 12px/500).
- **Semantic Color + Icon Pairing (`NFR-UX-005`):**
  - Active navigation / selection: **Orange** (`#EA580C` on light neutral surface, contrast $> 4.5:1$).
  - Primary constructive actions (`+ New project`, `Generate`, `Approve`): **Blue** (`#2563EB`) with explicit verb labels.
  - Warnings (`possible_conflict`, `Indexing pending`, `archived`): **Amber** (`#B45309`) + `AlertTriangle` icon.
  - Errors (`DAG Cycle`, `failed`, `rejected`): **Red** (`#DC2626`) + `XCircle` icon.
  - Verified success (`no_conflict`, `synced`, `Approved & Indexed`): **Emerald** (`#047857`) + `CheckCircle2` icon.
  - Neutral / Missing context (`insufficient_context`, `N/A`): **Slate** (`#475569`) + `Info` icon.
- **Accessibility Built-In:** All modals and slide-over drawers use Radix UI `Dialog` (automatic focus trap, `aria-labelledby`, `Escape` dismissal, and focus restoration on close).

---

## 9. Frontend Testing Organization

Frontend tests are co-located by responsibility and run automatically in GitHub Actions PR CI (`DEC-15`):

| Test Type | Location | Tools | Scope & Mocking Strategy |
|---|---|---|---|
| **Unit Tests** | `src/shared/**/*.test.ts` | Vitest | Pure functions: `metricFormat` (`null` $\rightarrow$ `N/A`), `problemDetails` parser, Zod schemas, `useProjectRole` permission matrix. |
| **Component & Integration Tests** | `src/features/**/*.test.tsx` | Vitest + React Testing Library + MSW | Renders full feature pages/modals against Mock Service Worker (MSW) handlers simulating REST contracts, `401` refresh, `409` DAG cycle errors, Owner vs. Member RBAC visibility, and `N/A` analytics rendering. |
| **End-to-End (E2E) Tests** | `tests/e2e/*.spec.ts` | Playwright | Full browser execution against the Docker Compose stack (PostgreSQL + Spring Boot + FastAPI ML + Vite/Nginx) validating `AC-01`–`AC-13` and viewport responsiveness (`1920×1080`, `1280×800`, `1024×768`). |
