"""Validate the analyzer report without publishing any matched secret values."""
import json
from pathlib import Path


def summarize(report):
    if report.get("scan", {}).get("status") != "success" or not isinstance(report.get("vulnerabilities"), list):
        raise ValueError("Secret analyzer report missing or unsuccessful")
    return [{"file": item.get("location", {}).get("file"),
             "line": item.get("location", {}).get("start_line"),
             "rule": item.get("identifiers", [{}])[0].get("type")}
            for item in report["vulnerabilities"]]


if __name__ == "__main__":
    result = summarize(json.loads(Path("gl-secret-detection-report.json").read_text()))
    Path("gl-security-reports").mkdir(exist_ok=True)
    Path("gl-security-reports/secrets-redacted.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
    if result:
        raise SystemExit("Secret detection found unresolved findings")
