import { useEffect, useRef, useState } from "react";
import { LoadingSpinner } from "../shared/ui/LoadingState";

const extractionPreviewMs = 1200;
const validationPreviewMs = 13000;
const completionPreviewMs = 14500;
const failurePreviewMs = 5000;

export function DecompositionProgress({
  onComplete,
  ready,
  simulateFailure,
}: {
  ready: boolean;
  simulateFailure: boolean;
  onComplete: (elapsed: number) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [extractedAt, setExtractedAt] = useState<number>();
  const completed = useRef(false);
  useEffect(() => {
    const started = performance.now();
    let timer: number | undefined;
    function schedule() {
      window.clearInterval(timer);
      if (document.hidden) return;
      const tick = () => setElapsed(performance.now() - started);
      tick();
      timer = window.setInterval(tick, 100);
    }
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, []);

  useEffect(() => {
    if (ready && extractedAt === undefined)
      setExtractedAt(Math.max(extractionPreviewMs, elapsed));
  }, [ready, elapsed, extractedAt]);

  const previewTime =
    extractedAt === undefined ? 0 : elapsed - extractedAt + extractionPreviewMs;
  const finished =
    previewTime >= (simulateFailure ? failurePreviewMs : completionPreviewMs);
  useEffect(() => {
    if (finished && !document.hidden && !completed.current) {
      completed.current = true;
      onComplete(elapsed);
    }
  }, [finished, elapsed, onComplete]);

  const extracting = previewTime < extractionPreviewMs;
  return (
    <div className="project-tasks__empty project-tasks__processing">
      <LoadingSpinner />
      <p role="status">
        {extracting ? (
          <>
            Extracting text layer from
            <br />
            specification...
          </>
        ) : previewTime < validationPreviewMs ? (
          "Decomposing requirements..."
        ) : (
          <>
            Validating JSON schema and
            <br />
            dependency graph...
          </>
        )}
      </p>
      <span role="timer">{(Math.floor(elapsed / 100) / 10).toFixed(1)} s</span>
    </div>
  );
}
