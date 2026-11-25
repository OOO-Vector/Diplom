import { useWorkspace } from "../features/projects/model/workspaceContext";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  adrNumber,
  canReviseProposal,
  readProjectDecisions,
  reviewProjectProposal,
  type ProjectDecision,
  type ReviewStatus,
} from "../features/projects/model/projectDecisions";
import "./ProjectDecisionsPage.css";

const filters = [
  { value: "all", label: "All" },
  { value: "approved", label: "Active approved" },
  { value: "proposed", label: "Proposed" },
  { value: "revision_requested", label: "Revision requested" },
  { value: "superseded", label: "Superseded" },
] as const;

type Filter = (typeof filters)[number]["value"];
const statusLabels = {
  proposed: "Proposed",
  approved: "Approved",
  revision_requested: "Revision requested",
  superseded: "Superseded",
  rejected: "Rejected",
};
const proposalDate = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

function RevisionDialog({
  title,
  error,
  onClose,
  onSubmit,
}: {
  title: string;
  error: string;
  onClose: () => void;
  onSubmit: (note: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal?.();
    if (element && !element.open) element.open = true;
    return () => {
      if (element?.open) element.close?.();
    };
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(
      new FormData(event.currentTarget).get("note") ?? "",
    ).trim();
    if (note) onSubmit(note);
  }

  return (
    <dialog
      ref={dialog}
      className="project-decisions__revision"
      aria-labelledby="revision-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form onSubmit={submit}>
        <h2 id="revision-title">Request revision</h2>
        <p>{title}</p>
        <label>
          What needs to change?
          <textarea name="note" rows={4} required autoFocus />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="project-proposal__actions">
          <button
            className="project-decisions__button"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="project-decisions__button" type="submit">
            Send revision request
          </button>
        </div>
      </form>
    </dialog>
  );
}

export default function ProjectDecisionsPage() {
  const { projectId = "" } = useParams();
  const { archived, isProjectOwner } = useWorkspace();
  const [decisions, setDecisions] = useState<readonly ProjectDecision[]>(() =>
    readProjectDecisions(projectId),
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [revision, setRevision] = useState<ProjectDecision | null>(null);
  const [error, setError] = useState("");
  const visible =
    filter === "all"
      ? decisions
      : decisions.filter(({ status }) => status === filter);

  function review(
    id: string,
    status: ReviewStatus,
    note?: string,
  ) {
    if (archived || !isProjectOwner) return;
    try {
      setDecisions(reviewProjectProposal(projectId, id, status, note));
      setError("");
      setRevision(null);
    } catch {
      setError("Could not update this proposal. Please try again.");
    }
  }

  return (
    <section
      className="project-decisions"
      data-empty={decisions.length === 0}
      aria-labelledby="project-decisions-title"
    >
      <header className="project-decisions__heading">
        <h1 id="project-decisions-title">Proposals and decisions</h1>
        <div
          className="project-decisions__filters"
          role="group"
          aria-label="Filter decisions by status"
        >
          {filters.map(({ value, label }) => (
            <button
              type="button"
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {!archived && (
          <Link
            className="project-decisions__create project-decisions__button"
            to="new"
          >
            <span aria-hidden="true">+</span>
            Create a proposal
          </Link>
        )}
      </header>
      {error && !revision && <p role="alert">{error}</p>}
      <div
        className="project-decisions__scroll"
        role="region"
        aria-label="Proposals and decisions list"
        tabIndex={0}
      >
        {visible.length ? (
          <ul className="project-decisions__list">
            {visible.map((entry) => {
              const {
                id,
                title,
                status,
                number,
                author,
                proposedAt,
                rationale,
                decision,
                report,
                revisionNote,
              } = entry;
              const canReview =
                !archived && isProjectOwner && status === "proposed";
              return (
                <li key={id} className="project-decisions__card">
                  <div className="project-decisions__card-heading">
                    <h2>
                      {number ? `${adrNumber(number)}: ` : ""}
                      {title}
                    </h2>
                    <span>{statusLabels[status]}</span>
                    <span>
                      Proposed by {author ?? "Unknown author"}
                      {proposedAt && (
                        <>
                          {" "}
                          on{" "}
                          <time dateTime={proposedAt}>
                            {proposalDate.format(new Date(proposedAt))}
                          </time>
                        </>
                      )}
                    </span>
                  </div>
                  <dl>
                    <dt>Rationale:</dt>
                    <dd>{rationale}</dd>
                    <dt>Decision:</dt>
                    <dd>{decision}</dd>
                    <dt>Local conflict check summary:</dt>
                    <dd>
                      {report?.summary ?? "—"}
                      {report?.sources.map(({ title, excerpt }) => (
                        <blockquote key={`${title}:${excerpt}`}>
                          <cite>{title}</cite>
                          <p>{excerpt}</p>
                        </blockquote>
                      ))}
                    </dd>
                    {status === "revision_requested" && revisionNote && (
                      <>
                        <dt>Revision requested:</dt>
                        <dd>{revisionNote}</dd>
                      </>
                    )}
                  </dl>
                  <div
                    className="project-decisions__review-actions"
                    aria-label="Proposal review"
                    role="group"
                  >
                    <button
                      className="project-decisions__button"
                      type="button"
                      disabled={!canReview}
                      onClick={() => review(id, "approved")}
                    >
                      Approve
                    </button>
                    <button
                      className="project-decisions__button"
                      type="button"
                      disabled={!canReview}
                      onClick={() => {
                        if (!canReview) return;
                        setError("");
                        setRevision(entry);
                      }}
                    >
                      Request revision
                    </button>
                    <button
                      className="project-decisions__button"
                      type="button"
                      disabled={!canReview}
                      onClick={() => review(id, "rejected")}
                    >
                      Reject
                    </button>
                    {!archived && canReviseProposal(entry) && (
                      <Link
                        className="project-decisions__button"
                        to={`${encodeURIComponent(id)}/revise`}
                      >
                        Edit proposal
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="project-decisions__empty" role="status">
            {decisions.length
              ? "No proposals or decisions match this filter."
              : "No proposals or decisions yet."}
          </p>
        )}
      </div>
      {!archived && isProjectOwner && revision && (
        <RevisionDialog
          title={revision.title}
          error={error}
          onClose={() => {
            setRevision(null);
            setError("");
          }}
          onSubmit={(note) => review(revision.id, "revision_requested", note)}
        />
      )}
    </section>
  );
}
