# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from datetime import UTC, datetime
import smtplib

import pytest

from app.models.app_settings import QuotaNotificationSettings
from app.services import quota_alert_email_service
from app.services.quota_alert_email_service import QuotaAlertEmailService
from app.services.quota_subject import SubjectContext


class _FakeMailer:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def send(
        self,
        *,
        recipients: list[str],
        subject: str,
        body: str,
    ) -> None:
        self.calls.append(
            {
                "recipients": recipients,
                "subject": subject,
                "body": body,
            }
        )


class _FailingMailer:
    def __init__(self, error: Exception) -> None:
        self.error = error

    def send(self, **_kwargs) -> None:
        raise self.error


def _settings(**overrides) -> QuotaNotificationSettings:
    values = {
        "smtp_host": "smtp.example.test",
        "smtp_port": 587,
        "smtp_username": "smtp-user",
        "smtp_from_email": "alerts@example.test",
        "smtp_from_name": "Quota Alerts",
        "smtp_starttls": True,
        "smtp_timeout_seconds": 15,
    }
    values.update(overrides)
    return QuotaNotificationSettings(**values)


def test_quota_notification_settings_normalize_smtp_strings():
    settings = _settings(
        smtp_host=" smtp.example.test ",
        smtp_username=" smtp-user ",
        smtp_from_email=" alerts@example.test ",
        smtp_from_name=" Quota Alerts ",
    )

    assert settings.smtp_host == "smtp.example.test"
    assert settings.smtp_username == "smtp-user"
    assert settings.smtp_from_email == "alerts@example.test"
    assert settings.smtp_from_name == "Quota Alerts"


def test_build_mailer_requires_username_for_environment_password():
    service = QuotaAlertEmailService()
    service.smtp_password = "secret"

    mailer, reason = service.build_mailer(
        _settings(smtp_username=None)
    )

    assert mailer is None
    assert reason == (
        "SMTP configuration invalid: SMTP_PASSWORD is set but "
        "smtp_username is empty."
    )


def test_send_test_email_normalizes_recipient_and_timestamps_message(
    monkeypatch,
):
    service = QuotaAlertEmailService()
    fake_mailer = _FakeMailer()
    fixed_now = datetime(2026, 8, 14, 17, 0, tzinfo=UTC)
    monkeypatch.setattr(
        service,
        "build_mailer",
        lambda notification_settings: (fake_mailer, None),
    )
    monkeypatch.setattr(
        quota_alert_email_service,
        "utcnow",
        lambda: fixed_now,
    )

    result = service.send_test_email(
        notification_settings=_settings(),
        recipient_email=" Admin@Example.Test ",
    )

    assert result == {
        "recipient": "admin@example.test",
    }
    assert fake_mailer.calls[0]["recipients"] == [
        "admin@example.test"
    ]
    assert "SMTP configuration" in str(fake_mailer.calls[0]["subject"])
    assert "Sent at (UTC): 2026-08-14T17:00:00+00:00" in str(
        fake_mailer.calls[0]["body"]
    )


def test_send_test_email_only_wraps_smtp_delivery_errors(monkeypatch):
    service = QuotaAlertEmailService()
    monkeypatch.setattr(
        service,
        "build_mailer",
        lambda notification_settings: (_FailingMailer(smtplib.SMTPException("smtp unavailable")), None),
    )

    with pytest.raises(ValueError, match="Unable to send test email: smtp unavailable"):
        service.send_test_email(
            notification_settings=_settings(),
            recipient_email="admin@example.test",
        )

    monkeypatch.setattr(
        service,
        "build_mailer",
        lambda notification_settings: (_FailingMailer(TypeError("unexpected mailer bug")), None),
    )
    with pytest.raises(TypeError, match="unexpected mailer bug"):
        service.send_test_email(
            notification_settings=_settings(),
            recipient_email="admin@example.test",
        )


def test_send_alert_email_only_suppresses_delivery_errors():
    subject = SubjectContext(
        subject_type="account",
        subject_id=1,
        endpoint_id=1,
        endpoint_name="ceph",
        subject_name="account",
        subject_identifier="RGW-1",
        usage_uid=None,
        quota_account_id="RGW-1",
        quota_user_uid=None,
        contact_email=None,
    )
    kwargs = {
        "recipients": ["admin@example.test"],
        "subject": subject,
        "alert_level": "warning",
        "ratio_pct": 85.0,
        "threshold_percent": 80,
        "used_bytes": 85,
        "used_objects": 8,
        "quota_size_bytes": 100,
        "quota_objects": 10,
        "checked_at": datetime(2026, 8, 14, 17, 0, tzinfo=UTC),
    }

    assert QuotaAlertEmailService.send_alert_email(
        mailer=_FailingMailer(OSError("network unavailable")),
        **kwargs,
    ) is False

    with pytest.raises(TypeError, match="unexpected mailer bug"):
        QuotaAlertEmailService.send_alert_email(
            mailer=_FailingMailer(TypeError("unexpected mailer bug")),
            **kwargs,
        )
