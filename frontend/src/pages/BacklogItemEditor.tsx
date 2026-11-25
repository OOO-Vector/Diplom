import { useState, type FormEvent } from "react";

import {
  createItem,
  kindLabels,
  nextTaskStatuses,
  parentKind,
  taskDraftSchema,
  taskStatuses,
  type BacklogItem,
} from "../features/projects/model/taskBacklog";
import { DependencyEditor } from "./DependencyEditor";
import { BacklogDialog } from "./BacklogDialog";
export function ItemEditor({
  item,
  items,
  onSave,
  onRemove,
  onClose,
  approved,
  saveError,
}: {
  item?: BacklogItem;
  items: BacklogItem[];
  onSave: (item: BacklogItem) => string | null;
  onRemove: (id: string) => boolean;
  onClose: () => void;
  approved: boolean;
  saveError: string;
}) {
  const [draft, setDraft] = useState(() => item ?? createItem("epic", null));
  const [failure, setFailure] = useState("");
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const parents = items.filter(({ kind }) => kind === parentKind[draft.kind]);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = taskDraftSchema.safeParse({
      ...draft,
      acceptanceCriteria: draft.acceptanceCriteria
        .map((line) => line.trim())
        .filter(Boolean),
    });
    if (!parsed.success) {
      setFailure(parsed.error.issues[0]?.message ?? "Check the task fields.");
      return;
    }
    if (
      draft.kind !== "epic" &&
      !parents.some(({ id }) => id === draft.parentId)
    ) {
      setFailure("Select a valid parent.");
      return;
    }
    const error = onSave(parsed.data);
    if (error !== null) {
      setFailure(error);
    }
  }
  return (
    <BacklogDialog
      title={
        item
          ? `Edit ${kindLabels[item.kind].toLowerCase()}`
          : "Create a task manually"
      }
      onClose={onClose}
    >
      <form
        onSubmit={save}
        className="project-tasks__editor"
        onChange={() => setFailure("")}
      >
        {approved && (
          <p>
            Saving changes revokes approval. The Owner must confirm the updated
            backlog.
          </p>
        )}
        {(failure || saveError) && <p role="alert">{failure || saveError}</p>}
        {saveError && item && items.find(({ id }) => id === item.id) && (
          <details>
            <summary>Latest saved task</summary>
            {items
              .filter(({ id }) => id === item.id)
              .map((current) => (
                <div key={current.id}>
                  <strong>{current.title}</strong>
                  <p>{current.description}</p>
                  <p>Status: {current.status.replaceAll("_", " ")}</p>
                  <p>
                    Blocked by:{" "}
                    {current.blockedBy
                      .map(
                        (id) =>
                          items.find((entry) => entry.id === id)?.title ?? id,
                      )
                      .join(", ") || "None"}
                  </p>
                </div>
              ))}
          </details>
        )}
        {!item && (
          <label>
            Type
            <select
              value={draft.kind}
              onChange={(event) => {
                const kind = event.target.value as BacklogItem["kind"];
                setDraft({ ...draft, kind, parentId: null });
              }}
            >
              <option value="epic">Epic</option>
              <option
                value="task"
                disabled={!items.some(({ kind }) => kind === "epic")}
              >
                Task
              </option>
              <option
                value="subtask"
                disabled={!items.some(({ kind }) => kind === "task")}
              >
                Subtask
              </option>
            </select>
          </label>
        )}
        <label>
          Title
          <input
            maxLength={200}
            autoFocus
            required
            value={draft.title}
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value })
            }
          />
        </label>
        <label>
          Acceptance criteria (one per line)
          <textarea
            rows={3}
            value={draft.acceptanceCriteria.join("\n")}
            onChange={(event) =>
              setDraft({
                ...draft,
                acceptanceCriteria: event.target.value.split("\n"),
              })
            }
          />
        </label>
        <label>
          Description
          <textarea
            maxLength={8000}
            rows={5}
            value={draft.description}
            onChange={(event) =>
              setDraft({ ...draft, description: event.target.value })
            }
          />
        </label>
        <label>
          Status
          <select
            value={draft.status}
            onChange={(event) => {
              const status = taskStatuses.find(
                (value) => value === event.target.value,
              );
              if (status) setDraft({ ...draft, status });
            }}
          >
            {nextTaskStatuses(item?.status ?? "draft").map((status) => (
              <option key={status} value={status}>
                {status.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        {draft.kind !== "epic" && (
          <label>
            Parent
            <select
              required
              value={draft.parentId ?? ""}
              onChange={(event) =>
                setDraft({ ...draft, parentId: event.target.value || null })
              }
            >
              <option value="">Select parent</option>
              {parents.map(({ id, title }) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
          </label>
        )}
        <DependencyEditor
          items={items}
          draft={draft}
          onChange={(blockedBy) => setDraft({ ...draft, blockedBy })}
        />
        {confirmRemoval && (
          <p role="alert">
            Delete this item, its children and their dependency links?
          </p>
        )}
        <footer>
          <button className="project-tasks__button" type="submit">
            Save
          </button>
          {item && (
            <button
              className="project-tasks__delete"
              type="button"
              onClick={() => {
                if (confirmRemoval) {
                  onRemove(item.id);
                } else setConfirmRemoval(true);
              }}
            >
              {confirmRemoval ? "Confirm delete" : "Delete"}
            </button>
          )}
        </footer>
      </form>
    </BacklogDialog>
  );
}
