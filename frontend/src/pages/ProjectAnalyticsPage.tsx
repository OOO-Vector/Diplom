import { useParams } from "react-router-dom";
import { readProjectAnalytics } from "../features/projects/model/projectAnalytics";
import "./ProjectAnalyticsPage.css";

function seconds(milliseconds: number | null) {
  return milliseconds === null ? "N/A" : (milliseconds / 1000).toFixed(2);
}

function outcomeCell(column: string[], index: number) {
  return column[index] ?? (index === 0 ? "N/A" : null);
}

export default function ProjectAnalyticsPage() {
  const { projectId = "" } = useParams();
  const { proposals, dagChecks, dagCycles, answers } =
    readProjectAnalytics(projectId);
  const last = proposals.at(-1);
  const outcomes = {
    accepted: new Array<string>(),
    edited: new Array<string>(),
    rejected: new Array<string>(),
  };
  proposals.forEach(({ outcome }, index) => {
    if (outcome !== "pending")
      outcomes[outcome].push(`#${String(index + 1).padStart(3, "0")}`);
  });
  const outcomeColumns = Object.values(outcomes);
  const outcomeRows = Math.max(
    1,
    ...outcomeColumns.map((column) => column.length),
  );
  const meanDecomposition = proposals.length
    ? proposals.reduce((sum, proposal) => sum + proposal.durationMs, 0) /
      proposals.length
    : null;
  const meanAnswer = answers.count ? answers.totalMs / answers.count : null;

  return (
    <section
      className="project-analytics"
      aria-labelledby="project-analytics-title"
    >
      <h1 id="project-analytics-title">Local demo analytics</h1>
      <div
        className="project-analytics__scroll"
        role="region"
        aria-label="Project metrics"
        tabIndex={0}
      >
        <table className="project-analytics__proposals">
          <thead>
            <tr>
              <th scope="col">Decomposition proposals, #</th>
              <th scope="col">Accepted</th>
              <th scope="col">Edited</th>
              <th scope="col">Rejected</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: outcomeRows }, (_, index) => (
              <tr key={index}>
                <td />
                <td>{outcomeCell(outcomes.accepted, index)}</td>
                <td>{outcomeCell(outcomes.edited, index)}</td>
                <td>{outcomeCell(outcomes.rejected, index)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="project-analytics__metrics">
          <div>
            <dt>Decomposition time, s</dt>
            <dd>
              <span>
                Last <strong>{seconds(last?.durationMs ?? null)}</strong>
              </span>
              <span>
                Average <strong>{seconds(meanDecomposition)}</strong>
              </span>
            </dd>
          </div>
          <div>
            <dt>During last decomposition generated</dt>
            <dd>
              <span>
                Epics <strong>{last?.counts.epic ?? "N/A"}</strong>
              </span>
              {last && last.counts.story > 0 && (
                <span>
                  Stories <strong>{last.counts.story}</strong>
                </span>
              )}
              <span>
                Tasks <strong>{last?.counts.task ?? "N/A"}</strong>
              </span>
              <span>
                Subtasks <strong>{last?.counts.subtask ?? "N/A"}</strong>
              </span>
            </dd>
          </div>
          <div>
            <dt>DAG cycle checks</dt>
            <dd>
              <span>
                Clear{" "}
                <strong>{dagChecks ? dagChecks - dagCycles : "N/A"}</strong>
              </span>
              <span>
                Cycles found <strong>{dagChecks ? dagCycles : "N/A"}</strong>
              </span>
            </dd>
          </div>
          <div>
            <dt>Answer generation time, s</dt>
            <dd>
              <span>
                Last <strong>{seconds(answers.lastMs)}</strong>
              </span>
              <span>
                Average <strong>{seconds(meanAnswer)}</strong>
              </span>
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
