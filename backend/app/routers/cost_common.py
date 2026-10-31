# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from datetime import date, datetime
from typing import NoReturn

from fastapi import HTTPException, status


def raise_cost_disabled() -> NoReturn:
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "code": "cost_disabled",
            "message": "Cost is disabled",
        },
    )


def parse_cost_day(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid day format, expected YYYY-MM-DD",
        ) from exc
