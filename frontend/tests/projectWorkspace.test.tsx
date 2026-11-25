// @vitest-environment jsdom
import { AxiosError, AxiosHeaders } from "axios";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "../src/app/App";
import { router } from "../src/app/router";
import { httpClient } from "../src/shared/api/httpClient";
import { authSession } from "../src/features/account/authSession";

it("filters the dashboard, preserves the selected module, and blocks archived writes", async () => {
  const adapter = httpClient.defaults.adapter;
  const active = {
    id: "e470ed9e-7db3-4d71-b4ca-86168983613b",
    name: "Zulu active",
    myRole: "owner",
    status: "active",
  };
  const archive = {
    id: "a77bb451-d9ce-4dd1-a993-6a52fc1e2308",
    name: "Alpha archive",
    myRole: "member",
    status: "archived",
  };
  httpClient.defaults.adapter = async (config) => {
    const url = config.url;
    const user = {
      id: active.id,
      displayName: "Test user",
      email: "owner@example.test",
      isActive: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    if (url === "/auth/logout")
      return {
        config,
        data: undefined,
        headers: new AxiosHeaders(),
        status: 204,
        statusText: "",
      };
    const data =
      url === "/auth/csrf"
        ? { headerName: "X-CSRF-Token", token: "fixture" }
        : url === "/auth/refresh"
          ? {
              user,
              accessToken: "fixture",
              expiresIn: 900,
              tokenType: "Bearer",
            }
          : url === "/projects"
            ? { items: [active, archive], totalPages: 1 }
            : url === "/projects/" + active.id
              ? active
              : url === "/projects/" + archive.id
                ? archive
                : undefined;
    const response = {
      config,
      data,
      headers: new AxiosHeaders(),
      status: data ? 200 : 404,
      statusText: "",
    };
    if (data === undefined)
      throw new AxiosError(
        "Fixture not found",
        undefined,
        config,
        undefined,
        response,
      );
    return response;
  };
  try {
    await router.navigate("/projects");
    render(<App />);
    const dashboard = await screen.findByRole("region", { name: "Projects" });
    const list = await within(dashboard).findByRole("list", {
      name: "Available projects",
    });
    expect(
      within(list)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Alpha archive", "Zulu active"]);
    fireEvent.change(within(dashboard).getByRole("searchbox"), {
      target: { value: "zulu" },
    });
    expect(within(list).queryByText("Alpha archive")).toBeNull();
    fireEvent.click(within(list).getByRole("link", { name: "Zulu active" }));
    const create = await screen.findByRole("button", {
      name: "Create a task manually",
    });
    expect(create).toHaveProperty("disabled", false);
    fireEvent.click(create);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Project list" }),
      ).getByRole("link", { name: "Alpha archive" }),
    );
    expect(
      await screen.findByText("This project is archived and read-only."),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe(
      "/projects/" + archive.id + "/tasks",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      await screen.findByRole("button", { name: "Create a task manually" }),
    ).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("link", { name: "Decisions" }));
    expect(
      await screen.findByRole("heading", { name: "Proposals and decisions" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "Create a proposal" }),
    ).toBeNull();
  } finally {
    cleanup();
    await authSession.logout();
    httpClient.defaults.adapter = adapter;
  }
});
