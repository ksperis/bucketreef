#!/usr/bin/env python3
"""Issue integration evidence only for successful, exact-revision jobs."""
import json
import os
from pathlib import Path

from gitlab_api import GitLabAPI, expected_names, successful_jobs


def integration_record(api, plan, pipeline_id):
    pipeline = api.get(f"pipelines/{pipeline_id}")
    if pipeline["sha"] != plan["sha"] or pipeline["ref"] != plan["ref"] or pipeline["source"] != "parent_pipeline":
        raise ValueError("Unexpected qualification pipeline")
    jobs = successful_jobs(api.jobs(pipeline_id), expected_names(plan["jobs"]), plan["sha"])
    return {"schema": 1, "sha": plan["sha"], "ref": plan["ref"], "parent_id": plan["parent_id"],
            "pipeline_id": pipeline_id, "plan": plan, "jobs": jobs}


if __name__ == "__main__":
    plan = json.loads(Path("ci-plan.json").read_text())
    record = integration_record(GitLabAPI(), plan, int(os.environ["CI_PIPELINE_ID"]))
    Path("integration.json").write_text(json.dumps(record, indent=2) + "\n")
