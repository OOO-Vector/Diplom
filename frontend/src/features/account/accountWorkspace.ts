import { authSession } from "./authSession";
import {
  activeAccountId as demoAccountId,
  workspaceKey as demoWorkspaceKey,
} from "./localAccount";
import { isLocalDemo } from "./useAccount";

export function activeAccountId() {
  if (isLocalDemo()) return demoAccountId();
  const snapshot = authSession.snapshot();
  return snapshot.status === "authenticated" ? snapshot.user.id : null;
}

export function workspaceKey(key: string) {
  if (isLocalDemo()) return demoWorkspaceKey(key);
  const id = activeAccountId();
  if (!id) return key + ".signed-out";
  return key + ".server." + id;
}
