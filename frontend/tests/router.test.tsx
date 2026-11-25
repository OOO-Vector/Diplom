import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { webcrypto } from "node:crypto";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { RouterProvider } from "react-router-dom";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { router } from "../src/app/router";
import {
  hasUnreadNotifications,
  receiveNotification,
} from "../src/features/notifications/model/unreadNotifications";
import { submitProjectProposal } from "../src/features/projects/model/projectDecisions";
import {
  readProjectAnalytics,
  recordBacklogReview,
  recordDecomposition,
} from "../src/features/projects/model/projectAnalytics";
import {
  createItem,
  emptyBacklog,
  readBacklog,
} from "../src/features/projects/model/taskBacklog";
import {
  listProjectDocuments,
  storeProjectDocuments,
} from "../src/features/projects/model/projectDocuments";

beforeEach(() => {
  vi.stubEnv("VITE_AUTH_MODE", "local-demo");
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.setItem(
    "team-ai.accounts",
    JSON.stringify([
      {
        id: "test-account",
        namespace: "",
        name: "Test User",
        email: "test@example.com",
        salt: "fixture",
        passwordHash: "fixture",
      },
    ]),
  );
  sessionStorage.setItem("team-ai.session", "test-account");
});

afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("registers, updates, signs out, signs in and deletes a browser account", async () => {
  sessionStorage.clear();
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  await router.navigate("/");
  render(<App />);
  fireEvent.click(
    await screen.findByRole("link", { name: "Create an account" }),
  );
  fireEvent.change(screen.getByLabelText("Display name"), {
    target: { value: "Alex" },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "alex@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "original-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Register" }));
  expect(
    await screen.findByRole("heading", { name: "Projects" }, { timeout: 3000 }),
  ).toBeTruthy();
  expect(localStorage.getItem("team-ai.accounts")).not.toContain(
    "original-password",
  );

  fireEvent.click(screen.getByRole("link", { name: "Profile" }));
  expect(
    await screen.findByRole("heading", { name: "Account settings" }),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Display name"), {
    target: { value: "Alex Updated" },
  });
  fireEvent.change(screen.getByLabelText("Avatar"), {
    target: {
      files: [new File(["avatar"], "avatar.png", { type: "image/png" })],
    },
  });
  expect(await screen.findByAltText("Avatar preview")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  expect(await screen.findByText("Profile saved.")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Profile" })
      .querySelector("img")
      ?.getAttribute("src"),
  ).toMatch(/^data:image\/png/);
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "original-password" },
  });
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "changed-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  expect(
    await screen.findByText("Password changed.", {}, { timeout: 3000 }),
  ).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "alex@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "original-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(
    await screen.findByRole("alert", {}, { timeout: 3000 }),
  ).toHaveProperty("textContent", "Email or password is incorrect.");
  fireEvent.click(screen.getByRole("link", { name: "Forgot password?" }));
  expect(screen.getByRole("heading", { name: "Reset password" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("New password", { exact: true }), {
    target: { value: "recovered-password" },
  });
  const confirmation = screen.getByLabelText("Confirm new password");
  fireEvent.change(confirmation, { target: { value: "different-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  expect(
    await screen.findByText("The two passwords do not match."),
  ).toBeTruthy();
  fireEvent.change(confirmation, { target: { value: "recovered-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  expect(
    await screen.findByText(
      "Password reset. Sign in with your new password.",
      {},
      { timeout: 3000 },
    ),
  ).toBeTruthy();
  expect(router.state.location.pathname).toBe("/login");
  expect(screen.getByLabelText<HTMLInputElement>("Email").value).toBe(
    "alex@example.com",
  );
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "recovered-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  fireEvent.click(
    await screen.findByRole("link", { name: "Profile" }, { timeout: 3000 }),
  );
  expect(screen.getByLabelText<HTMLInputElement>("Display name").value).toBe(
    "Alex Updated",
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: "recovered-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
  expect(
    await screen.findByRole("heading", { name: "Sign in" }, { timeout: 3000 }),
  ).toBeTruthy();
  expect(localStorage.getItem("team-ai.accounts")).toBe("[]");
}, 20000);

it("opens GitHub settings with editable fields and a masked token", async () => {
  localStorage.setItem(
    "team-ai.projects",
    JSON.stringify([{ id: "example", name: "Example" }]),
  );
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: {
            "x-ratelimit-limit": "5000",
            "x-ratelimit-remaining": "750",
            "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 1080),
          },
        }),
      ),
  );
  await router.navigate("/projects/example/settings");
  render(<App />);
  fireEvent.click(await screen.findByRole("link", { name: "GitHub settings" }));
  const repository = await screen.findByRole<HTMLInputElement>("textbox", {
    name: "Project repository URL",
  });
  fireEvent.change(repository, {
    target: { value: "https://github.com/example/repository" },
  });
  expect(repository.value).toBe("https://github.com/example/repository");

  const token = screen.getByLabelText<HTMLInputElement>(
    "GitHub Personal access token",
  );
  expect(token.type).toBe("password");
  fireEvent.change(token, { target: { value: "test-token" } });
  fireEvent.click(screen.getByRole("button", { name: "Show access token" }));
  expect(token.type).toBe("text");
  expect(token.value).toBe("test-token");
  fireEvent.click(screen.getByRole("button", { name: "Hide access token" }));
  expect(token.type).toBe("password");
  fireEvent.click(screen.getByRole("button", { name: "Synchronise" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "GitHub authentication token expired or invalid permissions.",
  );
  expect(token.value).toBe("");
  expect(token.getAttribute("aria-invalid")).toBe("true");
  expect(repository.value).toBe("https://github.com/example/repository");
  fireEvent.change(token, { target: { value: "replacement-token" } });
  fireEvent.click(screen.getByRole("button", { name: "Synchronise" }));
  expect(await screen.findByText("Local sync preview on")).toBeTruthy();
  expect(screen.getByText(/85% of hourly quota used/)).toBeTruthy();
  expect(screen.getByText("750 / 5,000 requests/hr")).toBeTruthy();
  expect(screen.getByRole("timer").textContent).toMatch(/^\d+m \d{2}s$/);
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  expect(screen.getByText("Never")).toBeTruthy();
  expect(repository.value).toBe("");
  expect(token.value).toBe("");
  expect(screen.queryByRole("timer")).toBeNull();
});

it("redirects the root to the projects workspace", async () => {
  await router.navigate("/");
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Projects" })).toBeTruthy();
  expect(router.state.location.pathname).toBe("/projects");
  expect(screen.getByRole("main")).toBeTruthy();
});

it("keeps project context on deep links and highlights the active section", async () => {
  localStorage.setItem(
    "team-ai.projects",
    JSON.stringify([{ id: "example", name: "Example" }]),
  );
  await router.navigate("/projects/example/tasks");
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "Project tasks" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Tasks" }).getAttribute("aria-current"),
  ).toBe("page");
  expect(screen.getByRole("link", { name: "Chat" }).getAttribute("href")).toBe(
    "/projects/example/chat",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Create a task manually" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Create a task manually" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));

  const load = await screen.findByRole("button", { name: "Load document" });
  const picker = screen.getByLabelText("Project document");
  const openPicker = vi.spyOn(picker, "click");
  fireEvent.click(load);
  expect(openPicker).toHaveBeenCalledOnce();
  fireEvent.change(picker, {
    target: { files: [new File(["Specification"], "project.md")] },
  });
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Unsupported file format.",
  );
  expect(
    screen.queryByRole("link", { name: "Decompose into tasks" }),
  ).toBeNull();

  const oversized = new File(["Specification"], "oversized.txt");
  Object.defineProperty(oversized, "size", { value: 10 * 1024 * 1024 + 1 });
  fireEvent.change(picker, { target: { files: [oversized] } });
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("up to 10 MiB."),
  );

  const text =
    "# Specification\nBuild a workspace\n- Create schema\n- Add workspace routes";
  const specification = new File([text], "project.txt");
  Object.defineProperty(specification, "arrayBuffer", {
    value: async () => new TextEncoder().encode(text).buffer,
  });
  fireEvent.change(picker, { target: { files: [specification] } });
  const decompose = await screen.findByRole("link", {
    name: "Decompose into tasks",
  });
  expect(screen.getByText("Loaded file: project.txt")).toBeTruthy();
  expect(
    screen.queryByRole("combobox", { name: "Specification version" }),
  ).toBeNull();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  await act(async () => {
    fireEvent.click(decompose);
  });
  expect(screen.getByText(/Extracting text layer/)).toBeTruthy();
  await act(async () => vi.advanceTimersByTimeAsync(1200));
  expect(await screen.findByText("Decomposing requirements...")).toBeTruthy();
  await act(async () => vi.advanceTimersByTimeAsync(11800));
  expect(screen.getByText(/Validating JSON schema/)).toBeTruthy();
  expect(screen.getByRole("timer").textContent).toBe("13.0 s");
  await act(async () => vi.advanceTimersByTimeAsync(1500));
  vi.useRealTimers();
  expect(
    await screen.findByText("Created 1 epics, 1 tasks, 2 subtasks"),
  ).toBeTruthy();
  expect(screen.queryByText(/Local preview completed/)).toBeNull();
  const previewPicker = screen.getByLabelText("Project document");
  const previewPickerClick = vi.spyOn(previewPicker, "click");
  fireEvent.click(screen.getByRole("button", { name: "Load document" }));
  expect(previewPickerClick).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog", { name: "Specifications" })).toBeNull();
  expect(screen.getByText("Blocked by: 1.1.1")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Collapse Build a workspace" }),
  );
  expect(screen.queryByRole("button", { name: /Create schema/ })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Expand Build a workspace" }),
  );
  const subtask = screen.getByRole("button", { name: /Create schema/ });
  fireEvent.click(subtask);
  expect(screen.getByRole("dialog", { name: "Create schema" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  fireEvent.doubleClick(subtask);
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Add workspace routes" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.queryByRole("dialog", { name: "Edit subtask" })).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("DAG error");
  expect(screen.getByRole("button", { name: "Confirm" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.doubleClick(subtask);
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Add workspace routes" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  fireEvent.click(screen.getByRole("button", { name: "Publish to GitHub" }));
  expect(
    screen.queryByRole("dialog", { name: "Publish to GitHub" }),
  ).toBeNull();
  expect(
    screen.getByText("A GitHub publishing connection is required."),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Create a task manually" }),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Type" }), {
    target: { value: "subtask" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
    target: { value: "Review routes" },
  });
  const parent = screen.getByRole<HTMLSelectElement>("combobox", {
    name: "Parent",
  });
  fireEvent.change(parent, { target: { value: parent.options[1]?.value } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("button", { name: /Review routes/ })).toBeTruthy();
  expect(screen.getByText("Created 1 epics, 1 tasks, 3 subtasks")).toBeTruthy();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  await act(async () => {
    await router.navigate(
      "/projects/example/tasks/decompose?decompositionDemo=error",
      {
        state: { documentName: "project.txt" },
      },
    );
  });
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  vi.useRealTimers();
  expect((await screen.findByRole("alert")).textContent).toContain(
    "No partial draft was saved.",
  );
  expect(readBacklog("team-ai.backlog:example").items).toHaveLength(5);
});

it("shows the next mutual dependency after the first pair is fixed", async () => {
  localStorage.setItem(
    "team-ai.backlog:example",
    JSON.stringify({
      items: [
        {
          id: "epic",
          kind: "epic",
          parentId: null,
          title: "Epic",
          description: "",
          blockedBy: [],
        },
        ...["A", "B", "C", "D"].map((title, index) => ({
          id: title,
          kind: "task",
          parentId: "epic",
          title,
          description: "",
          blockedBy: [["B"], ["A"], ["D"], ["C"]][index],
        })),
      ],
      generationMs: 1000,
      confirmed: false,
    }),
  );
  await router.navigate("/projects/example/tasks");
  render(<App />);
  expect((await screen.findByRole("alert")).textContent).toBe(
    "DAG error: Task #1.1 and #1.2 block each other",
  );
  fireEvent.doubleClick(screen.getByRole("button", { name: "Task 1.1: A" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "B" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("alert").textContent).toBe(
    "DAG error: Task #1.3 and #1.4 block each other",
  );
  expect(screen.getByText("Generated in 1.000 s")).toBeTruthy();
});

it("keeps published structure read-only while allowing status changes", async () => {
  localStorage.setItem(
    "team-ai.projects",
    JSON.stringify([{ id: "example", name: "Example" }]),
  );
  localStorage.setItem(
    "team-ai.backlog:example",
    JSON.stringify({
      items: [
        {
          id: "epic",
          kind: "epic",
          parentId: null,
          title: "Original",
          description: "",
          blockedBy: [],
          githubSync: "synced",
        },
      ],
      generationMs: null,
      confirmed: true,
    }),
  );
  await router.navigate("/projects/example/tasks");
  render(<App />);
  const row = await screen.findByRole("button", { name: "Epic 1: Original" });
  expect(
    screen.getByRole("button", { name: "Confirmed" }).dataset.completed,
  ).toBe("true");
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Published to GitHub",
    }).disabled,
  ).toBe(true);
  fireEvent.doubleClick(row);
  expect(screen.queryByRole("dialog", { name: "Edit epic" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Create a task manually" }),
  ).toHaveProperty("disabled", true);
  fireEvent.click(row);
  fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
    target: { value: "ready" },
  });
  expect(readBacklog("team-ai.backlog:example").items[0]).toMatchObject({
    title: "Original",
    githubSync: "synced",
    status: "ready",
  });
  expect(
    screen.getByRole("button", { name: "Confirmed" }).dataset.completed,
  ).toBe("true");
});

it("sends a multiline message and an attachment in the selected chat", async () => {
  await router.navigate("/projects/example/chat");
  render(<App />);
  expect(await screen.findByText("How can I help you?")).toBeTruthy();
  const picker = screen.getByLabelText("Chat documents");
  const openPicker = vi.spyOn(picker, "click");
  fireEvent.click(screen.getByRole("button", { name: "Attach documents" }));
  expect(openPicker).toHaveBeenCalledOnce();
  fireEvent.change(picker, {
    target: { files: [new File(["Specification"], "project.txt")] },
  });
  const message = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Message",
  });
  fireEvent.change(message, { target: { value: "First line\nSecond line" } });
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Send message" })
        .disabled,
    ).toBe(false),
  );
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  expect(screen.getByRole("log").textContent).toContain(
    "First line\nSecond line",
  );
  expect(screen.getByRole("log").textContent).toContain("project.txt");
  expect(message.value).toBe("");
  expect(
    screen.getByRole("status", { name: "Generating response" }),
  ).toBeTruthy();
  act(() => vi.advanceTimersByTime(1200));
  expect(screen.getByRole("timer").textContent).toBe("1.2 s");
  expect(screen.getByRole("log").textContent).toContain("Demo response.");
  fireEvent.click(screen.getByRole("button", { name: "Stop generation" }));
  expect(screen.queryByRole("timer")).toBeNull();
  const stopped = screen.getByRole("log").textContent;
  act(() => vi.advanceTimersByTime(6000));
  expect(screen.getByRole("log").textContent).toBe(stopped);
  expect(screen.getByRole("button", { name: "Send message" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const edit = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Edit message",
  });
  expect(edit.value).toBe("First line\nSecond line");
  expect(
    screen.getByRole("list", { name: "Pending attachments" }).textContent,
  ).toContain("project.txt");
  fireEvent.change(edit, { target: { value: "Revised message" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  const log = screen.getByRole("log");
  expect(log.textContent).not.toContain("First line");
  expect(log.textContent).toContain("Revised message");
  expect(log.textContent).toContain("project.txt");
  expect(screen.getByRole("timer").textContent).toBe("0.0 s");
  act(() => vi.advanceTimersByTime(6000));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(readProjectAnalytics("example").answers.count).toBe(1);
  expect(screen.getByRole("timer").textContent).toBe("0.0 s");
  expect(screen.getAllByText("Revised message")).toHaveLength(1);
  expect(log.textContent).not.toContain("Demo response.");
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Chat name" }), {
    target: { value: "Design discussion" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create chat" }));
  expect(
    screen.getByRole("heading", { name: "Design discussion" }),
  ).toBeTruthy();
  const dialogueSearch = screen.getByRole("searchbox", {
    name: "Search dialogues",
  });
  fireEvent.change(dialogueSearch, { target: { value: "Design" } });
  expect(screen.queryByRole("button", { name: "New chat 1" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Clear search dialogues" }),
  );
  expect(dialogueSearch).toHaveProperty("value", "");
  expect(document.activeElement).toBe(dialogueSearch);
  expect(screen.getByText("How can I help you?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "New chat 1" }));
  expect(screen.getByRole("log").textContent).toContain("project.txt");
});

it("shares project documents and their context settings across chats", async () => {
  const project = "docs-example";
  const specification = new File(["Specifications"], "project.txt");
  await storeProjectDocuments(project, null, [specification]);
  await storeProjectDocuments(project, "1", [new File(["Notes"], "notes.txt")]);
  await storeProjectDocuments(project, "2", [new File(["Plan"], "plan.txt")]);
  await storeProjectDocuments("another-project", null, [
    new File(["Private"], "private.txt"),
  ]);
  await router.navigate(`/projects/${project}/chat`);
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "Project docs" }));
  const projectDoc = await screen.findByRole("button", {
    name: "Use project.txt in replies",
  });
  expect(
    screen.getByRole("button", { name: "Use notes.txt in replies" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Use plan.txt in replies" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Use private.txt in replies" }),
  ).toBeNull();
  fireEvent.click(projectDoc);
  await waitFor(() =>
    expect(projectDoc.getAttribute("aria-pressed")).toBe("false"),
  );

  const stored = await listProjectDocuments(project);
  expect(stored.find(({ name }) => name === "project.txt")?.enabled).toBe(
    false,
  );
  expect(
    stored.find(({ name }) => name === "project.txt")?.bytes.byteLength,
  ).toBe(14);
  fireEvent.click(screen.getByRole("button", { name: "Project docs" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Check my document scope" },
  });
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  act(() => vi.advanceTimersByTime(6000));
  expect(screen.getByRole("log").textContent).toContain(
    "2 documents selected for context",
  );
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  fireEvent.click(screen.getByRole("button", { name: "Create chat" }));
  fireEvent.click(screen.getByRole("button", { name: "Project docs" }));
  expect(
    screen
      .getByRole("button", { name: "Use project.txt in replies" })
      .getAttribute("aria-pressed"),
  ).toBe("false");
  expect(
    screen.getByRole("button", { name: "Use notes.txt in replies" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Use plan.txt in replies" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Project docs" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Check the next chat" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  act(() => vi.advanceTimersByTime(6000));
  expect(screen.getByRole("log").textContent).toContain(
    "2 documents selected for context",
  );
});

it("renders recorded proposal outcomes and project timings in Analytics", async () => {
  const project = "analytics-example";
  const accepted = createItem("epic", null, "Accepted epic");
  const edited = createItem("epic", null, "Edited epic");
  const rejected = createItem("epic", null, "Rejected epic");
  recordDecomposition(project, [accepted], 1000, false);
  recordDecomposition(project, [edited], 2000, false);
  recordDecomposition(project, [rejected], 6000, false);
  const draft = { ...emptyBacklog, items: [accepted, edited, rejected] };
  const revised = {
    ...draft,
    items: [accepted, { ...edited, title: "Updated" }],
  };
  recordBacklogReview(project, draft, revised, true);
  recordBacklogReview(project, revised, { ...revised, confirmed: true }, false);
  await router.navigate(`/projects/${project}/analytics`);
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "AI operation analytics" }),
  ).toBeTruthy();
  expect(screen.getByRole("row", { name: "#001 #002 #003" })).toBeTruthy();
  expect(screen.getByText("6.00")).toBeTruthy();
  expect(screen.getByText("3.00")).toBeTruthy();
  expect(
    screen.getByText("DAG cycle checks").parentElement?.textContent,
  ).toContain("Cycles found 1");
  expect(
    screen.getByText("Answer generation time, s").parentElement?.textContent,
  ).toContain("N/A");
});

it("opens Decisions with a collapsed sidebar and mutually exclusive filters", async () => {
  await router.navigate("/projects/example/decisions");
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "Proposals and decisions" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Expand projects sidebar" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.getByRole("status").textContent).toBe(
    "No proposals or decisions yet.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Proposed" }));
  expect(
    screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed"),
  ).toBe("false");
  expect(
    screen
      .getByRole("button", { name: "Proposed" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("link", { name: "Create a proposal" }));
  expect(
    await screen.findByRole("heading", { name: /New proposal/ }),
  ).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Submit" }).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Rationale" }), {
    target: { value: "Simplify storage." },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Decision" }), {
    target: { value: "Use a document store." },
  });
  const proposalTitle = screen.getByRole("textbox", { name: "Proposal title" });
  expect(proposalTitle).toHaveProperty("value", "");
  fireEvent.change(proposalTitle, {
    target: { value: "Storage architecture" },
  });
  expect(screen.getByRole("textbox", { name: "Decision" })).toHaveProperty(
    "value",
    "Use a document store.",
  );
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const check = screen.getByRole<HTMLButtonElement>("button", {
    name: "Check for conflicts",
  });
  fireEvent.click(check);
  expect(
    screen.getByRole("status", { name: "Checking for conflicts" }),
  ).toBeTruthy();
  expect(check.disabled).toBe(true);
  expect(screen.getByRole("link", { name: "Cancel" })).toBeTruthy();
  act(() => vi.advanceTimersByTime(1500));
  vi.useRealTimers();
  expect(check.disabled).toBe(false);
  expect(screen.getByRole("status").textContent).toContain(
    "No active approved decisions exist",
  );
  expect(
    screen
      .getByRole("link", { name: "Decisions" })
      .getAttribute("aria-current"),
  ).toBe("page");
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  expect(
    await screen.findByRole("heading", { name: "Proposals and decisions" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: "ADR-001: Storage architecture" }),
  ).toBeTruthy();
  expect(screen.getByText("Simplify storage.")).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Approve" }).disabled,
  ).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Reject" }).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Request revision" }));
  const memberRequest = screen.getByRole("dialog", {
    name: "Request revision",
  });
  fireEvent.change(within(memberRequest).getByRole("textbox"), {
    target: { value: "Add implementation details." },
  });
  fireEvent.click(
    within(memberRequest).getByRole("button", {
      name: "Send revision request",
    }),
  );
  expect(screen.getByText("Add implementation details.")).toBeTruthy();
});

