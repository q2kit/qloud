import uuid

from django.db import transaction

from apps.accounts.models import User
from apps.core.errors import InvalidShareRecipient, InvalidShareTarget, ShareExists
from apps.drive.models import Node

from . import selectors
from .models import Share
from .notifications import schedule_share_email


def _locked_node(user: User, node_id: uuid.UUID) -> Node:
    node = selectors.editable_node(user, node_id)
    User.objects.select_for_update().get(pk=node.owner_id)
    # All grant writers and Drive tree writers serialize on the real owner.
    return selectors.editable_node(user, node_id)


@transaction.atomic
def create_share(user: User, node_id: uuid.UUID, email: str, role: str) -> Share:
    node = _locked_node(user, node_id)
    recipient = User.objects.filter(
        email__iexact=email.strip(), is_active=True, suspended_at__isnull=True
    ).first()
    if recipient is None:
        raise InvalidShareRecipient
    if recipient.pk in (user.pk, node.owner_id):
        raise InvalidShareTarget
    if Share.objects.filter(node=node, grantee=recipient).exists():
        raise ShareExists
    share = Share.objects.create(node=node, grantee=recipient, role=role, created_by=user)
    schedule_share_email(share)
    return share


@transaction.atomic
def update_share(user: User, share_id: uuid.UUID, role: str) -> Share:
    share = selectors.share_for(user, share_id)
    _locked_node(user, share.node_id)
    share = selectors.share_for(user, share_id)
    share.role = role
    share.save(update_fields=["role", "updated_at"])
    return share


@transaction.atomic
def revoke_share(user: User, share_id: uuid.UUID) -> None:
    share = selectors.share_for(user, share_id)
    _locked_node(user, share.node_id)
    selectors.share_for(user, share_id).delete()
