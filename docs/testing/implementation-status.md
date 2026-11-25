# Automated testing: implemented status and coverage evidence

> This status supplement is authoritative for what the current `FE` branch actually runs. The broader scenarios in `testing-strategy.md` are targets unless they are listed below as implemented and wired into CI.

## Checks implemented and executed in CI

| Area | Implemented on `FE` | CI evidence |
|---|---|---|
| Frontend static checks and build | ESLint and production build/typecheck | `Frontend quality` runs `npm run lint` and `npm run build` on pushes to `FE` and pull requests to `develop`. |
| Frontend unit/component/feature tests | Vitest and React Testing Library; tests include UI flows, validation and state behavior | `npm run test:coverage`; the 70% line threshold blocks a failed job. |
| Frontend browser E2E | One Playwright Chromium flow: account registration, project creation, two specification uploads, reload and sign-out/session check | `npm run test:e2e` runs in CI against the local-demo Vite server. This is not a full-stack/backend E2E test. |
| Backend tests and quality gates | JUnit tests, API/contract checks, security spike, PostgreSQL/Testcontainers schema/migration tests, OpenAPI validation and JaCoCo verification | `Backend quality` runs these Gradle tasks on pushes to `FE` and pull requests to `develop`. |
| Database integrity | SQL integrity scripts are invoked as part of the backend schema test suite | Logs/reports are included in the backend artifact when generated. |

Both workflows upload generated reports and test evidence as run-specific GitHub Actions artifacts for 14 days, including frontend coverage/JUnit/Playwright output and backend JaCoCo/JUnit/contract/SQL-integrity output. Upload is configured to run even when verification fails, so available failure reports are retained.

## Coverage: metric and exact scope

Coverage values are generated from each CI run; do not copy a previous run's percentage into this document as if it were current. The workflow run summary displays covered lines, total lines and percentage, and the matching artifact contains the detailed report. Cite the run URL and its commit SHA when presenting a coverage result in the diploma report.

- **Frontend:** `@vitest/coverage-v8` measures the included `frontend/src/**/*.ts` and `frontend/src/**/*.tsx` files. The line threshold is 70% for that configured frontend source scope. The `Frontend quality` run summary prints the exact count and percentage from `coverage/coverage-summary.json`; the HTML, JSON summary and Cobertura output are uploaded.
- **Backend:** JaCoCo's blocking 70% line threshold applies **only to compiled classes under `com/teamai/orchestrator/core/**`**. It does not assert 70% for all backend classes. The CI summary prints covered/total line counts and percentage for that Core scope separately from the overall JaCoCo report total; the overall figure is informational, not the threshold. The uploaded JaCoCo HTML/XML reports are the detailed evidence.
- Coverage generated from separate `securitySpike` and `schemaTest` tasks is not counted toward the backend Core gate; the gate uses the regular `test` execution data.

## Planned or not yet demonstrated by the current CI

The following items in the broader strategy are future targets or known gaps, not evidence of implemented CI tests on this branch:

- Python ML service tests and coverage (`pytest`, `coverage.py`), model/feature tests and ML holdout evaluation.
- Full-stack Playwright against the deployed Spring Boot + PostgreSQL stack, including real API-backed browser session and specification upload. The current CI Playwright scenario uses local demo mode.
- Planned end-to-end journeys for AI decomposition, GitHub publishing/webhooks, conflict detection/RAG, analytics polling and multi-service workflows.
- Automated accessibility checks (for example axe-core) and a documented load/performance test gate.
- MSW-based frontend service simulation; current frontend feature tests use the fixtures/mocks described in the implementation docs.

## Evidence

## Frontend 

For commit 8c2af7b automated tests via GitHub Actions showed:

 Test Files  11 passed (11)
      Tests  49 passed (49)
   Start at  18:28:28
   Duration  9.56s (transform 410ms, setup 34ms, collect 1.33s, tests 3.91s, environment 2.04s, prepare 452ms)

