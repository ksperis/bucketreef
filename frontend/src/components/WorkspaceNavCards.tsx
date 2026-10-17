/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Link } from "react-router-dom";
import { cx, uiCardClass } from "./ui/styles";
import "./compactDashboard.css";

type WorkspaceNavCardItem = {
  title: string;
  description: string;
  to: string;
  eyebrow?: string;
};

type WorkspaceNavCardsProps = {
  items: WorkspaceNavCardItem[];
  columns?: 2 | 3 | 4;
  className?: string;
};

export default function WorkspaceNavCards({
  items,
  columns = 3,
  className,
}: WorkspaceNavCardsProps) {
  const gridClass = columns === 4 ? "xl:grid-cols-4" : columns === 2 ? "lg:grid-cols-2" : "xl:grid-cols-3";

  return (
    <div className={cx("ui-dashboard-nav-grid sm:grid-cols-2", gridClass, className)}>
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className={cx(
            uiCardClass,
            "ui-dashboard-nav-card"
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {item.eyebrow ? (
                <p className="ui-dashboard-note">
                  {item.eyebrow}
                </p>
              ) : null}
              <h3 className={cx("ui-dashboard-title", item.eyebrow && "mt-1.5")}>
                {item.title}
              </h3>
            </div>
            <span className="ui-dashboard-nav-arrow">
              <ArrowIcon className="h-4 w-4" />
            </span>
          </div>
          <p className="ui-dashboard-note">{item.description}</p>
        </Link>
      ))}
    </div>
  );
}

function ArrowIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M6 10h8m0 0-3-3m3 3-3 3" />
    </svg>
  );
}
