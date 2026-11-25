import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isLocalDemo, useAccount } from "../features/account/useAccount";
import { workspaceKey } from "../features/account/accountWorkspace";
import { useWorkspace } from "../features/projects/model/workspaceContext";
import { specificationsApi } from "../features/projects/api/specificationsApi";
import {
  checkTaskDocumentFile,
  validateTaskDocument,
} from "../features/projects/model/validateTaskDocument";
import { normalizeApiError } from "../shared/api/requestApi";
import {
  listSpecifications,
  projectDocumentsKey,
  readSpecificationFile,
  saveSpecification,
} from "../features/projects/model/projectDocuments";
import {
  recordBacklogReview,
  recordDecomposition,
} from "../features/projects/model/projectAnalytics";
import {
  cyclicItems,
  generateLocalDraft,
  graphProblems,
  publicationLocked,
  readBacklog,
  writeBacklog,
  type Backlog,
} from "../features/projects/model/taskBacklog";

import { TaskBacklogWorkspace } from "./TaskBacklogWorkspace";
import { SpecificationUpload } from "./SpecificationUpload";
import { DecompositionProgress } from "./DecompositionProgress";
import "./ProjectTasksPage.css";

type TasksAction = "create" | "decompose";

function specificationUploadError(error: unknown) {
  const problem = normalizeApiError(error);
  switch (problem.code) {
    case "INVALID_SPECIFICATION":
      return {
        error:
          "Could not read the document. Use UTF-8 TXT or a PDF with a text layer.",
      };
    case "UNSUPPORTED_MEDIA_TYPE":
      return { error: problem.message, reason: "format" as const };
    case "PAYLOAD_TOO_LARGE":
      return { error: problem.message, reason: "size" as const };
    case "SPECIFICATION_TEXT_TOO_LARGE":
      return {
        error: "The extracted text exceeds the 200,000-character limit.",
      };
    case "SPECIFICATION_PROCESSING_LIMIT":
      return {
        error: "The PDF is too complex to process. Try a shorter document.",
      };
    case "PROJECT_ARCHIVED":
      return { error: "Archived projects cannot accept new specifications." };
    case "IMPORT_BUSY":
      return { error: "Document import is busy. Wait a moment and try again." };
    default:
      return { error: problem.message };
  }
}

export default function ProjectTasksPage({ action }: { action?: TasksAction }) {
  const { archived } = useWorkspace();
  const { projectId = "" } = useParams();
  if (archived && action)
    return (
      <Navigate
        to={`/projects/${encodeURIComponent(projectId)}/tasks`}
        replace
      />
    );
  return <ProjectTasks action={action} />;
}

