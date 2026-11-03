/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListBadge } from "../../components/list/ListControls";
import { useManagerI18n } from "./managerI18n";

type ManagerIamPoliciesCellProps = {
  managedPolicies?: string[] | null;
  inlinePolicies?: string[] | null;
};

const MAX_VISIBLE_POLICIES = 2;

function managedPolicyName(policyArn: string): string {
  return policyArn.split("/").pop() || policyArn;
}

function PolicyRow({
  label,
  policies,
  displayName,
  title,
}: {
  label: string;
  policies: string[];
  displayName: (policy: string) => string;
  title: (policy: string) => string;
}) {
  const visiblePolicies = policies.slice(0, MAX_VISIBLE_POLICIES);
  const hiddenPolicies = policies.slice(MAX_VISIBLE_POLICIES);

  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2">
      <span className="ui-caption w-14 shrink-0 font-medium text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <div className="flex min-w-0 items-center gap-1.5">
        {visiblePolicies.map((policy) => (
          <ListBadge
            key={policy}
            tone="neutral"
            className="min-w-0 max-w-36 truncate"
            title={title(policy)}
          >
            {displayName(policy)}
          </ListBadge>
        ))}
        {hiddenPolicies.length > 0 && (
          <ListBadge
            tone="neutral"
            className="shrink-0"
            title={hiddenPolicies.map(displayName).join(", ")}
          >
            +{hiddenPolicies.length}
          </ListBadge>
        )}
      </div>
    </div>
  );
}

export default function ManagerIamPoliciesCell({
  managedPolicies,
  inlinePolicies,
}: ManagerIamPoliciesCellProps) {
  const { text } = useManagerI18n();
  const managed = managedPolicies ?? [];
  const inline = inlinePolicies ?? [];

  if (managed.length === 0 && inline.length === 0) {
    return <span className="ui-caption text-slate-500 dark:text-slate-400">-</span>;
  }

  return (
    <div className="min-w-0 space-y-1">
      {managed.length > 0 && (
        <PolicyRow
          label={text("Managed")}
          policies={managed}
          displayName={managedPolicyName}
          title={(policy) => policy}
        />
      )}
      {inline.length > 0 && (
        <PolicyRow
          label={text("Inline")}
          policies={inline}
          displayName={(policy) => policy}
          title={(policy) => policy}
        />
      )}
    </div>
  );
}
