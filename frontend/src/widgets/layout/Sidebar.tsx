import { SidebarSearch } from "./SidebarSearch";
import { useId, useState, type FormEvent } from "react";
import { Link, useMatch } from "react-router-dom";
import { projectDestination } from "../../features/projects/model/workspaceContext";
import "./Sidebar.css";

type SidebarProps = {
  projects?: readonly { id: string; name: string }[];
  onNewProject?: (name: string) => Promise<boolean>;
  initiallyCollapsed?: boolean;
};

export function Sidebar({
  projects = [],
  onNewProject,
  initiallyCollapsed = false,
}: SidebarProps) {
  const [expandedPageCollapsed, setExpandedPageCollapsed] = useState(false);
  const [collapsedPageCollapsed, setCollapsedPageCollapsed] = useState(true);
  const [collapsed, setCollapsed] = initiallyCollapsed
    ? [collapsedPageCollapsed, setCollapsedPageCollapsed]
    : [expandedPageCollapsed, setExpandedPageCollapsed];
  const [search, setSearch] = useState("");
  const [draftName, setDraftName] = useState<string | null>(null);
  const contentId = useId();
  const match = useMatch("/projects/:projectId/*");
  const projectId = match?.params.projectId;
  const section = match?.params["*"]?.split("/")[0]?.toLowerCase();
  const [pending, setPending] = useState(false);
  const query = search.trim().toLowerCase();
  const visibleProjects = projects.filter(({ name }) =>
    name.toLowerCase().includes(query),
  );

  async function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draftName === null || !onNewProject || pending) return;

    setPending(true);
    const created = await onNewProject(draftName.trim() || "New project");
    setPending(false);
    if (!created) return;
    setDraftName(null);
    setSearch("");
    setCollapsedPageCollapsed(false);
  }

  return (
    <aside
      className="project-sidebar"
      data-collapsed={collapsed}
      aria-label="Projects"
    >
      <button
        className="project-sidebar__toggle"
        type="button"
        aria-label={
          collapsed ? "Expand projects sidebar" : "Collapse projects sidebar"
        }
        aria-expanded={!collapsed}
        aria-controls={contentId}
        onClick={() => setCollapsed((current) => !current)}
      >
        <span aria-hidden="true">{collapsed ? ">" : "<"}</span>
      </button>
      <div id={contentId} hidden={collapsed}>
        <Link className="project-sidebar__title" to="/projects">
          Projects
        </Link>
        <div className="project-sidebar__actions">
          {draftName === null ? (
            <button
              className="project-sidebar__new"
              type="button"
              onClick={() => setDraftName("")}
              disabled={!onNewProject}
            >
              <span className="project-sidebar__plus" aria-hidden="true" />
              New project
            </button>
          ) : (
            <form className="project-sidebar__create" onSubmit={submitProject}>
              <button
                className="project-sidebar__new"
                type="submit"
                aria-label="Create project"
                disabled={pending}
              >
                <span className="project-sidebar__plus" aria-hidden="true" />
              </button>
              <input
                aria-label="Project name"
                placeholder="New project"
                maxLength={150}
                disabled={pending}
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                autoFocus
              />
            </form>
          )}
          <SidebarSearch
            label="Search projects"
            value={search}
            onChange={setSearch}
          />
        </div>
        <nav className="project-sidebar__projects" aria-label="Project list">
          {visibleProjects.length ? (
            <ul>
              {visibleProjects.map(({ id, name }) => (
                <li key={id}>
                  <Link
                    to={projectDestination(id, section)}
                    aria-current={id === projectId ? "true" : undefined}
                  >
                    {name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>{query ? "No matching projects" : "No projects yet"}</p>
          )}
        </nav>
      </div>
    </aside>
  );
}
