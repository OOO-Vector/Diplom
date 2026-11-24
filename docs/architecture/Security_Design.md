# Security Design — Core baseline

**Version:** 0.1.3 · **Status:** CORE-04 refresh rotation, replay detection and logout implemented for external review on the merged CORE-02/03 baseline. Browser-only Origin policy and zero JWT clock skew retained.

## 1. Trust boundaries and threat model

Browser → same-origin HTTPS proxy → Java. Java → private PG, internal ML, external OpenAI/GitHub; only Java can access provider credentials. Treat user input, uploaded documents, LLM output, webhook payload and model metadata as untrusted. Actors: anonymous attacker, authenticated nonmember, malicious member, compromised browser/refresh token, unreliable/malicious external data. Threats: credential stuffing, token replay, CSRF/XSS, IDOR, privilege escalation, cross-project retrieval, injection, secrets leakage, webhook forgery, job replay and resource exhaustion.

## 2. Authentication and session protocol

- Passwords hashed with Argon2id using a maintained Spring Security implementation and random salts; initial policy 19 MiB memory, 2 iterations, parallelism 1, benchmark and raise cost if feasible; verify exact library/runtime dependency in spike. Do not log/return raw passwords or hashes. No truncation, trim or silent normalization of password.
- Access JWT (15 minutes) signed with centrally managed asymmetric RSA key (RS256 proposed, fixed allowlist, minimum 2048 bits); claims `sub` user UUID, `iss`, `aud`, `iat`, `exp`, `jti`; verify issuer/audience/signature/time, reject unexpected algorithms. Keys mounted as secrets; document rotation with overlap for existing TTL. Check active account and membership server-side; no authoritative project roles in token. Access token in frontend memory only, never local/session storage, query params or cookies. Logout revokes refresh, already-issued JWT may remain valid until expiry (≤15 min); disabled user rejected immediately at guard.
- Refresh credential: random >=256 bits, base64url opaque value; store SHA-256 digest only (high-entropy token), constant-safe verification; family absolute TTL 7 days from login (rotation never extends beyond family expiry). New login independent family. Transaction locks family via stable root/row locking; consumed/revoked/expired credentials cannot issue access. On replay of consumed token, revoke entire family and audit; ensure revocation commits before sending 401 (do not roll it back with exception). Old-token replacement link retained to distinguish replay. Network-lost rotation forces login rather than allowing unsafe reuse. Client single-flight refresh including across tabs (coordinate with Web Locks/BroadcastChannel where available; fallback re-login on replay); no automatic retry of cookie rotation. Token issuance only after successful commit.
- `refresh_token` HttpOnly, Secure, SameSite=Lax, host-only, Path=/api/v1/auth, Max-Age no longer than family expiry; clear matching attributes on logout/revoked refresh. Production never insecure. Local Vite proxy / same-origin HTTPS development recommended; if insecure localhost exception is necessary, explicit dev-only config with no real data, never remote deployment. `Cache-Control: no-store` on CSRF and auth responses.

Approved MVP JWT time policy: clock skew = 0 seconds, with no expiry grace period. Reject at `now >= exp`, reject future `iat` and future `nbf` when present, and enforce an access-token lifetime of at most 900 seconds. Signing and validation must use an injected `java.time.Clock` (UTC system clock in production, fixed clock in tests). Issuing and validating hosts must keep their clocks synchronized (for example through NTP); monitor clock drift and correct infrastructure time rather than silently widening the tolerance. This decision preserves the SRS maximum access-token validity after logout.

## 3. CSRF and CORS contract

Proposed same-origin browser flow: `GET /api/v1/auth/csrf` establishes an HttpOnly host-only `csrf_token` cookie (Secure, SameSite=Lax, Path=/api/v1/auth) and returns CSRF header token in JSON. Server validates `X-CSRF-Token` against cookie via Spring CSRF mechanism (masked token accepted by configured handler; verify with integration test), for POST register/login/refresh/logout. Re-fetch after login/logout or CSRF rejection; rotate token on auth boundary. Credentials are sent same-origin, cookie is not readable by frontend. Bearer-only project endpoints have no ambient cookie authentication; CSRF exemption limited to bearer resource endpoints, never blanket disable across cookie endpoints. No GET mutation other than issuing CSRF bootstrap cookie. Logout requires valid CSRF but may clear absent/invalid refresh and return 204; no bearer requirement.

Prefer same-origin proxy; if local separated origin is unavoidable allow only exact configured development origin, allow credentials and listed headers, never wildcard; strict origin validation for cookie-based POST, appropriate preflight, no permissive CORS in production. SameSite is defense in depth, not a substitute for CSRF. Auth responses never return refresh credential in JSON.

