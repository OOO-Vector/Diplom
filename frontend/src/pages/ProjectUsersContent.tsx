import type { ProjectMember } from "./ProjectUsersPage";

export default function ProjectUsersContent({
  members,
  onRemove,
}: {
  members: readonly ProjectMember[];
  onRemove: (email: string) => void;
}) {
  if (members.length > 0) {
    return (
      <ul className="project-users__members" aria-label="Project members">
        <li>
          <span className="project-users__avatar" aria-hidden="true">
            Y
          </span>
          <div>
            <strong>You</strong>
            <small>Owner | Active</small>
          </div>
        </li>
        {members.map(({ email, status }) => (
          <li key={email}>
            <span className="project-users__avatar" aria-hidden="true">
              {email[0]?.toUpperCase()}
            </span>
            <div>
              <strong>{email}</strong>
              <small>Member | {status}</small>
            </div>
            <button
              type="button"
              aria-label={
                status === "Invited"
                  ? `Remove invitation for ${email}`
                  : `Remove member ${email}`
              }
              onClick={() => onRemove(email)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="project-users__empty">
      <p>No members in this project yet.</p>
      <p>Click “Add new user to the project” to invite teammates.</p>
    </div>
  );
}
