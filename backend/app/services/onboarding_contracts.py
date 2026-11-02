# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.models.onboarding import OnboardingDraft


REQUIRED_FEATURES = {
    "manager": ("manager_enabled",),
    "portal": ("portal_enabled", "browser_enabled", "browser_portal_enabled"),
    "private_connection": (
        "browser_enabled",
        "browser_root_enabled",
        "manager_enabled",
    ),
    "ceph_admin": ("ceph_admin_enabled",),
    "supervision": (),
}


def required_onboarding_feature_fields(draft: OnboardingDraft) -> tuple[str, ...]:
    fields: list[str] = []
    for option in draft.selected_options:
        for field in REQUIRED_FEATURES[option]:
            if field not in fields:
                fields.append(field)
    return tuple(fields)


class OnboardingError(ValueError):
    def __init__(self, code: str, status_code: int = 400):
        super().__init__(code)
        self.code = code
        self.status_code = status_code
