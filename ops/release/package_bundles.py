#!/usr/bin/env python3
"""Build reproducible, source-free deployment bundles using only the standard library."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
from pathlib import Path
import re
import tarfile

ROOT = Path(__file__).resolve().parents[2]


def package_bundles(version: str, destination: Path) -> list[Path]:
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("Version must be X.Y.Z")
    destination.mkdir(parents=True, exist_ok=True)
    common = {
        "docker-compose.yml": (ROOT / "deploy/compose/docker-compose.yml").read_bytes(),
        "docker-compose.admin.yml": (ROOT / "deploy/compose/docker-compose.admin.yml").read_bytes(),
        "docker-compose.user.yml": (ROOT / "deploy/compose/docker-compose.user.yml").read_bytes(),
        "docker-compose.ceph-admin-high-security.yml": (
            ROOT / "deploy/compose/docker-compose.ceph-admin-high-security.yml"
        ).read_bytes(),
        ".env.example": re.sub(
            r"(?m)^BUCKETREEF_TAG=.*$", f"BUCKETREEF_TAG={version}",
            (ROOT / "deploy/compose/.env.example").read_text(),
        ).encode(),
        "VERSION": f"{version}\n".encode(),
        "LICENSE": (ROOT / "LICENSE").read_bytes(),
    }
    artifacts = []
    for kind in ("compose", "quickstart"):
        files = {**common, "README.md": (ROOT / f"deploy/{kind}/README.md").read_bytes()}
        if kind == "quickstart":
            files["bucketreef-quickstart"] = (ROOT / "deploy/quickstart/bucketreef-quickstart").read_bytes()
        archive = destination / f"bucketreef-{kind}.tar.gz"
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
        artifacts.extend((archive, checksum))
    return artifacts


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", type=Path, default=Path("dist/release"))
    args = parser.parse_args()
    for artifact in package_bundles(args.version, args.output):
        print(artifact)
