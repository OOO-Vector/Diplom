import type { AxiosRequestConfig } from "axios";
import type { z } from "zod";
import { ApiError, requestApi } from "../../shared/api/requestApi";
import { authApi } from "./authApi";

type Session = Awaited<ReturnType<typeof authApi.login>>;
type Snapshot =
  | { status: "checking" }
  | { status: "guest"; message?: string }
  | { status: "authenticated"; user: Session["user"] };

const signedOutKey = "team-ai.auth.signed-out";

export function createAuthSession(api: typeof authApi, storage?: Storage) {
  let snapshot: Snapshot = { status: "checking" };
  let current: Session | undefined;
  let epoch = 0;
  let started = false;
  let expiresAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let refreshFlight: Promise<void> | undefined;
  let logoutFlight: Promise<void> | undefined;
  const listeners = new Set<() => void>();

  function publish(next: Snapshot) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }

  function clear(message?: string) {
    clearTimeout(timer);
    current = undefined;
    publish({ status: "guest", message });
  }

  function rememberSignOut(value: boolean) {
    try {
      if (value) storage?.setItem(signedOutKey, "1");
      else storage?.removeItem(signedOutKey);
    } catch {
      // Cookie revocation still runs when browser storage is unavailable.
    }
  }

  function wasSignedOut() {
    try {
      return storage?.getItem(signedOutKey) === "1";
    } catch {
      return false;
    }
  }

  function accept(session: Session) {
    clearTimeout(timer);
    current = session;
    expiresAt = Date.now() + session.expiresIn * 1000;
    timer = setTimeout(() => void refresh(), session.expiresIn * 1000);
    publish({ status: "authenticated", user: session.user });
  }

  function refresh() {
    if (refreshFlight) return refreshFlight;
    if (snapshot.status === "guest") return Promise.resolve();
    const version = epoch;
    refreshFlight = api
      .refresh()
      .then((session) => {
        if (version !== epoch) return;
        if (current && current.user.id !== session.user.id) {
          epoch++;
          clear("Your session changed. Please sign in again.");
          return;
        }
        accept(session);
      })
      .catch((error: unknown) => {
        if (version === epoch) {
          epoch++;
          clear(
            current
              ? "Your session expired. Please sign in again."
              : error instanceof ApiError && error.status === 401
                ? undefined
                : "Could not restore your session. You can try signing in.",
          );
        }
      })
      .finally(() => {
        refreshFlight = undefined;
      });
    return refreshFlight;
  }

  return {
    snapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (started) return;
      started = true;
      if (wasSignedOut()) clear();
      else void refresh();
    },
    async login(data: Parameters<typeof api.login>[0], signal?: AbortSignal) {
      await logoutFlight;
      const version = ++epoch;
      const session = await api.login(data, signal);
      if (version !== epoch || signal?.aborted) return;
      rememberSignOut(false);
      accept(session);
    },
    logout() {
      if (logoutFlight) return logoutFlight;
      epoch++;
      rememberSignOut(true);
      clear();
      logoutFlight = Promise.resolve(refreshFlight)
        .then(() => api.logout())
        .catch(() =>
          clear(
            "Signed out in this tab. Server sign-out could not be confirmed.",
          ),
        )
        .finally(() => {
          logoutFlight = undefined;
        });
      return logoutFlight;
    },
    async request<S extends z.ZodType>(
      schema: S,
      config: AxiosRequestConfig & { url: string; signal?: AbortSignal },
    ): Promise<z.output<S>> {
      if (
        !/^\/(?!\/)[^\\]*$/.test(config.url) ||
        !new URL(
          "/api/v1" + config.url,
          "https://api.invalid",
        ).pathname.startsWith("/api/v1/")
      )
        throw new ApiError("Invalid API request path.");
      const version = epoch;
      const unauthorized = () => new ApiError("Please sign in again.", 401);
      if (snapshot.status !== "authenticated") throw unauthorized();
      if (Date.now() >= expiresAt) await refresh();

      const send = (session: Session) =>
        requestApi(schema, {
          ...config,
          headers: {
            ...config.headers,
            Authorization: `Bearer ${session.accessToken}`,
          },
        });
      if (epoch !== version || !current) throw unauthorized();
      async function verified(session: Session) {
        const result = await send(session);
        if (epoch !== version) throw unauthorized();
        return result;
      }
      const original = current;
      try {
        return await verified(original);
      } catch (error) {
        if (
          !(error instanceof ApiError) ||
          error.status !== 401 ||
          config.signal?.aborted ||
          epoch !== version
        )
          throw error;
        if (current === original) await refresh();
        const safe = ["GET", "HEAD"].includes(
          (config.method ?? "GET").toUpperCase(),
        );
        if (!safe || !current || epoch !== version || config.signal?.aborted)
          throw error;
        try {
          return await verified(current);
        } catch (retryError) {
          if (
            retryError instanceof ApiError &&
            retryError.status === 401 &&
            epoch === version &&
            !config.signal?.aborted
          ) {
            epoch++;
            clear("Your session expired. Please sign in again.");
          }
          throw retryError;
        }
      }
    },
  };
}

function browserSessionStorage() {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

export const authSession = createAuthSession(authApi, browserSessionStorage());
