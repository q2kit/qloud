"""Transactional trash groups; object cleanup is durable and runs after commit."""

import uuid
from collections.abc import Sequence
from datetime import datetime, timedelta
from functools import partial

from django.db import connection, transaction
from django.db.models import (
    DateTimeField,
    DurationField,
    ExpressionWrapper,
    F,
    QuerySet,
    Sum,
    Value,
)
from django.http import Http404
from django.utils import timezone

from apps.accounts.models import User
from apps.audit import services as audit
from apps.sharing.permissions import Role, nodes_for

from .errors import RootFolder
from .models import FileVersion, Node, ObjectDeletion
from .services import available_name
from .thumbnails import SIZES, thumbnail_key

# Walk only live descendants: older trash groups must keep their own root and clock.
_TRASH = """
WITH RECURSIVE tree(id, root_id, depth) AS (
    SELECT id, id, 0 FROM drive_node WHERE id = ANY(%s::uuid[]) AND owner_id = %s
    UNION ALL
    SELECT n.id, t.root_id, t.depth + 1 FROM drive_node n
    JOIN tree t ON n.parent_id = t.id
    WHERE n.trashed_at IS NULL AND n.owner_id = %s
), roots AS (
    SELECT DISTINCT ON (id) id, root_id FROM tree ORDER BY id, depth DESC
)
UPDATE drive_node n SET trashed_at = %s, trashed_by_id = %s,
    trashed_root_id = r.root_id, updated_at = %s
FROM roots r WHERE n.id = r.id AND n.trashed_at IS NULL
"""

_SUBTREE = """
WITH RECURSIVE tree(id) AS (
    SELECT id FROM drive_node WHERE id = ANY(%s::uuid[]) AND owner_id = %s
    UNION ALL
    SELECT n.id FROM drive_node n JOIN tree t ON n.parent_id = t.id WHERE n.owner_id = %s
)
SELECT id FROM tree
"""


def roots_for(user: User) -> QuerySet[Node]:
    return nodes_for(user, Role.OWNER, trashed=True).filter(trashed_root_id=F("id"))


def _selected(
    user: User, ids: Sequence[uuid.UUID], *, trashed: bool, role: Role = Role.OWNER
) -> list[Node]:
    unique = list(dict.fromkeys(ids))
    nodes = list(nodes_for(user, role, trashed=trashed).filter(pk__in=unique))
    if len(nodes) != len(unique):
        raise Http404
    if any(node.parent_id is None for node in nodes):
        raise RootFolder
    if trashed and any(node.trashed_root_id != node.pk for node in nodes):
        raise Http404
    return nodes


def trash(user: User, ids: Sequence[uuid.UUID]) -> list[Node]:
    with transaction.atomic():
        owners = nodes_for(user, Role.EDITOR).filter(pk__in=ids).values("owner_id")
        owner_ids = list(
            User.objects.select_for_update()
            .filter(pk__in=owners)
            .order_by("pk")
            .values_list("pk", flat=True)
        )
        nodes = _selected(user, ids, trashed=False, role=Role.EDITOR)
        now = timezone.now()
        with connection.cursor() as cursor:
            for owner_id in owner_ids:
                cursor.execute(
                    _TRASH,
                    [
                        [str(n.pk) for n in nodes if n.owner_id == owner_id],
                        owner_id,
                        owner_id,
                        now,
                        user.pk,
                        now,
                    ],
                )
        audit.record_all(audit.event(audit.Action.NODE_TRASH, node, actor=user) for node in nodes)
        # The editor loses read access as soon as trash commits. Return only the
        # selected roots already authorized above, without querying their trash.
        return list(Node.objects.filter(pk__in=[n.pk for n in nodes], trashed_root_id=F("id")))


