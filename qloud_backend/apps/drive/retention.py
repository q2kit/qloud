"""Bounded maintenance using the same owner lock as uploads and version actions."""

import uuid
from datetime import datetime, timedelta

from django.db import transaction
from django.db.models import Q, Subquery

from apps.accounts.models import User

from .models import FileVersion, Node
from .services import delete_versions_locked


def file_batch(after: uuid.UUID | None, batch: int = 200) -> list[tuple[uuid.UUID, uuid.UUID]]:
    # Maintenance includes trash and suspended owners; no request permissions apply.
    nodes = Node.objects.filter(kind=Node.Kind.FILE)
    if after is not None:
        nodes = nodes.filter(pk__gt=after)
    return list(nodes.order_by("pk").values_list("pk", "owner_id")[:batch])


@transaction.atomic
def expire_file(node_id: uuid.UUID, owner_id: uuid.UUID, now: datetime, batch: int = 200) -> int:
    owner = User.objects.select_for_update().filter(pk=owner_id).first()
    if owner is None:
        return 0
    node = Node.objects.select_for_update().filter(pk=node_id, owner=owner).first()
    if node is None:
        return 0
    old = FileVersion.objects.filter(node=node, keep_forever=False)
    if node.current_version_id is not None:
        old = old.exclude(pk=node.current_version_id)
    newest = old.order_by("-version_number").values("pk")[: owner.plan.max_versions_per_file]
    expired = (
        Q()
        if owner.plan.version_retention_days is None
        else Q(created_at__lt=now - timedelta(days=owner.plan.version_retention_days))
    )
    candidates = old.filter(~Q(pk__in=Subquery(newest)) | expired)
    versions = list(candidates.order_by("version_number")[:batch])
    if versions:
        delete_versions_locked(node, versions)
    return len(versions)
