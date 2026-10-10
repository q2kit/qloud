from importlib import import_module

import pytest
from botocore.exceptions import ClientError
from django.apps import apps
from django.conf import settings
from django.db import connection
from rest_framework.test import APIClient

from apps.accounts.models import Plan
from apps.storage import s3


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


@pytest.fixture(scope="session")
def bucket() -> str:
    """The test bucket on LocalStack (docker compose), created once per run."""
    name = str(settings.S3_BUCKET)
    try:
        s3.client().head_bucket(Bucket=name)
    except ClientError:
        s3.client().create_bucket(Bucket=name)
    return name
