import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  graphProblems,
  nextTaskStatuses,
  publicationLocked,
  safeIssueUrl,
  kindLabels,
  removeBranch,
  reviseBacklog,
  type Backlog,
  type BacklogItem,
} from "../features/projects/model/taskBacklog";

import { BacklogDialog } from "./BacklogDialog";
import { ItemEditor } from "./BacklogItemEditor";

type Dialog =
  { mode: "create" } | { mode: "details" | "edit"; item: BacklogItem };

export function TaskBacklogWorkspace({
  backlog,
  showTree,
  canApprove,
  archived,
  saveError,
  onChange,
  openCreate,
  onCloseCreate,
}: {
  backlog: Backlog;
  showTree: boolean;
  canApprove: boolean;
  archived: boolean;
  saveError: string;
  onChange: (backlog: Backlog) => boolean;
  openCreate: boolean;
  onCloseCreate: () => void;
}) {
  const { items } = backlog;
  const locked = publicationLocked(backlog);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [publicationAttempt, setPublicationAttempt] = useState<Backlog>();
  const clickTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(clickTimer.current), []);
  const currentDialog =
    dialog ?? (!archived && openCreate ? ({ mode: "create" } as const) : null);
  const { cycles, invalid } = graphProblems(items);
  const hasGraphErrors = cycles.size > 0 || invalid.size > 0;
  const byId = new Map(items.map((item) => [item.id, item]));
  const confirmed = backlog.confirmed && !hasGraphErrors;
  const published =
    confirmed &&
    items.length > 0 &&
    items.every(({ githubSync }) => githubSync === "synced");
  const children = new Map<string | null, BacklogItem[]>();
  const numbers = new Map<string, string>();
  const counts = { epic: 0, story: 0, task: 0, subtask: 0 };
  for (const item of items) {
    counts[item.kind]++;
    const parentId =
      invalid.get(item.id) === "Invalid parent" ? null : item.parentId;
    const siblings = children.get(parentId) ?? [];
    siblings.push(item);
    children.set(parentId, siblings);
  }
  function numberBranch(parentId: string | null, prefix = "") {
    children.get(parentId)?.forEach((item, index) => {
      const number = `${prefix}${index + 1}`;
      numbers.set(item.id, number);
      numberBranch(item.id, `${number}.`);
    });
  }
  numberBranch(null);
  const cycleEntries = [...numbers].filter(([id]) => cycles.has(id));
  const dependencies = new Map(
    items.map(({ id, blockedBy }) => [id, new Set(blockedBy)]),
  );
  let cycleMessage = `DAG error: Cyclic dependency detected in ${cycleEntries.map(([, number]) => `#${number}`).join(", ")}`;
  for (const [index, [id, number]] of cycleEntries.entries()) {
    const partner = cycleEntries.find(
      ([otherId], otherIndex) =>
        otherIndex > index &&
        dependencies.get(id)?.has(otherId) &&
        dependencies.get(otherId)?.has(id),
    );
    if (partner) {
      cycleMessage = `DAG error: Task #${number} and #${partner[1]} block each other`;
      break;
    }
  }

  function close() {
    setDialog(null);
    if (openCreate) onCloseCreate();
  }

  function renderBranch(parentId: string | null): ReactNode {
    const branch = children.get(parentId);
    if (!branch?.length) return null;
    return (
      <ul className="project-tasks__branch">
        {branch.map((item) => {
          const expanded = !collapsed.has(item.id);
          const hasChildren = children.has(item.id);
          const issueUrl = safeIssueUrl(item.githubUrl);
          const blockers = item.blockedBy
            .map((id) => numbers.get(id))
            .filter(Boolean);
          return (
            <li key={item.id}>
              <div className="project-tasks__row">
                <div
                  className="project-tasks__node"
                  data-cycle={cycles.has(item.id) || invalid.has(item.id)}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      window.clearTimeout(clickTimer.current);
                      if (event.detail === 0)
                        setDialog({ mode: "details", item });
                      else if (event.detail === 1)
                        clickTimer.current = window.setTimeout(
                          () => setDialog({ mode: "details", item }),
                          500,
                        );
                    }}
                    onDoubleClick={() => {
                      window.clearTimeout(clickTimer.current);
                      if (!archived && !locked)
                        setDialog({ mode: "edit", item });
                    }}
                  >
                    <span
                      className={
                        item.kind === "subtask"
                          ? undefined
                          : "project-tasks__kind"
                      }
                    >
                      {kindLabels[item.kind]}
                    </span>{" "}
                    {numbers.get(item.id)}: {item.title}
                  </button>
                  {hasChildren && (
                    <button
                      type="button"
                      className="project-tasks__toggle"
                      aria-label={`${expanded ? "Collapse" : "Expand"} ${item.title}`}
                      aria-expanded={expanded}
                      onClick={() => {
                        setCollapsed((previous) => {
                          const next = new Set(previous);
                          if (next.has(item.id)) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        });
                      }}
                    >
                      {expanded ? "‹" : "›"}
                    </button>
                  )}
                </div>
                {invalid.has(item.id) && <small>{invalid.get(item.id)}</small>}
                {item.status !== "draft" && (
                  <small>{item.status.replaceAll("_", " ")}</small>
                )}
                {item.githubSync && <small>GitHub: {item.githubSync}</small>}
                {item.githubNumber &&
                  (issueUrl ? (
                    <a href={issueUrl} target="_blank" rel="noreferrer">
                      GH #{item.githubNumber}
                    </a>
                  ) : (
                    <small>GH #{item.githubNumber}</small>
                  ))}
                {blockers.length > 0 && (
                  <span className="project-tasks__blocked">
                    Blocked by: {blockers.join(", ")}
                  </span>
                )}
              </div>
              {expanded && renderBranch(item.id)}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <>
      {showTree && items.length > 0 && (
        <>
          <div className="project-tasks__metadata">
            <span>
              Created {counts.epic} epics,{" "}
              {counts.story > 0 && `${counts.story} stories, `}
              {counts.task} tasks, {counts.subtask} subtasks
            </span>
            <span
              className={hasGraphErrors ? "project-tasks__cycle" : undefined}
              role={hasGraphErrors ? "alert" : undefined}
            >
              {cycles.size
                ? cycleMessage
                : invalid.size
                  ? `DAG error: ${[...invalid].map(([id, message]) => `${byId.get(id)?.title}: ${message}`).join(", ")}`
                  : "DAG valid: No cycles"}
            </span>
            <span>
              {published ? "Synced with GitHub" : "Not synced with GitHub"}
            </span>
            {backlog.generationMs !== null && (
              <span>
                Local draft in {(backlog.generationMs / 1000).toFixed(3)} s
              </span>
            )}
          </div>
          {locked && (
            <p>Publication has started. Backlog structure is read-only.</p>
          )}
          <div
            className="project-tasks__tree"
            data-cycle={cycles.size > 0}
            aria-label="Project task hierarchy"
          >
            {renderBranch(null)}
          </div>
          <footer className="project-tasks__footer">
            <button
              className="project-tasks__button"
              type="button"
              data-completed={confirmed}
              disabled={
                archived ||
                !canApprove ||
                hasGraphErrors ||
                locked ||
                backlog.confirmed
              }
              onClick={() => onChange({ ...backlog, confirmed: true })}
            >
              {confirmed ? "Confirmed" : "Confirm"}
            </button>
            <button
              className="project-tasks__button"
              type="button"
              data-completed={published}
              disabled={archived || !confirmed || locked}
              title={
                !confirmed ? "Confirm the backlog before publishing" : undefined
              }
              onClick={() => setPublicationAttempt(backlog)}
            >
              {published ? "Published to GitHub" : "Publish to GitHub"}
            </button>
            {publicationAttempt === backlog && (
              <span
                className="project-tasks__publication-message"
                role="status"
              >
                A GitHub publishing connection is required.
              </span>
            )}
            {!archived && !locked && (
              <small>Double-click any task to edit its details</small>
            )}
          </footer>
        </>
      )}
      {currentDialog?.mode === "details" && (
        <BacklogDialog title={currentDialog.item.title} onClose={close}>
          {saveError && <p role="alert">{saveError}</p>}
          <p className="project-tasks__description">
            {currentDialog.item.description || "No description yet."}
          </p>
          {locked &&
            !archived &&
            (() => {
              const row = byId.get(currentDialog.item.id);
              return (
                row && (
                  <label>
                    Status
                    <select
                      value={row.status}
                      onChange={(event) => {
                        const status = nextTaskStatuses(row.status).find(
                          (value) => value === event.target.value,
                        );
                        if (status)
                          onChange({
                            ...backlog,
                            items: items.map((entry) =>
                              entry.id === row.id
                                ? { ...entry, status }
                                : entry,
                            ),
                          });
                      }}
                    >
                      {nextTaskStatuses(row.status).map((status) => (
                        <option key={status} value={status}>
                          {status.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                )
              );
            })()}
          {currentDialog.item.acceptanceCriteria.length > 0 && (
            <>
              <h3>Acceptance criteria</h3>
              <ul>
                {currentDialog.item.acceptanceCriteria.map(
                  (criterion, index) => (
                    <li key={index}>{criterion}</li>
                  ),
                )}
              </ul>
            </>
          )}
        </BacklogDialog>
      )}
      {(currentDialog?.mode === "edit" || currentDialog?.mode === "create") && (
        <ItemEditor
          item={currentDialog.mode === "edit" ? currentDialog.item : undefined}
          items={items}
          approved={confirmed}
          saveError={saveError}
          onClose={close}
          onSave={(item) => {
            if (archived || locked)
              return "This backlog is now read-only. Your edits have not been discarded.";
            if (currentDialog.mode === "edit") {
              const original = byId.get(item.id);
              if (!original)
                return "This task was removed in the latest revision. Your draft is still open.";
              const snapshot = (entry: BacklogItem) =>
                JSON.stringify({
                  ...entry,
                  blockedBy: [...entry.blockedBy].sort(),
                });
              if (snapshot(item) === snapshot(original)) {
                close();
                return null;
              }
            }
            const next: BacklogItem[] =
              currentDialog.mode === "edit"
                ? items.map((current) =>
                    current.id === item.id ? item : current,
                  )
                : [...items, item];
            if (!onChange(reviseBacklog(backlog, next))) return "";
            close();
            return null;
          }}
          onRemove={(id) => {
            if (archived || locked) return false;
            const removed = onChange(
              reviseBacklog(backlog, removeBranch(items, id)),
            );
            if (removed) close();
            return removed;
          }}
        />
      )}
    </>
  );
}
