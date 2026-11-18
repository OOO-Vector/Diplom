**TEAM AI ORCHESTRATOR**

**UX DESIGN SPECIFICATION  
<br/>**

**CONTENTS:**

(1) Target audience and personas
(2) Information architecture and navigation scheme
(3) Key interaction scenarios (User flows and CJM)
(4) Accessibility checklist

**1\. TARGET AUDIENCE AND PERSONAS**

**1.1 Target audience and role formalization**
The system defines two core user roles with distinct responsibilities and permissions:

**Project owner (Team lead)**:
**Core responsibilities:** Manages project workspace membership, reviews and approves AI-generated task backlogs, oversees versioned architectural decisions, resolves decision conflicts, authorizes the publication of tasks to GitHub Issues.
**Access level:** Elevated permissions to approve/reject proposals, manage version transitions and view AI-operation analytics dashboards.
**Team member (Developer)**:
**Core responsibilities:** Uploads project specifications, reviews task structures, submits proposed architectural decisions, queries approved project knowledge via the Context engine, and develops features using verified tasks.
**Access level:** Standard permissions to propose decisions, edit tasks (subject to cycle validation), and use grounded contextual search.

**1.2 Key user pains and system motivations**
Derived from the analytical workflow and coordination bottlenecks, the users face the following challenges:
**Inefficient task decomposition and manual coordination**: Manually breaking down high-level requirements and transferring tasks to GitHub takes excessive time, while hidden dependency prerequisites cause unnecessary idle time and waiting among teammates.
**Fragmented project knowledge and inconsistent configuration**: Outdated local project versions or unaligned instructions lead to local build failures, configuration mismatches, and communication overhead.
**Hidden costs of AI-assisted review and oversight**: While AI helps generate intermediate artifacts, human review is burdensome, and teams traditionally lack systematic ways to record verification time, correction counts, and approval outcomes.
**Risk of undetected architectural conflicts**: Developers may propose technical changes (e.g., changing databases or frameworks) that silently violate previously agreed-upon team decisions if there is no centralized, version-controlled source of truth.

**1.3 Detailed user personas**

**Persona 1: Johnatan, the engineering Team lead (Project owner)**
**Demographic and context**: Works in IT sphere for 4 years, right now is acting as a team lead and coordinator for a small software development engineering team. Responsible for architectural alignment and project delivery schedules.
**Goals**:
Convert unstructured textual project specifications into a clean, schema-validated and dependency-safe task hierarchy.
Maintain strict human-in-the-loop oversight to ensure no unverified tasks or conflicting decisions slip into production.
Track the operational footprint and review effort of AI-assisted workflows.
**Pains**:
Frustrated by the manual overhead of creating GitHub issues and managing broken task dependency links.
Worried about approval fatigue and losing situational awareness when reviewing large volumes of AI-generated content.
**Behaviors and needs**:
Requires a robust pre-publication review gate where backlogs and dependency trees can be manually edited and validated.
Needs explicit version control over architectural decisions with the ability to record written justifications for any overrides.

**Persona 2: Richard, the software developer (Team member)**
**Demographic and context**: A developer who was hired recently and is responsible for implementing backend logic (e.g., Java/Spring Boot, database configurations, API endpoints).
**Goals**:
Quickly understand which tasks are unblocked and ready for independent execution.
Retrieve precise, source-cited project decisions (e.g., active database choice, authentication rules) without digging through scattered documentation.
Propose technical changes safely without violating existing team decisions.
**Pains**:
Suffers from build failures caused by misaligned local environment configurations and outdated instructions.
Faces uncertainty when building features due to a lack of clear acceptance criteria or hidden dependencies on other team members' modules.
**Behaviors and needs**:
Relies on the Context engine (RAG) to query approved project knowledge and receive verifiable source links rather than fabricated answers.
Needs automated conflict warnings before submitting a new technical decision proposal to catch contradictions early.

**2\. INFORMATION ARCHITECTURE AND NAVIGATION SCHEME**

**2.1 Application structure and layout architecture**
The user interface of the Team AI orchestrator follows a persistent three-tier layout structure, ensuring that project context, global workspace navigation and core feature switching remain consistently accessible across all views.

