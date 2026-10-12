"""Read-side node queries; access is checked through apps.sharing.permissions."""

import uuid
from collections.abc import Iterable

from django.db import connection
from django.db.models import BooleanField, Case, QuerySet, Subquery, Value, When
from django.http import Http404

from apps.accounts.models import User
from apps.sharing.permissions import Role, get_node_or_404, nodes_for

from .errors import NotAFile
from .models import FileVersion, Node

# Adjacency list + recursive CTE (data-model.md); one query whatever the depth.
_BREADCRUMB = """
WITH RECURSIVE ancestors(id, parent_id, depth) AS (
    SELECT id, parent_id, 0 FROM drive_node WHERE id = %s
    UNION ALL
    SELECT n.id, n.parent_id, a.depth + 1
    FROM drive_node n JOIN ancestors a ON n.id = a.parent_id
)
SELECT n.id, n.name, n.parent_id
FROM ancestors a JOIN drive_node n ON n.id = a.id
WHERE a.depth > 0
ORDER BY a.depth DESC
"""

_IS_WITHIN = """
WITH RECURSIVE ancestors(id, parent_id) AS (
    SELECT id, parent_id FROM drive_node WHERE id = %s
    UNION ALL
    SELECT n.id, n.parent_id FROM drive_node n JOIN ancestors a ON n.id = a.parent_id
)
SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = ANY(%s::uuid[]))
"""


def breadcrumb(node: Node, user: User) -> list[Node]:
    """Ancestors visible to the caller, without exposing unshared parent names."""
    ancestors = list(Node.objects.raw(_BREADCRUMB, [node.pk]))
    if node.owner_id == user.pk:
        return ancestors
    visible = set(
        nodes_for(user).filter(pk__in=[n.pk for n in ancestors]).values_list("pk", flat=True)
    )
    # Keep only the contiguous path leading to this node.
    path: list[Node] = []
    for ancestor in reversed(ancestors):
        if ancestor.pk not in visible:
            break
        path.append(ancestor)
    return list(reversed(path))


def is_within(folder_id: uuid.UUID, node_ids: Iterable[uuid.UUID]) -> bool:
    """Whether `folder_id` is one of `node_ids` or lies inside one of them."""
    with connection.cursor() as cursor:
        cursor.execute(_IS_WITHIN, [folder_id, [str(node_id) for node_id in node_ids]])
        row = cursor.fetchone()
    return bool(row and row[0])


RECENT_LIMIT = 100


def recent_files(user: User) -> QuerySet[Node]:
    """The newest owned live files, capped before applying the page cursor."""
    files = nodes_for(user).filter(owner=user, kind=Node.Kind.FILE)
    newest = files.order_by("-updated_at", "-id").values("pk")[:RECENT_LIMIT]
    return files.filter(pk__in=Subquery(newest))


def file_for(user: User, node_id: uuid.UUID, role: Role = Role.VIEWER) -> Node:
    node = get_node_or_404(user, node_id, role)
    if node.kind != Node.Kind.FILE:
        raise NotAFile
    return node


def version_history(node: Node) -> QuerySet[FileVersion]:
    """History of a file already loaded through the permission layer."""
    return (
        FileVersion.objects.filter(node=node)
        .select_related("uploaded_by")
        .annotate(
            is_current=Case(
                When(pk=node.current_version_id, then=Value(True)),
                default=Value(False),
                output_field=BooleanField(),
            )
        )
    )


def version_for(node: Node, version_id: uuid.UUID) -> FileVersion:
    """Scope the version to a permission-checked file, hiding mismatched IDs."""
    try:
        return FileVersion.objects.select_related("blob").get(pk=version_id, node=node)
    except FileVersion.DoesNotExist as error:
        raise Http404 from error
