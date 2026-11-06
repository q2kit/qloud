"""Bounded maintenance using the same owner lock as uploads and version actions."""

import uuid
from datetime import datetime, timedelta

from django.db import transaction
from django.db.models import (
    Count,
    DateTimeField,
    DurationField,
    Exists,
    ExpressionWrapper,
    F,
    IntegerField,
    OuterRef,
    Q,
    QuerySet,
    Subquery,
    Value,
)
from django.db.models.functions import Coalesce

from apps.accounts.models import User
from apps.audit import services as audit

from .models import FileVersion, Node
from .services import delete_versions_locked


def superseded_at() -> Subquery:
    """When the next version replaced this one; its age for retention counts from here."""
    return Subquery(
        FileVersion.objects.filter(
            node=OuterRef("node"), version_number__gt=OuterRef("version_number")
        )
        .order_by("version_number")
        .values("created_at")[:1],
        output_field=DateTimeField(),
    )


def _old_versions() -> QuerySet[FileVersion]:
    # Unpinned, non-current versions are the only ones cleanup may delete.
    return FileVersion.objects.filter(keep_forever=False).filter(
        Q(node__current_version__isnull=True) | ~Q(pk=F("node__current_version"))
    )


def file_batch(
    now: datetime, after: uuid.UUID | None, batch: int = 200
) -> list[tuple[uuid.UUID, uuid.UUID]]:
    """Files whose owner's plan currently allows deleting at least one old version."""
    # Maintenance includes trash and suspended owners; no request permissions apply.
    old = _old_versions().filter(node=OuterRef("pk"))
    old_count = Subquery(
        old.order_by().values("node").annotate(n=Count("pk")).values("n"),
        output_field=IntegerField(),
    )
    cutoff = ExpressionWrapper(
        Value(now)
        - ExpressionWrapper(
            OuterRef("owner__plan__version_retention_days") * Value(timedelta(days=1)),
            output_field=DurationField(),
        ),
        output_field=DateTimeField(),
    )
    aged = old.annotate(superseded_at=superseded_at()).filter(superseded_at__lt=cutoff)
    nodes = (
        Node.objects.filter(kind=Node.Kind.FILE)
        .alias(old_count=Coalesce(old_count, 0))
        .filter(Q(old_count__gt=F("owner__plan__max_versions_per_file")) | Exists(aged))
    )
    if after is not None:
        nodes = nodes.filter(pk__gt=after)
    return list(nodes.order_by("pk").values_list("pk", "owner_id")[:batch])


@transaction.atomic
def expire_file(node_id: uuid.UUID, owner_id: uuid.UUID, now: datetime, batch: int = 200) -> int:
    owner = (
        User.objects.select_for_update(of=("self",))
        .select_related("plan")
        .filter(pk=owner_id)
        .first()
    )
    if owner is None:
        return 0
    node = Node.objects.select_for_update().filter(pk=node_id, owner=owner).first()
    if node is None:
        return 0
    old = _old_versions().filter(node=node)
    newest = old.order_by("-version_number").values("pk")[: owner.plan.max_versions_per_file]
    expired = (
        Q()
        if owner.plan.version_retention_days is None
        else Q(superseded_at__lt=now - timedelta(days=owner.plan.version_retention_days))
    )
    candidates = old.alias(superseded_at=superseded_at()).filter(
        ~Q(pk__in=Subquery(newest)) | expired
    )
    versions: list[FileVersion] = list(candidates.order_by("version_number")[:batch])
    if versions:
        delete_versions_locked(node, versions)
        audit.record(
            audit.Action.VERSION_EXPIRE,
            node,
            actor=None,
            actor_kind=audit.ActorKind.SYSTEM,
            versions=[version.version_number for version in versions],
        )
    return len(versions)
