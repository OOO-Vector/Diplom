import { z } from "zod";
import { workspaceKey } from "../../account/accountWorkspace";

const storageKey = "team-ai.notifications.unread";
const inboxKey = "team-ai.notifications.items";
const listeners = new Set<() => void>();
let fallbackUnread = false;
let fallbackEntries = "[]";

export type InboxEvent =
  | {
      type: "revision-request";
      projectId: string;
      proposalId: string;
      adr: string;
    }
  | {
      type: "project-invitation";
      projectId: string;
      projectName: string;
      invitedBy?: string;
    };

export type InboxNotification = InboxEvent & {
  id: string;
  receivedAt: string;
  unread?: boolean;
};
const entry = z.object({
  id: z.string(),
  projectId: z.string(),
  receivedAt: z.string().datetime(),
  unread: z.boolean().optional(),
});
const inbox = z.array(
  z.discriminatedUnion("type", [
    entry.extend({
      type: z.literal("revision-request"),
      proposalId: z.string(),
      adr: z.string(),
    }),
    entry.extend({
      type: z.literal("project-invitation"),
      projectName: z.string(),
      invitedBy: z.string().optional(),
    }),
  ]),
);

export function inboxSnapshot() {
  try {
    return localStorage.getItem(workspaceKey(inboxKey)) ?? "[]";
  } catch {
    return fallbackEntries;
  }
}

export function parseInbox(snapshot: string): InboxNotification[] {
  try {
    return inbox.parse(JSON.parse(snapshot));
  } catch {
    return [];
  }
}

export function hasUnreadNotifications() {
  try {
    return localStorage.getItem(workspaceKey(storageKey)) === "true";
  } catch {
    return fallbackUnread;
  }
}

export function subscribeToUnreadNotifications(listener: () => void) {
  function handleStorage(event: StorageEvent) {
    if (
      event.key === workspaceKey(storageKey) ||
      event.key === workspaceKey(inboxKey) ||
      event.key === null
    )
      listener();
  }
  listeners.add(listener);
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

function setUnread(unread: boolean) {
  fallbackUnread = unread;
  try {
    if (unread) localStorage.setItem(workspaceKey(storageKey), "true");
    else localStorage.removeItem(workspaceKey(storageKey));
  } catch {
    // Keep unread state available in the current tab.
  }
  listeners.forEach((listener) => listener());
}

export function receiveNotification(event?: InboxEvent) {
  if (event) {
    const entry: InboxNotification = {
      ...event,
      id: crypto.getRandomValues(new Uint32Array(4)).join("-"),
      receivedAt: new Date().toISOString(),
      unread: true,
    };
    storeInbox([entry, ...parseInbox(inboxSnapshot())]);
  }
  setUnread(true);
}

export function markNotificationsRead() {
  storeInbox(
    parseInbox(inboxSnapshot()).map((entry) => ({ ...entry, unread: false })),
  );
  setUnread(false);
}

function storeInbox(entries: InboxNotification[]) {
  fallbackEntries = JSON.stringify(entries);
  try {
    localStorage.setItem(workspaceKey(inboxKey), fallbackEntries);
  } catch {
    // Keep notifications available in memory when storage is unavailable.
  }
}

export function resolveRevisionNotifications(
  projectId: string,
  proposalId: string,
) {
  const entries = parseInbox(inboxSnapshot());
  const remaining = entries.filter(
    (entry) =>
      entry.type !== "revision-request" ||
      entry.projectId !== projectId ||
      entry.proposalId !== proposalId,
  );
  if (remaining.length === entries.length) return;

  storeInbox(remaining);
  setUnread(
    remaining.some((entry) => entry.unread ?? hasUnreadNotifications()),
  );
}
