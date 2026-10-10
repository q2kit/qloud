import re
from typing import Any
from urllib.parse import unquote

import pytest
from allauth.account.models import EmailAddress
from django.core import mail
from django.test import Client, RequestFactory

from apps.accounts.adapter import AccountAdapter
from apps.accounts.models import Plan, User
from apps.accounts.services import suspend_user

pytestmark = pytest.mark.django_db

AUTH = "/api/auth/browser/v1"
PASSWORD = "qloud-test-password"


def post(client: Client, path: str, data: dict[str, Any], **extra: Any) -> Any:
    return client.post(f"{AUTH}{path}", data, content_type="application/json", **extra)


def signup(
    client: Client, email: str = "alice@example.com", password: str = PASSWORD, **extra: Any
) -> Any:
    return post(client, "/auth/signup", {"email": email, "password": password}, **extra)


def login(
    client: Client, email: str = "alice@example.com", password: str = PASSWORD, **data: Any
) -> Any:
    return post(client, "/auth/login", {"email": email, "password": password, **data})


def emailed_key(path: str) -> str:
    body = str(mail.outbox[-1].body)
    match = re.search(rf"{path}/(\S+)", body)
    assert match, body
    # Keys are URL-encoded in the link; the SPA router decodes them before posting.
    return unquote(match.group(1))


def session_status(client: Client) -> int:
    status: int = client.get(f"{AUTH}/auth/session").status_code
    return status


def test_signup_provisions_account_and_sends_verification(client):
    response = signup(client, email="Alice@Example.com", HTTP_ACCEPT_LANGUAGE="en")
    assert response.status_code == 200
    assert response.json()["meta"]["is_authenticated"]
    user = User.objects.get(email="alice@example.com")
    assert user.plan.code == "free-2026"
    assert user.root_folder is not None
    assert user.locale == "en"
    assert user.check_password(PASSWORD)
    assert not EmailAddress.objects.get(user=user).verified
    assert len(mail.outbox) == 1
    assert "http://localhost:5173/verify-email/" in mail.outbox[0].body


def test_signup_defaults_to_vietnamese_locale(client):
    assert signup(client, HTTP_ACCEPT_LANGUAGE="fr").status_code == 200
    assert User.objects.get().locale == "vi"


@pytest.mark.parametrize("password", ["short1", "12345678", "alice@example.com"])
def test_signup_rejects_weak_passwords(client, password):
    response = signup(client, password=password)
    assert response.status_code == 400
    assert response.json()["errors"][0]["param"] == "password"
    assert not User.objects.exists()


def test_signup_rejects_duplicate_email_case_insensitively(client):
    User.objects.create_user("alice@example.com", PASSWORD)
    response = signup(client, email="ALICE@example.com")
    assert response.status_code == 400
    assert User.objects.count() == 1


def test_signup_closed_by_setting(client, settings):
    settings.SIGNUP_ENABLED = False
    assert signup(client).status_code == 403
    assert not User.objects.exists()


def test_signup_closed_without_default_plan(client):
    Plan.objects.update(is_default_for_signup=False)
    assert signup(client).status_code == 403
    assert not User.objects.exists()


def test_login_session_and_logout(client):
    User.objects.create_user("alice@example.com", PASSWORD)
    assert session_status(client) == 401
    response = login(client)
    assert response.status_code == 200
    assert response.json()["data"]["user"]["email"] == "alice@example.com"
    assert session_status(client) == 200
    assert client.delete(f"{AUTH}/auth/session").status_code == 401
    assert session_status(client) == 401


def test_login_errors_do_not_reveal_whether_email_exists(client):
    User.objects.create_user("alice@example.com", PASSWORD)
    wrong_password = login(client, password="qloud-wrong-password")
    unknown_email = login(client, email="nobody@example.com")
    assert wrong_password.status_code == unknown_email.status_code == 400
    assert wrong_password.json() == unknown_email.json()


