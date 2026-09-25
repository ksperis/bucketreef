/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import "./bucketFeatureCards.css";

export default function BucketFeatureGrid({
  title,
  description,
  summary,
  children,
}: {
  title: string;
  description: string;
  summary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bucket-feature-layout" aria-label={title}>
      <div className="bucket-feature-grid-intro">
        <div className="min-w-0">
          <h2 className="bucket-feature-grid-title">{title}</h2>
          <p className="bucket-feature-grid-description">{description}</p>
        </div>
        {summary ? <div className="bucket-feature-grid-summary">{summary}</div> : null}
      </div>
      <div className="bucket-feature-grid">{children}</div>
    </section>
  );
}
