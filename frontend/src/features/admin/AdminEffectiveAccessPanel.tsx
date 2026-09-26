/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import {
  listAccessAudit,
  type AccessAuditRow,
  type AccessAuditScope,
} from "../../api/accessAudit";
import ListPageSection from "../../components/list/ListPageSection";
import { ListActionLink } from "../../components/list/ListControls";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { extractApiError } from "../../utils/apiError";
import AccessAuditTable from "./AccessAuditTable";

type Props = {
  userId?: number;
  scope?: AccessAuditScope;
  targetId?: number;
  contextLabel: string;
  showUserColumn?: boolean;
};

export default function AdminEffectiveAccessPanel({
  userId,
  scope,
  targetId,
  contextLabel,
  showUserColumn = userId == null,
}: Props) {
  const [rows, setRows] = useState<AccessAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listAccessAudit({ page, page_size: pageSize, user_id: userId, scope, target_id: targetId, sort_by: "user", sort_dir: "asc" })
      .then((response) => {
        if (cancelled) return;
        setRows(response.items);
        setTotal(response.total);
      })
      .catch((cause) => {
        if (cancelled) return;
        setRows([]);
        setTotal(0);
        setError(extractApiError(cause, "Unable to load effective access."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [page, pageSize, scope, targetId, userId]);

  const auditPath = useMemo(() => {
    const params = new URLSearchParams();
    if (userId != null) params.set("user_id", String(userId));
    if (scope) params.set("scope", scope);
    if (targetId != null) params.set("target_id", String(targetId));
    const query = params.toString();
    return query ? `/admin/access-audit?${query}` : "/admin/access-audit";
  }, [scope, targetId, userId]);
  const status = resolveListTableStatus({ loading, error, rowCount: rows.length });

  return (
    <ListPageSection
      variant="section"
      title="Effective access"
      description={`Saved effective BucketReef permissions for ${contextLabel}, including UI Group inheritance.`}
      countLabel={`${total} ${total === 1 ? "entry" : "entries"}`}
      headingActions={<ListActionLink to={auditPath}>View in Access audit</ListActionLink>}
      secondaryContent={error ? <span role="alert">{error}</span> : undefined}
    >
      <AccessAuditTable
        rows={rows}
        status={status}
        emptyMessage="No effective BucketReef rights are currently granted for this context."
        showUserColumn={showUserColumn}
        pagination={{
          page,
          pageSize,
          total,
          onPageChange: setPage,
          onPageSizeChange: (size) => { setPage(1); setPageSize(size); },
          disabled: loading,
        }}
      />
    </ListPageSection>
  );
}
