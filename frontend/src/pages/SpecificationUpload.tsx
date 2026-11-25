import { useRef } from "react";

export function SpecificationUpload({
  disabled,
  onChoose,
}: {
  disabled: boolean;
  onChoose: (file: File) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={picker}
        type="file"
        hidden
        disabled={disabled}
        accept=".txt,.pdf,text/plain,application/pdf"
        aria-label="Project document"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onChoose(file);
        }}
      />
      <button
        className="project-tasks__button"
        type="button"
        disabled={disabled}
        onClick={() => picker.current?.click()}
      >
        Load document
      </button>
    </>
  );
}