it("lets the project owner approve, reject and request a revision", async () => {
  const project = "review-project";
  localStorage.setItem(
    "team-ai.projects",
    JSON.stringify([{ id: project, name: "Review" }]),
  );
  for (const decision of ["First", "Second", "Third"]) {
    submitProjectProposal(
      project,
      { title: decision, rationale: "Reason", decision },
      { summary: "Saved check", sources: [] },
      "Example author",
    );
  }
  await router.navigate(`/projects/${project}/decisions`);
  render(<App />);
  const first = await screen.findByRole("heading", { name: "ADR-001: First" });
  const card = (heading: HTMLElement) => within(heading.closest("li")!);
  fireEvent.click(card(first).getByRole("button", { name: "Approve" }));
  expect(card(first).getByText("Approved")).toBeTruthy();
  const second = screen.getByRole("heading", { name: "ADR-002: Second" });
  fireEvent.click(card(second).getByRole("button", { name: "Reject" }));
  expect(card(second).getByText("Rejected")).toBeTruthy();
  const third = screen.getByRole("heading", { name: "ADR-003: Third" });
  fireEvent.click(
    card(third).getByRole("button", { name: "Request revision" }),
  );
  const revision = screen.getByRole("dialog", { name: "Request revision" });
  fireEvent.change(
    within(revision).getByRole("textbox", { name: "What needs to change?" }),
    { target: { value: "Clarify the scope." } },
  );
  fireEvent.click(
    within(revision).getByRole("button", { name: "Send revision request" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Superseded" }));
  expect(screen.getByText("Clarify the scope.")).toBeTruthy();
  expect(screen.getByText("Saved check")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "ADR-001: First" })).toBeNull();
  fireEvent.click(
    screen.getByRole("link", { name: "Inbox, unread notifications" }),
  );
  expect(
    await screen.findByRole("heading", {
      name: "Revision requested for ADR-003",
    }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("link", { name: "Review revision request" }),
  );
  expect(
    await screen.findByRole("heading", { name: /Revise ADR-003/ }),
  ).toBeTruthy();
  expect(screen.getByText("Clarify the scope.")).toBeTruthy();
  const decision = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Decision",
  });
  expect(decision.value).toBe("Third");
  fireEvent.change(decision, { target: { value: "Third revised" } });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.click(screen.getByRole("button", { name: "Check for conflicts" }));
  act(() => vi.advanceTimersByTime(1500));
  vi.useRealTimers();
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  const revised = await screen.findByRole("heading", {
    name: "ADR-003: Third",
  });
  expect(card(revised).getByText("Proposed")).toBeTruthy();
  act(() =>
    receiveNotification({
      type: "revision-request",
      projectId: "another-project",
      proposalId: "other",
      adr: "ADR-004",
    }),
  );
  fireEvent.click(
    screen.getByRole("link", { name: "Inbox, unread notifications" }),
  );
  expect(
    await screen.findByRole("heading", {
      name: "Revision requested for ADR-004",
    }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("heading", { name: "Revision requested for ADR-003" }),
  ).toBeNull();
});

it("opens Tasks by default when entering a project", async () => {
  await router.navigate("/projects/example");
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "Project tasks" }),
  ).toBeTruthy();
  expect(router.state.location.pathname).toBe("/projects/example/tasks");
});

