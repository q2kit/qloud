import pytest
import redis
from django.db import connection
from django.urls import reverse

pytestmark = pytest.mark.django_db


def test_health_ok(api_client):
    response = api_client.get(reverse("health"))

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "checks": {"database": "ok", "redis": "ok"}}


def test_health_requires_no_authentication(api_client):
    api_client.logout()

    assert api_client.get(reverse("health")).status_code == 200


@pytest.mark.parametrize("failing", ["database", "redis"])
def test_health_reports_failing_dependency(api_client, monkeypatch, failing):
    def boom(*args, **kwargs):
        raise ConnectionError("down")

    if failing == "database":
        monkeypatch.setattr(connection, "cursor", boom)
    else:
        monkeypatch.setattr(redis.Redis, "from_url", boom)

    response = api_client.get(reverse("health"))

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "error"
    assert body["checks"][failing] == "error"
    assert "down" not in response.content.decode()
