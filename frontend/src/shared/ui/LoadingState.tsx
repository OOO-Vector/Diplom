import "./LoadingState.css";

export function LoadingSpinner() {
  return <span className="loading-state__spinner" aria-hidden="true" />;
}

export function LoadingState({ overlay = false }: { overlay?: boolean }) {
  return (
    <div
      className={
        overlay ? "loading-state loading-state--overlay" : "loading-state"
      }
      role="status"
    >
      <LoadingSpinner />
      <span className="loading-state__label">Loading workspace…</span>
    </div>
  );
}
