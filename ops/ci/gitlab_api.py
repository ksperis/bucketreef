"""Read-only GitLab API; never mistake the newest green pipeline for this SHA."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request


class GitLabAPI:
    def __init__(self):
        self.base = f"{os.environ['CI_API_V4_URL']}/projects/{os.environ['CI_PROJECT_ID']}"
        self.token = os.environ["GITLAB_CI_READ_API_TOKEN"]
        if not self.token:
            raise ValueError("GITLAB_CI_READ_API_TOKEN is required")

    def get(self, path, *, binary=False, missing_ok=False):
        request = urllib.request.Request(f"{self.base}/{path}", headers={"PRIVATE-TOKEN": self.token})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                data = response.read()
                return data if binary else json.loads(data)
        except urllib.error.HTTPError as error:
            if error.code == 404 and missing_ok:
                return None
            raise RuntimeError(f"GitLab read failed with HTTP {error.code}") from None

    def pages(self, path):
        separator = "&" if "?" in path else "?"
        page = 1
        while True:
            items = self.get(f"{path}{separator}per_page=100&page={page}")
            if not isinstance(items, list):
                raise ValueError("Invalid GitLab listing")
            yield from items
            if len(items) < 100:
                return
            page += 1

    def jobs(self, pipeline_id):
        return list(self.pages(f"pipelines/{int(pipeline_id)}/jobs?include_retried=false"))

    def artifact(self, job_id, path):
        return self.get(f"jobs/{int(job_id)}/artifacts/{urllib.parse.quote(path, safe='/')}", binary=True, missing_ok=True)


def expected_names(names):
    result = []
    for name in names:
        if name.endswith("image-vuln-scan") or name == "release-bundle-smoke":
            result.extend(f"{name}: [{arch}]" for arch in ("amd64", "arm64"))
        else:
            result.append(name)
    return result


def successful_jobs(jobs, expected, sha):
    found = {}
    for job in jobs:
        name = job["name"]
        if name in expected:
            if name in found:
                raise ValueError(f"Ambiguous validation job: {name}")
            if job["status"] != "success" or job.get("allow_failure") or job["commit"]["id"] != sha:
                raise ValueError(f"Unsuccessful or mismatched validation: {name}")
            found[name] = job["id"]
    if set(found) != set(expected):
        raise ValueError("Required pipeline jobs are missing")
    return found


def completed_records(api, ref, filename="integration.json", sha=None):
    query = urllib.parse.urlencode({"ref": ref, "status": "success", "order_by": "id", "sort": "desc", **({"sha": sha} if sha else {})})
    for parent in api.pages(f"pipelines?{query}"):
        if parent.get("status") != "success" or parent.get("source") not in {"push", "web"} or parent["ref"] != ref or (sha and parent["sha"] != sha):
            continue
        for bridge in api.pages(f"pipelines/{parent['id']}/bridges"):
            child = bridge.get("downstream_pipeline")
            if bridge["name"] != "run-selected" or bridge["status"] != "success" or not child:
                continue
            detail = api.get(f"pipelines/{child['id']}")
            if detail["status"] != "success" or detail["sha"] != parent["sha"] or detail["ref"] != ref or detail["source"] != "parent_pipeline":
                continue
            jobs = api.jobs(child["id"])
            ready = [job for job in jobs if job["name"] == "integration-ready" and job["status"] == "success"
                     and not job.get("allow_failure") and job["commit"]["id"] == parent["sha"]]
            if len(ready) != 1:
                continue
            raw = api.artifact(ready[0]["id"], filename)
            if raw is None:
                continue
            record = json.loads(raw)
            if (record.get("schema") != 1 or record.get("sha") != parent["sha"]
                or record.get("pipeline_id") != child["id"] or record.get("parent_id") != parent["id"]
                or record.get("ref") != ref):
                raise ValueError("Pipeline evidence has inconsistent provenance")
            actual = successful_jobs(jobs, expected_names(record["plan"]["jobs"]), record["sha"])
            if actual != record["jobs"]:
                raise ValueError("Pipeline evidence no longer matches its jobs")
            yield record


def latest_baseline(api, ref):
    return next((record["sha"] for record in completed_records(api, ref)
                 if record["plan"]["profile"] in {"integration", "qualify"}), None)
