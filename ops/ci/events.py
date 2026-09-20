#!/usr/bin/env python3
"""Resolve immutable event inputs and emit the shared plan for either platform."""
import argparse
import json
import os
from pathlib import Path

from plan import ROOT, changes, classify, git, select, version_changed


def github_plan(env):
    event = json.loads(Path(env["GITHUB_EVENT_PATH"]).read_text())
    if env["GITHUB_EVENT_NAME"] == "pull_request":
        pr = event["pull_request"]
        head, base = pr["head"]["sha"], pr["base"]["sha"]
        ref = pr["base"]["ref"]
    elif env["GITHUB_EVENT_NAME"] == "merge_group":
        head, base = event["merge_group"]["head_sha"], event["merge_group"]["base_sha"]
        ref = event["merge_group"]["base_ref"].removeprefix("refs/heads/")
    else:
        raise ValueError("Unsupported public CI event")
    tested = git("rev-parse", "HEAD")
    if tested != env["GITHUB_SHA"]:
        raise ValueError("Checkout does not match the event revision")
    # Compare the actual tested merge tree, not just the fork's head.
    paths = changes(base, tested)
    return {**select("pr", paths, ref=ref), "base_sha": base, "head_sha": head, "sha": tested}


def gitlab_plan(env, api=None):
    ref = env.get("CI_COMMIT_BRANCH", "")
    profile = classify(source=env["CI_PIPELINE_SOURCE"], ref=ref,
                       protected=env.get("CI_COMMIT_REF_PROTECTED") == "true",
                       mode=env.get("CI_MODE", "auto"), tag=env.get("CI_COMMIT_TAG", ""))
    sha = env["CI_COMMIT_SHA"]
    if git("rev-parse", "HEAD") != sha:
        raise ValueError("Checkout differs from GitLab revision")
    base = None
    if profile == "integration":
        from gitlab_api import GitLabAPI, latest_baseline
        base = latest_baseline(api or GitLabAPI(), ref)
    paths = changes(base, sha)
    plan = select(profile, paths, ref=ref, version=profile == "integration" and version_changed(base, sha, paths))
    return {**plan, "base_sha": base, "head_sha": sha, "sha": sha,
            "parent_id": int(env["CI_PIPELINE_ID"]), "tag": env.get("CI_COMMIT_TAG", "")}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("platform", choices=("github", "gitlab"))
    args = parser.parse_args()
    plan = github_plan(os.environ) if args.platform == "github" else gitlab_plan(os.environ)
    Path("ci-plan.json").write_text(json.dumps(plan, indent=2) + "\n")
    if args.platform == "github":
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            output.write("jobs=" + json.dumps(plan["jobs"]) + "\n")
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
            summary.write(f"Tested revision: `{plan['sha']}`\n\n")
            summary.write("```json\n" + json.dumps(plan, indent=2) + "\n```\n")
    else:
        from render_gitlab import render
        import yaml
        Path("ci-child.yml").write_text(yaml.safe_dump(render(plan), sort_keys=False))
