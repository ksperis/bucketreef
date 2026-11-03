/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { ListBadge } from "../../components/list/ListControls";

const MAX_VISIBLE_NAMES = 2;

export default function ManagerIamNameListCell({ names }: { names?: string[] | null }) {
  if (!names || names.length === 0) {
    return <span className="ui-caption text-slate-500 dark:text-slate-400">-</span>;
  }

  const hiddenNames = names.slice(MAX_VISIBLE_NAMES);

  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {names.slice(0, MAX_VISIBLE_NAMES).map((name) => (
        <ListBadge key={name} tone="neutral" className="max-w-40 truncate" title={name}>
          {name}
        </ListBadge>
      ))}
      {hiddenNames.length > 0 && (
        <ListBadge tone="neutral" title={hiddenNames.join(", ")}>
          +{hiddenNames.length}
        </ListBadge>
      )}
    </div>
  );
}
