import uuid

import pytest
from django.db import IntegrityError, transaction

from apps.accounts.models import User
from apps.sharing.models import Share

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("role", ["viewer", "editor"])
def test_share_audit_and_constraints(role):
    owner = User.objects.create_user("owner@example.com")
    grantee = User.objects.create_user("grantee@example.com")
    fields = dict(node=owner.root_folder, grantee=grantee, created_by=owner)
    share = Share.objects.create(**fields, role=role)
    assert isinstance(share.pk, uuid.UUID)
    assert share.pk.version == 7
    assert share.created_at
    assert share.updated_at
    with pytest.raises(IntegrityError), transaction.atomic():
        Share.objects.create(**fields, role=role)
    share.delete()
    with pytest.raises(IntegrityError), transaction.atomic():
        Share.objects.create(**fields, role="owner")


@pytest.mark.parametrize("deleted", ["node", "grantee", "created_by"])
def test_share_foreign_keys_cascade(deleted):
    owner = User.objects.create_user("owner@example.com")
    grantee = User.objects.create_user("grantee@example.com")
    assert owner.root_folder is not None
    share = Share.objects.create(
        node=owner.root_folder, grantee=grantee, created_by=owner, role="viewer"
    )
    getattr(share, deleted).delete()
    assert not Share.objects.filter(pk=share.pk).exists()