\[ App root / Main workspace layout \]
├── 1. Left sidebar (Collapsible / Project management panel)
│     ├── Workspace brand / Logo
│     ├── "Projects" section header
│     ├── "+ New project" action button
│     ├── Project search bar
│     └── Dynamic project list (Scrollable list of project items)
├── 2. Top header navigation (Contextual module bar)
│     ├── Module switcher tabs:
│     │     ├── \[TASKS\] (Backlog import, task hierarchy and DAG view)
│     │     ├── \[DECISIONS\] (Shared project memory, decision proposals and conflict
│     │     │                  resolution)
│     │     ├── \[CHAT\] (Grounded RAG assistant and uploaded documents context)
│     │     ├── \[ANALYTICS\] (AI operation metrics and audit logs)
│     │     └── \[SETTINGS\] (Project configuration, specs management and GitHub
│     │                        integration)
│     └── Right-hand utilities:
│           ├── Notifications / Mail icon (Alerts and system notifications)
│           └── User profile / Account menu (Avatar, role, account settings)
└── 3. Main content workspace area (Dynamic section views)
      ├── SCR-01: Project dashboard and member management
      ├── SCR-02: Tasks and backlog generator / DAG workspace
      ├── SCR-03: Grounded RAG assistant and document context view (Chat interface)
      ├── SCR-04: AI operation analytics dashboard
      ├── SCR-05: Project settings and GitHub integration view
      └──SCR-06: Shared project memory and decisions

**Screen and navigation map details**

| **Section ID** | **Screen name**                     | **UI access path**             | **Core responsibilities and primary transitions**                                                                                                                               | **Screen states** |                                                                                                                                                                                               |
| -------------- | ----------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SCR-01         | Project dashboard and settings      | Left sidebar project selection | General project settings, member management (adding/removing users, assigning Owner/Member roles) and workspace overview.                                                       |                   | Empty (no project selected/created), Loading, Populated member list, Error (unauthorized access).                                                                                             |
| SCR-02         | Tasks and backlog generator         | Top header \[TASKS\] tab       | Specification file upload (.txt, .pdf), AI-driven task decomposition, interactive task tree editing, dependency management and GitHub publication.                              |                   | Empty (no spec uploaded), Processing (LLM generation), Interactive preview/edit, Cycle error warning, Published.                                                                              |
| SCR-03         | Grounded RAG chat and documents     | Top header \[CHAT\] tab        | Conversational interface for querying project specifications and internal memory, alongside a document manager sidebar for uploaded specifications.                             |                   | Empty (initial chat), Streaming/Processing, Active Q&A with Source citations, Document manager panel active.                                                                                  |
| SCR-04         | AI operation analytics              | Top header \[ANALYTICS\] tab   | Audit dashboard displaying proposal processing statuses (Accepted / Modified / Rejected), review durations, and token usage metrics.                                            |                   | Loading, Populated metrics, Missing data indicator (N/A for unrecorded values).                                                                                                               |
| SCR-05         | Project settings and GitHub         | Top header \[SETTINGS\] tab    | Configuration of project parameters, GitHub repository bindings, authentication tokens, and webhook synchronization status.                                                     |                   | Unlinked state, Connected/Synced state, Auth error state, Rate limit warning.                                                                                                                 |
| SCR-06         | Shared project memory and decisions | Top header \[DECISIONS\] tab   | Viewing active/superseded architectural decisions (version history), drafting new decision proposals, running on-demand conflict checks and Owner approval/override resolution. |                   | Empty (no decisions yet), Populated (active & proposed lists), Conflict check loading, Conflict evaluation result (possible_conflict / no_conflict / insufficient_context), Indexing pending. |

**2.2 Navigation patterns and interaction hierarchy**
**Global context persistence:** The Left sidebar remains fixed for rapid switching between different projects, creating new projects or filtering through the project search bar.
**Module switching:** The top header navigation bar acts as the primary switcher for active project tools (PROJECTS, TASKS, CHAT, ANALYTICS, SETTINGS). Clicking a tab instantly updates the main workspace without losing project context.
**Optimal depth:** Key developer actions (such as switching projects or navigating to task dependencies) require $\le 2$ clicks from any location within the workspace.

**2.3 Role-based access control (RBAC visibility)**
The UI dynamically adapts based on the user's assigned role within the selected project (Owner vs. Member):

