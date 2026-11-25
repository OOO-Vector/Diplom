import { z } from "zod";

export const taskStatuses = [
  "draft",
  "ready",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
] as const;

const itemSchema = z.object({
  id: z.string(),
  kind: z.enum(["epic", "task", "subtask"]),
  parentId: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()).default([]),
  priority: z.number().int().min(1).max(5).default(3),
  blockedBy: z.array(z.string()),
  status: z.enum(taskStatuses).default("draft"),
  githubNumber: z.number().int().positive().optional(),
  githubUrl: z.string().optional(),
  githubSync: z.enum(["pending", "synced", "failed", "unknown"]).optional(),
});
const backlogSchema = z.object({
  items: z.array(itemSchema),
  generationMs: z.number().nullable(),
  confirmed: z.boolean(),
  revision: z.string().optional(),
  specificationId: z.string().optional(),
  history: z
    .array(
      z.object({
        items: z.array(itemSchema),
        generationMs: z.number().nullable(),
        confirmed: z.boolean(),
        specificationId: z.string().optional(),
      }),
    )
    .optional(),
});

export type BacklogItem = z.infer<typeof itemSchema>;
export type Backlog = z.infer<typeof backlogSchema>;
export const emptyBacklog: Backlog = {
  items: [],
  generationMs: null,
  confirmed: false,
};
export const kindLabels = { epic: "Epic", task: "Task", subtask: "Subtask" };
export const parentKind = {
  epic: null,
  task: "epic",
  subtask: "task",
} as const;

export function readBacklog(key: string): Backlog {
  try {
    return backlogSchema.parse(JSON.parse(localStorage.getItem(key) ?? "null"));
  } catch {
    return emptyBacklog;
  }
}

export function reviseBacklog(backlog: Backlog, items: BacklogItem[]): Backlog {
  return {
    ...backlog,
    confirmed: false,
    items: items.map((item) =>
      item.githubSync === "synced" ? { ...item, githubSync: "pending" } : item,
    ),
  };
}

export function createItem(
  kind: BacklogItem["kind"],
  parentId: string | null,
  description = "",
): BacklogItem {
  return {
    id: crypto.getRandomValues(new Uint32Array(4)).join("-"),
    kind,
    parentId,
    description,
    acceptanceCriteria: [],
    priority: 3,
    title: description.replace(/\s+/g, " ").slice(0, 100),
    blockedBy: [],
    status: "draft",
  };
}

export function generateLocalDraft(text: string, documentName: string) {
  const items: BacklogItem[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let epic: BacklogItem | undefined;
  let task: BacklogItem | undefined;
  let previousSubtask: BacklogItem | undefined;
  for (const line of lines) {
    if (/^#\s+/.test(line)) {
      epic = createItem("epic", null, line.replace(/^#\s+/, ""));
      items.push(epic);
      task = previousSubtask = undefined;
      continue;
    }
    if (!epic) {
      epic = createItem("epic", null, documentName.replace(/\.[^.]+$/, ""));
      items.push(epic);
    }
    if (!task || !/^[-*•]\s+/.test(line)) {
      task = createItem("task", epic.id, line.replace(/^#+\s+|^[-*•]\s+/g, ""));
      items.push(task);
      previousSubtask = undefined;
      continue;
    }
    const subtask = createItem(
      "subtask",
      task.id,
      line.replace(/^[-*•]\s+/, ""),
    );
    if (previousSubtask) subtask.blockedBy.push(previousSubtask.id);
    items.push(subtask);
    previousSubtask = subtask;
  }
  return items;
}

export function cyclicItems(items: readonly BacklogItem[]) {
  const dependencies = new Map(items.map((item) => [item.id, item.blockedBy]));
  const indices = new Map<string, number>();
  const active = new Set<string>();
  const stack: string[] = [];
  const cycles = new Set<string>();

  function visit(id: string): number {
    const index = indices.size;
    indices.set(id, index);
    active.add(id);
    stack.push(id);
    let root = index;
    for (const next of dependencies.get(id) ?? []) {
      if (!dependencies.has(next)) continue;
      const nextIndex = indices.get(next);
      if (nextIndex === undefined) root = Math.min(root, visit(next));
      else if (active.has(next)) root = Math.min(root, nextIndex);
    }
    if (root === index) {
      const component = stack.splice(stack.lastIndexOf(id));
      for (const member of component) {
        active.delete(member);
        if (component.length > 1 || dependencies.get(member)?.includes(member))
          cycles.add(member);
      }
    }
    return root;
  }

  for (const { id } of items) {
    if (!indices.has(id)) visit(id);
  }
  return cycles;
}

export function removeBranch(items: readonly BacklogItem[], id: string) {
  const removed = new Set([id]);
  function removeChildren(parentId: string) {
    for (const item of items) {
      if (item.parentId !== parentId || removed.has(item.id)) continue;
      removed.add(item.id);
      removeChildren(item.id);
    }
  }
  removeChildren(id);
  return items
    .filter((item) => !removed.has(item.id))
    .map((item) => ({
      ...item,
      blockedBy: item.blockedBy.filter(
        (dependency) => !removed.has(dependency),
      ),
    }));
}

export const taskDraftSchema = itemSchema.extend({
  title: z.string().trim().min(1, "Enter a task title.").max(200),
  description: z.string().trim().max(8000),
  acceptanceCriteria: z.array(z.string().trim().max(1000)).max(100),
});

export function graphProblems(items: readonly BacklogItem[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const cycles = cyclicItems(items);
  const invalid = new Map<string, string>();
  for (const item of items) {
    const expected = parentKind[item.kind];
    const parent = item.parentId === null ? null : byId.get(item.parentId);
    if (expected === null ? item.parentId !== null : parent?.kind !== expected)
      invalid.set(item.id, "Invalid parent");
    if (!invalid.has(item.id) && item.blockedBy.some((id) => !byId.has(id)))
      invalid.set(item.id, "Unknown blocking task");
  }
  return { cycles, invalid };
}

export function publicationLocked(backlog: Backlog) {
  return backlog.items.some(
    ({ githubSync, githubNumber, githubUrl }) =>
      Boolean(githubNumber || githubUrl) ||
      githubSync === "synced" ||
      githubSync === "unknown" ||
      githubSync === "pending",
  );
}

export function nextTaskStatuses(
  status: BacklogItem["status"],
): readonly BacklogItem["status"][] {
  const allowed: Record<
    BacklogItem["status"],
    readonly BacklogItem["status"][]
  > = {
    draft: ["ready", "cancelled"],
    ready: ["in_progress", "draft", "cancelled"],
    in_progress: ["in_review", "ready", "cancelled"],
    in_review: ["done", "in_progress", "cancelled"],
    done: [],
    cancelled: [],
  };
  return [status, ...allowed[status]];
}

export function writeBacklog(key: string, expected: Backlog, next: Backlog) {
  const current = readBacklog(key);
  if (JSON.stringify(current) !== JSON.stringify(expected)) return null;
  const saved = {
    ...next,
    revision: crypto.getRandomValues(new Uint32Array(4)).join("-"),
  };
  localStorage.setItem(key, JSON.stringify(saved));
  return saved;
}

export function safeIssueUrl(value?: string) {
  if (!value || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  return url.origin === "https://github.com" &&
    !url.username &&
    !url.password &&
    /^\/[^/]+\/[^/]+\/issues\/\d+$/.test(url.pathname)
    ? url.href
    : undefined;
}
