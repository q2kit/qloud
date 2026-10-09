import pytest
from django.urls import reverse

pytestmark = pytest.mark.django_db


def test_openapi_schema_is_served_and_lists_health(api_client):
    response = api_client.get(reverse("schema"), {"format": "json"})

    assert response.status_code == 200
    assert "/api/v1/health" in response.json()["paths"]
