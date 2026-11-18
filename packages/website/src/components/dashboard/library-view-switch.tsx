import { List, Network } from "lucide-react";

const views = [
  { id: "list", label: "List", Icon: List },
  { id: "graph", label: "Graph", Icon: Network },
] as const;

export type LibraryView = (typeof views)[number]["id"];

export function LibraryViewSwitch({
  view,
  onChange,
}: {
  view: LibraryView;
  onChange?: (view: LibraryView) => void;
}) {
  return (
    <div
      className="library-view-switch"
      role={onChange ? "group" : undefined}
      aria-label={onChange ? "Note view" : undefined}
      aria-hidden={onChange ? undefined : true}
    >
      {views.map(({ id, label, Icon }) =>
        onChange ? (
          <button
            key={id}
            type="button"
            aria-pressed={view === id}
            onClick={() => onChange(id)}
          >
            <Icon size={15} aria-hidden="true" /> {label}
          </button>
        ) : (
          <span key={id}>
            <Icon size={15} aria-hidden="true" /> {label}
          </span>
        ),
      )}
    </div>
  );
}
