import { useEffect } from "react";
import { logError } from "../shared/lib/logger";
import { FailureState } from "../shared/ui/FailureState";

export function RouteError() {
  useEffect(() => {
    logError("route.failure");
  }, []);

  return <FailureState />;
}
