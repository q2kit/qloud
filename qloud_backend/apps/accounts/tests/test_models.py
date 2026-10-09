import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

pytestmark = pytest.mark.django_db

User = get_user_model()


def test_create_user_normalizes_email_and_hashes_password():
    user = User.objects.create_user("Alice@Example.COM", "s3cret-pass")

    assert user.email == "alice@example.com"
    assert user.check_password("s3cret-pass")
    assert user.password != "s3cret-pass"
    assert not user.is_staff
    assert not user.is_superuser
    assert user.id.version == 7
    assert str(user) == "alice@example.com"


def test_email_is_unique_case_insensitively():
    User.objects.create_user("bob@example.com", "pw-123456")

    with pytest.raises(IntegrityError), transaction.atomic():
        User.objects.create_user("BOB@example.com", "pw-123456")


def test_create_user_requires_email():
    with pytest.raises(ValueError, match="Email is required"):
        User.objects.create_user("", "pw-123456")


def test_create_superuser_sets_flags():
    admin = User.objects.create_superuser("admin@example.com", "pw-123456")

    assert admin.is_staff
    assert admin.is_superuser
