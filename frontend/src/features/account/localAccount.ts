import { z } from "zod";

const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  avatar: z.string().optional(),
  namespace: z.string(),
  salt: z.string(),
  passwordHash: z.string(),
});
type Account = z.infer<typeof accountSchema>;
export type AccountProfile = Pick<Account, "id" | "name" | "email" | "avatar">;

const registryKey = "team-ai.accounts";
const sessionKey = "team-ai.session";
const recoveryKey = "team-ai.local-recovery-account";
const claimKey = "team-ai.legacy-workspace-claimed";
const listeners = new Set<() => void>();

function readAccounts(): Account[] {
  return z
    .array(accountSchema)
    .parse(JSON.parse(localStorage.getItem(registryKey) ?? "[]"));
}

function activeAccount() {
  try {
    const id = sessionStorage.getItem(sessionKey);
    return id ? readAccounts().find((account) => account.id === id) : undefined;
  } catch {
    return undefined;
  }
}

export function accountSnapshot() {
  const account = activeAccount();
  if (!account) return "";
  const { id, name, email, avatar } = account;
  return JSON.stringify({ id, name, email, avatar } satisfies AccountProfile);
}

export function subscribeAccount(listener: () => void) {
  listeners.add(listener);
  function storage(event: StorageEvent) {
    if (
      event.key === registryKey ||
      event.key === sessionKey ||
      event.key === null
    )
      listener();
  }
  window.addEventListener("storage", storage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", storage);
  };
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function workspaceKey(key: string) {
  const namespace = activeAccount()?.namespace;
  return namespace ? `team-ai.account:${namespace}:${key}` : key;
}

export function activeAccountId() {
  return activeAccount()?.id;
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function hashPassword(password: string, salt: string) {
  if (!crypto.subtle)
    throw new Error("Password features require a secure browser context.");
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: 600_000,
      salt: encoder.encode(salt),
    },
    material,
    256,
  );
  return hex(new Uint8Array(bits));
}

function randomId() {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}

function saveAccounts(accounts: Account[]) {
  localStorage.setItem(registryKey, JSON.stringify(accounts));
  notify();
}

export async function registerAccount(
  name: string,
  email: string,
  password: string,
) {
  name = name.trim();
  email = email.trim().toLowerCase();
  if (!name || !z.string().email().safeParse(email).success)
    throw new Error("Enter your name and a valid email.");
  if (password.length < 8)
    throw new Error("Use at least 8 characters for your password.");
  const salt = randomId();
  const passwordHash = await hashPassword(password, salt);
  const accounts = readAccounts();
  if (accounts.some((account) => account.email === email))
    throw new Error("An account with this email already exists.");
  const id = randomId();
  const namespace = localStorage.getItem(claimKey) || accounts.length ? id : "";
  localStorage.setItem(claimKey, "true");
  saveAccounts([
    ...accounts,
    { id, namespace, name, email, salt, passwordHash },
  ]);
  sessionStorage.setItem(sessionKey, id);
  localStorage.setItem(recoveryKey, id);
  notify();
}

export async function signIn(email: string, password: string) {
  const account = readAccounts().find(
    (entry) => entry.email === email.trim().toLowerCase(),
  );
  const hash = await hashPassword(password, account?.salt ?? "unknown-account");
  if (
    !account ||
    hash !== account.passwordHash ||
    !readAccounts().some(
      ({ id, passwordHash }) => id === account.id && hash === passwordHash,
    )
  ) {
    throw new Error("Email or password is incorrect.");
  }
  sessionStorage.setItem(sessionKey, account.id);
  localStorage.setItem(recoveryKey, account.id);
  notify();
}

export function signOut() {
  sessionStorage.removeItem(sessionKey);
  notify();
}

function recoveryAccount() {
  const accounts = readAccounts();
  const saved = localStorage.getItem(recoveryKey);
  if (saved === null && accounts.length === 1) return accounts[0];
  return accounts.find(({ id }) => id === saved);
}

export function recoveryEmail() {
  try {
    return recoveryAccount()?.email;
  } catch {
    return undefined;
  }
}

export async function resetLocalPassword(
  password: string,
  confirmation: string,
) {
  if (password.length < 8)
    throw new Error("Use at least 8 characters for your password.");
  if (password !== confirmation)
    throw new Error("The two passwords do not match.");
  const account = recoveryAccount();
  if (!account || activeAccount())
    throw new Error("Password reset is unavailable in this browser.");

  const salt = randomId();
  const passwordHash = await hashPassword(password, salt);
  const latest = recoveryAccount();
  if (
    activeAccount() ||
    latest?.id !== account.id ||
    latest.passwordHash !== account.passwordHash
  ) {
    throw new Error("Your account changed. Try again.");
  }
  saveAccounts(
    readAccounts().map((entry) =>
      entry.id === account.id ? { ...entry, salt, passwordHash } : entry,
    ),
  );
  return account.email;
}

function requireAccount() {
  const account = activeAccount();
  if (!account) throw new Error("Sign in to continue.");
  return account;
}

export function saveProfile(profile: { name: string; avatar?: string }) {
  const { id } = requireAccount();
  const name = profile.name.trim();
  if (!name) throw new Error("Enter a display name.");
  saveAccounts(
    readAccounts().map((account) =>
      account.id === id ? { ...account, ...profile, name } : account,
    ),
  );
}

async function verifyPassword(password: string) {
  const account = requireAccount();
  if ((await hashPassword(password, account.salt)) !== account.passwordHash)
    throw new Error("Current password is incorrect.");
  const latest = requireAccount();
  if (latest.id !== account.id || latest.passwordHash !== account.passwordHash)
    throw new Error("Your account changed. Try again.");
  return account;
}

export async function changePassword(current: string, password: string) {
  if (password.length < 8)
    throw new Error("Use at least 8 characters for your password.");
  const account = await verifyPassword(current);
  const salt = randomId();
  const passwordHash = await hashPassword(password, salt);
  const latest = requireAccount();
  if (latest.id !== account.id || latest.passwordHash !== account.passwordHash)
    throw new Error("Your account changed. Try again.");
  saveAccounts(
    readAccounts().map((entry) =>
      entry.id === account.id ? { ...entry, salt, passwordHash } : entry,
    ),
  );
}

export async function deleteAccount(password: string) {
  const account = await verifyPassword(password);
  saveAccounts(readAccounts().filter(({ id }) => id !== account.id));
  if (localStorage.getItem(recoveryKey) === account.id)
    localStorage.setItem(recoveryKey, "");
  signOut();
}