JUNIT report written to /home/runner/work/Diplom/Diplom/frontend/test-results/vitest.xml
 % Coverage report from v8
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
-------------------|---------|----------|---------|---------|-------------------
All files          |   87.22 |    78.77 |   83.28 |   87.22 |                   
 src               |       0 |        0 |       0 |       0 |                   
  main.tsx         |       0 |        0 |       0 |       0 | 1-16              
 src/app           |    93.1 |     93.1 |      50 |    93.1 |                   
  App.tsx          |     100 |      100 |     100 |     100 |                   
  ...rBoundary.tsx |   71.42 |    66.66 |      50 |   71.42 | 13-14,17-18       
  RouteError.tsx   |   28.57 |      100 |       0 |   28.57 | 6-11              
  router.tsx       |   99.01 |    95.45 |     100 |   99.01 | 78                
 ...atures/account |   93.66 |    74.56 |   94.23 |   93.66 |                   
  ...tWorkspace.ts |     100 |      100 |     100 |     100 |                   
  authApi.ts       |   91.66 |       75 |   71.42 |   91.66 | 28-30,67,73,75    
  authSession.ts   |   91.84 |    75.32 |     100 |   91.84 | ...24-126,204-205 
  localAccount.ts  |   94.78 |    65.67 |   95.65 |   94.78 | ...75-176,199-200 
  useAccount.ts    |     100 |      100 |     100 |     100 |                   
 ...ications/model |   87.61 |    72.72 |      90 |   87.61 |                   
  ...ifications.ts |   87.61 |    72.72 |      90 |   87.61 | ...1,76-82,98,128 
 ...s/projects/api |   93.42 |       75 |     100 |   93.42 |                   
  ...Repository.ts |      80 |       50 |     100 |      80 | 9-10,24-26        
  ...cationsApi.ts |     100 |     87.5 |     100 |     100 | 26                
 ...projects/model |   88.09 |    84.55 |   80.82 |   88.09 |                   
  hasPdfText.ts    |   94.44 |     62.5 |     100 |   94.44 | 33-34             
  ...tAnalytics.ts |   99.18 |    93.33 |     100 |   99.18 | 53                
  projectApi.ts    |   40.54 |       50 |      20 |   40.54 | ...10-115,118-128 
  ...tDecisions.ts |   94.27 |    77.77 |     100 |   94.27 | ...67,82-84,88-89 
  ...tDocuments.ts |   97.46 |    93.33 |   81.48 |   97.46 | 97-99,178-180     
  ...ctSections.ts |     100 |      100 |     100 |     100 |                   
  taskBacklog.ts   |   88.57 |    82.25 |   91.66 |   88.57 | ...78-195,262-268 
  ...skDocument.ts |   84.21 |     82.6 |     100 |   84.21 | 31-38,57          
  ...aceContext.ts |     100 |      100 |     100 |     100 |                   
 src/pages         |   85.47 |    75.97 |   83.21 |   85.47 |                   
  ...ccessPage.tsx |   71.59 |    72.52 |     100 |   71.59 | ...35-237,259-261 
  ...logDialog.tsx |    90.9 |       60 |      50 |    90.9 | 27-29             
  ...temEditor.tsx |   76.06 |    71.42 |   63.63 |   76.06 | ...14-216,227-230 
  ...nProgress.tsx |     100 |    95.23 |     100 |     100 | 26                
  ...ncyEditor.tsx |     100 |      100 |     100 |     100 |                   
  InboxPage.tsx    |   97.82 |    66.66 |     100 |   97.82 | 61                
  NotFoundPage.tsx |     100 |      100 |     100 |     100 |                   
  ProfilePage.tsx  |    85.2 |    77.41 |   73.33 |    85.2 | ...37-140,272-274 
  ...yticsPage.tsx |   96.61 |    47.36 |     100 |   96.61 | 35,89-91          
  ...tChatPage.tsx |    93.7 |    80.23 |   91.66 |    93.7 | ...71-474,583-588 
  ...sionsPage.tsx |    94.6 |    68.42 |   81.81 |    94.6 | ...13,271,281-283 
  ...itHubPage.tsx |   89.71 |    76.25 |     100 |   89.71 | ...72,174-177,242 
  ...posalPage.tsx |    85.5 |    68.18 |     100 |    85.5 | ...16-123,229-237 
  ...ctionPage.tsx |       0 |        0 |       0 |       0 | 1-9               
  ...tingsPage.tsx |   13.51 |       50 |      50 |   13.51 | 32-142            
  ...TasksPage.tsx |   86.63 |    72.65 |     100 |   86.63 | ...88,392,402-405 
  ...rsContent.tsx |     100 |      100 |     100 |     100 |                   
  ...UsersPage.tsx |   90.32 |    69.69 |     100 |   90.32 | ...,90-92,155-157 
  ProjectsPage.tsx |    87.5 |    63.15 |   33.33 |    87.5 | 27,31-39,91,95    
  ...ctMembers.tsx |   75.92 |    66.66 |      50 |   75.92 | ...20,146,179-184 
  ...ionUpload.tsx |     100 |      100 |     100 |     100 |                   
  ...Workspace.tsx |   90.06 |    88.69 |    92.3 |   90.06 | ...50-352,365-371 
 src/shared/api    |   91.72 |       90 |   85.71 |   91.72 |                   
  httpClient.ts    |    77.5 |      100 |   66.66 |    77.5 | 27-35             
  ...lemDetails.ts |     100 |      100 |     100 |     100 |                   
  requestApi.ts    |   97.26 |     87.8 |     100 |   97.26 | 42,47             
 src/shared/lib    |     100 |      100 |     100 |     100 |                   
  logger.ts        |     100 |      100 |     100 |     100 |                   
 src/shared/ui     |   68.49 |    53.84 |   66.66 |   68.49 |                   
  ApiFeedback.tsx  |      80 |       25 |     100 |      80 | 18-19,26,29-31    
  Button.tsx       |   15.38 |      100 |       0 |   15.38 | 4-15              
  FailureState.tsx |   22.22 |      100 |       0 |   22.22 | 5-12              
  LoadingState.tsx |     100 |      100 |     100 |     100 |                   
  Panel.tsx        |     100 |      100 |     100 |     100 |                   
 ...widgets/layout |   91.35 |    88.05 |      76 |   91.35 |                   
  AppShell.tsx     |      77 |     87.3 |      50 |      77 | ...32-238,243-249 
  ChatSidebar.tsx  |    98.3 |    72.22 |      75 |    98.3 | 92-93             
  Header.tsx       |     100 |      100 |     100 |     100 |                   
  Sidebar.tsx      |     100 |    89.28 |     100 |     100 | 37,42,123         
  ...barSearch.tsx |     100 |      100 |     100 |     100 |                   
