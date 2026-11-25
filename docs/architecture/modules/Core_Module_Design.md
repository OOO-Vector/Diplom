# Core & Access — module design

CORE-05/06 implementation is prepared for external review. Projects and memberships use the existing 002/003 schema,
including its immediate unique Owner index and deferred exactly-one-Owner trigger; no schema/grant changes are required.

## 1. Responsibility and boundaries

Manage active accounts, authentication sessions, projects, memberships, ownership and project-scope checks. No password recovery/email verification (Should), no global admin role, invitations to unknown users or hard deletion. Project Owner is a project-scoped role, not a role embedded in a JWT. Other modules receive `CurrentUser`, `ProjectAccess.requireMember(projectId,userId)`, `requireOwner`, `requireWritableProject` and targeted identity/project read ports. They never touch Core repositories.

## 2. Existing data and migration

| Entity | Existing DB mapping / constraints | Design |
|---|---|---|
| User | `users`: id UUID, email varchar(254), password_hash text, display_name varchar(100), is_active bool, created_at/updated_at timestamptz; unique lower(email) | UUID generated server-side; trim email, case-insensitive lookup; no password trimming; DTO excludes hash |
| Project | `projects`: id UUID, name varchar(150), description text nullable, created_by FK, status active/archived, timestamps | creator immutable; role derives from membership, not created_by |
| Membership | `project_members`: PK(project_id,user_id), role owner/member, joined_at | composite ID; unique owner partial index; deferred owner check (003) at COMMIT |
| RefreshTokenFamily | migration 013, `refresh_token_families` | stable family lock row, user FK, issued/expires/revoked timestamps; expiry exactly 168 hours after login |
| RefreshSession | migration 013, `refresh_sessions` | 32-byte SHA-256 digest, family FK with fixed lifetime, issued/consumed/revoked timestamps, same-family replacement FK |

Refresh migration 013 is implemented for review; see [CORE-01 schema and locking contract](../../../database/docs/CORE-01_Refresh_Sessions.md). Two tables separate the permanent family lock/revocation record from individual token generations. User ownership is inherited through the family; copied family lifetime in each session is enforced by a composite FK. Hash uniqueness, timestamp checks, same-family replacement, one available token per family and user/family/expiry indexes are enforced. Refined least-privilege grants replace the earlier broad CRUD proposal: app_write has SELECT/INSERT and state-column UPDATE only; app_read cannot read refresh metadata/digests. No app DELETE or immutable-field UPDATE. Retain consumed/revoked rows at least until family expiry; privileged cleanup policy follows privacy review. Never amend 002/003/011. User, Project and ProjectMember use JPA; refresh persistence uses parameterized JDBC. Hibernate validates the schema without generating it. DB stores instants; timestamps are supplied by the backend Clock.

## 3. Package and service design

```text
core/
  api/             AuthController, UserController, ProjectController, MemberController, DTOs
  application/     AuthService, RefreshSessionService, ProjectService, MembershipService, ProjectAccess
  domain/          User, Project, ProjectMember, ProjectRole, ProjectStatus, RefreshSession
  persistence/     UserRepository, ProjectRepository, ProjectMemberRepository, RefreshSessionRepository
```

Security filter chain, JWT signer/decoder, CSRF adapter, ProblemDetails error mapping in infrastructure. Place Spring transaction boundaries on public application service methods. `ProjectAccess` resolves caller from trusted security principal, not request payload; read queries include actor membership or check relevant object scope. Map database constraint violations to stable API error codes without leaking SQL.

Implemented project path: `ProjectController` / `MemberController` → transactional `ProjectService` /
`MembershipService` → JPA `ProjectRepository` / `ProjectMemberRepository`. `ProjectMember.Id` maps the existing
composite primary key. `ProjectAccess` resolves a validated JWT principal and active user; project roles are read from
membership rows, never supplied in request bodies or used from JWT role claims. Member page projections select only
userId, displayName, role and joinedAt. No User entity or credential fields are serialized in project/member responses.

Mutations use READ COMMITTED and acquire the project row's pessimistic write lock before reading current membership,
role and status. Creation inserts and locks its new project row, then inserts the sole Owner in the same transaction.
Transfer demotes and explicitly flushes before promoting and flushing; membership IDs/joinedAt and createdBy are preserved.
Spring's service transaction interceptor commits before the controller receives a success response. Reads use REPEATABLE READ
to keep the authorization check, scoped count and page data on one snapshot; removal affects subsequent requests.
In-flight reads may complete against their earlier snapshot. Different projects use independent locks.

PATCH tracks property presence separately from value: omitted description is unchanged, null clears it; null name,
empty PATCH and unknown properties are rejected. Name/description lengths count Unicode code points, reject unpaired
surrogates and PostgreSQL-incompatible NUL. Project write bodies are bounded to 32 KiB before MVC parsing, including
chunked input. Archive and member DELETE accept no body. UUID path inputs require canonical hyphenated syntax.
Pagination uses fixed contract ordering, defaults 0/20, size 1–100, and never counts foreign projects or members.

