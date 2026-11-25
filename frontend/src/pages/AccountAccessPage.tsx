import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  recoveryEmail,
  registerAccount,
  resetLocalPassword,
  signIn,
} from "../features/account/localAccount";
import {
  authApi,
  loginSchema,
  registerSchema,
} from "../features/account/authApi";
import { authSession } from "../features/account/authSession";
import { ApiError } from "../shared/api/requestApi";
import { LoadingState } from "../shared/ui/LoadingState";
import {
  isLocalDemo,
  useSession,
  useAccount,
} from "../features/account/useAccount";
import brand from "../widgets/layout/team-ai-orchestrator.svg";
import "./AccountPage.css";

export function AccountAccessPage({
  mode,
}: {
  mode: "login" | "register" | "reset";
}) {
  const account = useAccount();
  const session = useSession();
  const demo = isLocalDemo();
  const request = useRef<AbortController>();
  const [fields, setFields] = useState<Record<string, string>>({});
  useEffect(() => () => request.current?.abort(), []);
  const { state } = useLocation();
  const navigate = useNavigate();
  const [blockedUntil, setBlockedUntil] = useState<number>();
  useEffect(() => {
    if (!blockedUntil) return;
    const timer = setTimeout(
      () => setBlockedUntil(undefined),
      Math.min(2_147_483_647, Math.max(0, blockedUntil - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [blockedUntil]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const registering = mode === "register";
  const resetting = mode === "reset";
  const email = demo && resetting ? recoveryEmail() : undefined;
  const destination =
    typeof state?.from === "string" &&
    /^\/(?!\/)[^\\\s]*$/.test(state.from) &&
    /^\/(projects|profile|inbox)(?:[/?#]|$)/.test(state.from)
      ? state.from
      : "/projects";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current || (blockedUntil && blockedUntil > Date.now())) return;
    const controller = new AbortController();
    request.current = controller;
    setFields({});
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      if (!demo) {
        const input = {
          email: data.get("email"),
          password: data.get("password"),
          displayName: data.get("name"),
        };
        if (registering) {
          const parsed = registerSchema.safeParse(input);
          if (!parsed.success) {
            setFields(
              Object.fromEntries(
                parsed.error.issues.map((issue) => [
                  issue.path.join("."),
                  issue.message,
                ]),
              ),
            );
            return;
          }
          const user = await authApi.register(parsed.data, controller.signal);
          if (!controller.signal.aborted)
            navigate("/login", {
              replace: true,
              state: {
                from: destination,
                recoveredEmail: user.email,
                registered: true,
              },
            });
        } else {
          const parsed = loginSchema.safeParse(input);
          if (!parsed.success) {
            setFields(
              Object.fromEntries(
                parsed.error.issues.map((issue) => [
                  issue.path.join("."),
                  issue.message,
                ]),
              ),
            );
            return;
          }
          await authSession.login(parsed.data, controller.signal);
        }
      } else if (resetting) {
        const recoveredEmail = await resetLocalPassword(
          String(data.get("password")),
          String(data.get("confirmation")),
        );
        navigate("/login", {
          replace: true,
          state: { from: destination, recoveredEmail, passwordReset: true },
        });
      } else if (registering) {
        await registerAccount(
          String(data.get("name")),
          String(data.get("email")),
          String(data.get("password")),
        );
      } else {
        await signIn(String(data.get("email")), String(data.get("password")));
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError) {
        if (error.status === 429 && error.retryAt && error.retryAt > Date.now())
          setBlockedUntil(error.retryAt);
        setFields(
          Object.fromEntries(
            error.fields.map((field) => [field, "Check this field."]),
          ),
        );
        if (registering && error.status === 409) {
          setFields({ email: "An account with this email already exists." });
          return;
        }
      }
      setError(
        error instanceof ApiError && error.status === 401
          ? "The email or password was not accepted."
          : error instanceof Error
            ? error.message
            : "Could not continue. Please try again.",
      );
    } finally {
      request.current = undefined;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  if (!demo && session.status === "checking") return <LoadingState />;
  if (!demo && resetting) return <Navigate to="/login" replace state={state} />;
  if (account) return <Navigate to={destination} replace />;

  return (
    <main className="account-access">
      <div className="account-access__brand">
        <img src={brand} alt="Team AI Orchestrator" />
        <p>
          Turn project specifications into tasks, make decisions and collaborate
          with AI in one workspace.
        </p>
      </div>
      <form
        key={mode}
        className="account-card"
        onSubmit={submit}
        noValidate={!demo}
        aria-busy={pending}
      >
        <h1>
          {resetting
            ? "Reset password"
            : registering
              ? "Create an account"
              : "Sign in"}
        </h1>
        {resetting && !email && (
          <p>No account is available to recover in this browser.</p>
        )}
        {mode === "login" && state?.passwordReset && (
          <p role="status">Password reset. Sign in with your new password.</p>
        )}
        {mode === "login" && state?.registered && (
          <p role="status">Account created. You can sign in now.</p>
        )}
        {mode === "login" &&
          !error &&
          session.status === "guest" &&
          session.message && <p role="status">{session.message}</p>}
        {registering && (
          <label>
            Display name
            <input
              name="name"
              autoComplete="name"
              required
              maxLength={100}
              aria-invalid={Boolean(fields.displayName)}
              aria-describedby={fields.displayName ? "name-error" : undefined}
            />
            {fields.displayName && (
              <span role="alert" id="name-error">
                {fields.displayName}
              </span>
            )}
          </label>
        )}
        {!resetting && (
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="username"
              defaultValue={
                mode === "login" && typeof state?.recoveredEmail === "string"
                  ? state.recoveredEmail
                  : ""
              }
              required
              maxLength={254}
              aria-invalid={Boolean(fields.email)}
              aria-describedby={fields.email ? "email-error" : undefined}
            />
            {fields.email && (
              <span role="alert" id="email-error">
                {fields.email}
              </span>
            )}
          </label>
        )}
        {(!resetting || email) && (
          <>
            <label>
              {resetting ? "New password" : "Password"}
              <input
                name="password"
                type="password"
                autoComplete={
                  registering || resetting ? "new-password" : "current-password"
                }
                required
                minLength={demo && (registering || resetting) ? 8 : undefined}
                aria-invalid={Boolean(fields.password)}
                aria-describedby={
                  fields.password ? "password-error" : undefined
                }
              />
              {fields.password && (
                <span role="alert" id="password-error">
                  {fields.password}
                </span>
              )}
            </label>
            {resetting && (
              <label>
                Confirm new password
                <input
                  name="confirmation"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
              </label>
            )}
            {(registering || resetting) && (
              <p>Use at least {demo ? 8 : 12} characters.</p>
            )}
            {error && <p role="alert">{error}</p>}
            <button
              className="account-button"
              type="submit"
              disabled={pending || Boolean(blockedUntil)}
            >
              {pending
                ? "Please wait…"
                : resetting
                  ? "Reset password"
                  : registering
                    ? "Register"
                    : "Sign in"}
            </button>
          </>
        )}
        <div className="account-access__links">
          <Link to={mode === "login" ? "/register" : "/login"} state={state}>
            {mode === "login" ? "Create an account" : "Back to sign in"}
          </Link>
          {mode === "login" && demo && (
            <Link to="/reset-password" state={state}>
              Forgot password?
            </Link>
          )}
        </div>
      </form>
    </main>
  );
}
