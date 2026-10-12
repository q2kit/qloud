"""Every message the auth API can send must exist in Vietnamese.

allauth ships no Vietnamese catalog and Django upgrades sometimes change a
msgid before its catalog catches up (Django 6.1: "too short"). These tests
fail when an upgrade brings back English text for `vi`.
"""

import pytest
from allauth.account.adapter import DefaultAccountAdapter
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from django.contrib.auth.password_validation import (
    get_default_password_validators,
    validate_password,
)
from django.core.exceptions import ValidationError
from django.utils import translation

from apps.accounts.models import User

ALLAUTH_MESSAGES = {
    **{
        f"account.{code}": message for code, message in DefaultAccountAdapter.error_messages.items()
    },
    **{
        f"socialaccount.{code}": message
        for code, message in DefaultSocialAccountAdapter.error_messages.items()
    },
}


def in_language(language: str, message: object) -> str:
    with translation.override(language):
        return str(message)


@pytest.mark.parametrize("key", sorted(ALLAUTH_MESSAGES))
def test_allauth_messages_are_translated(key):
    message = ALLAUTH_MESSAGES[key]
    assert in_language("vi", message) != in_language("en", message)


def password_errors(language: str, password: str) -> list[str]:
    with translation.override(language):
        try:
            validate_password(password, User(email="alice@example.com"))
        except ValidationError as error:
            return error.messages
    return []


@pytest.mark.parametrize("password", ["short", "12345678", "password", "alice@example.com"])
def test_password_errors_are_translated(password):
    english, vietnamese = password_errors("en", password), password_errors("vi", password)
    assert english
    assert set(english).isdisjoint(vietnamese)


def test_password_help_texts_are_translated():
    # get_help_text() renders in the active language when called.
    for validator in get_default_password_validators():
        with translation.override("en"):
            english = validator.get_help_text()
        with translation.override("vi"):
            vietnamese = validator.get_help_text()
        assert vietnamese != english


@pytest.mark.django_db
def test_signup_reports_a_short_password_in_vietnamese(client):
    response = client.post(
        "/api/auth/browser/v1/auth/signup",
        {"email": "alice@example.com", "password": "short"},
        content_type="application/json",
        HTTP_ACCEPT_LANGUAGE="vi",
    )
    assert response.status_code == 400
    error = response.json()["errors"][0]
    assert error["param"] == "password"
    assert error["message"] == "Mật khẩu phải có ít nhất 8 ký tự."
