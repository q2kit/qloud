"""M1-04: rate limits, Turnstile, email delivery through Celery and localized templates."""

import io
import json
from smtplib import SMTPException
from typing import Any
from unittest.mock import patch
from urllib.error import URLError
from urllib.parse import parse_qs

import pytest
from allauth.headless.socialaccount.inputs import SignupInput as ProviderSignupInput
from allauth.socialaccount.forms import SignupForm as SocialSignupForm
from celery.exceptions import Retry
from django.conf import settings as django_settings
from django.core import mail
from django.core.mail import EmailMultiAlternatives
from django.test import Client

from apps.accounts.forms import TurnstileSignupForm
from apps.accounts.models import User
from apps.accounts.tasks import send_email
from apps.core.turnstile import verify_turnstile

pytestmark = pytest.mark.django_db

AUTH = "/api/auth/browser/v1"
PASSWORD = "qloud-test-password"


def post(client: Client, path: str, data: dict[str, Any], **extra: Any) -> Any:
    return client.post(f"{AUTH}{path}", data, content_type="application/json", **extra)


class FakeCloudflare:
    """Replaces urlopen in apps.core.turnstile and records what was sent."""

    def __init__(self, *, success: bool = True, error: Exception | None = None) -> None:
        self.success = success
        self.error = error
        self.sent: list[dict[str, list[str]]] = []

    def __call__(self, request: Any, timeout: float) -> io.BytesIO:
        if self.error:
            raise self.error
        self.sent.append(parse_qs(request.data.decode()))
        return io.BytesIO(json.dumps({"success": self.success}).encode())


@pytest.fixture
def turnstile(settings):
    settings.TURNSTILE_SECRET_KEY = "secret"

    def install(**kwargs: Any) -> FakeCloudflare:
        fake = FakeCloudflare(**kwargs)
        patcher = patch("apps.core.turnstile.urlopen", fake)
        patcher.start()
        installed.append(patcher)
        return fake

    installed: list[Any] = []
    yield install
    for patcher in installed:
        patcher.stop()


@pytest.fixture
def rate_limits(settings):
    # Restore the production limits (tests disable them) on an isolated cache.
    from config.settings import base

    settings.ACCOUNT_RATE_LIMITS = base.ACCOUNT_RATE_LIMITS
    settings.CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "rate-limit-tests",
        }
    }
    from django.core.cache import cache

    cache.clear()


# --- Turnstile ---------------------------------------------------------------


def test_verify_turnstile_is_skipped_without_secret(settings):
    settings.TURNSTILE_SECRET_KEY = ""
    assert verify_turnstile("")


def test_verify_turnstile_sends_secret_token_and_ip(turnstile):
    cloudflare = turnstile()
    assert verify_turnstile("token", "203.0.113.7")
    assert cloudflare.sent == [
        {"secret": ["secret"], "response": ["token"], "remoteip": ["203.0.113.7"]}
    ]


@pytest.mark.parametrize(
    ("token", "kwargs"),
    [
        ("", {}),
        ("token", {"success": False}),
        ("token", {"error": URLError("unreachable")}),
        ("token", {"error": TimeoutError()}),
    ],
)
def test_verify_turnstile_fails_closed(turnstile, token, kwargs):
    turnstile(**kwargs)
    assert not verify_turnstile(token)


def test_all_signup_forms_carry_turnstile():
    # allauth derives email, OAuth (form) and OAuth (headless) signup from one base.
    assert issubclass(SocialSignupForm, TurnstileSignupForm)
    assert issubclass(ProviderSignupInput, TurnstileSignupForm)


def test_signup_requires_valid_turnstile(client, turnstile):
    turnstile(success=False)
    data = {"email": "alice@example.com", "password": PASSWORD, "turnstile_token": "bad"}
    response = post(client, "/auth/signup", data)
    assert response.status_code == 400
    error = response.json()["errors"][0]
    assert (error["code"], error["param"]) == ("captcha_invalid", "turnstile_token")
    assert not User.objects.exists()


def test_signup_with_valid_turnstile_uses_trusted_client_ip(client, turnstile, settings):
    settings.ALLAUTH_TRUSTED_CLIENT_IP_HEADER = "CF-Connecting-IP"
    cloudflare = turnstile()
    data = {"email": "alice@example.com", "password": PASSWORD, "turnstile_token": "good"}
    response = post(client, "/auth/signup", data, HTTP_CF_CONNECTING_IP="198.51.100.4")
    assert response.status_code == 200
    assert cloudflare.sent[0]["remoteip"] == ["198.51.100.4"]


def test_password_reset_request_requires_turnstile(client, turnstile):
    User.objects.create_user("alice@example.com", PASSWORD)
    turnstile(success=False)
    response = post(client, "/auth/password/request", {"email": "alice@example.com"})
    assert response.status_code == 400
    assert response.json()["errors"][0]["code"] == "captcha_invalid"
    assert not mail.outbox


def test_login_does_not_need_turnstile(client, turnstile):
    cloudflare = turnstile(success=False)
    User.objects.create_user("alice@example.com", PASSWORD)
    response = post(client, "/auth/login", {"email": "alice@example.com", "password": PASSWORD})
    assert response.status_code == 200
    assert not cloudflare.sent


# --- Rate limits -------------------------------------------------------------


