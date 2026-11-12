# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Apply a versioned deployment configuration to a BucketReef installation."""
import argparse
import json
import os
from pathlib import Path
import sys

from pydantic import ValidationError

from app.core.sensitive_data import sanitized_error_log_detail
from app.models.deployment_configuration import DeploymentManifest
from app.services.database_initialization import prepare_deployment_database
from app.services.deployment_configuration_service import DeploymentConfigurationService


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("apply",))
    parser.add_argument("--file", type=Path, help="JSON manifest. Defaults to DEPLOYMENT_CONFIG.")
    parser.add_argument("--expected-revision", type=int, help="Require this manifest revision.")
    args = parser.parse_args()
    try:
        from app.core.database import SessionLocal, engine

        raw = args.file.read_text(encoding="utf-8") if args.file else os.environ.get("DEPLOYMENT_CONFIG")
        if not raw:
            parser.error("Supply a JSON manifest with --file or DEPLOYMENT_CONFIG.")
        manifest = DeploymentManifest.from_json(raw)
        if args.expected_revision is not None and manifest.revision != args.expected_revision:
            raise ValueError("The deployment manifest revision does not match the requested revision.")
        prepare_deployment_database(engine, SessionLocal)
        with SessionLocal() as db:
            result = DeploymentConfigurationService(db).apply(manifest)
    except ValidationError as exc:
        for error in exc.errors(include_input=False, include_context=False, include_url=False):
            location = ".".join(str(segment) for segment in error["loc"] if not isinstance(segment, str) or segment.isidentifier())
            print(f"Invalid deployment manifest at {location or 'root'} ({error['type']}).", file=sys.stderr)
        return 1
    except (OSError, UnicodeError):
        print("Could not read the deployment manifest.", file=sys.stderr)
        return 1
    except ValueError as exc:
        print(sanitized_error_log_detail(exc), file=sys.stderr)
        return 1
    except Exception:
        print("Unable to apply deployment configuration. Check the database and RGW connectivity.", file=sys.stderr)
        return 1
    print(json.dumps({
        "revision": result.revision,
        "status": "identities_pending" if result.pending_endpoints else "applied",
        "changed": result.changed,
        "pending_endpoints": list(result.pending_endpoints),
    }))
    return 2 if result.pending_endpoints else 0


if __name__ == "__main__":
    sys.exit(main())
