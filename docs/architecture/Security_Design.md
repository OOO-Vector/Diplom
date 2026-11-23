# Security Design — Core baseline

**Version:** 0.1.0 · **Status:** proposed detail based on DEC-02/03/04/16; peer review required

## 1. Trust boundaries and threat model

Browser → same-origin HTTPS proxy → Java. Java → private PG, internal ML, external OpenAI/GitHub; only Java can access provider credentials. Treat user input, uploaded documents, LLM output, webhook payload and model metadata as untrusted. Actors: anonymous attacker, authenticated nonmember, malicious member, compromised browser/refresh token, unreliable/malicious external data. Threats: credential stuffing, token replay, CSRF/XSS, IDOR, privilege escalation, cross-project retrieval, injection, secrets leakage, webhook forgery, job replay and resource exhaustion.

## 2. Authentication and session protocol

- Passwords hashed with Argon2id using a maintained Spring Security implementation and random salts; initial policy 19 MiB memory, 2 iterations, parallelism 1, benchmark and raise cost if feasible; verify exact library/runtime dependency in spike. Do not log/return raw passwords or hashes. No truncation, trim or silent normalization of password.
- Access JWT (15 minutes) signed with centrally managed asymmetric RSA key (RS256 proposed, fixed allowlist, minimum 2048 bits); claims `sub` user UUID, `iss`, `aud`, `iat`, `exp`, `jti`; verify issuer/audience/signature/time, reject unexpected algorithms. Keys mounted as secrets; document rotation with overlap for existing TTL. Check active account and membership server-side; no authoritative project roles in token. Access token in frontend memory only, never local/session storage, query params or cookies. Logout revokes refresh, already-issued JWT may remain valid until expiry (≤15 min); disabled user rejected immediately at guard.
- Refresh credential: random >=256 bits, base64url opaque value; store SHA-256 digest only (high-entropy token), constant-safe verification; family absolute TTL 7 days from login (rotation never extends beyond family expiry). New login independent family. Transaction locks family via stable root/row locking; consumed/revoked/expired credentials cannot issue access. On replay of consumed token, revoke entire family and audit; ensure revocation commits before sending 401 (do not roll it back with exception). Old-token replacement link retained to distinguish replay. Network-lost rotation forces login rather than allowing unsafe reuse. Client single-flight refresh including across tabs (coordinate with Web Locks/BroadcastChannel where available; fallback re-login on replay); no automatic retry of cookie rotation. Token issuance only after successful commit.
- `refresh_token` HttpOnly, Secure, SameSite=Lax, host-only, Path=/api/v1/auth, Max-Age no longer than family expiry; clear matching attributes on logout/revoked refresh. Production never insecure. Local Vite proxy / same-origin HTTPS development recommended; if insecure localhost exception is necessary, explicit dev-only config with no real data, never remote deployment. `Cache-Control: no-store` on CSRF and auth responses.

## 3. CSRF and CORS contract

Proposed same-origin browser flow: `GET /api/v1/auth/csrf` establishes an HttpOnly host-only `csrf_token` cookie (Secure, SameSite=Lax, Path=/api/v1/auth) and returns CSRF header token in JSON. Server validates `X-CSRF-Token` against cookie via Spring CSRF mechanism (masked token accepted by configured handler; verify with integration test), for POST register/login/refresh/logout. Re-fetch after login/logout or CSRF rejection; rotate token on auth boundary. Credentials are sent same-origin, cookie is not readable by frontend. Bearer-only project endpoints have no ambient cookie authentication; CSRF exemption limited to bearer resource endpoints, never blanket disable across cookie endpoints. No GET mutation other than issuing CSRF bootstrap cookie. Logout requires valid CSRF but may clear absent/invalid refresh and return 204; no bearer requirement.

Prefer same-origin proxy; if local separated origin is unavoidable allow only exact configured development origin, allow credentials and listed headers, never wildcard; strict origin validation for cookie-based POST, appropriate preflight, no permissive CORS in production. SameSite is defense in depth, not a substitute for CSRF. Auth responses never return refresh credential in JSON.

## 4. Authorization and concurrency

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

Test invalid JWT signature/issuer/audience/expiry, inactive account, duplicate email, CSRF mismatch, CORS disallowed origin, refresh concurrency/replay/expiry/logout, malformed inputs, lock race and scope/role. Validate isolation for retrieval/private chat/jobs, invalid webhook signature, AI injection, upload limits, rate limits, secret scans and clean DB grants. All defined access cases must reject; target ≥70% core backend line coverage (see SRS). No security certification is claimed. Confirm exact Spring Security JWT/Argon2/CSRF libraries through implementation spike; API key/model access, retention/privacy/provider terms, production domains/TLS/backup restore remain validation gates. Detailed QA cases by colleague.
