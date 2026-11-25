import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  changePassword,
  deleteAccount,
  saveProfile,
  signOut,
} from "../features/account/localAccount";
import { authSession } from "../features/account/authSession";
import { isLocalDemo, useAccount } from "../features/account/useAccount";
import "./AccountPage.css";

function readAvatar(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not open the image."));
    reader.readAsDataURL(file);
  });
}

export default function ProfilePage() {
  return isLocalDemo() ? <LocalProfilePage /> : <ServerProfilePage />;
}

function ServerProfilePage() {
  const account = useAccount();
  if (!account) return null;
  return (
    <section className="account-profile" aria-labelledby="profile-title">
      <h1 id="profile-title">Account settings</h1>
      <div className="account-card">
        <h2>Profile</h2>
        <p>{account.name}</p>
        <p>{account.email}</p>
        <button
          className="account-button"
          type="button"
          onClick={() => void authSession.logout()}
        >
          Sign out
        </button>
      </div>
    </section>
  );
}

function LocalProfilePage() {
  const account = useAccount();
  const navigate = useNavigate();
  const [avatar, setAvatar] = useState(account?.avatar);
  const [deleting, setDeleting] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [readingAvatar, setReadingAvatar] = useState(false);
  if (!account) return null;

  function leave() {
    signOut();
    navigate("/login", { replace: true });
  }

  async function run(
    event: FormEvent<HTMLFormElement>,
    action: (data: FormData) => void | Promise<void>,
    success: string,
  ) {
    event.preventDefault();
    setPending(true);
    setFeedback(null);
    try {
      await action(new FormData(event.currentTarget));
      setFeedback({ text: success });
    } catch (error) {
      setFeedback({
        text:
          error instanceof Error ? error.message : "Could not save the change.",
        error: true,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="account-profile" aria-labelledby="profile-title">
      <h1 id="profile-title">Account settings</h1>
      <form
        className="account-card"
        onSubmit={(event) =>
          void run(
            event,
            (data) => saveProfile({ name: String(data.get("name")), avatar }),
            "Profile saved.",
          )
        }
      >
        <h2>Profile</h2>
        <div className="account-profile__avatar">
          {avatar ? (
            <img src={avatar} alt="Avatar preview" />
          ) : (
            <span aria-hidden="true">
              {account.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <label>
            Avatar
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={readingAvatar || pending}
              onChange={async (event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                if (
                  !["image/png", "image/jpeg", "image/webp"].includes(
                    file.type,
                  ) ||
                  file.size > 1024 * 1024
                ) {
                  setFeedback({
                    text: "Choose a PNG, JPEG or WebP image up to 1 MB.",
                    error: true,
                  });
                  return;
                }
                setReadingAvatar(true);
                try {
                  setAvatar(await readAvatar(file));
                  setFeedback(null);
                } catch {
                  setFeedback({
                    text: "Could not open the image.",
                    error: true,
                  });
                } finally {
                  setReadingAvatar(false);
                }
              }}
            />
          </label>
        </div>
        {avatar && (
          <button
            className="account-button account-button--secondary"
            type="button"
            onClick={() => setAvatar(undefined)}
          >
            Remove avatar
          </button>
        )}
        <label>
          Display name
          <input
            name="name"
            autoComplete="name"
            defaultValue={account.name}
            required
            maxLength={100}
          />
        </label>
        <label>
          Email
          <input value={account.email} readOnly />
        </label>
        <button
          className="account-button"
          disabled={pending || readingAvatar}
          type="submit"
        >
          Save profile
        </button>
      </form>
      <form
        className="account-card"
        onSubmit={(event) => {
          const form = event.currentTarget;
          void run(
            event,
            async (data) => {
              await changePassword(
                String(data.get("current")),
                String(data.get("password")),
              );
              form.reset();
            },
            "Password changed.",
          );
        }}
      >
        <h2>Change password</h2>
        <label>
          Current password
          <input
            name="current"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <label>
          New password
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </label>
        <button className="account-button" type="submit" disabled={pending}>
          Change password
        </button>
      </form>
      <div className="account-card">
        <h2>Account access</h2>
        {!deleting ? (
          <div className="account-actions">
            <button className="account-button" type="button" onClick={leave}>
              Sign out
            </button>
            <button
              className="account-button account-button--danger"
              type="button"
              onClick={() => {
                setDeleting(true);
                setFeedback(null);
              }}
            >
              Delete account
            </button>
          </div>
        ) : (
          <form
            className="account-delete"
            onSubmit={(event) =>
              void run(
                event,
                async (data) => {
                  await deleteAccount(String(data.get("password")));
                  navigate("/login", { replace: true });
                },
                "",
              )
            }
          >
            <p>
              Enter your password to permanently delete this account from this
              browser.
            </p>
            <label>
              Confirm password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                autoFocus
              />
            </label>
            <div className="account-actions">
              <button
                className="account-button account-button--secondary"
                type="button"
                disabled={pending}
                onClick={() => {
                  setDeleting(false);
                  setFeedback(null);
                }}
              >
                Cancel
              </button>
              <button
                className="account-button account-button--danger"
                type="submit"
                disabled={pending}
              >
                Confirm deletion
              </button>
            </div>
          </form>
        )}
      </div>
      {feedback?.text && (
        <p
          className="account-feedback"
          role={feedback.error ? "alert" : "status"}
        >
          {feedback.text}
        </p>
      )}
    </section>
  );
}