Approved browser-only Origin policy: POST `/api/v1/auth/register`, `/api/v1/auth/login`, `/api/v1/auth/refresh` and `/api/v1/auth/logout` require an `Origin` exactly matching a configured allowed origin (scheme, host and port). Missing Origin, the literal `null` Origin and any foreign Origin are rejected with 403, even with valid CSRF credentials. No Referer fallback or CLI exemption is provided. CORS configuration alone is insufficient: enforce this check before auth side effects and retain CSRF validation. CLI clients without Origin are intentionally unsupported by these browser endpoints; manually sending an allowed Origin does not replace cookie/CSRF requirements or prove that a client is a browser.

Use same-origin HTTPS for the supported browser flow: Secure cookies and remote deployments require HTTPS. The localhost HTTP URL in OpenAPI is not a promise that browser cookie authentication works over HTTP. Any explicit dev-only localhost exception mentioned above must preserve the Origin and CSRF checks and must never apply remotely. Return `Cache-Control: no-store` on every auth response, including Origin/CSRF failures and other errors.

## 4. Authorization and concurrency

CORE-01 persistence: migration 013 separates `refresh_token_families` (stable lock row, owner, absolute expiry and family revocation) from `refresh_sessions` (SHA-256 digest and generation state). Rotation, logout and replay commands lock the family first with `SELECT ... FOR UPDATE OF f` at READ COMMITTED, then re-read token state and check family expiry/revocation. A consumed-token replay and a current-token rotation therefore contend on the same row. App permissions exclude history deletion and identity/hash/lifetime updates; general app_read has no refresh access. See [schema, constraints, lock order and verification](../../database/docs/CORE-01_Refresh_Sessions.md). CORE-04 follows this protocol in application code without changing migrations or grants; DDL alone does not enforce it.

Refresh/logout accept no request body; nonempty bodies return 400 without session changes. Exactly one `refresh_token`
cookie is accepted, containing canonical unpadded base64url encoding of 32 bytes (43 characters). The SHA-256 input is
the ASCII wire credential, matching login issuance. Missing, duplicate, malformed, unknown, expired or revoked credentials
produce generic REFRESH_INVALID/401 on refresh, clearing both refresh and CSRF cookies; bootstrap CSRF again before login.
Successful refresh retains the CSRF cookie and rotates only the refresh credential. Logout clears both cookies and returns
204 for missing/invalid/expired/already-revoked credentials; a known family is revoked even through a consumed generation.

Each refresh/logout command owns a REQUIRES_NEW, READ COMMITTED transaction. After acquiring the family lock it re-reads
the generation in a separate SQL statement and obtains a fresh Clock instant. Rotation updates consumed_at/replacement_id
before inserting the successor with unchanged family lifetime, satisfying the partial unique index and deferred FK.
JWT signing occurs inside this transaction; no replacement cookie/token is returned before commit. Signing, SQL and
commit-time constraint failures roll back consumption/insertion and produce a generic server error, never a successful logout.
Replay returns an invalid result from the transaction rather than throwing: family revocation commits before HTTP 401.
Its structured audit event contains only event name, family UUID and the public response correlationId, and is emitted after commit.
Existing generation history is preserved; family revocation is authoritative without updating/deleting every generation.
An already-issued access JWT still follows the existing active-user/expiry policy. Disabling a user is rechecked on refresh;
family locking does not serialize an administrative account-status update, so in-flight checks remain snapshot-based.

Authenticate active user, scope `projectId` to membership, then validate object IDs against project, role and write state. Foreign resources return 404; known project permission failure 403. Archived projects read-only for all members. Owner cannot inspect another user's private chat. Only Owner sets project metadata, membership, GitHub connection, backlog/decision approval, override and archive. Both roles may publish an approved task and access common knowledge. All workers recheck actor/scope/version before side effects; signed provider webhooks map only verified connected repos (system actor, not arbitrary user). Core row locks for project-state transitions; no RLS required MVP but DB constraints do not replace per-user guards.

## 5. Security controls by boundary

