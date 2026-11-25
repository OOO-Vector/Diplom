import {
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import {
  Outlet,
  Navigate,
  useFetchers,
  useLocation,
  useMatch,
  useNavigate,
  useNavigation,
} from "react-router-dom";
import { z } from "zod";
import {
  getPendingRequests,
  subscribeToRequests,
} from "../../shared/api/httpClient";
import { LoadingState } from "../../shared/ui/LoadingState";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { workspaceKey } from "../../features/account/accountWorkspace";
import {
  isLocalDemo,
  useAccount,
  useSession,
} from "../../features/account/useAccount";

import {
  createServerProject,
  getProject,
  listProjects,
  type Project,
} from "../../features/projects/model/projectApi";
import {
  type ProjectEntry,
  type WorkspaceContext,
} from "../../features/projects/model/workspaceContext";
import { ApiFeedback } from "../../shared/ui/ApiFeedback";
import { type ApiError, normalizeApiError } from "../../shared/api/requestApi";

const projectList = z.array(z.object({ id: z.string(), name: z.string() }));

function readProjects(storageKey: string): z.infer<typeof projectList> {
  try {
    return projectList.parse(
      JSON.parse(localStorage.getItem(storageKey) ?? "[]"),
    );
  } catch {
    return [];
  }
}

export function AppShell() {
  const account = useAccount();
  const location = useLocation();
  const session = useSession();
  if (!isLocalDemo() && session.status === "checking") return <LoadingState />;
  if (!account)
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search + location.hash }}
      />
    );
  return <SignedInShell key={account.id} />;
}

function SignedInShell() {
  const { pathname } = useLocation();
  const match = useMatch("/projects/:projectId/*");
  const projectId = match?.params.projectId;
  const isSettings = Boolean(useMatch("/projects/:projectId/settings/*"));
  const isDecisions = Boolean(useMatch("/projects/:projectId/decisions/*"));
  const navigate = useNavigate();
  const navigation = useNavigation();
  const fetchers = useFetchers();
  const fetching = useIsFetching();
  const mutating = useIsMutating({
    predicate: (mutation) => !mutation.state.isPaused,
  });
  const pendingRequests = useSyncExternalStore(
    subscribeToRequests,
    getPendingRequests,
  );
  const loading =
    navigation.state !== "idle" ||
    fetchers.some((fetcher) => fetcher.state !== "idle") ||
    fetching > 0 ||
    mutating > 0 ||
    pendingRequests > 0;
  const storageKey = workspaceKey("team-ai.projects");
  const demo = isLocalDemo();
  const [projects, setProjects] = useState<ProjectEntry[]>(() =>
    demo ? readProjects(storageKey) : [],
  );
  const [projectAccess, setProjectAccess] = useState<{
    id: string;
    project?: Project;
    error?: ApiError;
  }>();
  const [projectsLoading, setProjectsLoading] = useState(!demo);
  const [listError, setListError] = useState<ApiError>();
  const [listAttempt, setListAttempt] = useState(0);
  const [accessAttempt, setAccessAttempt] = useState(0);
  const [createError, setCreateError] = useState<ApiError>();
  const creating = useRef<AbortController>();

  useEffect(() => () => creating.current?.abort(), [pathname]);

  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    setProjectsLoading(true);
    void listProjects(controller.signal)
      .then((items) => {
        if (!controller.signal.aborted)
          setProjects((existing) => [
            ...items,
            ...existing.filter(
              (project) => !items.some(({ id }) => id === project.id),
            ),
          ]);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setListError(normalizeApiError(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setProjectsLoading(false);
      });
    return () => controller.abort();
  }, [demo, listAttempt]);

  useEffect(() => {
    setProjectAccess(undefined);
    if (demo || !projectId) return;
    const controller = new AbortController();
    void getProject(projectId, controller.signal)
      .then((project) => {
        if (!controller.signal.aborted)
          setProjectAccess({
            id: projectId,
            project,
          });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const failure = normalizeApiError(error);
        if (failure.status === 404)
          setProjects((items) => items.filter(({ id }) => id !== projectId));
        setProjectAccess({ id: projectId, error: failure });
      });
    return () => controller.abort();
  }, [demo, projectId, accessAttempt]);

  const access = projectAccess?.id === projectId ? projectAccess : undefined;

  useEffect(() => {
    if (!demo) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(projects));
    } catch {
      // Keep the in-memory list usable when browser storage is unavailable.
    }
  }, [demo, projects, storageKey]);

  async function createProject(name: string) {
    if (!demo) {
      if (creating.current) return false;
      const controller = new AbortController();
      creating.current = controller;
      setCreateError(undefined);
      try {
        const project = await createServerProject(name, controller.signal);
        if (controller.signal.aborted) return false;
        setProjects((items) => [...items, project]);
        navigate(`/projects/${project.id}/tasks`);
        return true;
      } catch (error) {
        if (!controller.signal.aborted)
          setCreateError(normalizeApiError(error));
        return false;
      } finally {
        creating.current = undefined;
      }
    }
    const id = crypto.getRandomValues(new Uint32Array(4)).join("-");
    const project = { id, name };
    setProjects((current) => [...current, project]);
    navigate(`/projects/${project.id}/settings`);
    return true;
  }

  const context: WorkspaceContext = {
    projects,
    projectsLoading,
    projectsFailed: Boolean(listError),
    project: access?.project,
    isProjectOwner: demo
      ? projects.some(({ id }) => id === projectId)
      : access?.project?.myRole === "owner",
    archived: access?.project?.status === "archived",
    createProject,
    updateProject(project) {
      setProjects((items) =>
        items.map((item) => (item.id === project.id ? project : item)),
      );
      setProjectAccess({ id: project.id, project });
    },
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">
        Skip to content
      </a>
      <Header showProjectNavigation={demo || Boolean(access?.project)} />
      <Sidebar
        projects={projects}
        onNewProject={createProject}
        initiallyCollapsed={isSettings || isDecisions}
      />
      <div className="app-body">
        <main id="workspace" className="workspace" tabIndex={-1}>
          <Suspense key={pathname} fallback={<LoadingState />}>
            {listError && (
              <ApiFeedback
                error={listError}
                onRetry={() => {
                  setListError(undefined);
                  setListAttempt((attempt) => attempt + 1);
                }}
              />
            )}
            {createError && <ApiFeedback error={createError} />}
            {!demo && projectId && !access?.project ? (
              access?.error ? (
                <ApiFeedback
                  error={access.error}
                  onRetry={() => {
                    setProjectAccess(undefined);
                    setAccessAttempt((attempt) => attempt + 1);
                  }}
                />
              ) : (
                <LoadingState />
              )
            ) : (
              <>
                {context.archived && (
                  <p className="project-archive-banner" role="status">
                    This project is archived and read-only.
                  </p>
                )}
                <Outlet key={projectId} context={context} />
              </>
            )}
            {loading && <LoadingState overlay />}
          </Suspense>
        </main>
      </div>
    </div>
  );
}
