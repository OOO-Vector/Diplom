// @vitest-environment node
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { authMock } from "../authMock";

let server: ViteDevServer;
let origin: string;

beforeAll(async () => {
  server = await createServer({
    configFile: false,
    envFile: false,
    plugins: [authMock()],
    server: { host: "127.0.0.1", port: 0, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.listen(0);
  const address = server.httpServer?.address();
  if (!address || typeof address === "string")
    throw new Error("No mock server address");
  origin = "http://127.0.0.1:" + address.port;
});

afterAll(async () => server?.close());

function browser() {
  const cookies = new Map<string, string>();
  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Origin", origin);
    if (path.startsWith("/auth/"))
      headers.set("Cookie", [...cookies.values()].join("; "));
    const response = await fetch(origin + "/api/v1" + path, {
      ...init,
      headers,
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      const key = pair?.split("=")[0];
      if (!key || !pair) continue;
      if (cookie.includes("Max-Age=0;")) cookies.delete(key);
      else cookies.set(key, pair);
    }
    return response;
  }
  async function auth(path: string, data?: unknown) {
    const csrfResponse = await request("/auth/csrf");
    expect(csrfResponse.headers.get("Set-Cookie")).toMatch(
      /HttpOnly; SameSite=Lax; Secure/,
    );
    const { token } = await csrfResponse.json();
    return request("/auth/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  }
  return { request, auth };
}

it("registers, authenticates, limits project access, rotates cookies and revokes on logout", async () => {
  const owner = browser();
  const member = browser();
  const credentials = {
    email: "owner@example.test",
    password: "mock-only password",
  };
  const unauthorized = await owner.request("/auth/login", { method: "POST" });
  expect(unauthorized.status).toBe(403);
  expect(
    (
      await owner.auth("register", {
        ...credentials,
        displayName: "Test Owner",
      })
    ).status,
  ).toBe(201);
  expect((await owner.auth("refresh")).status).toBe(401);
  const login = await owner.auth("login", credentials);
  expect(login.status).toBe(200);
  const loginCookie = login.headers.get("Set-Cookie");
  const { accessToken } = await login.json();
  const project = await owner.request("/projects", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Private mock project" }),
  });
  expect(project.status).toBe(201);
  const { id } = await project.json();

  const alternate = { ...credentials, email: "member@example.test" };
  await member.auth("register", { ...alternate, displayName: "Other account" });
  const alternateLogin = await member.auth("login", alternate);
  const otherToken = (await alternateLogin.json()).accessToken;
  const hidden = await member.request("/projects/" + id, {
    headers: { Authorization: "Bearer " + otherToken },
  });
  expect(hidden.status).toBe(404);

  const ownerHeaders = {
    Authorization: "Bearer " + accessToken,
    "Content-Type": "application/json",
  };
  const memberHeaders = {
    Authorization: "Bearer " + otherToken,
    "Content-Type": "application/json",
  };
  const path = "/projects/" + id;
  const added = await owner.request(path + "/members", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ email: alternate.email }),
  });
  expect(added.status).toBe(201);
  const { userId } = await added.json();
  const listed = await member.request(path + "/members", {
    headers: memberHeaders,
  });
  expect(listed.status).toBe(200);
  expect((await listed.json()).items).toEqual([
    expect.objectContaining({ role: "owner" }),
    expect.objectContaining({ userId, role: "member" }),
  ]);
  const edit = {
    method: "PATCH",
    body: JSON.stringify({ name: "Renamed mock project" }),
  };
  expect(
    (await owner.request(path, { ...edit, headers: ownerHeaders })).status,
  ).toBe(200);
  expect(
    (await member.request(path, { ...edit, headers: memberHeaders })).status,
  ).toBe(403);
  const transfer = await owner.request(path + "/transfer-ownership", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ newOwnerUserId: userId }),
  });
  expect((await transfer.json()).myRole).toBe("member");
  expect(
    (
      await owner.request(path + "/archive", {
        method: "POST",
        headers: ownerHeaders,
      })
    ).status,
  ).toBe(403);
  const archived = await member.request(path + "/archive", {
    method: "POST",
    headers: memberHeaders,
  });
  expect((await archived.json()).status).toBe("archived");
  expect(
    (await member.request(path, { ...edit, headers: memberHeaders })).status,
  ).toBe(409);
  expect((await owner.request(path, { headers: ownerHeaders })).status).toBe(
    200,
  );

  const refresh = await owner.auth("refresh");
  expect(refresh.status).toBe(200);
  expect(refresh.headers.get("Set-Cookie")).not.toEqual(loginCookie);
  const nextToken = (await refresh.json()).accessToken;
  expect((await owner.auth("logout")).status).toBe(204);
  expect((await owner.auth("refresh")).status).toBe(401);
  expect(
    (
      await owner.request("/users/me", {
        headers: { Authorization: "Bearer " + nextToken },
      })
    ).status,
  ).toBe(401);
});
