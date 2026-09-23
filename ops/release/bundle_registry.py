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


def _safe_error(stderr):
    message = stderr.decode(errors="replace").strip() or "no error output"
    for name in ("GHCR_TOKEN", "GITHUB_RELEASE_TOKEN"):
        secret = os.environ.get(name)
        if secret:
            message = message.replace(secret, "[REDACTED]")
    return message[:1000]


def run(arguments, *, cwd=None, missing_ok=False):
    result = subprocess.run(["oras", *arguments], cwd=cwd, capture_output=True)
    if result.returncode:
        if missing_ok and re.search(
            rb"manifest unknown|name unknown|NOT_FOUND|\b404\b|denied: requested access to the resource is denied",
            result.stderr,
            re.IGNORECASE,
        ):
            return None
        operation = arguments[0] if arguments else "operation"
        raise RuntimeError(
            f"Bundle registry {operation} failed (exit {result.returncode}): {_safe_error(result.stderr)}"
        )
    return result.stdout


def hashes(directory):
    return {name: hashlib.sha256((directory / name).read_bytes()).hexdigest() for name in ASSETS}


def publish(version, sha, directory):
    with tempfile.TemporaryDirectory() as temporary:
        layout = str(Path(temporary) / "layout")
        manifest = Path(temporary) / "manifest.json"
        annotations = [
            "--artifact-type", "application/vnd.bucketreef.bundles.v1",
            "--annotation", "org.opencontainers.image.created=1970-01-01T00:00:00Z",
            "--annotation", f"org.opencontainers.image.revision={sha}",
        ]
        # Fix the creation annotation, otherwise ORAS embeds the current time.
        run(["push", "--oci-layout", f"{layout}:{version}",
             *annotations, "--export-manifest", str(manifest), *ASSETS], cwd=directory)
        digest = "sha256:" + hashlib.sha256(manifest.read_bytes()).hexdigest()
        auth = ["--username", os.environ["GHCR_USERNAME"], "--password", os.environ["GHCR_TOKEN"]]
        target = f"{REPOSITORY}:{version}"
        current = run(["resolve", *auth, target], missing_ok=True)
        if current is not None and current.decode().strip() != digest:
            raise ValueError("Refusing to replace different immutable release bundles")
        if current is None:
            # A first GHCR package may reject `oras copy --from-oci-layout` before
            # the repository exists. Push the same deterministic manifest directly;
            # the resolve below still proves the immutable digest before returning.
            remote_manifest = Path(temporary) / "remote-manifest.json"
            run(["push", *auth, *annotations, "--export-manifest", str(remote_manifest),
                 target, *ASSETS], cwd=directory)
            if "sha256:" + hashlib.sha256(remote_manifest.read_bytes()).hexdigest() != digest:
                raise ValueError("Remote bundle manifest differs from deterministic bundle manifest")
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