| Boundary | Controls and tests |
|---|---|
| REST | strict DTO validation, reject mass assignment, body limits, consistent Problem Details, generated correlation ID, no internal stack traces, no secrets in request capture |
| Credentials | rate limit login/register/refresh (starting proposals: per-IP login 20/min and per-account 5/min; register 5/min/IP; refresh 30/min/session; tune in staging; return 429 Retry-After); avoid permanent account lockout/DoS; trusted proxy IP only |
| Browser | safe text rendering, no raw unsafe HTML, CSP and frame protections, no token in URL; enforce TLS, secure cookies and no-store |
| DB | use JPA/parameterized SQL; separate team_ai_app and team_ai_admin, limited grants, private network; encrypted/controlled backup; verify no DDL/TRUNCATE access |
| Files/AI | UTF-8 TXT/PDF text layer limits, reject malformed/oversized; no OCR; provider output schema validation, prompt injection cannot expand scope/tool privileges; redact secrets and restrict source disclosure |
| GitHub | short-lived installation token, key outside Git, verify HMAC over raw webhook body with constant-time comparison, dedupe delivery, reconcile uncertain writes |
| ML | private network; strict finite-vector schema, model/version/checksum verification; no untrusted pickle/artifact deserialization; do not expose service publicly |
| Logs | audit auth failures/replay/role changes/overrides with IDs, no sensitive payloads; retention policy TBD, no external telemetry by default |

## 6. Verification and open engineering checks

CORE-02/03 implementation: registration, login, CSRF bootstrap and `/api/v1/users/me` use the existing database schema.
Registration commits a salted Argon2id hash; duplicate `lower(email)` violations map to 409 even during concurrent inserts.
Login does one Argon2 verification for existing, inactive and unknown accounts (a random startup dummy hash for unknown accounts),
then rechecks active/hash state inside the issuance transaction. Both refresh rows and JWT signing must succeed before credentials
leave the transaction. Initial issuance uses parameterized JDBC participating in the JPA transaction and app-role grants;
CORE-04 adds the separate refresh/logout controller and the family-locking service described above.

Auth POST bodies are limited to 16 KiB before JSON parsing, including bodies without Content-Length. JSON unknown properties
and scalar type coercion are rejected. Password bounds count Unicode code points and UTF-8 bytes; unpaired surrogates are invalid.
NUL is rejected in display names because PostgreSQL text cannot store it; passwords are hashed without trimming/normalizing.
The single-instance MVP limiter uses 60-second windows: register 5/IP, login 20/IP and 5/email (including unknown accounts).
It returns 429 with Retry-After, bounds state to 10,000 keys and fails closed when full. It uses the servlet remote address,
not caller-supplied X-Forwarded-For. A reverse proxy must have an explicitly reviewed trusted-client-IP configuration;
otherwise all proxy clients share an IP budget. Limits are in-memory and reset at restart; multi-instance/shared limits require deployment work.

Refresh uses a separate bounded in-memory budget of 30 requests/60 seconds per usable family, shared across its rotations.
Unknown/malformed credentials never allocate entries; replay revocation and logout bypass this budget so saturation cannot
suppress security state changes. At 10,000 entries the oldest budget is evicted instead of globally denying unrelated families.
This protects memory and availability but may relax rate enforcement under sustained capacity pressure; it is a single-instance
MVP control, not distributed abuse protection. Failed rotation attempts after acquiring the budget also count. A 429 preserves
the current cookie and DB generation state and includes Retry-After; clients must not automatically retry a successful/lost rotation.

Keys load from externally mounted PKCS#8/X.509 PEM resources; startup rejects malformed, mismatched or <2048-bit pairs.
Issuer, audience, exact HTTPS origins and key ID are mandatory configuration (see root README). Only the configured public key
and its kid are trusted; no token-supplied key URLs are fetched. This implementation supports one signing/verification key at a time:
overlapping key-ring rotation remains an operational implementation gap, not a claimed capability. Keep clocks synchronized.
The already documented zero-skew JWT boundary is enforced against an injected Clock for issuing and validation.
HTTP auth integration is tested with MockMvc plus real PostgreSQL; deployed TLS, browser E2E, load/coverage and key rotation
are separate verification gates. Existing SET-01 evidence remains historical.

Test invalid JWT signature/issuer/audience/expiry, inactive account, duplicate email, CSRF mismatch, CORS disallowed origin, refresh concurrency/replay/expiry/logout, malformed inputs, lock race and scope/role. Validate isolation for retrieval/private chat/jobs, invalid webhook signature, AI injection, upload limits, rate limits, secret scans and clean DB grants. All defined access cases must reject; target ≥70% core backend line coverage (see SRS). No security certification is claimed. Confirm exact Spring Security JWT/Argon2/CSRF libraries through implementation spike; API key/model access, retention/privacy/provider terms, production domains/TLS/backup restore remain validation gates. Detailed QA cases by colleague.
