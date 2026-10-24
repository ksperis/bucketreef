# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.onboarding import OnboardingJourneyOut, OnboardingStatus


def test_onboarding_responses_require_complete_canonical_payloads() -> None:
    assert set(OnboardingJourneyOut.model_json_schema()["required"]) == {
        "id",
        "revision",
        "draft",
        "resources",
        "configured",
        "preview",
        "links",
        "created_at",
        "updated_at",
    }
    assert set(OnboardingStatus.model_json_schema()["required"]) == {
        "dismissed",
        "complete",
        "source",
        "journeys",
        "can_configure",
    }
