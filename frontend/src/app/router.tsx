import { lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "../widgets/layout/AppShell";

import { projectSections } from "../features/projects/model/projectSections";
import { RouteError } from "./RouteError";
import { AccountAccessPage } from "../pages/AccountAccessPage";
import ProfilePage from "../pages/ProfilePage";

const ProjectUsersPage = lazy(() =>
  import("../pages/ProjectUsersPage").then(({ ProjectUsersPage }) => ({
    default: ProjectUsersPage,
  })),
);
const ProjectsPage = lazy(() => import("../pages/ProjectsPage"));
const ProjectSectionPage = lazy(() => import("../pages/ProjectSectionPage"));
const ProjectSettingsPage = lazy(() => import("../pages/ProjectSettingsPage"));
const ProjectTasksPage = lazy(() => import("../pages/ProjectTasksPage"));
const ProjectChatPage = lazy(() => import("../pages/ProjectChatPage"));
const ProjectAnalyticsPage = lazy(
  () => import("../pages/ProjectAnalyticsPage"),
);
const ProjectDecisionsPage = lazy(
  () => import("../pages/ProjectDecisionsPage"),
);
const ProjectGitHubPage = lazy(() => import("../pages/ProjectGitHubPage"));
const ProjectProposalPage = lazy(() => import("../pages/ProjectProposalPage"));
const InboxPage = lazy(() => import("../pages/InboxPage"));
const NotFoundPage = lazy(() => import("../pages/NotFoundPage"));

const profileRoute = {
  path: "profile",
  element: <ProfilePage />,
};

export const router = createBrowserRouter(
  [
    { path: "login", element: <AccountAccessPage key="login" mode="login" /> },
    {
      path: "reset-password",
      element: <AccountAccessPage key="reset" mode="reset" />,
    },
    {
      path: "register",
      element: <AccountAccessPage key="register" mode="register" />,
    },
    {
      element: <AppShell />,
      errorElement: <RouteError />,
      children: [
        { index: true, element: <Navigate to="/projects" replace /> },
        { path: "projects", element: <ProjectsPage /> },
        { path: "inbox", element: <InboxPage /> },
        profileRoute,
        {
          path: "projects/:projectId",
          children: [
            { index: true, element: <Navigate to="tasks" replace /> },
            { path: "decisions/new", element: <ProjectProposalPage /> },
            {
              path: "decisions/:proposalId/revise",
              element: <ProjectProposalPage />,
            },
            ...projectSections.map(({ path, label }) => ({
              path,
              element:
                path === "settings" ? (
                  <ProjectSettingsPage />
                ) : path === "tasks" ? (
                  <ProjectTasksPage />
                ) : path === "chat" ? (
                  <ProjectChatPage />
                ) : path === "analytics" ? (
                  <ProjectAnalyticsPage />
                ) : path === "decisions" ? (
                  <ProjectDecisionsPage />
                ) : (
                  <ProjectSectionPage title={label} />
                ),
            })),
            {
              path: "tasks/new",
              element: <ProjectTasksPage action="create" />,
            },
            {
              path: "tasks/decompose",
              element: <ProjectTasksPage action="decompose" />,
            },
            {
              path: "settings/user",
              element: <ProjectUsersPage />,
            },
            {
              path: "settings/user/invite",
              element: <ProjectUsersPage step="invite" />,
            },
            {
              path: "settings/user/invite/review",
              element: <Navigate to=".." relative="path" replace />,
            },
            {
              path: "settings/github",
              element: <ProjectGitHubPage />,
            },
            { path: "inbox", element: <Navigate to="/inbox" replace /> },
            { path: "profile", element: <Navigate to="/profile" replace /> },
          ],
        },
        { path: "*", element: <NotFoundPage /> },
      ],
    },
  ],
  { future: { v7_relativeSplatPath: true } },
);
