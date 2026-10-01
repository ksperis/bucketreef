import type { AccessAuditScope } from "../../api/accessAudit";

type AccessAuditContext = {
  userId?: number;
  groupId?: number;
  scope?: AccessAuditScope;
  targetId?: number;
};

export function buildAccessAuditHref({ userId, groupId, scope, targetId }: AccessAuditContext): string {
  const params = new URLSearchParams();
  if (userId != null) params.set("user_id", String(userId));
  if (groupId != null) params.set("group_id", String(groupId));
  if (scope) params.set("scope", scope);
  if (targetId != null) params.set("target_id", String(targetId));
  const query = params.toString();
  return query ? `/admin/access-audit?${query}` : "/admin/access-audit";
}
