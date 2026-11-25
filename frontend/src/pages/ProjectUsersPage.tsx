import { lazy, Suspense, useState, type FormEvent } from "react";
import {
  Link,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom";
import { z } from "zod";
import { workspaceKey } from "../features/account/accountWorkspace";
import { LoadingState } from "../shared/ui/LoadingState";
import "./ProjectUsersPage.css";

import { isLocalDemo } from "../features/account/useAccount";

const ServerProjectMembers = lazy(() => import("./ServerProjectMembers"));

const ProjectUsersContent = lazy(() => import("./ProjectUsersContent"));
const memberSchema = z.object({
  email: z.string(),
  status: z.enum(["Invited", "Active"]),
});
export type ProjectMember = z.infer<typeof memberSchema>;

export function ProjectUsersPage({
  step = "members",
}: {
  step?: "members" | "invite";
}) {
  return isLocalDemo() ? (
    <DemoProjectUsers step={step} />
  ) : (
    <ServerProjectMembers invite={step === "invite"} />
  );
}

function DemoProjectUsers({ step }: { step: "members" | "invite" }) {
  const navigate = useNavigate();
  const { isProjectOwner } = useOutletContext<{ isProjectOwner: boolean }>();
  const { projectId } = useParams();
  const storageKey = workspaceKey(`team-ai.invitations:${projectId}`);
  const [error, setError] = useState("");
  const [members, setMembers] = useState(readMembers);

  function readMembers(): ProjectMember[] {
    if (!isProjectOwner) return [];

    try {
      const stored: unknown = JSON.parse(
        localStorage.getItem(storageKey) ?? "[]",
      );
      if (!Array.isArray(stored)) return [];
      return stored.flatMap((entry: unknown) => {
        if (typeof entry === "string")
          return [{ email: entry, status: "Invited" as const }];
        const member = memberSchema.safeParse(entry);
        return member.success ? [member.data] : [];
      });
    } catch {
      return [];
    }
  }

  function saveMembers(nextMembers: ProjectMember[]) {
    if (!isProjectOwner) return false;

    try {
      localStorage.setItem(storageKey, JSON.stringify(nextMembers));
      setMembers(nextMembers);
      setError("");
      return true;
    } catch {
      setError("Could not update project members. Please try again.");
      return false;
    }
  }

  function continueInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(
      new FormData(event.currentTarget).get("email") ?? "",
    ).trim();
    if (!email) return;

    const current = readMembers();
    if (
      current.some(
        (member) => member.email.toLowerCase() === email.toLowerCase(),
      )
    ) {
      setError("This email is already on the project member list.");
      return;
    }
    if (saveMembers([...current, { email, status: "Invited" }])) {
      navigate("..", { relative: "path", replace: true });
    }
  }

  return (
    <section className="project-users" aria-labelledby="project-users-title">
      <h1 id="project-users-title">
        <Link to={step === "members" ? ".." : "../.."} relative="path">
          Project settings
        </Link>
        <span aria-hidden="true"> &gt; </span>
        Users &amp; Roles
      </h1>
      {!isProjectOwner && (
        <>
          <button className="project-users__add" type="button" disabled>
            <span aria-hidden="true">+</span>
            Add new user to the project
          </button>
          <div className="project-users__empty">
            <p>Failed to load project members.</p>
            <p>You may lack administrative privileges.</p>
            <p>Try reloading the page.</p>
          </div>
        </>
      )}
      {isProjectOwner && step === "members" && (
        <>
          <Link className="project-users__add" to="invite">
            <span aria-hidden="true">+</span>
            Add new user to the project
          </Link>
          <Suspense fallback={<LoadingState />}>
            <ProjectUsersContent
              members={members}
              onRemove={(email) => {
                saveMembers(
                  readMembers().filter((member) => member.email !== email),
                );
              }}
            />
          </Suspense>
        </>
      )}
      {isProjectOwner && step === "invite" && (
        <form className="project-users__invite" onSubmit={continueInvitation}>
          <input
            name="email"
            type="email"
            required
            autoFocus
            onChange={() => setError("")}
            aria-label="Teammate email"
            placeholder="Enter your teammate’s email and send an invitation"
          />
          <button type="submit" aria-label="Invite teammate">
            +
          </button>
        </form>
      )}
      {error && (
        <p className="project-users__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
