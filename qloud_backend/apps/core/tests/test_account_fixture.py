import pytest

from apps.accounts.models import User


@pytest.mark.django_db(transaction=True)
def test_transactional_test_outside_accounts_has_signup_plan():
    user = User.objects.create_user("outside-accounts@example.com")
    assert user.plan.code == "free-2026"
