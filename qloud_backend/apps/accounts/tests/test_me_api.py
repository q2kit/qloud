import pytest
from django.urls import reverse

from apps.accounts.models import User

pytestmark = pytest.mark.django_db

ME = "/api/v1/me"


@pytest.fixture
def user():
    return User.objects.create_user(
        "alice@example.com",
        "qloud-test-password",
        display_name="Alice",
        avatar_url="https://avatars.example/alice.png",
    )


def test_me_requires_authentication(api_client):
    for response in (api_client.get(ME), api_client.patch(ME, {}, format="json")):
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "not_authenticated"


def test_me_returns_profile_and_preferences(api_client, user):
    api_client.force_authenticate(user)
    response = api_client.get(ME)
    assert response.status_code == 200
    assert response.json() == {
        "id": str(user.pk),
        "email": "alice@example.com",
        "display_name": "Alice",
        "avatar_url": "https://avatars.example/alice.png",
        "locale": "vi",
        "theme": "system",
        "root_folder_id": str(user.root_folder_id),
    }


def test_me_updates_preferences_and_ignores_read_only_fields(api_client, user):
    api_client.force_authenticate(user)
    response = api_client.patch(
        ME,
        {
            "display_name": "Alice N.",
            "locale": "en",
            "theme": "dark",
            "email": "mallory@example.com",
            "avatar_url": "https://evil.example/x.png",
        },
        format="json",
    )
    assert response.status_code == 200
    user.refresh_from_db()
    assert (user.display_name, user.locale, user.theme) == ("Alice N.", "en", "dark")
    assert user.email == "alice@example.com"
    assert user.avatar_url == "https://avatars.example/alice.png"


def test_me_patch_writes_only_the_sent_fields(api_client, user):
    # A concurrent change to another field (e.g. quota counters) must survive.
    api_client.force_authenticate(user)
    User.objects.filter(pk=user.pk).update(used_bytes=600, display_name="Changed elsewhere")
    assert api_client.patch(ME, {"theme": "light"}, format="json").status_code == 200
    user.refresh_from_db()
    assert (user.theme, user.used_bytes, user.display_name) == ("light", 600, "Changed elsewhere")


@pytest.mark.parametrize(
    ("field", "value"),
    [("locale", "fr"), ("theme", "blue"), ("display_name", "x" * 101)],
)
def test_me_rejects_invalid_values(api_client, user, field, value):
    api_client.force_authenticate(user)
    response = api_client.patch(ME, {field: value}, format="json")
    assert response.status_code == 400
    body = response.json()["error"]
    assert body["code"] == "validation_error"
    assert field in body["details"]["fields"]


def test_me_url_is_named():
    assert reverse("me") == ME
