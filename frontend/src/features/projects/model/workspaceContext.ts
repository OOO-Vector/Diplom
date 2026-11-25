import { useOutletContext } from "react-router-dom";
import type { Project } from "./projectApi";
import { projectSections } from "./projectSections";

export type ProjectEntry = Pick<Project, "id" | "name"> &
  Partial<Pick<Project, "myRole" | "status">>;

export type WorkspaceContext = {
  projects: readonly ProjectEntry[];
  projectsLoading: boolean;
  projectsFailed: boolean;
  project?: Project;
  isProjectOwner: boolean;
  archived: boolean;
  createProject: (name: string) => Promise<boolean>;
  updateProject: (project: Project) => void;
};

export function useWorkspace() {
  return useOutletContext<WorkspaceContext>();
}

export function projectDestination(id: string, currentModule?: string) {
  const section = projectSections.find(({ path }) => path === currentModule);
  return `/projects/${encodeURIComponent(id)}${section ? "/" + section.path : ""}`;
}
