"""Validate the analyzer report without publishing any matched secret values."""
import json
from pathlib import Path


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


def is_test_fixture(item):
    expected = FIXTURE_LOCATIONS.get(item.get("location", {}).get("file"), set())
    return (item.get("raw_source_code_extract") in expected
            and any(identifier.get("type") == "gitleaks_rule_id"
                    and identifier.get("value") == "Password in URL"
                    for identifier in item.get("identifiers", [])))


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
    print(f"Known disposable PostgreSQL fixture findings: {sum(is_test_fixture(item) for item in report['vulnerabilities'])}")
    if result:
        raise SystemExit("Secret detection found unresolved findings")
