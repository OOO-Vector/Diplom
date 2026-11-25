import { useEffect, useRef, type ReactNode } from "react";
export function BacklogDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal?.();
    if (element && !element.open) element.open = true;
    return () => {
      if (element?.open) element.close?.();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="project-tasks__dialog"
      aria-labelledby="task-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id="task-dialog-title">{title}</h2>
        <button type="button" aria-label="Close dialog" onClick={onClose}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
