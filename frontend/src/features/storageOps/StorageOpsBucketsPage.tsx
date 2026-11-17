/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import BucketOpsWorkbench from "../shared/BucketOpsWorkbench";
import { useI18n } from "../../i18n";

export default function StorageOpsBucketsPage() {
  const { t } = useI18n();
  return (
    <BucketOpsWorkbench
      mode="storage-ops"
      shell={{
        pageDescription: t({
          en: "Cross-context bucket listing and bulk configuration operations.",
          fr: "Liste des Buckets multi-contextes et opérations de configuration en masse.",
          de: "Kontextübergreifende Bucket-Liste und Massenkonfiguration.",
          zh: "跨上下文 Bucket 列表和批量配置操作。",
        }),
      }}
    />
  );
}