function ProjectTasks({ action }: { action?: TasksAction }) {
  const upload = useRef<AbortController>();
  useEffect(() => () => upload.current?.abort(), []);
  const { state, search } = useLocation();
  const navigate = useNavigate();
  const { projectId = "" } = useParams();
  const { isProjectOwner, archived } = useWorkspace();
  const account = useAccount();
  const queryClient = useQueryClient();
  const projectPath = `/projects/${encodeURIComponent(projectId)}`;
  const storageKey = workspaceKey(`team-ai.backlog:${projectId}`);
  const documentsKey = projectDocumentsKey(projectId);
  const demo = isLocalDemo();
  const specificationsKey = [...documentsKey, "specifications", demo];
  const [backlog, setBacklog] = useState(() => readBacklog(storageKey));
  const [openCreate, setOpenCreate] = useState(
    action === "create" && !publicationLocked(backlog),
  );
  const [storageError, setStorageError] = useState("");
  const [operationError, setOperationError] = useState("");

  const simulateFailure =
    demo && new URLSearchParams(search).get("decompositionDemo") === "error";
  const specificationId =
    typeof state?.specificationId === "string" ? state.specificationId : "";
  const [selectedId, setSelectedId] = useState("");
  const [validation, setValidation] = useState<{
    pending: boolean;
    error?: string;
    reason?: "format" | "size";
  }>({ pending: false });
  const specifications = useQuery({
    queryKey: specificationsKey,
    queryFn: ({ signal }) =>
      demo
        ? listSpecifications(projectId, signal)
        : specificationsApi.latest(projectId, signal),
    enabled: action !== "decompose",
  });
  const selected =
    specifications.data?.find(({ id }) => id === selectedId) ??
    specifications.data?.[0];
  const source = useQuery({
    queryKey: [...documentsKey, "decomposition-source", demo, specificationId],
    enabled: Boolean(specificationId) && action === "decompose",
    gcTime: 0,
    queryFn: async ({ signal }) => {
      if (!demo)
        return specificationsApi.source(projectId, specificationId, signal);
      const file = await readSpecificationFile(
        projectId,
        specificationId,
        signal,
      );
      if (!file) throw new Error("The selected specification is unavailable.");
      const validated = await validateTaskDocument(file);
      signal.throwIfAborted();
      if ("error" in validated)
        throw new Error("The saved specification could not be read.");
      return { text: validated.text, name: file.name };
    },
  });

  async function selectDocument(file: File) {
    if (archived) return;
    upload.current?.abort();
    const controller = new AbortController();
    upload.current = controller;
    setValidation({ pending: true });
    const result = demo
      ? await validateTaskDocument(file)
      : checkTaskDocumentFile(file);
    if (controller.signal.aborted) return;
    if (result && "error" in result) {
      setValidation({
        pending: false,
        error: result.error,
        reason: result.reason,
      });
      return;
    }
    try {
      const specification = demo
        ? await saveSpecification(
            projectId,
            file,
            account?.name ?? "You",
            controller.signal,
          )
        : await specificationsApi.upload(projectId, file, controller.signal);
      if (controller.signal.aborted) return;
      queryClient.setQueryData<typeof specifications.data>(
        specificationsKey,
        (current) => [
          specification,
          ...(current ?? []).filter(({ id }) => id !== specification.id),
        ],
      );
      setSelectedId(specification.id);
      void queryClient.invalidateQueries({ queryKey: documentsKey });
      setValidation({ pending: false });
    } catch (error) {
      if (!controller.signal.aborted)
        setValidation({
          pending: false,
          ...(demo
            ? { error: "Could not save the specification. Try again." }
            : specificationUploadError(error)),
        });
    }
  }

  const saveBacklog = useCallback(
    (next: Backlog, expected = backlog) => {
      if (archived) return false;
      try {
        const saved = writeBacklog(storageKey, expected, next);
        if (!saved) {
          setBacklog(readBacklog(storageKey));
          setStorageError(
            "The backlog changed in another tab. Review the latest revision before saving again. Your edits are still open.",
          );
          return false;
        }
        setBacklog(saved);
        setStorageError("");
        return true;
      } catch {
        setStorageError("Could not save the backlog. Please try again.");
        return false;
      }
    },
    [archived, backlog, storageKey],
  );

  const completeDecomposition = useCallback(
    (generationMs: number) => {
      if (archived) return;
      if (simulateFailure || !source.data) {
        setOperationError("generation");
        return;
      }
      if (publicationLocked(backlog)) {
        setOperationError(
          "This backlog is locked because publication has started.",
        );
        return;
      }
      try {
        const items = generateLocalDraft(source.data.text, source.data.name);
        const problems = graphProblems(items);
        if (!items.length || problems.cycles.size || problems.invalid.size)
          throw new Error();
        const { history } = backlog;
        const snapshot = {
          items: backlog.items,
          generationMs: backlog.generationMs,
          confirmed: backlog.confirmed,
          specificationId: backlog.specificationId,
        };
        const next = {
          items,
          generationMs,
          confirmed: false,
          specificationId,
          history: backlog.items.length
            ? [...(history ?? []), snapshot]
            : history,
        };
        if (!saveBacklog(next)) {
          setOperationError(
            "Could not save the new backlog. The previous revision was preserved.",
          );
          return;
        }
        recordDecomposition(projectId, items, generationMs, false);
        navigate(projectPath + "/tasks", {
          replace: true,
        });
      } catch {
        setOperationError("generation");
      }
    },
    [
      archived,
      backlog,
      navigate,
      projectId,
      projectPath,
      saveBacklog,
      source.data,
      specificationId,
      simulateFailure,
    ],
  );

  const locked = publicationLocked(backlog);
  const hasItems = backlog.items.length > 0;
  const processing = action === "decompose";
  const preview = hasItems && !processing && !validation.error;
  const uploadButton = (
    <SpecificationUpload
      disabled={archived || validation.pending}
      onChoose={(file) => void selectDocument(file)}
    />
  );
  const decomposeButton =
    selected &&
    !archived &&
    !locked &&
    !validation.pending &&
    !validation.error ? (
      <Link
        className="project-tasks__button"
        to={{ pathname: "decompose", search: simulateFailure ? search : "" }}
        state={{ specificationId: selected.id }}
      >
        Decompose into tasks
      </Link>
    ) : null;

  return (
    <section
      className={
        preview ? "project-tasks project-tasks--preview" : "project-tasks"
      }
      aria-labelledby="project-tasks-title"
    >
      <div className="project-tasks__heading">
        <h1 id="project-tasks-title">Project tasks</h1>
        <div className="project-tasks__heading-actions">
          {preview && uploadButton}
          <button
            type="button"
            disabled={
              archived ||
              locked ||
              (processing && !operationError && !source.isError)
            }
            onClick={() => setOpenCreate(true)}
            className="project-tasks__button"
          >
            <span aria-hidden="true" className="project-tasks__plus">
              +
            </span>{" "}
            Create a task manually
          </button>
        </div>
      </div>
      {preview && selectedId && selected && (
        <div className="project-tasks__specifications">
          <p role="status">Loaded file: {selected.name}</p>
          {decomposeButton}
        </div>
      )}
      {!processing && !validation.error && storageError && (
        <p>{storageError}</p>
      )}
      {!processing && !demo && !validation.error && specifications.isError && (
        <p role="alert">Could not load the project specification.</p>
      )}
      {validation.pending && <p role="status">Checking document…</p>}
      {validation.error && (
        <div className="project-tasks__empty" role="alert">
          <p>
            {validation.reason === "format" ? (
              <>
                Unsupported file format.
                <br />
                Please provide .txt file or .pdf
                <br />
                with text layer.
              </>
            ) : validation.reason === "size" ? (
              <>
                File is too large.
                <br />
                Please provide a file
                <br />
                up to 10 MiB.
              </>
            ) : (
              validation.error
            )}
          </p>
        </div>
      )}
      {processing ? (
        operationError || source.isError ? (
          <div className="project-tasks__empty" role="alert">
            <p>
              {operationError === "generation" ? (
                <>
                  Local draft generation failed.
                  <br />
                  No partial draft was saved.
                  <br />
                  Please reload the page and try again.
                </>
              ) : (
                operationError || "Could not read the selected specification."
              )}
            </p>
            {operationError !== "generation" && (
              <Link to={projectPath + "/tasks"}>Back to project tasks</Link>
            )}
          </div>
        ) : specificationId || simulateFailure ? (
          <DecompositionProgress
            ready={Boolean(source.data) || simulateFailure}
            simulateFailure={simulateFailure}
            onComplete={completeDecomposition}
          />
        ) : (
          <p>
            Select a project document before starting decomposition.{" "}
            <Link to={projectPath + "/tasks"}>Back to project tasks</Link>
          </p>
        )
      ) : (
        !hasItems && (
          <div
            className="project-tasks__empty"
            hidden={Boolean(validation.error)}
          >
            <p>
              No tasks yet.
              {!archived && (
                <>
                  <br />
                  Upload your project document and
                  <br />
                  decompose it to create a local draft.
                </>
              )}
            </p>
            {!archived && (
              <div className="project-tasks__actions">
                {uploadButton}
                {decomposeButton ?? (
                  <button
                    className="project-tasks__button"
                    type="button"
                    disabled
                  >
                    Decompose into tasks
                  </button>
                )}
              </div>
            )}
            {selected && (
              <p className="project-tasks__document" role="status">
                Loaded file: {selected.name}
              </p>
            )}
          </div>
        )
      )}
      <TaskBacklogWorkspace
        backlog={backlog}
        showTree={!processing && !validation.error}
        canApprove={isProjectOwner}
        archived={archived}
        saveError={storageError}
        onChange={(next) => {
          if (!saveBacklog(next)) return false;
          recordBacklogReview(
            projectId,
            backlog,
            next,
            cyclicItems(next.items).size > 0,
          );
          return true;
        }}
        openCreate={openCreate}
        onCloseCreate={() => {
          setOpenCreate(false);
          if (action === "create")
            navigate(`${projectPath}/tasks`, { replace: true });
        }}
      />
    </section>
  );
}
