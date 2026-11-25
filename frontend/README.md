# Frontend

Team AI Orchestrator is a React and TypeScript SPA with project tasks, chat, decisions, analytics, settings, an inbox, and account screens. The SPA uses backend sessions and project access checks by default. Prototype feature data such as tasks and chat remains browser-backed. The GitHub settings screen can verify repository access through the GitHub API.

## Run locally

Use Node.js 20+ and npm. From `frontend/`:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. This starts the browser-only demo from the current terminal. Accounts and projects stay in browser storage across server restarts at the same URL. Keep the terminal open while working.

For backend integration, start PostgreSQL and Spring Boot as described in the [root setup](../README.md#local-setup). Set `APP_ALLOWED_ORIGINS=https://127.0.0.1:5173` in the backend environment before starting Spring Boot.

From `frontend/`, create a locally trusted certificate for `127.0.0.1`. For example, with mkcert installed, run the following in PowerShell. Installing the local CA may prompt for OS approval.

```powershell
New-Item -ItemType Directory -Force .cert
mkcert -install
mkcert -cert-file .cert/local.pem -key-file .cert/local-key.pem 127.0.0.1
```

Copy `.env.example` to `.env.local` and set `API_PROXY_TLS_CERT=.cert/local.pem` and `API_PROXY_TLS_KEY=.cert/local-key.pem`. Run `npm run dev:backend` and open `https://127.0.0.1:5173`. Vite proxies same-origin `/api` to `http://127.0.0.1:8080` by default. If you use `localhost` instead, include it in the certificate and use the same exact HTTPS origin in the backend setting and browser.

In backend mode, Project tasks uploads specifications to the API and reads the latest version and its extracted text from PostgreSQL. Local demo specifications remain in browser storage. GitHub repository access verification via PAT is available only in the local demo. The backend-mode screen shows GitHub App availability.

Task decomposition currently builds a local draft from headings and lines. The task editor supports Epic → optional Story → Task → Subtask. Backlog edits, revision checks, dependency checks and approval operate in browser storage until the Planning API is available. The chat uses simulated replies, Decisions uses local conflict heuristics, and Analytics reports browser activity.

To try registration, login, refresh, logout and project administration without Spring Boot, run `npm run dev:mock` and open the loopback URL shown by Vite. Use test data in this mode. The mock uses in-memory accounts, mock tokens, project metadata and memberships, all cleared when the process stops. Its refresh cookie uses `Secure`, so use loopback during development and HTTPS for a deployed backend.

The browser-only demo includes local password reset and profile editing. Its stores are separate from server-mode accounts. Backend mode has sign-in, sign-up, profile display and sign-out. Password recovery, profile edits and account deletion require backend endpoints.

`API_PROXY_TARGET` is read by the dev server. `VITE_` variables are public. API access JWTs and GitHub access tokens stay in memory. Only the backend sets the production refresh cookie. Failed logout can leave the server session active and is reported in the sign-in screen. Session storage holds only a sign-out flag for preventing automatic sign-in in that tab.

## Checks

```sh
npm run lint
npm run format:check
npm run typecheck
npm test
npm run test:coverage
npx playwright install chromium
npm run test:e2e
npm run build
npm run preview
```

`npm run test:coverage` runs unit, component and integration tests, enforces 70% line coverage and writes HTML and Cobertura reports to `coverage/` and JUnit XML to `test-results/`. Playwright starts the local demo automatically and writes its HTML report to `playwright-report/`.

For the same browser test against Spring Boot and PostgreSQL, start a disposable backend and the HTTPS frontend described above. In PowerShell, run:

```powershell
$env:E2E_BACKEND_URL = "https://127.0.0.1:5173"
npm run test:e2e
```

Use a certificate trusted by Chromium. The test registers a synthetic account and creates a project with two specification versions. See the [testing strategy](../docs/testing/testing-strategy.md#frontend-verification-implemented-in-fe) for CI and coverage scope.

Use `npm run format` to apply Prettier. Prettier checks authored files and skips the npm lockfile and generated output. TypeScript runs in strict mode. ESLint checks React Hooks, import cycles and layer boundaries. Explicit `any` is an error. Use `unknown` and narrow or validate external data. An exceptional suppression must be scoped to the affected line and explain the upstream type limitation.

`npm run build` creates `dist/`. In production, serve static assets from that directory, forward `/api` to the backend, and fall back to `index.html` for frontend paths to support direct navigation.

## Source layout

| Location                               | Responsibility                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/main.tsx`, `src/app/`             | Bootstrap, providers, routes and global error handling                                                         |
| `src/pages/`                           | Route entry points                                                                                             |
| `src/widgets/layout/`                  | Sidebar, header and workspace layout                                                                           |
| `src/features/<domain>/`               | Domain modules with `model/` for types and state, `schemas/` for validation and `api/` for endpoints as needed |
| `src/shared/ui/`, `src/shared/styles/` | UI primitives, responsive layout rules and design tokens                                                       |
| `src/shared/api/`, `src/shared/lib/`   | Shared HTTP, response validation and diagnostics                                                               |
| `tests/`, colocated `*.test.ts`        | Integration and unit tests                                                                                     |

Imports flow from app to pages and widgets, then to features and shared code. Shared code has no application-layer dependencies. See [FE-01 current architecture](../docs/frontend/frontend-architecture.md#fe-01-current-architecture) and the [UX specification](../docs/frontend/UX/UX_specification.md).

Diagnostics emit a fixed event name and, when available, an HTTP error status and validated diagnostic IDs. Error objects, URLs, request and response bodies, headers and user data are excluded from application logs.

- In local-demo mode, add `?decompositionDemo=error` to the Tasks URL before selecting a specification and starting decomposition to exercise a local failure.
- Add `?quotaDemo=1` to the GitHub settings URL to exercise the quota warning and countdown.
