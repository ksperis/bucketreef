"""Validate the analyzer report without publishing any matched secret values."""
import hashlib
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
# Before the templates were extracted, the same disposable service lived here.
FIXTURE_LOCATIONS[".gitlab-ci.yml"] = {POSTGRES_FIXTURES["ops/ci/gitlab/jobs.yml"]}

# Public synthetic identifiers used by redaction tests and screenshot fixtures.
AWS_FIXTURES = {
    "backend/tests/test_admin_stats_error_sanitization.py": {"AKIAIOSFODNN7EXAMPLE"},
    "backend/tests/test_manager_stats_connection_metrics.py": {"AKIAIOSFODNN7EXAMPLE"},
    "frontend/src/api/storageOps.stream.test.ts": {"AKIAIOSFODNN7EXAMPLE"},
    "frontend/src/utils/apiError.test.ts": {"AKIAIOSFODNN7EXAMPLE"},
    "frontend/src/utils/runtimeDiagnostics.test.ts": {"AKIAIOSFODNN7EXAMPLE"},
    "backend/tests/test_s3_connection_api_contract.py": {"AKIAINVALIDOWNERTYPE"},
    "frontend/scripts/docs-screenshots/fixtures/base.ts": {"AKIAHELIOSPORTALROOT"},
}
AWS_FIXTURES["ops/ci/secret_report.py"] = set().union(*AWS_FIXTURES.values())

# Removed localhost PostgreSQL examples used the project name as user/password.
# Bind each exception to its original commit and exact extract fingerprint, so
# a reintroduction or changed example still requires review.
HISTORICAL_ENV_EXAMPLES = {
    "97df1e1e8bd66688d7c1a1313cc42b4d9f3756a8": "1411cd74bd00b0848b09c81f8355ee14b52b9b298733e58d4fc33b3fc6d308c4",
    "0d471c7552f76702635cdd49f9862064f7855db1": "39b2693267f2b98d60b9b8d7a322bbdf60ab08c75694ceeb179d397489c606f3",
    "6474d5df6762d042c2ed1b580d57e316a1d6d9cc": "66d665e329993237af528672abaed0799041da1bdc3ec4d8cf7635b98e1ed1b9",
}

# GitLab secret analyzer 7 can omit the originating commit for findings from
# the scanned history. Keep the fallback exact by path and extract digest, and
# accept it only after the matched value has disappeared from the current file.
REMOVED_PASSWORD_URL_FIXTURES = {
    "backend/.env.example": set(HISTORICAL_ENV_EXAMPLES.values()),
    "backend/tests/test_admin_onboarding.py": {
        "789843487b075417c068e27849039ac4917bfe65950127f5958a1d61a997a59d",
        "ca122f2fef05b2c5eedcacfac7daec5bf60b96c4a2bb92e17d1adba547ae5783",
    },
}


def is_removed_password_url_fixture(path, extract):
    digest = hashlib.sha256(extract.encode()).hexdigest()
    if digest not in REMOVED_PASSWORD_URL_FIXTURES.get(path, set()):
        return False
    try:
        current = Path(path).read_text()
    except (OSError, UnicodeError):
        return False
    return extract not in current


def is_placeholder_commit_sha(commit_sha):
    return isinstance(commit_sha, str) and bool(commit_sha) and set(commit_sha) == {"0"}


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
    digest = hashlib.sha256(extract.encode()).hexdigest()
    if (path == "backend/.env.example"
            and HISTORICAL_ENV_EXAMPLES.get(location.get("commit", {}).get("sha")) == digest):
        return True
    commit_sha = location.get("commit", {}).get("sha")
    if commit_sha and not is_placeholder_commit_sha(commit_sha):
        return False
    return is_removed_password_url_fixture(path, extract)


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
