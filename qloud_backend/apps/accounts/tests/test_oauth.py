"""OAuth through the real redirect and callback views; only provider HTTP is faked."""

import json
import time
from typing import Any
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from allauth.account.models import EmailAddress
from allauth.socialaccount.models import SocialAccount
from django.test import Client

from apps.accounts.models import Plan, User
from apps.accounts.services import suspend_user

pytestmark = pytest.mark.django_db

AUTH = "/api/auth/browser/v1"
CLIENT_IDS = {"google": "google-client-id", "github": "github-client-id"}


@pytest.fixture(autouse=True)
def oauth_providers(settings):
    settings.SOCIALACCOUNT_PROVIDERS = {
        provider: {"APPS": [{"client_id": client_id, "secret": "secret"}]}
        for provider, client_id in CLIENT_IDS.items()
    }


class FakeResponse:
    def __init__(self, data: Any) -> None:
        self._data = data
        self.status_code = 200
        self.ok = True
        self.text = json.dumps(data)
        self.headers = {"content-type": "application/json"}

    def json(self) -> Any:
        return self._data

    def raise_for_status(self) -> None:
        pass


class FakeSession:
    """Stands in for the requests session allauth uses to talk to providers."""

    def __init__(self, routes: dict[str, Any]) -> None:
        self.routes = routes

    def __enter__(self) -> FakeSession:
        return self

    def __exit__(self, *exc: object) -> None:
        pass

    def request(self, method: str, url: str, **kwargs: Any) -> FakeResponse:
        return FakeResponse(self.routes[url])

    def get(self, url: str, **kwargs: Any) -> FakeResponse:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs: Any) -> FakeResponse:
        return self.request("POST", url, **kwargs)


def google_routes(email: str, *, verified: bool = True) -> dict[str, Any]:
    now = int(time.time())
    id_token = jwt.encode(
        {
            "iss": "https://accounts.google.com",
            "aud": CLIENT_IDS["google"],
            "sub": "google-uid-1",
            "email": email,
            "email_verified": verified,
            "name": "Alice Nguyen",
            "given_name": "Alice",
            "family_name": "Nguyen",
            "picture": "https://lh3.googleusercontent.com/alice.png",
            "iat": now,
            "exp": now + 600,
        },
        "unused-because-tls-token-exchange",
        algorithm="HS256",
    )
    return {
        "https://oauth2.googleapis.com/token": {
            "access_token": "token",
            "token_type": "Bearer",
            "expires_in": 3600,
            "id_token": id_token,
        }
    }


def github_routes(email: str, *, verified: bool = True) -> dict[str, Any]:
    return {
        "https://github.com/login/oauth/access_token": {
            "access_token": "token",
            "token_type": "bearer",
        },
        "https://api.github.com/user": {
            "id": 42,
            "login": "alice",
            "name": "Alice GitHub",
            "email": email,
            "avatar_url": "https://avatars.githubusercontent.com/u/42",
        },
        "https://api.github.com/user/emails": [
            {"email": email, "primary": True, "verified": verified},
        ],
    }


def oauth(
    client: Client,
    provider: str,
    routes: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    *,
    process: str = "login",
    **headers: Any,
) -> Any:
    """Run redirect → provider → callback and return the final response."""
    redirect = client.post(
        f"{AUTH}/auth/provider/redirect",
        {"provider": provider, "callback_url": "/oauth/done", "process": process},
        **headers,
    )
    assert redirect.status_code == 302
    authorize = urlparse(redirect["Location"])
    query = parse_qs(authorize.query)
    assert query["client_id"] == [CLIENT_IDS[provider]]
    callback = urlparse(query["redirect_uri"][0])
    assert callback.path == f"/api/auth/oauth/{provider}/login/callback/"
    monkeypatch.setattr(
        "allauth.socialaccount.adapter.DefaultSocialAccountAdapter.get_requests_session",
        lambda self: FakeSession(routes),
    )
    return client.get(callback.path, {"code": "code", "state": query["state"][0]}, **headers)


def session_user_id(client: Client) -> str | None:
    user = session_user(client)
    return None if user is None else str(user["id"])


def session_user(client: Client) -> dict[str, Any] | None:
    body = client.get(f"{AUTH}/auth/session").json()
    user: dict[str, Any] | None = body.get("data", {}).get("user")
    return user if body["meta"]["is_authenticated"] else None


def test_config_lists_only_configured_providers(client, settings):
    providers = client.get(f"{AUTH}/config").json()["data"]["socialaccount"]["providers"]
    assert {provider["id"] for provider in providers} == {"google", "github"}
    settings.SOCIALACCOUNT_PROVIDERS = {}
    config = client.get(f"{AUTH}/config").json()["data"]
    assert not config.get("socialaccount", {}).get("providers")


