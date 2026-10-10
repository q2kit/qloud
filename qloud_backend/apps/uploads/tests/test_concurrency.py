from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from allauth.account.models import EmailAddress
from django.db import connections

from apps.accounts.models import User
from apps.uploads import services
from apps.uploads.errors import QuotaExceeded

pytestmark = pytest.mark.django_db(transaction=True)


def test_concurrent_uploads_never_exceed_quota(bucket):
    """quota.md: 10 uploads at once that together exceed the quota; only those that fit."""
    user = User.objects.create_user("racer@example.com", quota_override_bytes=1000)
    EmailAddress.objects.create(user=user, email=user.email, verified=True, primary=True)
    root = user.root_folder
    assert root is not None
    start = Barrier(10, timeout=10)

    def create(i: int) -> str:
        try:
            start.wait()
            services.create_session(
                user,
                parent_id=root.pk,
                filename=f"f{i}.bin",
                size=300,
                mime_type="application/octet-stream",
                fingerprint=str(i),
            )
            return "accepted"
        except QuotaExceeded:
            return "refused"
        finally:
            connections.close_all()

    with ThreadPoolExecutor(10) as pool:
        results = list(pool.map(create, range(10)))
    assert results.count("accepted") == 3
    user.refresh_from_db()
    assert user.reserved_bytes == 900
