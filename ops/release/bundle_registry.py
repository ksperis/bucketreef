"""Immutable OCI bundles let anonymous distribution checks precede GitHub publication."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

from publish_github_release import ASSETS

REPOSITORY = "ghcr.io/ksperis/bucketreef-bundles"


def run(arguments, *, cwd=None, missing_ok=False):
    result = subprocess.run(["oras", *arguments], cwd=cwd, capture_output=True)
    if result.returncode:
        if missing_ok and re.search(rb"manifest unknown|name unknown|NOT_FOUND|\b404\b", result.stderr):
            return None
        raise RuntimeError("Bundle registry operation failed (response withheld)")
    return result.stdout


def hashes(directory):
    return {name: hashlib.sha256((directory / name).read_bytes()).hexdigest() for name in ASSETS}


def publish(version, sha, directory):
    with tempfile.TemporaryDirectory() as temporary:
        layout = str(Path(temporary) / "layout")
        manifest = Path(temporary) / "manifest.json"
        # Fix the creation annotation, otherwise ORAS embeds the current time.
        run(["push", "--oci-layout", f"{layout}:{version}",
             "--artifact-type", "application/vnd.bucketreef.bundles.v1",
             "--annotation", "org.opencontainers.image.created=1970-01-01T00:00:00Z",
             "--annotation", f"org.opencontainers.image.revision={sha}",
             "--export-manifest", str(manifest), *ASSETS], cwd=directory)
        digest = "sha256:" + hashlib.sha256(manifest.read_bytes()).hexdigest()
        auth = ["--username", os.environ["GHCR_USERNAME"], "--password", os.environ["GHCR_TOKEN"]]
        target = f"{REPOSITORY}:{version}"
        current = run(["resolve", *auth, target], missing_ok=True)
        if current is not None and current.decode().strip() != digest:
            raise ValueError("Refusing to replace different immutable release bundles")
        if current is None:
            run(["copy", "--from-oci-layout", f"{layout}:{version}", target,
                 "--to-username", os.environ["GHCR_USERNAME"], "--to-password", os.environ["GHCR_TOKEN"]])
        if run(["resolve", *auth, target]).decode().strip() != digest:
            raise ValueError("Published bundle manifest differs")
        return {"schema": 1, "sha": sha, "version": version, "digest": digest, "files": hashes(directory)}


def download(record, directory, *, version, sha):
    if record["sha"] != sha or record["version"] != version or set(record["files"]) != set(ASSETS):
        raise ValueError("Bundle proof differs from this release")
    with tempfile.TemporaryDirectory() as temporary:
        auth = Path(temporary) / "anonymous.json"
        auth.write_text('{"auths":{}}')
        flags = ["--registry-config", str(auth)]
        if run(["resolve", *flags, f"{REPOSITORY}:{version}"]).decode().strip() != record["digest"]:
            raise ValueError("Public bundle version points to another manifest")
        run(["pull", *flags, f"{REPOSITORY}@{record['digest']}", "--output", str(directory)])
    if hashes(directory) != record["files"]:
        raise ValueError("Anonymous bundle download differs from prepared assets")