## 4. Command and query contracts

| Service operation | Precondition / atomic effects |
|---|---|
| register | valid normalized email/name/password; hash outside long transaction where practical; unique insert; return safe user; duplicate mapped to 409; no auto-login |
| login | active account & valid password; generic failure; create refresh family with absolute 7-day expiry; issue 15-min JWT and cookie; no role claims |
| refresh / logout | validate CSRF & cookie; row/family lock; atomic rotation or revocation; replay revokes active family; refresh failure generic; logout idempotent |
| createProject | active user; insert project and owner membership in same transaction; commit before returning 201; deferred trigger enforces exactly one |
| listProjects / getProject | membership-only, include `myRole`, page and filter; archived still readable; foreign ID gets 404 |
| updateProject | lock project row, recheck current owner and active state; patch only name/description; null description clears; no status/creator field |
| listMembers | actor member; restricted displayName/id/role/joinedAt (email not returned by list); paginated |
| addMember | lock project, owner+active; lookup active registered account by email; new membership role member only; duplicate 409 |
| removeMember | lock project, owner+active; cannot remove owner; absent membership 404; removed access denied on following guarded operation |
| transferOwnership | lock project row first; recheck owner after lock; target another active member; demote old owner and FLUSH before promoting target; commit once; remains member, creator unchanged |
| archive | lock project + owner; status archived; repeat by owner returns current representation; no subsequent domain mutations/new jobs; pending job rechecks and terminates without new side effects where possible |

For every project mutation, establish common project-row lock before membership checks and changes (including other modules' guarded writes where race matters); avoid lock-order inversions. Transfer must avoid immediate partial unique index violation by executing demotion first; deferred trigger allows temporary zero owners inside transaction only. A failed command rolls back; no network calls while holding lock. A competing owner transfer cannot use stale role. Read checks are snapshot-based; in-flight external actions cannot be revoked retroactively, but worker rechecks before each external side effect and records already-completed outcomes. Archive is not physical deletion. Concurrent normal metadata edits use last committed valid patch in MVP; no generic PUT of stale snapshots. See API contract.

## 5. Validation and response conventions

New proposed contract choices pending frontend review: password 12–128 Unicode code points, no composition rule/trimming, UTF-8 byte cap 512; email max 254, basic syntax and trim, case-insensitive uniqueness; displayName 1–100 trimmed; project name 1–150 trimmed; description max 4000 chars nullable. Reject unknown body fields, whitespace-only names and empty PATCH. IDs UUID, UTC timestamps. Pagination page 0-based/default 20/max 100, deterministic createdAt DESC/id DESC (members joinedAt ASC/id ASC). Default project list includes active and archived, optional status filter. No registration/login distinction for nonexistent/inactive/invalid credentials at login; registration duplicate explicit (enumeration tradeoff for MVP).

Public endpoints and responses: [openapi.yaml](../../api/openapi.yaml). Authorization bearer except auth endpoints; cookie+CSRF for login/refresh/logout/register (see [Security](../Security_Design.md)). `404` conceal inaccessible project, `403` known-project role denial, `409` archive/duplicate/state conflict. Do not expose owner-only operations via UI controls as sole enforcement.

## 6. Verification gates

CORE-05/06 automated evidence is reported in Issues #18/#19 with the tested commit. Integration tests use disposable
PostgreSQL 16/pgvector and real migrations/app-role grants, signed JWTs and the actual filter chain. They cover scoped
API behavior, validation, counts/order, archive rules, create/transfer rollback and one-Owner invariants. Concurrent
transfers, removal/transfer, duplicate add and archive/write races are synchronized through held project locks and
observed PostgreSQL blocking chains, rather than sleeps or mock-only transaction simulation. The broader gates below
also include future modules and deployment checks; they are not all claimed as completed by CORE-05/06.

- Unit: password and input policy, DTO mapping, project guard, transition rules, stable error mapping.
- Integration using Testcontainers real PostgreSQL and migrations: duplicate email case variants, create rollback/no orphan, add/remove, archived mutations, ownership transfer (flush order and rollback), two competing transfers, remove-vs-transfer and archive-vs-write; assert exactly one owner after each commit. New refresh table grants and unique hash constraints; invalid/reused/expired refresh, concurrent rotate, logout; no raw token in DB/logs.
- API: OpenAPI examples and negative status codes, unauthenticated/expired token, Member→Owner-only, foreign project/nested ID, pagination and validation. Separate CSRF cookie tests incl missing/wrong header, allowed origin and preflight. Frontend mock and live smoke login → project → add member → transfer → archive.
- Done: review contract with colleague, implement changesets, pass isolated migration and test suites, link coverage evidence, update database documentation and API contract. No reported success until actual run.
