#!/usr/bin/env python3
"""Build the reproducible, source-free deployment bundle."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
from pathlib import Path
import re
import tarfile

ROOT = Path(__file__).resolve().parents[2]


def package_deploy_bundle(version: str, destination: Path) -> list[Path]:
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("Version must be X.Y.Z")
    destination.mkdir(parents=True, exist_ok=True)
    files = {
        "compose.yaml": (ROOT / "deploy/bundle/compose.yaml").read_bytes(),
        "compose.admin.yaml": (ROOT / "deploy/bundle/compose.admin.yaml").read_bytes(),
        "compose.admin-no-ceph-admin.yaml": (
            ROOT / "deploy/bundle/compose.admin-no-ceph-admin.yaml"
        ).read_bytes(),
        "compose.user.yaml": (ROOT / "deploy/bundle/compose.user.yaml").read_bytes(),
        "compose.ceph-admin-high-security.yaml": (
            ROOT / "deploy/bundle/compose.ceph-admin-high-security.yaml"
        ).read_bytes(),
        ".env.example": re.sub(
            r"(?m)^BUCKETREEF_TAG=.*$", f"BUCKETREEF_TAG={version}",
            (ROOT / "deploy/bundle/.env.example").read_text(),
        ).encode(),
        "VERSION": f"{version}\n".encode(),
        "LICENSE": (ROOT / "LICENSE").read_bytes(),
        "README.md": (ROOT / "deploy/bundle/README.md").read_bytes(),
        "bucketreef-quickstart": (ROOT / "deploy/bundle/bucketreef-quickstart").read_bytes(),
    }
    archive = destination / "bucketreef-deploy.tar.gz"
    with archive.open("wb") as output:
        with gzip.GzipFile(filename="", mode="wb", fileobj=output, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.USTAR_FORMAT) as tar:
                for name, data in sorted(files.items()):
                    info = tarfile.TarInfo(name)
                    info.size = len(data)
                    info.mode = 0o755 if name == "bucketreef-quickstart" else 0o644
                    tar.addfile(info, io.BytesIO(data))
    checksum = archive.with_name(archive.name + ".sha256")
    checksum.write_text(f"{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive.name}\n")
    return [archive, checksum]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", type=Path, default=Path("dist/release"))
    args = parser.parse_args()
    for artifact in package_deploy_bundle(args.version, args.output):
        print(artifact)