@pytest.mark.parametrize(("remember", "browser_session"), [(False, True), (True, False)])
def test_login_remember_controls_session_lifetime(client, settings, remember, browser_session):
    User.objects.create_user("alice@example.com", PASSWORD)
    response = login(client, remember=remember)
    assert response.status_code == 200
    assert client.session.get_expire_at_browser_close() is browser_session
    max_age = response.cookies["sessionid"]["max-age"]
    assert max_age == ("" if browser_session else settings.SESSION_COOKIE_AGE)


def test_signup_session_ends_with_browser(client):
    signup(client)
    assert client.session.get_expire_at_browser_close()


def test_email_verification_by_emailed_key(client):
    signup(client)
    key = emailed_key("verify-email")
    response = post(client, "/auth/email/verify", {"key": key})
    assert response.status_code == 200
    assert EmailAddress.objects.get(email="alice@example.com").verified


def test_email_verification_rejects_invalid_key(client):
    signup(client)
    response = post(client, "/auth/email/verify", {"key": "invalid"})
    assert response.status_code == 400
    assert not EmailAddress.objects.get(email="alice@example.com").verified


def test_password_reset_revokes_existing_sessions(client):
    User.objects.create_user("alice@example.com", PASSWORD)
    old_session = Client()
    assert login(old_session).status_code == 200
    assert post(client, "/auth/password/request", {"email": "alice@example.com"}).status_code == 200
    key = emailed_key("password/reset")
    assert "http://localhost:5173/password/reset/" in mail.outbox[-1].body
    response = post(client, "/auth/password/reset", {"key": key, "password": "qloud-new-password"})
    assert response.status_code in {200, 401}
    assert User.objects.get().check_password("qloud-new-password")
    assert session_status(old_session) == 401
    assert login(client, password="qloud-new-password").status_code == 200


def test_password_reset_request_for_unknown_email_looks_the_same(client):
    User.objects.create_user("alice@example.com", PASSWORD)
    known = post(client, "/auth/password/request", {"email": "alice@example.com"})
    unknown = post(client, "/auth/password/request", {"email": "nobody@example.com"})
    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()


def test_suspended_user_cannot_log_in_and_live_session_is_revoked(client):
    user = User.objects.create_user("alice@example.com", PASSWORD)
    assert login(client).status_code == 200
    suspend_user(user, reason="Abuse")
    assert session_status(client) == 401
    # Even with the right password the user only gets the generic unauthenticated reply.
    response = login(client)
    assert response.status_code == 401
    assert not response.json()["meta"]["is_authenticated"]
    assert session_status(client) == 401


def test_adapter_refuses_suspended_user_in_flows_without_authenticate():
    user = User.objects.create_user("alice@example.com")
    request = RequestFactory().get("/")
    kwargs = {
        "email_verification": "optional",
        "signal_kwargs": None,
        "email": user.email,
        "signup": False,
        "redirect_url": None,
    }
    assert AccountAdapter().pre_login(request, user, **kwargs) is None
    suspend_user(user, reason="Abuse")
    user.refresh_from_db()
    assert AccountAdapter().pre_login(request, user, **kwargs) is not None


def test_auth_writes_require_csrf_token():
    client = Client(enforce_csrf_checks=True)
    User.objects.create_user("alice@example.com", PASSWORD)
    assert login(client).status_code == 403
    client.get(f"{AUTH}/config")
    token = client.cookies["csrftoken"].value
    response = post(
        client,
        "/auth/login",
        {"email": "alice@example.com", "password": PASSWORD},
        HTTP_X_CSRFTOKEN=token,
    )
    assert response.status_code == 200


def test_auth_specification_is_served(client):
    response = client.get("/api/auth/openapi.json")
    assert response.status_code == 200
    paths = response.json()["paths"]
    assert {f"{AUTH}/auth/login", f"{AUTH}/auth/signup", f"{AUTH}/auth/session"} <= set(paths)
