import json
from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "ops/ci"))

import promote_main
from plan import COMPONENTS


SHA = "a" * 40
DIGEST = "sha256:" + "b" * 64


def setup_receipts(monkeypatch, tmp_path, *, pipeline_id=42):
    monkeypatch.chdir(tmp_path)
    receipts = tmp_path / "image-receipts"
    receipts.mkdir()
    for component in COMPONENTS:
        (receipts / f"{component}.json").write_text(json.dumps({
            "sha": SHA,
            "pipeline_id": pipeline_id,
            "digest": DIGEST,
        }))
    for key, value in {
        "CI_COMMIT_SHA": SHA,
        "CI_PIPELINE_ID": str(pipeline_id),
        "CI_COMMIT_BRANCH": "main",
        "CI_DEFAULT_BRANCH": "main",
        "CI_REGISTRY_IMAGE": "registry.example/project",
    }.items():
        monkeypatch.setenv(key, value)


def test_promote_main_publishes_immutable_sha_and_moving_alias(monkeypatch, tmp_path):
    setup_receipts(monkeypatch, tmp_path)
    monkeypatch.setattr(promote_main, "credentials", lambda: "fixture")
    monkeypatch.setattr(
        promote_main.subprocess,
        "check_output",
        lambda *args, **kwargs: SHA + "\trefs/heads/main\n",
    )
    copies = []
    monkeypatch.setattr(
        promote_main,
        "copy_image",
        lambda source, target, **kwargs: copies.append((source, target, kwargs)),
    )

    promote_main.promote()

    immutable = [call for call in copies if ":main-" in call[1]]
    moving = [call for call in copies if call[1].endswith(":main")]
    assert len(immutable) == len(COMPONENTS)
    assert len(moving) == len(COMPONENTS)
    assert all(call[1].endswith(f":main-{SHA}") for call in immutable)
    assert all(call[2].get("immutable", True) is False for call in moving)


def test_promote_main_keeps_moving_alias_when_main_advanced(monkeypatch, tmp_path):
    setup_receipts(monkeypatch, tmp_path)
    monkeypatch.setattr(promote_main, "credentials", lambda: "fixture")
    monkeypatch.setattr(
        promote_main.subprocess,
        "check_output",
        lambda *args, **kwargs: "f" * 40 + "\trefs/heads/main\n",
    )
    copies = []
    monkeypatch.setattr(
        promote_main,
        "copy_image",
        lambda source, target, **kwargs: copies.append((source, target, kwargs)),
    )

    promote_main.promote()

    assert len(copies) == len(COMPONENTS)
    assert all(call[1].endswith(f":main-{SHA}") for call in copies)


def test_promote_main_rejects_receipt_from_another_pipeline(monkeypatch, tmp_path):
    setup_receipts(monkeypatch, tmp_path)
    path = tmp_path / "image-receipts/backend.json"
    receipt = json.loads(path.read_text())
    receipt["pipeline_id"] = 41
    path.write_text(json.dumps(receipt))
    monkeypatch.setattr(promote_main, "credentials", lambda: "fixture")
    monkeypatch.setattr(
        promote_main,
        "copy_image",
        lambda *args, **kwargs: pytest.fail("must reject before copying the mismatched receipt"),
    )

    with pytest.raises(ValueError, match="this pipeline"):
        promote_main.promote()
