import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { ErrorBoundary } from "./ErrorBoundary";
import { authSession } from "../features/account/authSession";
import { router } from "./router";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
let currentUser: string | undefined;
authSession.subscribe(() => {
  const session = authSession.snapshot();
  const nextUser =
    session.status === "authenticated" ? session.user.id : undefined;
  if (currentUser !== nextUser) {
    queryClient.clear();
    currentUser = nextUser;
  }
});

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
