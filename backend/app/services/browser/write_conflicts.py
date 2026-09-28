"""Destination observations, never an alternative authorization mechanism."""
from botocore.exceptions import ClientError

from app.models.browser import BrowserWriteGuard


class BrowserWriteConflict(RuntimeError):
    status_code = 409


def observe_destination(client, bucket: str, key: str, sse_params=None) -> dict:
    try:
        head = client.head_object(Bucket=bucket, Key=key, **(sse_params or {}))
    except ClientError as exc:
        if str(exc.response.get("Error", {}).get("Code")) in {"404", "NoSuchKey", "NotFound"}:
            return {"key": key, "exists": False, "etag": None, "size": None, "modified": None}
        raise RuntimeError("Unable to inspect destination; no write was attempted.") from exc
    return {"key": key, "exists": True, "etag": head.get("ETag"), "size": head.get("ContentLength"), "modified": head.get("LastModified")}


def supports_conditional_writes(account) -> bool:
    # Only assert a provider guarantee that has a documented contract. Other
    # S3 providers still get a last-moment observation, explicitly non-atomic.
    return getattr(getattr(account, "storage_endpoint", None), "provider", None) == "aws"


def check_destination(client, account, bucket: str, key: str, guard: BrowserWriteGuard | None, sse_params=None) -> dict:
    if guard is None:
        return {}
    observed = observe_destination(client, bucket, key, sse_params)
    if observed["exists"] != guard.exists or (guard.exists and observed["etag"] != guard.etag):
        raise BrowserWriteConflict("Destination changed. Review the conflict before retrying.")
    if not supports_conditional_writes(account):
        return {}
    if not guard.exists:
        return {"IfNoneMatch": "*"}
    if not guard.etag:
        raise BrowserWriteConflict("The destination has no usable ETag. Refresh before replacing it.")
    return {"IfMatch": guard.etag}
