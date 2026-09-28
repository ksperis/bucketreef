/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { PRODUCT_NAME, PRODUCT_VERSION } from "../constants/product";

type AppVersionProps = {
  className?: string;
};

export default function AppVersion({ className = "" }: AppVersionProps) {
  return (
    <span className={`ui-caption ${className}`.trim()}>
      {PRODUCT_NAME} v{PRODUCT_VERSION}
    </span>
  );
}
