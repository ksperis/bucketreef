"""Validate the analyzer report without publishing any matched secret values."""
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


# These public credentials belong only to disposable PostgreSQL CI services.
# Match the detector, file and complete extracted URL: never exclude a file,
# commit, rule, hostname or password substring from secret scanning.
POSTGRES_FIXTURES = {
    ".github/workflows/validate-task.yml": "postgresql://bucketreef:bucketreef-test-password@127.0.0.1",
    "ops/ci/gitlab/jobs.yml": "postgresql://bucketreef:bucketreef-test-password@postgres",
}
FIXTURE_LOCATIONS = {path: {url} for path, url in POSTGRES_FIXTURES.items()}
# The same literals are recorded here to define the exception itself.
FIXTURE_LOCATIONS["ops/ci/secret_report.py"] = set(POSTGRES_FIXTURES.values())
# Before the templates were extracted, the same disposable service lived here.
FIXTURE_LOCATIONS[".gitlab-ci.yml"] = {POSTGRES_FIXTURES["ops/ci/gitlab/jobs.yml"]}

# Public synthetic identifiers used by redaction tests and screenshot fixtures.
AWS_FIXTURES = {
    "backend/tests/test_admin_stats_error_sanitization.py": {"AKIAIOSFODNN7EXAMPLE"},
    "backend/tests/test_manager_stats_connection_metrics.py": {"AKIAIOSFODNN7EXAMPLE"},
    "frontend/src/api/storageOps.stream.test.ts": {"AKIAIOSFODNN7EXAMPLE"},
    "frontend/src/utils/apiError.test.ts": {"AKIAIOSFODNN7EXAMPLE"},
    "frontend/src/utils/runtimeDiagnostics.test.ts": {"AKIAIOSFODNN7EXAMPLE"},
    "backend/tests/test_s3_connection_api_contract.py": {
        "AKIAINVALIDOWNERTYPE",
        "AKIADUPLICATEPRIVATE",
        "AKIAUNEXPECTEDSHARED",
    },
    "frontend/scripts/docs-screenshots/fixtures/base.ts": {"AKIAHELIOSPORTALROOT"},
}
AWS_FIXTURES["ops/ci/secret_report.py"] = set().union(*AWS_FIXTURES.values())

def finding_metadata(item):
    location = item.get("location", {})
    extract = item.get("raw_source_code_extract")
    rules = sorted(
        identifier.get("value")
        for identifier in item.get("identifiers", [])
        if identifier.get("type") == "gitleaks_rule_id" and identifier.get("value")
    )
    return {
        "file": location.get("file"),
        "line": location.get("start_line"),
        "commit_sha": location.get("commit", {}).get("sha"),
        "extract_length": len(extract) if isinstance(extract, str) else None,
        "extract_sha256": hashlib.sha256(extract.encode()).hexdigest() if isinstance(extract, str) else None,
        "rules": rules,
    }


def is_test_fixture(item):
    location = item.get("location", {})
    path = location.get("file")
    extract = item.get("raw_source_code_extract")
    if not isinstance(extract, str):
        return False
    rules = {identifier.get("value") for identifier in item.get("identifiers", [])
             if identifier.get("type") == "gitleaks_rule_id"}
    if "AWS" in rules and extract in AWS_FIXTURES.get(path, set()):
        return True
    if "Password in URL" not in rules:
        return False
    if extract in FIXTURE_LOCATIONS.get(path, set()):
        return True
    return False


def summarize(report):
    if report.get("scan", {}).get("status") != "success" or not isinstance(report.get("vulnerabilities"), list):
        raise ValueError("Secret analyzer report missing or unsuccessful")
    return [{"file": item.get("location", {}).get("file"),
             "line": item.get("location", {}).get("start_line"),
             "rule": next(iter(item.get("identifiers", [])), {}).get("type")}
            for item in report["vulnerabilities"] if not is_test_fixture(item)]


if __name__ == "__main__":
    report = json.loads(Path("gl-secret-detection-report.json").read_text())
    result = summarize(report)
    Path("gl-security-reports").mkdir(exist_ok=True)
    Path("gl-security-reports/secrets-redacted.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
    print(f"Known public fixture findings: {sum(is_test_fixture(item) for item in report['vulnerabilities'])}")
    if result:
        for item in report["vulnerabilities"]:
            if not is_test_fixture(item):
                print("Unresolved finding metadata: " + json.dumps(finding_metadata(item), sort_keys=True))
        raise SystemExit("Secret detection found unresolved findings")
