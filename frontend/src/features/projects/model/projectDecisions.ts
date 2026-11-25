import { z } from "zod";
import { activeAccountId, workspaceKey } from "../../account/accountWorkspace";
import {
  receiveNotification,
  resolveRevisionNotifications,
} from "../../notifications/model/unreadNotifications";

const draftSchema = z.object({
  title: z.string(),
  rationale: z.string(),
  decision: z.string(),
});
export type ProposalDraft = z.infer<typeof draftSchema>;

const decisionSchema = draftSchema.extend({
  id: z.string(),
  status: z.enum(["proposed", "approved", "superseded", "rejected"]),
  number: z.number().int().positive().optional(),
  author: z.string().optional(),
  authorId: z.string().optional(),
  proposedAt: z.string().datetime().optional(),
  report: z
    .object({
      summary: z.string(),
      sources: z.array(z.object({ title: z.string(), excerpt: z.string() })),
    })
    .optional(),
  revisionNote: z.string().optional(),
});
export type ProjectDecision = z.infer<typeof decisionSchema>;

export type ConflictReport = {
  summary: string;
  sources: { title: string; excerpt: string }[];
};

const key = (projectId: string) =>
  workspaceKey(`team-ai.decisions:${projectId}`);
let fallbackAuthor: string | undefined;

function localAuthorId() {
  const authorKey = workspaceKey("team-ai.local-proposal-author");
  try {
    const existing = localStorage.getItem(authorKey);
    if (existing) return existing;
    const accountId = activeAccountId();
    if (accountId) {
      localStorage.setItem(authorKey, accountId);
      return accountId;
    }
    fallbackAuthor ??= crypto.getRandomValues(new Uint32Array(4)).join("-");
    localStorage.setItem(authorKey, fallbackAuthor);
  } catch {
    fallbackAuthor ??= crypto.getRandomValues(new Uint32Array(4)).join("-");
  }
  return fallbackAuthor;
}

export function canReviseProposal(
  proposal: ProjectDecision | undefined,
): proposal is ProjectDecision {
  return Boolean(
    proposal?.status === "superseded" &&
    proposal.revisionNote &&
    (proposal.authorId
      ? proposal.authorId === localAuthorId()
      : proposal.author === "You" || proposal.author === "Project Owner"),
  );
}

export function readProjectDecisions(projectId: string): ProjectDecision[] {
  try {
    const decisions = z
      .array(decisionSchema)
      .parse(JSON.parse(localStorage.getItem(key(projectId)) ?? "[]"));
    const occupied = new Set(decisions.map(({ number }) => number));
    let number = 1;
    return decisions
      .reverse()
      .map((entry) => {
        if (entry.number) return entry;
        while (occupied.has(number)) number++;
        occupied.add(number);
        return { ...entry, number };
      })
      .reverse();
  } catch {
    return [];
  }
}

export function adrNumber(number: number) {
  return `ADR-${String(number).padStart(3, "0")}`;
}

export function nextProposalNumber(proposals: readonly ProjectDecision[]) {
  return (
    proposals.reduce(
      (latest, entry) => Math.max(latest, entry.number ?? 0),
      0,
    ) + 1
  );
}

export function submitProjectProposal(
  projectId: string,
  draft: ProposalDraft,
  report: ConflictReport,
  author: string,
) {
  const proposals = readProjectDecisions(projectId);
  const entry: ProjectDecision = {
    ...draft,
    id: crypto.getRandomValues(new Uint32Array(4)).join("-"),
    title: draft.title.trim() || "Untitled proposal",
    number: nextProposalNumber(proposals),
    author,
    authorId: localAuthorId(),
    proposedAt: new Date().toISOString(),
    report,
    status: "proposed",
  };
  localStorage.setItem(key(projectId), JSON.stringify([entry, ...proposals]));
}

type ReviewStatus = Exclude<ProjectDecision["status"], "proposed">;