it("shows the inbox badge for incoming notifications and clears it on entry", async () => {
  await router.navigate("/projects/example/tasks");
  render(<App />);
  expect(await screen.findByRole("link", { name: "Inbox" })).toBeTruthy();
  act(() =>
    receiveNotification({
      type: "project-invitation",
      projectId: "example",
      projectName: "Example",
      invitedBy: "Alex",
    }),
  );
  act(() =>
    receiveNotification({
      type: "revision-request",
      projectId: "another-project",
      proposalId: "proposal",
      adr: "ADR-001",
    }),
  );
  const inbox = screen.getByRole("link", {
    name: "Inbox, unread notifications",
  });
  expect(inbox.getAttribute("href")).toBe("/inbox");
  expect(inbox.querySelector(".app-header__unread")).toBeTruthy();
  fireEvent.click(inbox);
  expect(await screen.findByRole("heading", { name: "Inbox" })).toBeTruthy();
  expect(router.state.location.pathname).toBe("/inbox");
  expect(
    screen.getByRole("heading", { name: "Invitation to Example" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Open project" }).getAttribute("href"),
  ).toBe("/projects/example");
  expect(
    screen
      .getByRole("link", { name: "Review revision request" })
      .getAttribute("href"),
  ).toBe("/projects/another-project/decisions/proposal/revise");
  expect(
    screen
      .getByRole("link", { name: "Inbox" })
      .querySelector(".app-header__unread"),
  ).toBeNull();
  expect(hasUnreadNotifications()).toBe(false);
});

it("hides project sections on the projects landing page", async () => {
  await router.navigate("/projects");
  render(<App />);
  expect(
    screen.queryByRole("navigation", { name: "Project sections" }),
  ).toBeNull();
});

it.each([
  ["  Example project  ", "Example project"],
  ["", "New project"],
])("creates a project from the sidebar with name %j", async (input, name) => {
  await router.navigate("/projects");
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: "New project" }));
  const sidebar = within(
    screen.getByRole("complementary", { name: "Projects" }),
  );
  const nameInput = sidebar.getByRole("textbox", { name: "Project name" });
  expect(document.activeElement).toBe(nameInput);
  fireEvent.change(nameInput, { target: { value: input } });
  fireEvent.click(sidebar.getByRole("button", { name: "Create project" }));

  expect(
    await screen.findByRole("heading", { name: "Project settings" }),
  ).toBeTruthy();
  const project = screen.getByRole("link", { name });
  expect(project.getAttribute("aria-current")).toBe("true");
  expect(router.state.location.pathname).toBe(project.getAttribute("href"));
  expect(
    screen.getByRole("link", { name: "Settings" }).getAttribute("aria-current"),
  ).toBe("page");

  cleanup();
  await router.navigate("/projects");
  render(<App />);
  expect(
    await within(screen.getByRole("main")).findByRole("link", { name }),
  ).toBeTruthy();
});

