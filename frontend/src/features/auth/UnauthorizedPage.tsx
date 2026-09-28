/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import ErrorState from "../../components/errors/ErrorState";

export default function UnauthorizedPage() {
  return <ErrorState kind="forbidden" />;
}
