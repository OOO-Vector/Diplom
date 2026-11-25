import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  projectDestination,
  useWorkspace,
} from "../features/projects/model/workspaceContext";
import { LoadingState } from "../shared/ui/LoadingState";
import "./ProjectsPage.css";

export default function ProjectsPage() {
  const { projects, createProject, projectsLoading, projectsFailed } =
    useWorkspace();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [order, setOrder] = useState("asc");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const visible = projects
    .filter(
      (project) =>
        project.name.toLowerCase().includes(search.trim().toLowerCase()) &&
        (status === "all" || status === (project.status ?? "active")),
    )
    .sort((a, b) =>
      order === "asc"
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name),
    );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      if (await createProject(name.trim() || "New project")) setName("");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="projects-dashboard" aria-labelledby="projects-title">
      <h1 id="projects-title">Projects</h1>
      <form onSubmit={submit} aria-busy={pending}>
        <label>
          Project name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={150}
            placeholder="New project"
            disabled={pending}
          />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create project"}
        </button>
      </form>
      <div className="projects-dashboard__filters">
        <label>
          Search projects
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">All projects</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label>
          Sort by name
          <select
            value={order}
            onChange={(event) => setOrder(event.target.value)}
          >
            <option value="asc">A to Z</option>
            <option value="desc">Z to A</option>
          </select>
        </label>
      </div>
      {projectsLoading ? (
        <LoadingState />
      ) : projectsFailed && !projects.length ? null : !visible.length ? (
        <p>
          {projects.length
            ? "No matching projects."
            : "No projects yet. Create a project to get started."}
        </p>
      ) : (
        <ul
          className="projects-dashboard__list"
          aria-label="Available projects"
        >
          {visible.map((project) => (
            <li key={project.id}>
              <Link to={projectDestination(project.id)}>{project.name}</Link>
              <span>
                {project.status === "archived" ? "Archived" : "Active"}
              </span>
              <span>{project.myRole === "member" ? "Member" : "Owner"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
