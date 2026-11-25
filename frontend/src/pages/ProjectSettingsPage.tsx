import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  archiveProject,
  updateProjectMetadata,
  type Project,
} from "../features/projects/model/projectApi";
import { useWorkspace } from "../features/projects/model/workspaceContext";
import { normalizeApiError, ApiError } from "../shared/api/requestApi";
import { ApiFeedback } from "../shared/ui/ApiFeedback";
import "./ProjectSettingsPage.css";
import "./ProjectsPage.css";

export default function ProjectSettingsPage() {
  const { project, isProjectOwner } = useWorkspace();

  return (
    <section
      className="project-settings"
      aria-labelledby="project-settings-title"
    >
      <h1 id="project-settings-title">Project settings</h1>
      <nav className="project-settings__links" aria-label="Settings options">
        <Link to="user">User settings</Link>
        {isProjectOwner && <Link to="github">GitHub settings</Link>}
      </nav>
      {project && <ProjectAdministration key={project.id} project={project} />}
    </section>
  );
}

function ProjectAdministration({ project }: { project: Project }) {
  const { archived, isProjectOwner, updateProject } = useWorkspace();
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError>();
  const [saved, setSaved] = useState(false);
  const request = useRef<AbortController>();
  useEffect(() => () => request.current?.abort(), []);

  async function submit(action: (signal: AbortSignal) => Promise<Project>) {
    if (archived || !isProjectOwner || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setSaved(false);
    setError(undefined);
    try {
      const updated = await action(controller.signal);
      if (controller.signal.aborted) return;
      updateProject(updated);
      setSaved(updated.status === "active");
      setConfirm(false);
    } catch (failure) {
      if (!controller.signal.aborted) setError(normalizeApiError(failure));
    } finally {
      request.current = undefined;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const description = String(data.get("description") ?? "").trim() || null;
    if (!name) {
      event.currentTarget.querySelector("input")?.focus();
      setError(new ApiError("Enter a project name."));
      return;
    }
    void submit((signal) =>
      updateProjectMetadata(project.id, { name, description }, signal),
    );
  }

  if (!isProjectOwner || archived)
    return (
      <div>
        <h2>{project.name}</h2>
        {project.description && <p>{project.description}</p>}
      </div>
    );

  return (
    <div className="projects-dashboard">
      <form onSubmit={save}>
        <label>
          Project name
          <input
            name="name"
            defaultValue={project.name}
            required
            maxLength={150}
            disabled={pending}
          />
        </label>
        <label>
          Description
          <textarea
            name="description"
            defaultValue={project.description ?? ""}
            maxLength={4000}
            disabled={pending}
          />
        </label>
        <button type="submit" disabled={pending}>
          Save project
        </button>
      </form>
      {saved && <p role="status">Project saved.</p>}
      {error && <ApiFeedback error={error} />}
      <div>
        {confirm && (
          <p>
            Archive this project? Its history stays available in read-only mode.
          </p>
        )}
        {confirm && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirm(false)}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            confirm
              ? void submit((signal) => archiveProject(project.id, signal))
              : setConfirm(true)
          }
        >
          {confirm ? "Confirm archive" : "Archive project"}
        </button>
      </div>
    </div>
  );
}