def test_failed_logins_are_limited_per_email(client, rate_limits):
    User.objects.create_user("alice@example.com", PASSWORD)
    wrong = {"email": "alice@example.com", "password": "qloud-wrong-password"}
    for _ in range(5):
        assert post(client, "/auth/login", wrong).status_code == 400
    response = post(client, "/auth/login", wrong)
    assert response.status_code == 429
    assert response.json()["status"] == 429
    # The limit is per email: another account from the same IP still works.
    User.objects.create_user("bob@example.com", PASSWORD)
    assert (
        post(client, "/auth/login", {"email": "bob@example.com", "password": PASSWORD}).status_code
        == 200
    )


def test_login_attempts_are_limited_per_ip(rate_limits):
    for index in range(10):
        response = post(
            Client(), "/auth/login", {"email": f"u{index}@example.com", "password": "x"}
        )
        assert response.status_code == 400
    response = post(Client(), "/auth/login", {"email": "u10@example.com", "password": "x"})
    assert response.status_code == 429


def test_ip_limit_follows_trusted_client_ip_header(rate_limits, settings):
    settings.ALLAUTH_TRUSTED_CLIENT_IP_HEADER = "CF-Connecting-IP"
    for index in range(10):
        post(
            Client(),
            "/auth/login",
            {"email": f"u{index}@example.com", "password": "x"},
            HTTP_CF_CONNECTING_IP="203.0.113.1",
        )
    blocked = post(
        Client(),
        "/auth/login",
        {"email": "a@example.com", "password": "x"},
        HTTP_CF_CONNECTING_IP="203.0.113.1",
    )
    other_ip = post(
        Client(),
        "/auth/login",
        {"email": "b@example.com", "password": "x"},
        HTTP_CF_CONNECTING_IP="203.0.113.2",
    )
    assert blocked.status_code == 429
    assert other_ip.status_code == 400


def test_password_reset_requests_are_limited_per_email(client, rate_limits):
    User.objects.create_user("alice@example.com", PASSWORD)
    for _ in range(5):
        assert (
            post(client, "/auth/password/request", {"email": "alice@example.com"}).status_code
            == 200
        )
    response = post(client, "/auth/password/request", {"email": "alice@example.com"})
    assert response.status_code == 429
    assert len(mail.outbox) == 5


# --- Email delivery ----------------------------------------------------------


def test_auth_email_is_handed_to_celery(client):
    with patch.object(send_email, "delay") as delay:
        post(client, "/auth/signup", {"email": "alice@example.com", "password": PASSWORD})
    delay.assert_called_once()
    payload = delay.call_args.kwargs
    assert payload["to"] == ["alice@example.com"]
    assert payload["from_email"] == django_settings.DEFAULT_FROM_EMAIL
    assert "/verify-email/" in payload["body"]
    assert not mail.outbox


@pytest.mark.real_on_commit
def test_email_waits_for_the_transaction_to_commit(client, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=False) as callbacks:
        post(client, "/auth/signup", {"email": "alice@example.com", "password": PASSWORD})
    assert not mail.outbox
    assert len(callbacks) == 1
    callbacks[0]()
    assert len(mail.outbox) == 1


def test_send_email_task_delivers_text_and_html():
    send_email(
        subject="S", body="B", from_email="a@example.com", to=["b@example.com"], html="<p>B</p>"
    )
    message = mail.outbox[0]
    assert isinstance(message, EmailMultiAlternatives)
    assert (message.subject, message.body, message.to) == ("S", "B", ["b@example.com"])
    assert message.alternatives[0][0] == "<p>B</p>"


def test_send_email_task_retries_smtp_failures():
    with (
        patch("apps.accounts.tasks.EmailMultiAlternatives.send", side_effect=SMTPException("down")),
        pytest.raises(Retry),
    ):
        send_email.apply(
            kwargs={
                "subject": "S",
                "body": "B",
                "from_email": "a@example.com",
                "to": ["b@example.com"],
            },
            throw=True,
        )


# --- Templates ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("language", "subject", "phrase"),
    [
        ("vi", "Xác thực địa chỉ email cho Qloud", "Vui lòng xác thực địa chỉ email"),
        ("en", "Confirm your email address for Qloud", "Please confirm the email address"),
    ],
)
def test_signup_email_is_localized(client, language, subject, phrase):
    post(
        client,
        "/auth/signup",
        {"email": "alice@example.com", "password": PASSWORD},
        HTTP_ACCEPT_LANGUAGE=language,
    )
    message = mail.outbox[0]
    assert message.subject == subject
    assert phrase in message.body
    assert f"{django_settings.APP_BASE_URL}/verify-email/" in message.body
    assert "testserver" not in f"{message.subject}{message.body}"


def test_password_reset_email_uses_the_account_language(client):
    User.objects.create_user("alice@example.com", PASSWORD, locale="en")
    post(
        client, "/auth/password/request", {"email": "alice@example.com"}, HTTP_ACCEPT_LANGUAGE="vi"
    )
    message = mail.outbox[0]
    assert message.subject == "Reset your Qloud password"
    assert f"{django_settings.APP_BASE_URL}/password/reset/" in message.body


def test_reset_for_unknown_email_sends_localized_notice(client):
    post(
        client, "/auth/password/request", {"email": "nobody@example.com"}, HTTP_ACCEPT_LANGUAGE="vi"
    )
    message = mail.outbox[0]
    assert message.subject == "Yêu cầu đặt lại mật khẩu Qloud"
    assert "nobody@example.com" in message.body
    assert f"{django_settings.APP_BASE_URL}/signup" in message.body