it("opens project settings with a collapsible sidebar and project-scoped links", async () => {
  localStorage.setItem(
    "team-ai.projects",
    JSON.stringify([{ id: "example", name: "Example" }]),
  );
  await router.navigate("/projects/example/settings");
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "Project settings" }),
  ).toBeTruthy();

  const toggle = screen.getByRole("button", {
    name: "Expand projects sidebar",
  });
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");

  expect(
    screen.getByRole("link", { name: "GitHub settings" }).getAttribute("href"),
  ).toBe("/projects/example/settings/github");
  fireEvent.click(screen.getByRole("link", { name: "User settings" }));
  expect(
    await screen.findByRole("heading", { name: /Users & Roles/ }),
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Add new user to the project" }),
  ).toBeTruthy();
  expect(
    await screen.findByText("No members in this project yet."),
  ).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.click(
    screen.getByRole("link", { name: "Add new user to the project" }),
  );
  const email = await screen.findByRole("textbox", { name: "Teammate email" });
  fireEvent.change(email, { target: { value: "teammate@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Invite teammate" }));
  expect(await screen.findByText("teammate@example.com")).toBeTruthy();
  expect(screen.getByText("Owner | Active")).toBeTruthy();
  expect(screen.getByText("Member | Invited")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Remove invitation for teammate@example.com",
    }),
  );
  expect(
    await screen.findByText("No members in this project yet."),
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Settings" }).getAttribute("aria-current"),
  ).toBe("page");
});