| **Feature / action**                               | **Project owner** | **Team member** | **UI behavior for unauthorized role**                                                                          |
| -------------------------------------------------- | ----------------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| Create / delete projects                           | Full access       | Full access     | Accessible to both roles in the Left sidebar.                                                                  |
| Manage project users and roles                     | Full access       | Restricted      | "Add new user" button hidden; Members can view member list only.                                               |
| Upload spec and generate backlog                   | Full access       | Full access     | Accessible to both roles.                                                                                      |
| Confirm and publish backlog to GitHub              | Full access       | Restricted      | GitHub publish action disabled with tooltip: "Requires Project owner role".                                    |
| Manage GitHub integration                          | Full access       | Restricted      | Settings fields locked for non-owners.                                                                         |
| Propose architectural decision and check conflicts | Full access       | Full access     | Accessible to both roles in \[DECISIONS\] (SCR-06).                                                            |
| Approve, reject or request revision on decisions   | Full access       | Restricted      | Approve, Reject, and Request revision controls hidden or disabled with tooltip: "Requires Project owner role". |
| Override decision conflict warning                 | Full access       | Restricted      | Override modal/action restricted exclusively to Project owner with mandatory justification input.              |

**2.4 State management and exception handling matrix**
Every module inside the three-tier layout explicitly handles four core states: Loading, Empty, Error, and Success/Populated.

**A. Empty states (Zero-data handling)**

**Project dashboard members list (SCR-01)**: When a project has no additional members, the list area displays a clean placeholder card with text: "No members added to this project yet. Click 'Add new user to the project' to invite teammates".
**RAG chat documents panel (SCR-03)**: Displays an empty state: "No specifications uploaded yet. Upload documents via Tasks or Settings to provide context to the RAG assistant".
**Shared project memory list (SCR-06):** When no architectural decisions have been proposed or approved yet, the workspace displays an empty state card: "No architectural decisions recorded in this project yet. Click '+ Propose decision' to document technical choices and build Shared project memory".

**B. Async and loading states**

**Task decomposition (SCR-02)**: Displays an animated multi-step progress bar ("Extracting text..." -> "Generating task graph..." -> "Validating DAG...") with a live generation timer.
**Global layout transition**: When switching between modules, content areas render structural skeleton loaders to maintain visual stability.
**Conflict check execution (SCR-06):** When clicking Check for conflicts, the side/inline evaluation panel displays a loading spinner/skeleton ("Retrieving approved project decisions and analyzing consistency...") before rendering the status badge.
**Embedding indexing after approval (SCR-06):** Upon Owner approval, a subtle status badge transitions from Indexing for RAG... to Approved and Indexed.

**C. Error states and exception handling**

**Cyclic dependency warning (SCR-02)**: If task dependencies introduce a circular reference, the DAG view highlights nodes in red and disables confirmation, displaying: "Cyclic dependency detected: Task #\__and #\__ block each other".
**GitHub integration error (SCR-05)**: Displays an explicit error banner in the settings view: "GitHub authentication token expired or invalid permissions. Please reconnect your repository".
**Insufficient context during conflict check (SCR-06):** When the knowledge base has no approved decisions yet, the system explicitly displays an informational badge Insufficient context ("No active approved decisions found to compare against. Conflict absence cannot be guaranteed") rather than a false No conflict green badge.
**Embedding / Indexing failure (SCR-06):** If vector indexing fails after decision approval, the decision is still saved as Approved, but displays a warning badge Indexing pending with a Retry indexing button instead of silently marking retrieval ready.

**3\. KEY INTERACTION SCENARIOS (USER FLOWS AND CJM)**

**Scenario 1: Project creation, backlog generation and GitHub publication (Based on UC-01)**
This scenario outlines how a user navigates the persistent three-tier layout to create a project, import specifications, resolve dependency errors, and publish confirmed tasks to GitHub Issues.

**Main flow:**

1. **Project initialization (Left sidebar -> SCR-01)**
**User action:** The user clicks "+ New Project" in the left sidebar, enters a project name (TeamProject_1), and presses Enter.
**System response:** The new project is persisted, automatically selected in the sidebar, and the main workspace loads the default \[PROJECTS\] dashboard overview.
**UX justification:** Keeps project switching and creation instantly accessible without cluttering the main task workspace.

2. **Specification upload and AI decomposition (\[TASKS\] tab -> SCR-02)**
**User action:** The user clicks the \[TASKS\] tab in the top header navigation bar and uploads a readable project specification file (.txt or text-layer .pdf).
**System response:** The system validates the file format, extracts the text layer, and triggers the LLM decomposition pipeline with an active multi-step loading progress bar ("Extracting text..." -> "Generating task graph..." -> "Validating DAG...") and a live timer.
**UX justification:** Separates file ingestion and task management into a dedicated module space while providing clear asynchronous feedback during LLM processing.

