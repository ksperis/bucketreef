# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from dataclasses import dataclass

from botocore.response import StreamingBody


@dataclass(frozen=True)
class S3ObjectDownload:
    """An open provider body whose ownership passes to the HTTP response."""

    body: StreamingBody
    content_type: str | None
    filename: str