it("lets the owner remove an active member while retaining legacy invitations", async () => {
  localStorage.setItem(
    "team-ai.projects",
    JSON.stringify([{ id: "example", name: "Example" }]),
  );
  localStorage.setItem(
    "team-ai.invitations:example",
    JSON.stringify([
      { email: "active@example.com", status: "Active" },
      "invited@example.com",
    ]),
  );
  await router.navigate("/projects/example/settings/user");
  render(<App />);

  const remove = await screen.findByRole("button", {
    name: "Remove member active@example.com",
  });
  expect(screen.getByText("Member | Active")).toBeTruthy();
  fireEvent.click(remove);
  expect(screen.queryByText("active@example.com")).toBeNull();
  expect(screen.getByText("invited@example.com")).toBeTruthy();
  expect(
    JSON.parse(localStorage.getItem("team-ai.invitations:example") ?? "[]"),
  ).toEqual([{ email: "invited@example.com", status: "Invited" }]);
});

it.each(["settings/user", "settings/user/invite"])(
  "blocks a non-owner at %s",
  async (path) => {
    localStorage.setItem(
      "team-ai.invitations:example",
      JSON.stringify(["private@example.com"]),
    );
    await router.navigate(`/projects/example/${path}`);
    render(<App />);

    expect(
      await screen.findByText("Failed to load project members."),
    ).toBeTruthy();
    const add = screen.getByRole<HTMLButtonElement>("button", {
      name: "Add new user to the project",
    });
    expect(add.disabled).toBe(true);
    expect(screen.queryByText("private@example.com")).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "Teammate email" }),
    ).toBeNull();
  },
);

it("renders the workspace 404 for an unknown path", async () => {
  await router.navigate("/projects/example/unknown");
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "Page not found" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Back to projects" }).getAttribute("href"),
  ).toBe("/projects");
});

it("shows the loading indicator for a query started after the page is ready", async () => {
  await router.navigate("/projects");
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Projects" });
  expect(screen.queryByRole("status")).toBeNull();

  let complete!: () => void;
  const response = new Promise<string>((resolve) => {
    complete = () => resolve("ready");
  });
  const request = client.fetchQuery({
    queryKey: ["pending-request"],
    queryFn: () => response,
  });
  expect(await screen.findByRole("status")).toBeTruthy();

  await act(async () => {
    complete();
    await request;
  });
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
});
