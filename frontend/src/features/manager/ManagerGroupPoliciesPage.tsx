/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  attachGroupPolicy,
  deleteGroupInlinePolicy,
  detachGroupPolicy,
  listGroupInlinePolicies,
  listGroupPolicies,
  putGroupInlinePolicy,
} from "../../api/managerIamGroups";
import ManagerEntityPoliciesPage from "./ManagerEntityPoliciesPage";
import { useManagerI18n } from "./managerI18n";

export default function ManagerGroupPoliciesPage({ embedded = false }: { embedded?: boolean }) {
  const { text } = useManagerI18n();
  return (
    <ManagerEntityPoliciesPage
      entityType="group"
      routeParam="groupName"
      listPoliciesForEntity={listGroupPolicies}
      attachPolicyToEntity={attachGroupPolicy}
      detachPolicyFromEntity={detachGroupPolicy}
      listInlinePoliciesForEntity={listGroupInlinePolicies}
      putInlinePolicyForEntity={putGroupInlinePolicy}
      deleteInlinePolicyForEntity={deleteGroupInlinePolicy}
      embedded={embedded}
      extraActions={(entityName) => [
        {
          label: text("Members"),
          to: `/manager/groups/${encodeURIComponent(entityName)}/members`,
          variant: "ghost",
        },
      ]}
    />
  );
}
