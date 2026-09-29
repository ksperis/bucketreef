import json
from types import SimpleNamespace

import secret_diagnostics


def test_analyzer_diagnostics_never_copy_log_or_invalid_revision(monkeypatch):
    commands = []
    monkeypatch.setattr(secret_diagnostics.subprocess, "run", lambda command, **kwargs: (
        commands.append(command) or SimpleNamespace(returncode=0)
    ))
    canary = "private-test-credential-must-not-escape"
    result = secret_diagnostics.diagnose(
        f"fatal: bad revision {canary}\nAuthentication failed for https://user:{canary}@example.invalid\n{canary}",
        {"base_sha": "a" * 40, "sha": canary},
    )
    assert result["error_categories"] == ["git_revision_unavailable", "authentication_failed"]
    assert result["git_revisions_available"] == {"base_sha": True, "sha": False}
    assert len(commands) == 1
    assert canary not in json.dumps(result)
