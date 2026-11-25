import type { BacklogItem } from "../features/projects/model/taskBacklog";

export function DependencyEditor({
  items,
  draft,
  onChange,
}: {
  items: readonly BacklogItem[];
  draft: BacklogItem;
  onChange: (blockedBy: string[]) => void;
}) {
  const candidates = items.filter(({ id }) => id !== draft.id);
  if (!candidates.length) return null;
  return (
    <fieldset>
      <legend>Blocked by</legend>
      {candidates.map(({ id, title }) => (
        <label key={id}>
          <input
            type="checkbox"
            checked={draft.blockedBy.includes(id)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...draft.blockedBy, id]
                  : draft.blockedBy.filter((blocker) => blocker !== id),
              )
            }
          />
          {title}
        </label>
      ))}
    </fieldset>
  );
}
