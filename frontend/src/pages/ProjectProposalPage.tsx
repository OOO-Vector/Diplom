import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { LoadingSpinner } from "../shared/ui/LoadingState";
import { useAccount } from "../features/account/useAccount";
import {
  checkProposal,
  adrNumber,
  nextProposalNumber,
  canReviseProposal,
  readProjectDecisions,
  resubmitProjectProposal,
  submitProjectProposal,
  type ConflictReport,
  type ProposalDraft,
} from "../features/projects/model/projectDecisions";
import { useWorkspace } from "../features/projects/model/workspaceContext";
import "./ProjectDecisionsPage.css";

const initialSummary =
  "Not checked yet. Select “Check for conflicts” before submitting.";

export default function ProjectProposalPage() {
  const { archived } = useWorkspace();
  const { projectId = "" } = useParams();
  if (archived)
    return (
      <Navigate
        to={`/projects/${encodeURIComponent(projectId)}/decisions`}
        replace
      />
    );
  return <ProposalForm />;
}

function ProposalForm() {
  const { projectId = "", proposalId } = useParams();
  const account = useAccount();
  const navigate = useNavigate();
  const decisionsPath = `/projects/${encodeURIComponent(projectId)}/decisions`;
  const [original] = useState(() =>
    proposalId
      ? readProjectDecisions(projectId).find(({ id }) => id === proposalId)
      : undefined,
  );
  const revising = Boolean(proposalId);
  const [summary, setSummary] = useState(initialSummary);
  const [pending, setPending] = useState<ProposalDraft | null>(null);
  const [checked, setChecked] = useState<{
    draft: ProposalDraft;
    report: ConflictReport;
  } | null>(null);
  const [submitError, setSubmitError] = useState("");
  const checking = pending !== null;

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => {
      setChecked({
        draft: pending,
        report: checkProposal(pending, readProjectDecisions(projectId)),
      });
      setPending(null);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [pending, projectId]);

  function checkConflicts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (checking) return;
    const fields = new FormData(event.currentTarget);
    const draft = {
      title: String(fields.get("title") ?? "").trim(),
      rationale: String(fields.get("rationale") ?? "").trim(),
      decision: String(fields.get("decision") ?? "").trim(),
    };
    if (!draft.rationale || !draft.decision) {
      setSummary(
        "Enter a rationale and decision before checking for conflicts.",
      );
      return;
    }
    setChecked(null);
    setSubmitError("");
    setPending(draft);
  }

  function submit() {
    if (!checked || checking) return;
    try {
      if (proposalId) {
        if (
          !resubmitProjectProposal(
            projectId,
            proposalId,
            checked.draft,
            checked.report,
          )
        ) {
          setSubmitError("This proposal is no longer available for revision.");
          return;
        }
      } else
        submitProjectProposal(
          projectId,
          checked.draft,
          checked.report,
          account?.name ?? "You",
        );
      navigate(decisionsPath, { replace: true });
    } catch {
      setSubmitError("Could not save the proposal. Please try again.");
    }
  }

  if (revising && !canReviseProposal(original)) {
    return (
      <section className="project-decisions">
        <h1>Revise proposal</h1>
        <p role="alert">This proposal is no longer available for revision.</p>
        <Link to={decisionsPath}>Back to proposals and decisions</Link>
      </section>
    );
  }

  return (
    <form
      className="project-decisions project-proposal"
      aria-labelledby="project-proposal-title"
      onSubmit={checkConflicts}
      onChange={() => {
        setSummary(initialSummary);
        setChecked(null);
        setSubmitError("");
      }}
    >
      <header className="project-decisions__heading">
        <h1 id="project-proposal-title">
          <Link to={decisionsPath}>Proposals and decisions</Link>
          <span aria-hidden="true"> &gt; </span>
          {revising
            ? `Revise ${original?.number ? adrNumber(original.number) : "proposal"}`
            : "New proposal"}
        </h1>
        <div className="project-proposal__actions">
          <Link className="project-decisions__button" to={decisionsPath}>
            Cancel
          </Link>
          <button
            className="project-decisions__button"
            type="submit"
            disabled={checking}
          >
            Check for conflicts
          </button>
          <button
            className="project-decisions__button"
            type="button"
            disabled={!checked || checking}
            onClick={submit}
          >
            Submit
          </button>
        </div>
      </header>
      <div
        className="project-decisions__scroll project-proposal__fields"
        role="region"
        aria-label="Proposal fields"
        tabIndex={0}
      >
        {original?.revisionNote && (
          <div className="project-proposal__result">
            <h2>Revision requested:</h2>
            <p>{original.revisionNote}</p>
          </div>
        )}
        <div className="project-proposal__title">
          <span>
            {adrNumber(
              original?.number ??
                nextProposalNumber(readProjectDecisions(projectId)),
            )}
            :
          </span>
          <input
            name="title"
            aria-label="Proposal title"
            placeholder="Proposal title"
            defaultValue={original?.title}
            maxLength={100}
            readOnly={checking}
          />
        </div>
        <label>
          Rationale<span aria-hidden="true">:</span>
          <span className="project-proposal__textarea">
            <textarea
              name="rationale"
              rows={4}
              readOnly={checking}
              defaultValue={original?.rationale}
            />
          </span>
        </label>
        <label>
          Decision<span aria-hidden="true">:</span>
          <span className="project-proposal__textarea">
            <textarea
              name="decision"
              rows={4}
              readOnly={checking}
              defaultValue={original?.decision}
            />
          </span>
        </label>
        <h2>Conflict check summary:</h2>
        {checking ? (
          <div
            className="project-proposal__loading"
            role="status"
            aria-label="Checking for conflicts"
          >
            <LoadingSpinner />
          </div>
        ) : checked ? (
          <div className="project-proposal__result" role="status">
            <p>{checked.report.summary}</p>
            {checked.report.sources.length > 0 && (
              <>
                <p>Sources:</p>
                {checked.report.sources.map(({ title, excerpt }) => (
                  <blockquote key={`${title}:${excerpt}`}>
                    <cite>{title}</cite>
                    <p>{excerpt}</p>
                  </blockquote>
                ))}
              </>
            )}
          </div>
        ) : (
          <p role="status">{summary}</p>
        )}
        {submitError && <p role="alert">{submitError}</p>}
      </div>
    </form>
  );
}
