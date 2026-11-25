import { expect, it } from "vitest";
import { checkProposal, type ProjectDecision } from "./projectDecisions";

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
