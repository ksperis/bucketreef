"""Registry operations that preserve index digests and distinguish missing from denied."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

DIGEST = re.compile(r"sha256:[0-9a-f]{64}")


def credentials(public=False):
    prefix = "GHCR" if public else "CI_REGISTRY"
    user = os.environ[prefix + ("_USERNAME" if public else "_USER")]
    password = os.environ[prefix + ("_TOKEN" if public else "_PASSWORD")]
    return f"{user}:{password}"


def inspect(reference, *, creds=None, missing_ok=False):
    with tempfile.TemporaryDirectory() as directory:
        auth = Path(directory) / "auth.json"
        auth.write_text('{"auths":{}}')
        args = ["skopeo", "inspect", "--raw", "--authfile", str(auth)]
        if creds:
            args += ["--creds", creds]
        result = subprocess.run([*args, "docker://" + reference], capture_output=True)
    if result.returncode:
        # Authentication/network errors are not permission to replace an artifact.
        if missing_ok and re.search(rb"manifest unknown|name unknown|\b404\b", result.stderr, re.I):
            return None
        raise RuntimeError("Registry inspection failed (credentials and response withheld)")
    index = json.loads(result.stdout)
    platforms = {}
    for manifest in index.get("manifests", []):
        platform = manifest.get("platform", {})
        arch = platform.get("architecture")
        if platform.get("os") == "linux" and arch in {"amd64", "arm64"}:
            if arch in platforms or not DIGEST.fullmatch(manifest.get("digest", "")):
                raise ValueError("Ambiguous or invalid image platform")
            platforms[arch] = manifest["digest"]
    if set(platforms) != {"amd64", "arm64"}:
        raise ValueError("Image must contain linux/amd64 and linux/arm64")
    digest = "sha256:" + hashlib.sha256(result.stdout).hexdigest()
    if "@" in reference and reference.rsplit("@", 1)[1] != digest:
        raise ValueError("Registry returned another index digest")
    return {"digest": digest, "platforms": platforms}


def copy_image(source, target, *, src_creds, dest_creds, immutable=True):
    expected = inspect(source, creds=src_creds)
    current = inspect(target, creds=dest_creds, missing_ok=True)
    if current == expected:
        return expected
    if current and immutable:
        raise ValueError("Refusing to replace an immutable image")
    result = subprocess.run(["skopeo", "copy", "--all", "--preserve-digests",
                             "--src-creds", src_creds, "--dest-creds", dest_creds,
                             "docker://" + source, "docker://" + target], capture_output=True)
    if result.returncode:
        raise RuntimeError("Registry copy failed (credentials and response withheld)")
    if inspect(target, creds=dest_creds) != expected:
        raise ValueError("Copied index or platform digests differ")
    return expected