3. **Interactive task editing and DAG cycle validation (\[TASKS\] tab -> SCR-02)**
**User action:** The user reviews the generated Epics, tasks, subtasks, and acceptance criteria, adjusting a Blocked by dependency relationship.
**System response:** The backend validates the Directed acyclic graph (DAG). When valid, the status indicator displays DAG valid: No cycles.
**UX justification:** Combines flexible manual editing with automated mathematical checks to prevent broken task execution chains.

4. **Backlog confirmation and GitHub publication (\[TASKS\] / \[SETTINGS\] -> SCR-02 and SCR-05)**
**User action:** As a Project owner, the user clicks "Confirm" and then "Publish to GitHub" (utilizing repository credentials configured in \[SETTINGS\]).
**System response:** Confirmed local tasks are pushed to the connected GitHub repository via REST API, storing remote issue IDs and displaying clickable links.
**UX justification:** Provides a clear transition from internal orchestration to external developer tracking while maintaining strict authorization gates.

**Alternative flows and error handling:**

**Alt flow 1A - Manual task creation (No spec uploaded):** If the user skips file upload in the empty state (SCR-02), they can click "+ Create a task manually" to build the backlog hierarchy from scratch without invoking AI decomposition.
**Error 1B - Invalid file format or scanned PDF (Step 2):** If the user uploads an unsupported file type, an oversized file, or a scanned-only PDF without an extractable text layer, the system rejects the upload before LLM invocation and displays a readable inline error alert explaining the format constraints.
**Error 1C - Cyclic dependency warning (Step 3):** If a manual edit introduces a circular dependency (e.g., Task A blocks Task B and vice versa), the DAG view highlights the conflicting nodes in red, disables the "Confirm" button, and displays an explicit banner: "Cyclic dependency detected: Task #\__and #\__ block each other".
**Error 1D - GitHub integration / Auth failure (Step 4):** If the GitHub Personal access token has expired or lacks repository permissions during publication, they will see an error banner in \[SETTINGS\] (SCR-05): "GitHub authentication token expired or invalid permissions. Please reconnect your repository".

**Scenario 2: Grounded RAG chat and internal context retrieval (Based on UC-02)**
This scenario details how team members query approved project knowledge and uploaded specifications using the conversational RAG assistant while avoiding hallucinated decisions.

**Main flow:**

1. **Opening the RAG assistant (\[CHAT\] tab -> SCR-03)**
**User action:** A Team member or Project owner clicks the \[CHAT\] tab in the top header to open the conversational interface.
**System response:** The chat workspace loads, displaying historical messages alongside the Document manager sidebar listing currently indexed specifications.
**UX justification:** Provides an intuitive, conversational interface for developers to interact with project memory without manual document digging.

2. **Submitting a contextual query (\[CHAT\] tab -> SCR-03)**
**User action:** The user types a technical question in the input bar (e.g., "What is the approved database and authentication flow for this project?") and submits it.
**System response:** The UI switches to the Streaming/Processing state (displaying a typing indicator/skeleton), while the Context engine executes a project-scoped vector similarity search (pgvector) over active approved decisions and indexed documents, filtering out superseded versions (FR-CE-01).
**UX justification:** Grounds AI responses in verified, current project history rather than generic LLM assumptions or outdated files.

3. **Receiving grounded answers with source citations (\[CHAT\] tab -> SCR-03)**
**User action:** The user inspects the streamed response and clicks on an attached source badge.
**System response:** The system displays the answer accompanied by verifiable source chips linking directly to the exact specification file or approved decision version.
**UX justification:** Provides transparent, evidence-based feedback so developers can verify architectural rules instantly.

**Alternative flows and error handling:**
**Alt flow 2A - Filtering context sources (Step 2):** Before submitting a query, the user can open the Document manager panel and toggle specific uploaded specifications on or off to narrow the retrieval scope for their question.
**Error / Edge case 2C - Missing context / Insufficient evidence (Step 3):** If the user asks about a topic not covered by approved decisions or uploaded documents (e.g., payment gateways), the Context engine returns an empty retrieval set and suppresses generative guessing (FR-CE-01). The assistant explicitly states that no verified project records exist for the query and prompts the user to upload relevant documentation.
**Error 2D - LLM / Embedding provider timeout (Step 2):** If the external LLM or embedding service times out or encounters a quota error during streaming, the loading skeleton clears and an inline error message appears with a "Retry" button, preserving the user's typed prompt.

**Scenario 3: Proposing, conflict-checking, and approving an architectural decision (Based on UC-02, US-05–US-08)**
This scenario outlines how a Team member proposes a technical decision, checks it against Shared project memory for contradictions, and how the Project owner resolves conflicts and approves a new version.

**Main flow:**

