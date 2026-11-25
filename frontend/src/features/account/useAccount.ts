import { useEffect, useSyncExternalStore } from "react";
import { authSession } from "./authSession";
import {
  accountSnapshot,
  subscribeAccount,
  type AccountProfile,
} from "./localAccount";

export const isLocalDemo = () =>
  (import.meta.env.DEV && import.meta.env.MODE === "local-demo") ||
  import.meta.env.VITE_AUTH_MODE === "local-demo";

export function useSession() {
  const snapshot = useSyncExternalStore(
    authSession.subscribe,
    authSession.snapshot,
  );
  useEffect(() => {
    if (!isLocalDemo()) authSession.start();
  }, []);
  return snapshot;
}

export function useAccount(): AccountProfile | null {
  const snapshot = useSession();
  const local = useSyncExternalStore(subscribeAccount, accountSnapshot);
  if (isLocalDemo())
    return local ? (JSON.parse(local) as AccountProfile) : null;
  if (snapshot.status !== "authenticated") return null;
  const { id, email, displayName } = snapshot.user;
  return { id, email, name: displayName };
}
