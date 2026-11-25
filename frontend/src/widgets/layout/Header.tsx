import { useEffect, useSyncExternalStore } from "react";
import { Link, NavLink, useMatch } from "react-router-dom";
import { useAccount } from "../../features/account/useAccount";
import {
  hasUnreadNotifications,
  markNotificationsRead,
  subscribeToUnreadNotifications,
} from "../../features/notifications/model/unreadNotifications";
import { projectSections } from "../../features/projects/model/projectSections";
import "./Header.css";

const brandUrl = new URL("./team-ai-orchestrator.svg", import.meta.url).href;

const sections = {
  tasks: (
    <path
      fillRule="evenodd"
      d="M41 16h23v8h15v31H56v-8H41zm3 4v3h17v-3zm0 5v3h12v-3zm0 5v3h12v-3zm0 5v3h12v-3zm0 5v3h12v-3zm15-12v3h17v-3zm0 5v3h17v-3zm0 5v3h17v-3zm0 5v3h17v-3zm0 5v3h17v-3z"
    />
  ),
  chat: (
    <path
      fillRule="evenodd"
      d="M34 17h14a10 10 0 0 1 10 10v9l2 7-9-4H34a10 10 0 0 1-10-10v-2a10 10 0 0 1 10-10zm-2 8a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm9 0a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm9 0a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm22 3h14a10 10 0 0 1 10 10v2a10 10 0 0 1-10 10H69l-9 4 2-7v-9a10 10 0 0 1 10-10zm-2 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm8 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm8 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
    />
  ),
  analytics: (
    <g fill="none" stroke="currentColor" strokeWidth="5">
      <circle cx="43" cy="36" r="10.5" />
      <circle cx="77" cy="36" r="10.5" />
      <path d="M25 32h8m20 0h14m20 0h8" strokeWidth="4" />
    </g>
  ),
  settings: (
    <g fill="none" stroke="currentColor" strokeWidth="5">
      <circle cx="60" cy="36" r="8" />
      <path
        strokeWidth="6"
        d="M60 20v8m0 16v8M44 36h8m16 0h8M49 25l5.5 5.5m11 11L71 47m0-22-5.5 5.5m-11 11L49 47"
      />
    </g>
  ),
  decisions: (
    <path d="M61.4 14.2 67.5 19.5Q69.6 21.3 69.6 24.5L71.7 21.9 75.6 25.2 74.3 26.8 74.9 28Q77.6 27.9 79.8 29.8L86.1 35.5 77.5 45.7 70.8 40Q68.5 38.1 68.3 35L67.4 34.7 46 60.2 42.3 57 64 31Q61.3 31.4 58.7 29.2L52.8 24.4Z" />
  ),
};

const navigation = Object.keys(sections) as (keyof typeof sections)[];

export function Header({
  showProjectNavigation = true,
}: {
  showProjectNavigation?: boolean;
}) {
  const account = useAccount();
  const projectId = useMatch("/projects/:projectId/*")?.params.projectId;
  const projectPath =
    showProjectNavigation &&
    projectId &&
    `/projects/${encodeURIComponent(projectId)}`;
  const inboxOpen = Boolean(useMatch("/inbox"));
  const unread = useSyncExternalStore(
    subscribeToUnreadNotifications,
    hasUnreadNotifications,
  );

  useEffect(() => {
    if (inboxOpen && unread) markNotificationsRead();
  }, [inboxOpen, unread]);

  return (
    <header className="app-header">
      <Link
        className="app-header__brand"
        to={projectPath ? `${projectPath}/tasks` : "/projects"}
      >
        <img src={brandUrl} alt="TEAM AI Orchestrator" />
      </Link>
      {projectPath && (
        <nav className="app-header__sections" aria-label="Project sections">
          {navigation.map((path) => (
            <NavLink
              className="app-header__item"
              key={path}
              to={`${projectPath}/${path}`}
              end={
                path !== "settings" && path !== "tasks" && path !== "decisions"
              }
            >
              <svg viewBox="0 0 120 62" aria-hidden="true" fill="currentColor">
                {sections[path]}
              </svg>
              <span>
                {
                  projectSections.find((section) => section.path === path)
                    ?.label
                }
              </span>
            </NavLink>
          ))}
        </nav>
      )}
      <nav className="app-header__account" aria-label="Account">
        <NavLink
          className="app-header__item app-header__inbox"
          to="/inbox"
          aria-label={
            unread && !inboxOpen ? "Inbox, unread notifications" : "Inbox"
          }
          end
        >
          <svg viewBox="0 0 120 95" aria-hidden="true" fill="currentColor">
            <path d="M38 27h43L60 42zm-5 3 27 18 26-18a10 10 0 0 1 3 7v20a10 10 0 0 1-10 10H40a10 10 0 0 1-10-10V37a10 10 0 0 1 3-7z" />
          </svg>
          {unread && !inboxOpen && (
            <span className="app-header__unread" aria-hidden="true" />
          )}
        </NavLink>
        <NavLink
          className="app-header__item app-header__profile"
          to="/profile"
          aria-label="Profile"
          end
        >
          {account?.avatar ? (
            <img src={account.avatar} alt="" />
          ) : (
            <svg viewBox="0 0 95 95" aria-hidden="true" fill="currentColor">
              <circle cx="47.5" cy="34" r="13" />
              <path d="M23 72a24.5 24.5 0 0 1 49 0z" />
            </svg>
          )}
        </NavLink>
      </nav>
    </header>
  );
}