-------------------|---------|----------|---------|---------|-------------------

## Backend

For commit 8c2af7b automated tests via GitHub Actions showed (see report zip -> reports -> jacoco -> test -> html -> index.html

orchestrator

------------------------------------------------|--------|--------------|------|--------|----------|------|--------|------|--------|-------|--------|---------|--------|---------|
Element                                         | Missed | Instructions | Cov. | Missed | Branches | Cov.	| Missed | Cxty	| Missed | Lines | Missed	| Methods | Missed | Classes |
                                                |        |              |      |        |          |      |        |      |        |       |        |         |        |         |
com.teamai.orchestrator.infrastructure.security	| 123    | 1,478	      | 92%	 | 27     | 93	     | 77%	| 34     | 161  | 14	   | 238	 | 10	    | 101	    | 0	     | 22      |
com.teamai.orchestrator.planning.application	  | 37     | 680	        | 94%	 | 25     | 89	     | 78%  |	26	   | 84	  | 5	     | 106	 | 2	    | 27	    | 0	     | 4       |
com.teamai.orchestrator.core.application	      | 23     | 1,136	      | 98%	 | 3      | 79	     | 96%	| 5	     | 98	  | 5	     | 164	 | 2	    | 57	    | 0	     | 11      |
com.teamai.orchestrator.core.domain	            | 23     | 190	        | 89%	 | 3      | 5	       | 62%	| 6	     | 39	  | 3	     | 48	   | 3	    | 35	    | 0      | 4       |
com.teamai.orchestrator.core.api	              | 14     | 738	        | 98%	 | 7      | 49 	     | 87%	| 10	   | 83	  | 3	     | 105	 | 3 	    | 55	    | 0	     | 17      |
com.teamai.orchestrator.core.persistence	      | 278	   |              | 97%	 | 2      | 4	       | 66%	| 2	     | 14	  | 0	     | 27	   | 0	    | 11	    | 0	     | 3       |
com.teamai.orchestrator		                      |        |              | 37%	 |	      |          | n/a	| 1	     | 2	  | 2	     | 3	   | 1	    | 2	      | 0	     | 1       |
com.teamai.orchestrator.planning.api	          | 194	   |              | 98%	 | 3      | 13	     | 81%	| 3	     | 16	  | 0	     | 25	   | 0	    | 8 	    | 0	     | 2       |
com.teamai.orchestrator.planning.persistence	  | 188	   |              | 100% |		    |          | n/a	| 0	     | 10	  | 0	     | 16	   | 0	    | 10 	    | 0 	   | 1       |
Total	                                          | 235 of 5,120	        | 95%	 | 70 of 402	       | 82%	| 87	   | 507	| 32	   | 732	 | 21   	| 306	    | 0	     | 65      |
 - ---------------------------------------------|-----------------------|------|-------------------|------|--------|------|--------|-------|--------|---------|--------|---------|
Created with JaCoCo 0.8.14.202510111229
