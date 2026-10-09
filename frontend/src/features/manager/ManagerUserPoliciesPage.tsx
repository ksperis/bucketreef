/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  attachUserPolicy,
  deleteUserInlinePolicy,
  detachUserPolicy,
  listUserInlinePolicies,
  listUserPolicies,
  putUserInlinePolicy,
} from "../../api/managerIamUsers";
import ManagerEntityPoliciesPage from "./ManagerEntityPoliciesPage";
import { useManagerI18n } from "./managerI18n";

export default function ManagerUserPoliciesPage() {
  const { text } = useManagerI18n();
  return (
    <ManagerEntityPoliciesPage
      entityType="user"
      routeParam="userName"
      listPoliciesForEntity={listUserPolicies}
      attachPolicyToEntity={attachUserPolicy}
      detachPolicyFromEntity={detachUserPolicy}
      listInlinePoliciesForEntity={listUserInlinePolicies}
      putInlinePolicyForEntity={putUserInlinePolicy}
      deleteInlinePolicyForEntity={deleteUserInlinePolicy}
      extraActions={(entityName) => [
        {
          label: text("Access keys"),
          to: `/manager/users/${encodeURIComponent(entityName)}/keys`,
          variant: "ghost",
        },
      ]}
    />
  );
}
