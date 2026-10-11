import datetime
import uuid

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounts.models import User

from . import link_selectors
from .models import ShareLink


@transaction.atomic
def create_link(
    user: User, node_id: uuid.UUID, expires_at: datetime.datetime | None = None
) -> ShareLink:
    node = link_selectors.owned_node(user, node_id)
    User.objects.select_for_update().get(pk=node.owner_id)
    node = link_selectors.owned_node(user, node_id)
    if expires_at is not None and expires_at <= timezone.now():
        raise ValidationError({"expires_at": ["Must be in the future."]})
    return ShareLink.objects.create(node=node, created_by=user, expires_at=expires_at)


@transaction.atomic
def revoke_link(user: User, link_id: uuid.UUID) -> None:
    link = link_selectors.managed_link(user, link_id)
    User.objects.select_for_update().get(pk=user.pk)
    link = link_selectors.managed_link(user, link_id)
    if link.revoked_at is None:
        link.revoked_at = timezone.now()
        link.revoked_by = user
        link.revoke_reason = ShareLink.RevokeReason.OWNER
        link.save(update_fields=["revoked_at", "revoked_by", "revoke_reason", "updated_at"])
