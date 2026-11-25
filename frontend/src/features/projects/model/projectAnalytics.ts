import { z } from "zod";
import { workspaceKey } from "../../account/accountWorkspace";
import type { Backlog, BacklogItem } from "./taskBacklog";

const metricsSchema = z.object({
  proposals: z.array(
    z.object({
      items: z.array(z.string()),
      durationMs: z.number().nonnegative(),
      counts: z.object({
        epic: z.number(),
        task: z.number(),
        subtask: z.number(),
      }),
      outcome: z.enum(["pending", "accepted", "edited", "rejected"]),
    }),
  ),
  dagChecks: z.number(),
  dagCycles: z.number(),
  answers: z.object({
    count: z.number(),
    totalMs: z.number(),
    lastMs: z.number().nullable(),
  }),
});
type Metrics = z.infer<typeof metricsSchema>;
const key = (projectId: string) =>
  workspaceKey(`team-ai.analytics:${projectId}`);

export function readProjectAnalytics(projectId: string): Metrics {
  try {
    return metricsSchema.parse(
      JSON.parse(localStorage.getItem(key(projectId)) ?? "null"),
    );
  } catch {
    return {
      proposals: [],
      dagChecks: 0,
      dagCycles: 0,
      answers: { count: 0, totalMs: 0, lastMs: null },
    };
  }
}

function updateMetrics(projectId: string, update: (metrics: Metrics) => void) {
  const metrics = readProjectAnalytics(projectId);
  update(metrics);
  try {
    localStorage.setItem(key(projectId), JSON.stringify(metrics));
  } catch {
    // An unavailable metrics store must not prevent the primary operation.
  }
}

export function recordDecomposition(
  projectId: string,
  items: BacklogItem[],
  durationMs: number,
  hasCycle: boolean,
) {
  updateMetrics(projectId, (metrics) => {
    const counts = { epic: 0, task: 0, subtask: 0 };
    for (const { kind } of items) counts[kind]++;
    metrics.proposals.push({
      items: items.map(({ id }) => id),
      durationMs,
      counts,
      outcome: "pending",
    });
    metrics.dagChecks++;
    if (hasCycle) metrics.dagCycles++;
  });
}

export function recordBacklogReview(
  projectId: string,
  previous: Backlog,
  next: Backlog,
  hasCycle: boolean,
) {
  const items = new Map(next.items.map((item) => [item.id, item]));
  const previousIds = new Set(previous.items.map(({ id }) => id));
  const content = (item: BacklogItem) =>
    JSON.stringify([
      item.kind,
      item.parentId,
      item.title,
      item.description,
      item.priority,
      item.acceptanceCriteria,
      [...item.blockedBy].sort(),
    ]);
  const changed = new Set(
    previous.items
      .filter((item) => {
        const current = items.get(item.id);
        return !current || content(item) !== content(current);
      })
      .map(({ id }) => id),
  );
  const added = next.items.filter(({ id }) => !previousIds.has(id));
  const revised = changed.size > 0 || added.length > 0;
  const approved = !previous.confirmed && next.confirmed;
  if (!revised && !approved) return;

  updateMetrics(projectId, (metrics) => {
    if (revised) {
      metrics.dagChecks++;
      if (hasCycle) metrics.dagCycles++;
    }
    for (const proposal of metrics.proposals) {
      if (proposal.outcome === "rejected") continue;
      const proposalIds = new Set(proposal.items);
      if (proposal.items.every((id) => !items.has(id)))
        proposal.outcome = "rejected";
      else if (
        proposal.items.some((id) => changed.has(id)) ||
        added.some(({ parentId }) => parentId && proposalIds.has(parentId))
      )
        proposal.outcome = "edited";
      else if (approved && proposal.outcome === "pending")
        proposal.outcome = "accepted";
    }
  });
}

export function recordAnswerDurations(projectId: string, durations: number[]) {
  if (!durations.length) return;
  updateMetrics(projectId, ({ answers }) => {
    answers.count += durations.length;
    answers.totalMs += durations.reduce((sum, duration) => sum + duration, 0);
    answers.lastMs = durations.at(-1) ?? answers.lastMs;
  });
}
