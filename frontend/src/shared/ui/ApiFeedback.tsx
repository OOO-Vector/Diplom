import { useEffect, useState } from "react";
import type { ApiError } from "../api/requestApi";

export function ApiFeedback({
  error,
  onRetry,
}: {
  error: ApiError;
  onRetry?: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  const waiting = error.retryAt !== undefined && error.retryAt > now;
  const retryable =
    error.status === undefined || error.status === 429 || error.status >= 500;

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  return (
    <div>
      <p role="alert">{error.message}</p>
      {waiting && error.retryAt && (
        <p>Try again in {Math.ceil((error.retryAt - now) / 1000)} s.</p>
      )}
      {retryable && onRetry && (
        <button type="button" disabled={waiting} onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
