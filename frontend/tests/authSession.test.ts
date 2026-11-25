import {
  AxiosError,
  AxiosHeaders,
  type InternalAxiosRequestConfig,
} from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { authApi } from "../src/features/account/authApi";
import { createAuthSession } from "../src/features/account/authSession";
import { httpClient } from "../src/shared/api/httpClient";
import { ApiError, normalizeApiError } from "../src/shared/api/requestApi";

const user = {
  id: "e470ed9e-7db3-4d71-b4ca-86168983613b",
  email: "test@example.test",
  displayName: "Test",
  isActive: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const session = (accessToken: string) => ({
  user,
  accessToken,
  expiresIn: 900,
  tokenType: "Bearer" as const,
});
const creds = { email: user.email, password: "a test password" };
const adapter = httpClient.defaults.adapter;

function response(
  config: InternalAxiosRequestConfig,
  status: number,
  data: unknown,
  headers = {},
) {
  return {
    config,
    status,
    data,
    headers: new AxiosHeaders(headers),
    statusText: "",
  };
}

function failure(status: number, data: unknown = {}, headers = {}) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError(
    "private server text",
    undefined,
    config,
    undefined,
    response(config, status, data, headers),
  );
}

describe("auth session", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    httpClient.defaults.adapter = adapter;
    vi.useRealTimers();
  });

  function fixture() {
    const api = {
      ...authApi,
      login: vi.fn().mockResolvedValue(session("old")),
      refresh: vi.fn().mockResolvedValue(session("new")),
      logout: vi.fn().mockResolvedValue(undefined),
    };
    return { api, store: createAuthSession(api) };
  }

  it("restores once at startup and clears memory on expiration and failed refresh", async () => {
    const { api, store } = fixture();
    api.refresh
      .mockResolvedValueOnce(session("old"))
      .mockRejectedValueOnce(new ApiError("rejected", 401));
    store.start();
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(store.snapshot()).toEqual({ status: "authenticated", user });
    await vi.advanceTimersByTimeAsync(900_000);
    expect(store.snapshot().status).toBe("guest");
    await expect(
      store.request(z.string(), { url: "/projects" }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("shares refresh across parallel 401s, replays reads once and never replays writes", async () => {
    const { api, store } = fixture();
    const request = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.headers.get("Authorization") === "Bearer old")
        throw failure(401);
      return response(config, 200, "ok");
    });
    httpClient.defaults.adapter = request;
    await store.login(creds);
    const read = () => store.request(z.string(), { url: "/projects" });
    const results = await Promise.allSettled([
      read(),
      read(),
      store.request(z.string(), { url: "/projects", method: "POST" }),
    ]);
    expect(results.map(({ status }) => status)).toEqual([
      "fulfilled",
      "fulfilled",
      "rejected",
    ]);
    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.map(([config]) => config.method)).toEqual([
      "get",
      "get",
      "post",
      "get",
      "get",
    ]);
  });

  it("closes private access before revocation and ignores late refresh", async () => {
    const { api, store } = fixture();
    let finish!: (value: ReturnType<typeof session>) => void;
    api.refresh.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    store.start();
    const logout = store.logout();
    expect(store.snapshot().status).toBe("guest");
    finish(session("late"));
    await logout;
    expect(api.logout).toHaveBeenCalledOnce();
    expect(store.snapshot().status).toBe("guest");
  });

  it("closes the session when a retry is also unauthorized", async () => {
    const { api, store } = fixture();
    httpClient.defaults.adapter = async () => {
      throw failure(401);
    };
    await store.login(creds);
    await expect(
      store.request(z.string(), { url: "/projects" }),
    ).rejects.toMatchObject({ status: 401 });
    expect(api.refresh).toHaveBeenCalledOnce();
    expect(store.snapshot().status).toBe("guest");
  });
});

describe("API error normalization", () => {
  it.each([401, 403, 404, 409, 429, 500])(
    "maps HTTP %s without displaying problem detail",
    (status) => {
      const error = normalizeApiError(
        failure(
          status,
          {
            status,
            code: "EXAMPLE",
            detail: "secret",
            fieldErrors: [{ field: "email" }],
          },
          { "Retry-After": "15" },
        ),
      );
      expect(error).toMatchObject({
        status,
        code: "EXAMPLE",
        fields: ["email"],
      });
      expect(error.message).not.toMatch(/secret|private server text/);
      expect(error.retryAt).toBeGreaterThan(Date.now());
    },
  );
  it("distinguishes timeout from connectivity errors", () => {
    expect(
      normalizeApiError(new AxiosError("secret", "ECONNABORTED")).message,
    ).toMatch(/timed out/);
    expect(
      normalizeApiError(new AxiosError("secret", "ERR_NETWORK")).message,
    ).toMatch(/reach the server/);
  });
});
