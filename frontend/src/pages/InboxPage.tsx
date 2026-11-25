import { useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import {
  inboxSnapshot,
  parseInbox,
  subscribeToUnreadNotifications,
} from "../features/notifications/model/unreadNotifications";
import "./InboxPage.css";

const date = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function InboxPage() {
  const entries = parseInbox(
    useSyncExternalStore(subscribeToUnreadNotifications, inboxSnapshot),
  );
  return (
    <section className="project-inbox" aria-labelledby="project-inbox-title">
      <h1 id="project-inbox-title">Inbox</h1>
      {entries.length ? (
        <ul>
          {entries.map((entry) => {
            const project = `/projects/${encodeURIComponent(entry.projectId)}`;
            return (
              <li key={entry.id}>
                <time dateTime={entry.receivedAt}>
                  {date.format(new Date(entry.receivedAt))}
                </time>
                {entry.type === "revision-request" ? (
                  <>
                    <h2>Revision requested for {entry.adr}</h2>
                    <p>
                      A revision was requested for your proposal. Open Decisions
                      to review the feedback.
                    </p>
                    <Link
                      to={`${project}/decisions/${encodeURIComponent(entry.proposalId)}/revise`}
                    >
                      Review revision request
                    </Link>
                  </>
                ) : (
                  <>
                    <h2>Invitation to {entry.projectName}</h2>
                    <p>
                      {entry.invitedBy
                        ? `${entry.invitedBy} invited you`
                        : "You were invited"}{" "}
                      to join this project.
                    </p>
                    <Link to={project}>Open project</Link>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p>No notifications yet.</p>
      )}
    </section>
  );
}