def restore(user: User, ids: Sequence[uuid.UUID]) -> list[Node]:
    with transaction.atomic():
        owner = User.objects.select_for_update().get(pk=user.pk)
        nodes = _selected(user, ids, trashed=True)
        if owner.root_folder_id is None:
            raise Http404
        now = timezone.now()
        # An ancestor group selected together with a child is restored first.
        pending = {node.pk: node for node in nodes}
        restored: list[Node] = []
        while pending:
            ready = [node for node in pending.values() if not _has_pending_ancestor(node, pending)]
            for node in ready:
                if node.parent_id is None:
                    raise RootFolder
                parent = nodes_for(user).filter(pk=node.parent_id).first()
                if parent is None:
                    parent = nodes_for(user).get(pk=owner.root_folder_id)
                node.parent = parent
                node.name = available_name(parent, node.name, node.kind)
                node.save(update_fields=["parent", "name"])
                nodes_for(user, Role.OWNER, trashed=True).filter(trashed_root_id=node.pk).update(
                    trashed_at=None, trashed_root=None, trashed_by=None, updated_at=now
                )
                node.trashed_at, node.trashed_root_id, node.trashed_by_id = None, None, None
                node.updated_at = now
                restored.append(node)
                del pending[node.pk]
        audit.record_all(
            audit.event(audit.Action.NODE_RESTORE, node, actor=user) for node in restored
        )
        return restored


def _has_pending_ancestor(node: Node, pending: dict[uuid.UUID, Node]) -> bool:
    # The selected nodes are permission-checked; the traversal stays in their owner's tree.
    from .selectors import is_within

    return is_within(node.parent_id, pending) if node.parent_id is not None else False


def delete(user: User, ids: Sequence[uuid.UUID] | None = None) -> None:
    with transaction.atomic():
        owner = User.objects.select_for_update().get(pk=user.pk)
        roots = list(roots_for(user)) if ids is None else _selected(user, ids, trashed=True)
        # Written first: deleting the nodes then clears the events' links to them.
        audit.record_all(audit.event(audit.Action.NODE_PURGE, node, actor=user) for node in roots)
        _delete_locked(owner, roots)


def _delete_locked(owner: User, roots: Sequence[Node], *, enqueue: bool = True) -> None:
    if not roots:
        return
    with connection.cursor() as cursor:
        cursor.execute(_SUBTREE, [[str(n.pk) for n in roots], owner.pk, owner.pk])
        subtree = [row[0] for row in cursor.fetchall()]
    nodes = Node.objects.filter(owner=owner, trashed_at__isnull=False, pk__in=subtree)
    versions = FileVersion.objects.filter(node__in=nodes)
    blob_keys = set(versions.values_list("blob__storage_key", flat=True))
    keys = {
        thumbnail_key(pk, size) for pk in versions.values_list("pk", flat=True) for size in SIZES
    }
    keys.update(key for key in nodes.values_list("thumbnail_key", flat=True) if key)
    nodes.delete()
    # A blob may still serve another version; never remove its object in that case.
    from .models import Blob

    unreferenced = Blob.objects.filter(storage_key__in=blob_keys, versions__isnull=True)
    size = unreferenced.aggregate(total=Sum("size"))["total"] or 0
    keys.update(unreferenced.values_list("storage_key", flat=True))
    ObjectDeletion.objects.bulk_create(
        [ObjectDeletion(storage_key=key) for key in keys], ignore_conflicts=True
    )
    User.objects.filter(pk=owner.pk).update(used_bytes=F("used_bytes") - size)
    from .tasks import enqueue_object_cleanup

    if enqueue:
        transaction.on_commit(partial(enqueue_object_cleanup))


def expired_root_ids(now: datetime, batch: int = 200) -> list[tuple[uuid.UUID, uuid.UUID]]:
    # Background maintenance includes suspended owners; this is not a request selector.
    duration = ExpressionWrapper(
        F("owner__plan__trash_retention_days") * Value(timedelta(days=1)),
        output_field=DurationField(),
    )
    return list(
        Node.objects.filter(trashed_root_id=F("id"), trashed_at__isnull=False)
        .annotate(
            expires_at=ExpressionWrapper(F("trashed_at") + duration, output_field=DateTimeField())
        )
        .filter(expires_at__lte=now)
        .order_by("trashed_at", "id")
        .values_list("id", "owner_id")[:batch]
    )


def expire_root(node_id: uuid.UUID, owner_id: uuid.UUID, now: datetime) -> bool:
    with transaction.atomic():
        owner = User.objects.select_for_update().filter(pk=owner_id).first()
        if owner is None:
            return False
        node = Node.objects.filter(pk=node_id, owner=owner, trashed_root_id=F("id")).first()
        if node is None or node.trashed_at is None:
            return False
        if node.trashed_at + timedelta(days=owner.plan.trash_retention_days) > now:
            return False
        audit.record(audit.Action.NODE_PURGE, node, actor=None, actor_kind=audit.ActorKind.SYSTEM)
        _delete_locked(owner, [node], enqueue=False)
        return True
