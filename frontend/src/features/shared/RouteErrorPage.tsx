/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect } from "react";
import { useRouteError } from "react-router-dom";
import ErrorState from "../../components/errors/ErrorState";
import { reportRuntimeError } from "../../utils/runtimeDiagnostics";

export default function RouteErrorPage() {
  const error = useRouteError();
  useEffect(() => { reportRuntimeError("Unhandled route error", error); }, [error]);
  return <ErrorState error={error} />;
}
