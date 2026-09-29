"""Public, immutable candidate envelope; final archives are never repackaged."""
import hashlib
from pathlib import Path
import shutil
import tempfile

import bundle_registry as registry
from publish_github_release import ASSETS


def paths(version):
    return {**{name: Path("dist/release") / name for name in (*ASSETS, f"bucketreef-{version}.tgz")},
            **{name: Path("dist/release-notes") / name for name in ("github.md", "gitlab.md")}}


def hashes(directory, version):
    return {name: hashlib.sha256((directory / name).read_bytes()).hexdigest() for name in paths(version)}


def publish(tag, version, sha):
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        for name, path in paths(version).items():
            shutil.copyfile(path, directory / name)
        return registry.publish(tag, sha, directory, members=tuple(paths(version)),
                                artifact_type="application/vnd.bucketreef.candidate.v1")


def download(inventory, directory):
    record = inventory["artifact"]
    if (record["sha"] != inventory["sha"] or record["version"] != inventory["tag"]
            or set(record["files"]) != set(paths(inventory["version"]))):
        raise ValueError("Candidate artifact provenance differs")
    with tempfile.TemporaryDirectory() as temporary:
        auth = Path(temporary) / "anonymous.json"
        auth.write_text('{"auths":{}}')
        flags = ["--registry-config", str(auth)]
        if registry.run(["resolve", *flags, f"{registry.REPOSITORY}:{inventory['tag']}"]).decode().strip() != record["digest"]:
            raise ValueError("Candidate tag changed")
        registry.run(["pull", *flags, f"{registry.REPOSITORY}@{record['digest']}", "--output", str(directory)])
    if hashes(directory, inventory["version"]) != record["files"]:
        raise ValueError("Anonymous candidate download differs from the prepared bytes")


def restore(inventory, directory):
    if hashes(directory, inventory["version"]) != inventory["artifact"]["files"]:
        raise ValueError("Cannot restore modified candidate files")
    for name, path in paths(inventory["version"]).items():
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(directory / name, path)
