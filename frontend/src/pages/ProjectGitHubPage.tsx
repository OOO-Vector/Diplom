import { useWorkspace } from "../features/projects/model/workspaceContext";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { verifyGitHubRepository } from "../features/projects/api/githubRepository";
import "./ProjectGitHubPage.css";

type Quota = { limit: number; remaining: number; resetAt: number };

function readQuota(headers: Headers): Quota | null {
  const limit = Number(headers.get("x-ratelimit-limit"));
  const remaining = Number(headers.get("x-ratelimit-remaining") ?? NaN);
  const resetAt = Number(headers.get("x-ratelimit-reset")) * 1000;
  if (
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    !Number.isSafeInteger(remaining) ||
    remaining < 0 ||
    remaining > limit ||
    !Number.isSafeInteger(resetAt) ||
    resetAt <= 0
  )
    return null;

  return { limit, remaining, resetAt };
}

const number = new Intl.NumberFormat("en");

export default function ProjectGitHubPage() {
  const { isProjectOwner } = useWorkspace();
  if (!isProjectOwner)
    return (
      <p role="alert">You do not have permission to manage GitHub settings.</p>
    );
  return <GitHubSettings />;
}

function GitHubSettings() {
  const { archived } = useWorkspace();
  const [searchParams] = useSearchParams();
  const demo = searchParams.get("quotaDemo") === "1";
  const [demoStartedAt] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  const [liveQuota, setLiveQuota] = useState<Quota | null>(null);
  const demoResetAt = demoStartedAt + 18 * 60 * 1000;
  const elapsedSteps = Math.max(0, Math.floor((now - demoStartedAt) / 5000));
  const quota = demo
    ? {
        limit: 5000,
        remaining:
          now >= demoResetAt ? 5000 : Math.max(0, 750 - elapsedSteps * 50),
        resetAt: demoResetAt,
      }
    : liveQuota && now < liveQuota.resetAt
      ? liveQuota
      : null;
  const usedPercent = quota
    ? Math.floor((100 * (quota.limit - quota.remaining)) / quota.limit)
    : 0;
  const secondsLeft = quota
    ? Math.max(0, Math.ceil((quota.resetAt - now) / 1000))
    : 0;
  const countdown = `${Math.floor(secondsLeft / 60)}m ${String(secondsLeft % 60).padStart(2, "0")}s`;
  const quotaCount = quota
    ? `${number.format(quota.remaining)} / ${number.format(quota.limit)}`
    : null;
  const resetAt = demo ? demoResetAt : liveQuota?.resetAt;

  useEffect(() => {
    if (resetAt === undefined) return;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= resetAt) window.clearInterval(timer);
    };
    const timer = window.setInterval(tick, 1000);
    tick();
    return () => window.clearInterval(timer);
  }, [resetAt]);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [repository, setRepository] = useState("");
  const [token, setToken] = useState("");
  const [previewAt, setPreviewAt] = useState<Date | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [authError, setAuthError] = useState("");
  const request = useRef<AbortController>();
  useEffect(() => () => request.current?.abort(), []);
  const { mutateAsync: verifyRepository, isPending } = useMutation({
    mutationFn: ({ path, signal }: { path: string; signal: AbortSignal }) =>
      verifyGitHubRepository(path, token.trim(), signal),
  });

  function resetPreview() {
    setPreviewAt(null);
    setMessage("");
    setError(false);
    setAuthError("");
  }

  async function synchronise(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (archived) return;
    if (request.current) return;
    const url = URL.canParse(repository.trim())
      ? new URL(repository.trim())
      : null;

    if (
      !url ||
      url.origin !== "https://github.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname) ||
      !token.trim()
    ) {
      setError(true);
      setMessage(
        "Enter a full GitHub repository HTTPS URL and an access token.",
      );
      return;
    }

    setMessage("");
    setAuthError("");
    setTokenVisible(false);
    const controller = new AbortController();
    request.current = controller;
    try {
      const path = url.pathname.replace(/\/$/, "").replace(/\.git$/, "");
      const response = await verifyRepository({
        path,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setNow(Date.now());
      setLiveQuota(readQuota(response.headers));
      const quotaExceeded =
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.get("x-ratelimit-remaining") === "0" ||
            response.headers.has("retry-after")));

      if (
        response.status === 401 ||
        (response.status === 403 && !quotaExceeded)
      ) {
        setToken("");
        setAuthError(
          response.status === 401
            ? "401 Bad Credentials: Check or replace your access token."
            : "403 Forbidden: Check the token’s repository permissions.",
        );
        return;
      }
      if (!response.ok) {
        setError(true);
        setMessage(
          quotaExceeded
            ? "GitHub rate limit reached. Try again later."
            : response.status === 404
              ? "Repository not found or unavailable to this token."
              : "GitHub could not verify the repository. Try again later.",
        );
        return;
      }
    } catch {
      if (controller.signal.aborted) return;
      setError(true);
      setMessage("Could not reach GitHub. Try again.");
      return;
    } finally {
      request.current = undefined;
    }
    setPreviewAt(new Date());
    setError(false);
    setMessage(
      "Local preview. Synchronisation with GitHub requires a server connection.",
    );
  }

  function disconnect() {
    if (archived) return;
    resetPreview();
    setRepository("");
    setToken("");
    setTokenVisible(false);
    setLiveQuota(null);
    setMessage("Connection details cleared.");
  }

  return (
    <form
      className="project-github"
      aria-labelledby="project-github-title"
      onSubmit={synchronise}
      noValidate
    >
      <div className="project-github__heading">
        <h1 id="project-github-title">
          <Link to=".." relative="path">
            Project settings
          </Link>
          <span aria-hidden="true"> &gt; </span>
          GitHub
        </h1>
        {(authError || (quotaCount && usedPercent >= 85)) && (
          <div className="project-github__notices">
            {authError && (
              <div className="project-github__auth-error" role="alert">
                <strong>
                  GitHub authentication token expired or invalid permissions.
                </strong>
                <p>Please reconnect your repository.</p>
              </div>
            )}
            {quotaCount && usedPercent >= 85 && (
              <div className="project-github__auth-error">
                <strong>
                  GitHub API rate limit warning:{demo && " (demo)"}
                </strong>
                <p>
                  {usedPercent}% of hourly quota used ({quotaCount} requests
                  remaining). Quota resets in{" "}
                  <span role="timer">{countdown}</span>.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="project-github__field">
        <label htmlFor="github-repository">Project repository URL</label>
        <input
          id="github-repository"
          type="url"
          placeholder="Format: repo full HTTPS URL. Issues will be published here."
          autoComplete="off"
          spellCheck={false}
          value={repository}
          disabled={archived || isPending}
          onChange={(event) => {
            setRepository(event.target.value);
            resetPreview();
          }}
        />
      </div>
      <div className="project-github__field">
        <div className="project-github__token">
          <label htmlFor="github-token">GitHub Personal access token</label>
          <button
            type="button"
            aria-label={
              tokenVisible ? "Hide access token" : "Show access token"
            }
            disabled={archived || isPending}
            onClick={() => setTokenVisible((visible) => !visible)}
          >
            <svg viewBox="0 0 40 24" aria-hidden="true">
              <ellipse
                cx="20"
                cy="12"
                rx="18"
                ry="10"
                fill="none"
                stroke="currentColor"
              />
              <circle cx="20" cy="12" r="4" fill="currentColor" />
              {!tokenVisible && <path d="M2 2l36 20" stroke="currentColor" />}
            </svg>
          </button>
        </div>
        <input
          id="github-token"
          type={tokenVisible ? "text" : "password"}
          placeholder={
            authError ||
            "Required scopes: repo (for creating Issues) and admin:repo_hook (for status sync)."
          }
          aria-invalid={Boolean(authError)}
          aria-describedby={authError ? "github-token-error" : undefined}
          disabled={archived || isPending}
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(event) => {
            setToken(event.target.value);
            setAuthError("");
            setMessage("");
          }}
        />
        {authError && (
          <span id="github-token-error" hidden>
            {authError}
          </span>
        )}
      </div>

      <dl className="project-github__status">
        <div>
          <dt>
            {previewAt ? "Local sync preview on" : "Last sync with GitHub on"}
          </dt>
          <dd>
            {previewAt ? (
              <time dateTime={previewAt.toISOString()}>
                {new Intl.DateTimeFormat("en", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(previewAt)}
              </time>
            ) : (
              "Never"
            )}
          </dd>
        </div>
        <div>
          <dt>Webhook endpoint URL</dt>
          <dd>
            {previewAt
              ? "Unavailable in local preview."
              : "Connect a repository to generate webhook configuration."}
          </dd>
        </div>
        <div>
          <dt>API quota remaining</dt>
          <dd>{quotaCount ? `${quotaCount} requests/hr` : "N/A"}</dd>
        </div>
      </dl>
      {message && <p role={error ? "alert" : "status"}>{message}</p>}

      <div className="project-github__actions">
        <button type="submit" disabled={archived || isPending}>
          Synchronise
        </button>
        <button
          type="button"
          onClick={disconnect}
          disabled={archived || isPending}
        >
          Disconnect
        </button>
      </div>
    </form>
  );
}
