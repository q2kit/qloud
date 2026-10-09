from importlib import import_module

import pytest
from django.apps import apps
from django.db import connection
from rest_framework.test import APIClient

from apps.accounts.models import Plan


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture(autouse=True)
def seeded_plans(request):
    if request.node.get_closest_marker("django_db") or set(request.fixturenames) & {
        "db",
        "transactional_db",
        "live_server",
    }:
        request.getfixturevalue("db")
        if not Plan.objects.exists():
            migration = import_module(
                "apps.accounts.migrations.0002_user_avatar_url_user_locale_and_more"
            )
            migration.seed_plans(apps, connection.schema_editor())
