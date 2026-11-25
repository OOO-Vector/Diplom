import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import {
  addMember,
  listMembers,
  removeMember,
  transferOwnership,
  type ProjectMember,
} from "../features/projects/model/projectApi";
import { useWorkspace } from "../features/projects/model/workspaceContext";
import { ApiFeedback } from "../shared/ui/ApiFeedback";
import { LoadingState } from "../shared/ui/LoadingState";
import { normalizeApiError, type ApiError } from "../shared/api/requestApi";

export default function ServerProjectMembers({ invite }: { invite: boolean }) {
  const { project, archived, isProjectOwner, updateProject } = useWorkspace();
  const id = project?.id ?? "";
  const canManage = isProjectOwner && !archived;
  const [members, setMembers] = useState<ProjectMember[]>();
  const [error, setError] = useState<ApiError>();
  const [mutationError, setMutationError] = useState<ApiError>();
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    member: ProjectMember;
    action: "remove" | "transfer";
  }>();
  const activeMutation = useRef<AbortController>();
  const navigate = useNavigate();

  useEffect(() => () => activeMutation.current?.abort(), [id]);

  useEffect(() => {
    if (invite || !id) return;
    const controller = new AbortController();
    void listMembers(id, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setMembers(items);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(normalizeApiError(failure));
      });
    return () => controller.abort();
  }, [id, invite, reload]);

  async function mutate(action: (signal: AbortSignal) => Promise<void>) {
    if (!canManage || activeMutation.current) return;
    const controller = new AbortController();
    activeMutation.current = controller;
    setPending(true);
    setMutationError(undefined);
    try {
      await action(controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted)
        setMutationError(normalizeApiError(failure));
    } finally {
      activeMutation.current = undefined;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email")).trim();
    void mutate(async (signal) => {
      await addMember(id, email, signal);
      if (!signal.aborted) navigate("..", { relative: "path", replace: true });
    });
  }

  if (invite && !canManage) return <Navigate to=".." relative="path" replace />;

  return (
    <section className="project-users" aria-labelledby="project-users-title">
      <h1 id="project-users-title">
        <Link to={invite ? "../.." : ".."} relative="path">
          Project settings
        </Link>{" "}
        &gt; Users &amp; Roles
      </h1>
      {mutationError && <ApiFeedback error={mutationError} />}
      {invite ? (
        <form
          className="project-users__invite"
          onSubmit={submit}
          aria-busy={pending}
        >
          <input
            type="email"
            name="email"
            aria-label="Teammate email"
            placeholder="Email of a registered teammate"
            required
            maxLength={254}
            disabled={pending}
          />
          <button type="submit" aria-label="Add teammate" disabled={pending}>
            +
          </button>
        </form>
      ) : (
        <>
          {canManage && (
            <Link className="project-users__add" to="invite">
              Add new user to the project
            </Link>
          )}
          {error ? (
            <ApiFeedback
              error={error}
              onRetry={() => {
                setError(undefined);
                setReload((value) => value + 1);
              }}
            />
          ) : !members ? (
            <LoadingState />
          ) : members.length === 0 ? (
            <p>No project members.</p>
          ) : (
            <ul className="project-users__members" aria-label="Project members">
              {members.map((member) => (
                <li key={member.userId}>
                  <div>
                    <strong>{member.displayName}</strong>
                    <small>
                      {member.role === "owner" ? "Owner" : "Member"}
                    </small>
                  </div>
                  {canManage && member.role === "member" && (
                    <div>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          setConfirmation({ member, action: "remove" })
                        }
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          setConfirmation({ member, action: "transfer" })
                        }
                      >
                        Transfer ownership
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {confirmation && canManage && (
            <div role="group" aria-label="Confirm membership change">
              <p>
                {confirmation.action === "remove"
                  ? "Remove"
                  : "Transfer ownership to"}{" "}
                {confirmation.member.displayName}?
              </p>
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirmation(undefined)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  void mutate(async (signal) => {
                    const { member, action } = confirmation;
                    if (action === "transfer") {
                      const updated = await transferOwnership(
                        id,
                        member.userId,
                        signal,
                      );
                      if (!signal.aborted) updateProject(updated);
                    } else {
                      await removeMember(id, member.userId, signal);
                    }
                    if (signal.aborted) return;
                    setConfirmation(undefined);
                    setMembers(undefined);
                    setReload((value) => value + 1);
                  })
                }
              >
                Confirm
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
