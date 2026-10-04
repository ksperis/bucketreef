/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useI18n } from "../i18n";
import TopbarUtilityHint from "./TopbarUtilityHint";

export default function WorkspaceDocumentationLink({ href }: { href: string }) {
  const { t } = useI18n();
  const label = t({
    en: "Documentation",
    fr: "Documentation",
    de: "Dokumentation",
    zh: "文档",
  });
  const title = t({
    en: "Open workspace documentation",
    fr: "Ouvrir la documentation de cet espace",
    de: "Dokumentation dieses Arbeitsbereichs öffnen",
    zh: "打开此工作区的文档",
  });

  return (
    <TopbarUtilityHint label={label}>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={title}
        className="shell-utility-button"
      >
        <DocumentationIcon />
      </a>
    </TopbarUtilityHint>
  );
}

function DocumentationIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M5 3.5h6.5L15 7v9.5H5v-13Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M11.5 3.5V7H15M7.5 10h5M7.5 13h5" />
    </svg>
  );
}
