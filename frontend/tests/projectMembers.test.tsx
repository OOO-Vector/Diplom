import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import * as projectApi from "../src/features/projects/model/projectApi";
import type { WorkspaceContext } from "../src/features/projects/model/workspaceContext";
import ServerProjectMembers from "../src/pages/ServerProjectMembers";
import { ApiError } from "../src/shared/api/requestApi";

vi.mock("../src/features/projects/model/projectApi", () => ({
  listMembers: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  transferOwnership: vi.fn(),
}));

const owner: projectApi.ProjectMember = {
  userId: "owner",
  displayName: "Project owner",
  role: "owner",
  joinedAt: "2026-01-01T00:00:00Z",
};
const member: projectApi.ProjectMember = {
  ...owner,
  userId: "member",
  displayName: "Teammate",
  role: "member",
};

function renderMembers(isProjectOwner: boolean) {
  const context: WorkspaceContext = {
    project: {
      id: "project",
      name: "Project",
      status: "active",
      myRole: isProjectOwner ? "owner" : "member",
    },
    projects: [],
    projectsLoading: false,
    projectsFailed: false,
    archived: false,
    isProjectOwner,
    createProject: vi.fn(),
    updateProject: vi.fn(),
  };
  return render(
    <MemoryRouter initialEntries={["/settings/user"]}>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route
            path="/settings/user"
            element={<ServerProjectMembers invite={false} />}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("shows the roster to a member and hides membership mutations", async () => {
  vi.mocked(projectApi.listMembers).mockResolvedValue([owner, member]);
  renderMembers(false);

  const roster = await screen.findByRole("list", { name: "Project members" });
  expect(within(roster).getByText("Teammate")).toBeTruthy();
  expect(
    screen.queryByRole("link", { name: "Add new user to the project" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Transfer ownership" }),
  ).toBeNull();
});

it("retains the roster after a rejected removal and refreshes it after a successful retry", async () => {
  vi.mocked(projectApi.listMembers)
    .mockResolvedValueOnce([owner, member])
    .mockResolvedValueOnce([owner]);
  vi.mocked(projectApi.removeMember)
    .mockRejectedValueOnce(new ApiError("Membership changed. Try again.", 409))
    .mockResolvedValueOnce(undefined);
  renderMembers(true);

  fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
  const confirmation = screen.getByRole("group", {
    name: "Confirm membership change",
  });
  const confirm = within(confirmation).getByRole("button", { name: "Confirm" });
  expect(projectApi.removeMember).not.toHaveBeenCalled();
  fireEvent.click(confirm);

  expect((await screen.findByRole("alert")).textContent).toContain(
    "Membership changed.",
  );
  expect(screen.getByText("Teammate")).toBeTruthy();
  fireEvent.click(confirm);

  await waitFor(() => expect(screen.queryByText("Teammate")).toBeNull());
  const roster = await screen.findByRole("list", { name: "Project members" });
  expect(within(roster).getByText("Project owner")).toBeTruthy();
  expect(within(roster).queryByText("Teammate")).toBeNull();
  expect(projectApi.removeMember).toHaveBeenCalledTimes(2);
  expect(projectApi.removeMember).toHaveBeenLastCalledWith(
    "project",
    "member",
    expect.any(AbortSignal),
  );
});