1. **Opening Shared project memory (\[DECISIONS\] tab -> SCR-06)**
**User action:** A Team member or Project owner clicks the \[DECISIONS\] tab in the top header navigation bar.**System response:** The workspace loads a split or tabbed view showing Active approved decisions (with version tags like v1, v2, authors and expandable Superseded history) alongside Pending proposals and a + Propose decision button.  
**UX justification:** Separates verified team agreements from unapproved drafts while preserving full version traceability.

2. **Drafting a decision proposal and running a conflict check (SCR-06)**
**User action:** The Team member clicks + Propose decision, fills in the title (e.g., "Switch primary database to MongoDB"), rationale and proposal text and clicks Check conflicts.  
**System response:** The Context engine (FR-CE-01) retrieves only currently approved decision versions within the same project (ignoring proposed or superseded records) and evaluates consistency. The UI displays a warning card: Possible conflict detected along with clickable source links/snippets to the conflicting decision (e.g., ADR-001: PostgreSQL as primary database).**UX justification:** Surfaces architectural contradictions before submission, preventing silent overrides of team agreements.

3. **Submitting the proposal (SCR-06)**
**User action:** The Team member reviews the conflict evidence, optionally refines the rationale and clicks Submit proposal.  
**System response:** The system persists the record with status Proposed, author metadata, timestamp, and attached conflict check results, notifying the Project owner.

4. **Owner review, conflict override and version transition (SCR-06)**
**User action:** The Project owner opens the pending proposal, inspects the retrieved conflict evidence, and chooses one of three actions: Approve, Request revision or Reject. Because a Possible conflict warning is active, clicking Approve opens a confirmation dialog requiring a written Override justification. The Owner enters the justification and confirms.  
**System response:** The new decision becomes active (Approved, e.g., v2), the previously conflicting active decision is automatically marked Superseded (remaining visible in version history), and the backend indexes the new version into pgvector for future RAG chat and conflict checks.

**Alternative flows and error handling:**

**Alt flow 3A - No conflict detected (Step 2):** If the proposal aligns with existing approved decisions, the evaluation panel displays a green No conflict badge with references to the checked active decisions, allowing clean submission.  
**Alt flow 3B - Empty knowledge base / Insufficient context (Step 2):** If no approved decisions exist in the project yet, the system displays a neutral Insufficient context status rather than No conflict, preventing false confidence when the memory repository is empty.  
**Alt flow 3C - Owner requests revision or rejects (Step 4):** If the Owner clicks Request revision with a comment, the proposal stays in Revision requested status so the Member can edit and resubmit it; if Rejected, it is archived without affecting active decisions.  
**Error 3D - Unauthorized approval attempt (Step 4):** Server-side RBAC blocks any non-owner API calls to approve or override decisions; in the UI, approval buttons are hidden/disabled for Team member users.  
**Error 3E - Embedding indexing failure (Step 4):** If the embedding provider fails during post-approval indexing, the decision status updates to Approved, while an explicit Indexing pending badge with a Retry action alerts the Owner that the decision is not yet searchable in \[CHAT\].

**4\. ACCESSIBILITY CHECKLIST**
This section outlines an assessment of the Team AI orchestrator system interface regarding its adherence to fundamental accessibility and usability principles.

**1\. Text and background contrast:**
      **Status:** Compliant.
      **Implementation:** The primary interface text appears in black against a white and light gray background.

**2\. Readable fonts:**
      **Status:** Compliant.
      **Implementation:** The system utilizes Poppins font with a clear size hierarchy (headings, body text, captions and metadata).

**3\. Color independence** (Information Not Conveyed Solely by Color):
      **Status:** Compliant.
      **Implementation:** For selectable elements (like buttons in top-header and project name in the list) is used orange color; for clickable buttons with some         consequence after click (e.g. "+Add new document") is used blue color. Something connected with error can be marked with red.

**4\. Minimum touch/Click target size:**
      **Status:** Compliant.
      **Implementation:** All interactive elements (such as buttons, top-header tabs and list items) feature an interaction area big enough to prevent accidental         clicks.

**5\. Keyboard navigation support:**
      **Status:** Partially implemented (within the scope of MVP constraints).
      **Implementation:** A logical tab order (Tab Index) has been established for key UI elements, including authorization forms, chat input fields, and tab             switching.

**6\. Exception and empty state handling:**
      **Status:** Implemented.
      **Implementation:** There are present empty states, loading indicators and banners with clear instructions for handling system errors (e.g., GitHub API             errors or circular dependencies within the task graph).