export function reviewProjectProposal(
  projectId: string,
  id: string,
  status: ReviewStatus,
  revisionNote?: string,
) {
  const proposals = readProjectDecisions(projectId);
  const target = proposals.find((proposal) => proposal.id === id);
  if (
    target?.status !== "proposed" ||
    (status === "superseded" && !revisionNote?.trim())
  )
    return proposals;
  const next = proposals.map((proposal) =>
    proposal.id === id
      ? { ...proposal, status, revisionNote: revisionNote?.trim() }
      : proposal,
  );
  localStorage.setItem(key(projectId), JSON.stringify(next));
  if (
    status === "superseded" &&
    canReviseProposal(next.find((proposal) => proposal.id === id))
  ) {
    receiveNotification({
      type: "revision-request",
      projectId,
      proposalId: id,
      adr: target.number ? adrNumber(target.number) : target.title,
    });
  }
  return next;
}

export function resubmitProjectProposal(
  projectId: string,
  id: string,
  draft: ProposalDraft,
  report: ConflictReport,
) {
  const proposals = readProjectDecisions(projectId);
  const target = proposals.find((proposal) => proposal.id === id);
  if (!canReviseProposal(target)) return false;

  const updated: ProjectDecision = {
    ...target,
    ...draft,
    title: draft.title.trim() || "Untitled proposal",
    report,
    status: "proposed",
    revisionNote: undefined,
  };
  localStorage.setItem(
    key(projectId),
    JSON.stringify(
      proposals.map((proposal) => (proposal.id === id ? updated : proposal)),
    ),
  );
  resolveRevisionNotifications(projectId, id);
  return true;
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export function checkProposal(
  draft: ProposalDraft,
  decisions: readonly ProjectDecision[],
): ConflictReport {
  const approved = decisions.filter(({ status }) => status === "approved");
  if (!approved.length)
    return {
      summary:
        "No active approved decisions exist in this project yet. Conflict absence cannot be verified automatically.",
      sources: [],
    };
  const proposalText = `${draft.decision}\n${draft.rationale}`;
  const replacements = [
    ...proposalText.matchAll(
      /\breplac(?:e|ing)\s+([^\n,.;]+?)\s+with\s+([^\n,.;]+?)(?=\s+(?:as|for|to|in)\s|[.,;\n]|$)/gi,
    ),
  ];
  const sources: ConflictReport["sources"] = [];
  const summaries = new Set<string>();
  for (const { title, decision } of approved) {
    for (const [, previous, replacement] of replacements) {
      if (
        !previous ||
        !replacement ||
        normalize(previous) === normalize(replacement)
      )
        continue;
      const requirement = decision
        .split(/(?<=[.!?])\s+|\n/)
        .find(
          (sentence) =>
            /\b(?:(?:must|shall)\s+(?:use|keep|retain|continue using)|(?:do not|must not|cannot)\s+(?:replace|remove)|requires?\s+(?:using|keeping|retaining))\b/i.test(
              sentence,
            ) &&
            ` ${normalize(sentence)} `.includes(` ${normalize(previous)} `) &&
            !` ${normalize(sentence)} `.includes(` ${normalize(replacement)} `),
        );
      if (!requirement) continue;
      summaries.add(
        `The proposal would replace ${previous} with ${replacement}, but the approved decision вЂњ${title}вЂќ requires retaining or using ${previous}.`,
      );
      if (
        !sources.some(
          (source) => source.title === title && source.excerpt === requirement,
        )
      )
        sources.push({ title, excerpt: requirement });
    }
  }
  if (sources.length) return { summary: [...summaries].join(" "), sources };
  const sameDecision = approved.find(
    ({ decision }) => normalize(decision) === normalize(draft.decision),
  );
  if (sameDecision)
    return {
      summary:
        "No conflicts found. The proposed decision matches an active approved decision.",
      sources: [{ title: sameDecision.title, excerpt: sameDecision.decision }],
    };
  return {
    summary:
      "Insufficient context. The active approved decisions do not provide enough evidence to verify this proposal automatically.",
    sources: [],
  };
}
