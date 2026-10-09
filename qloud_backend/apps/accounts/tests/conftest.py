import pytest

from apps.accounts.models import Plan


@pytest.fixture(autouse=True)
def seeded_plans(db):
    # Transactional migration tests flush the database after restoring the schema.
    if not Plan.objects.exists():
        Plan.objects.create(
            code="free-2026",
            name="Free 2026",
            quota_bytes=5_000_000_000,
            max_file_size_bytes=5_000_000_000,
            is_default_for_signup=True,
        )
        Plan.objects.create(
            code="plus-2026",
            name="Plus 2026",
            quota_bytes=50_000_000_000,
            max_file_size_bytes=50_000_000_000,
        )