def test_google_signup_provisions_account_with_profile(client, monkeypatch):
    response = oauth(
        client,
        "google",
        google_routes("alice@example.com"),
        monkeypatch,
        HTTP_ACCEPT_LANGUAGE="en",
    )
    assert response.status_code == 302
    assert response["Location"] == "/oauth/done"
    user = User.objects.get(email="alice@example.com")
    assert session_user_id(client) == str(user.pk)
    assert user.plan.code == "free-2026"
    assert user.root_folder is not None
    assert user.display_name == "Alice Nguyen"
    assert user.avatar_url == "https://lh3.googleusercontent.com/alice.png"
    assert user.locale == "en"
    assert not user.has_usable_password()
    assert EmailAddress.objects.get(user=user).verified
    assert SocialAccount.objects.get(user=user).provider == "google"


def test_verified_provider_email_links_existing_account(client, monkeypatch):
    user = User.objects.create_user("alice@example.com", "qloud-test-password")
    EmailAddress.objects.create(user=user, email=user.email, verified=True, primary=True)
    oauth(client, "github", github_routes("alice@example.com"), monkeypatch)
    assert User.objects.count() == 1
    assert session_user_id(client) == str(user.pk)
    assert SocialAccount.objects.get(user=user).provider == "github"
    user.refresh_from_db()
    assert user.check_password("qloud-test-password")


def test_linking_to_unverified_local_email_wipes_its_password(client, monkeypatch):
    # Whoever registered the address first never proved they own it, so allauth
    # locks them out instead of sharing the account with the provider's user.
    squatter = User.objects.create_user("alice@example.com", "qloud-test-password")
    EmailAddress.objects.create(user=squatter, email=squatter.email, verified=False)
    old_session = Client()
    assert old_session.login(email=squatter.email, password="qloud-test-password")
    oauth(client, "google", google_routes("alice@example.com"), monkeypatch)
    squatter.refresh_from_db()
    assert session_user_id(client) == str(squatter.pk)
    assert not squatter.has_usable_password()
    assert session_user(old_session) is None


def test_unverified_provider_email_does_not_link_existing_account(client, monkeypatch):
    user = User.objects.create_user("alice@example.com", "qloud-test-password")
    oauth(client, "github", github_routes("alice@example.com", verified=False), monkeypatch)
    assert User.objects.count() == 1
    assert not SocialAccount.objects.exists()
    assert session_user(client) is None
    user.refresh_from_db()
    assert user.check_password("qloud-test-password")


def test_logged_in_user_connects_provider(client, monkeypatch):
    user = User.objects.create_user("alice@example.com", "qloud-test-password")
    client.force_login(user)
    response = oauth(
        client, "github", github_routes("alice.dev@example.com"), monkeypatch, process="connect"
    )
    assert response.status_code == 302
    assert SocialAccount.objects.get(user=user).provider == "github"
    assert User.objects.count() == 1


def test_last_login_method_cannot_be_disconnected(client, monkeypatch):
    oauth(client, "google", google_routes("alice@example.com"), monkeypatch)
    account = SocialAccount.objects.get()
    response = client.delete(
        f"{AUTH}/account/providers",
        {"provider": "google", "account": account.uid},
        content_type="application/json",
    )
    assert response.status_code == 400
    assert SocialAccount.objects.filter(pk=account.pk).exists()


def test_provider_can_be_disconnected_when_password_remains(client, monkeypatch):
    user = User.objects.create_user("alice@example.com", "qloud-test-password")
    client.force_login(user)
    oauth(client, "github", github_routes("alice@example.com"), monkeypatch, process="connect")
    account = SocialAccount.objects.get()
    response = client.delete(
        f"{AUTH}/account/providers",
        {"provider": "github", "account": account.uid},
        content_type="application/json",
    )
    assert response.status_code == 200
    assert not SocialAccount.objects.exists()


@pytest.mark.parametrize("closed_by", ["setting", "missing_default_plan"])
def test_oauth_signup_respects_closed_signup(client, monkeypatch, settings, closed_by):
    if closed_by == "setting":
        settings.SIGNUP_ENABLED = False
    else:
        Plan.objects.update(is_default_for_signup=False)
    oauth(client, "google", google_routes("alice@example.com"), monkeypatch)
    assert not User.objects.exists()
    assert session_user(client) is None


def test_suspended_user_cannot_sign_in_with_provider(client, monkeypatch):
    user = User.objects.create_user("alice@example.com")
    EmailAddress.objects.create(user=user, email=user.email, verified=True, primary=True)
    suspend_user(user, reason="Abuse")
    oauth(client, "google", google_routes("alice@example.com"), monkeypatch)
    # AccountAdapter.pre_login must refuse before a session is created at all;
    # AccountBackend would only reject it on the next request.
    assert "_auth_user_id" not in client.session
    assert session_user(client) is None
