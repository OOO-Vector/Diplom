import { expect, it } from "vitest";
import {
  checkProposal,
  readProjectDecisions,
  type ProjectDecision,
} from "./projectDecisions";
import { workspaceKey } from "../../account/accountWorkspace";

it("reads legacy revision requests separately from superseded decisions", () => {
  const projectId = "legacy-decisions";
  const key = workspaceKey(`team-ai.decisions:${projectId}`);
  const decision = {
    title: "Proposal",
    rationale: "Reason",
    decision: "Decision",
    status: "superseded",
  };
  localStorage.setItem(
    key,
    JSON.stringify([
      { ...decision, id: "revision", revisionNote: "Clarify the scope." },
      { ...decision, id: "superseded" },
    ]),
  );
  try {
    expect(readProjectDecisions(projectId)).toMatchObject([
      {
        id: "revision",
        status: "revision_requested",
        revisionNote: "Clarify the scope.",
      },
      { id: "superseded", status: "superseded" },
    ]);
  } finally {
    localStorage.removeItem(key);
  }
});

it("distinguishes an explicit conflict, a matching decision and insufficient context", () => {
  const approved: ProjectDecision = {
    id: "database",
    title: "Primary Database",
    rationale: "",
    decision: "The project must use PostgreSQL as its primary database.",
    status: "approved",
  };
  const draft = { title: "", rationale: "Simplify storage.", decision: "" };
  const conflict = checkProposal(
    {
      ...draft,
      decision: "Replace PostgreSQL with MongoDB as the primary database.",
    },
    [approved],
  );
  expect(conflict.summary).toContain("replace PostgreSQL with MongoDB");
  expect(conflict.sources).toEqual([
    { title: approved.title, excerpt: approved.decision },
  ]);
  expect(
    checkProposal({ ...draft, decision: approved.decision }, [approved])
      .summary,
  ).toContain("No conflicts found.");
  expect(
    checkProposal({ ...draft, decision: "Standardize the CI pipeline." }, [
      approved,
    ]).summary,
  ).toContain("Insufficient context.");
});
