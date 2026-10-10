"""Read-side node queries; access is checked through apps.sharing.permissions."""

import uuid
from collections.abc import Iterable

from django.db import connection
from django.db.models import QuerySet, Subquery

from apps.accounts.models import User
from apps.sharing.permissions import nodes_for

from .models import Node

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


def breadcrumb(node: Node) -> list[Node]:
    """Ancestors of `node`, from the root folder down to its parent.

    M5: with shares, cut the path above the highest folder the viewer can access.
    """
    return list(Node.objects.raw(_BREADCRUMB, [node.pk]))


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
