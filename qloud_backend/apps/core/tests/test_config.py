import pytest

CONFIG = "/api/v1/config"


@pytest.mark.parametrize(
    ("site_key", "secret", "expected"),
    [
        ("site", "secret", "site"),
        # Without the secret the server does not check tokens: no widget.
        ("site", "", None),
        ("", "secret", None),
    ],
)
def test_config_exposes_turnstile_site_key_only_when_checked(
    api_client, settings, site_key, secret, expected
):
    settings.TURNSTILE_SITE_KEY = site_key
    settings.TURNSTILE_SECRET_KEY = secret
    response = api_client.get(CONFIG)
    assert response.status_code == 200
    assert response.json() == {"turnstile_site_key": expected}


def test_config_is_public_and_needs_no_session(api_client):
    assert api_client.get(CONFIG).status_code == 200
