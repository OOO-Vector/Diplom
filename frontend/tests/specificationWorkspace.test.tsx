import { AxiosError, AxiosHeaders } from "axios";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "../src/app/App";
import { router } from "../src/app/router";
import { authSession } from "../src/features/account/authSession";
import { httpClient } from "../src/shared/api/httpClient";

it("shows an upload rejection and renders the version returned by the authenticated API", async () => {
  const originalAdapter = httpClient.defaults.adapter;
  const project = {
    id: "cd19b126-cb45-4f64-9a5a-a4346d01a148",
    name: "Specification project",
    myRole: "member",
    status: "active",
  };
  const user = {
    id: "64d334c3-0b10-4288-930c-6039620200c8",
    email: "member@example.test",
    displayName: "Test member",
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  const path = `/projects/${project.id}`;
  const collection = `${path}/specifications`;
  const document = {
    id: "66009932-99ce-492b-9777-650b2e695b7a",
    originalFilename: "stored-requirements.txt",
  };
  let stored = false;
  const uploaded: string[] = [];
  httpClient.defaults.adapter = async (config) => {
    const reply = (status: number, data?: unknown) => ({
      config,
      status,
      data,
      statusText: "",
      headers: new AxiosHeaders(),
    });
    switch (config.url) {
      case "/auth/csrf":
        return reply(200, { headerName: "X-CSRF-Token", token: "fixture" });
      case "/auth/refresh":
        return reply(200, {
          user,
          accessToken: "fixture-token",
          tokenType: "Bearer",
          expiresIn: 900,
        });
      case "/auth/logout":
        return reply(204);
      case "/projects":
        return reply(200, { items: [project], totalPages: 1 });
      case path:
        return reply(200, project);
      case collection: {
        expect(config.headers.get("Authorization")).toBe(
          "Bearer fixture-token",
        );
        if (config.method === "get")
          return reply(200, { items: stored ? [document] : [] });
        expect(config.method).toBe("post");
        const form = config.data as FormData;
        const file = form.get("file") as File;
        expect(form.get("title")).toBe(file.name);
        uploaded.push(file.name);
        if (file.name === "long.txt") {
          throw new AxiosError(
            "Fixture document too long",
            undefined,
            config,
            undefined,
            reply(413, {
              title: "Payload Too Large",
              status: 413,
              code: "SPECIFICATION_TEXT_TOO_LARGE",
            }),
          );
        }
        stored = true;
        return reply(201, document);
      }
      default:
        throw new Error(`Unexpected fixture request: ${config.url}`);
    }
  };
  try {
    await router.navigate(`${path}/tasks`);
    render(<App />);
    await screen.findByRole("heading", { name: "Project tasks" });
    const picker = screen.getByLabelText("Project document");
    fireEvent.change(picker, {
      target: { files: [new File(["text"], "long.txt")] },
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "200,000-character limit",
    );
    expect(
      screen.queryByRole("link", { name: "Decompose into tasks" }),
    ).toBeNull();

    fireEvent.change(picker, {
      target: { files: [new File(["requirement"], "requirements.txt")] },
    });
    expect(
      await screen.findByText("Loaded file: stored-requirements.txt"),
    ).toBeTruthy();
    expect(
      await screen.findByRole("link", { name: "Decompose into tasks" }),
    ).toBeTruthy();
    expect(uploaded).toEqual(["long.txt", "requirements.txt"]);
  } finally {
    cleanup();
    try {
      await authSession.logout();
    } finally {
      httpClient.defaults.adapter = originalAdapter;
    }
  }
});
