import uuid

from django.db import connection
from django.db.models import Q, QuerySet
from django.http import Http404
from django.utils import timezone

from apps.accounts.models import User
from apps.core.errors import NotAFolder
from apps.drive.errors import RootFolder
from apps.drive.models import Node

from .models import ShareLink
from .permissions import _LINK_TREE, Role, get_link_node_or_404, get_node_or_404, nodes_for_link


def owned_node(user: User, node_id: uuid.UUID) -> Node:
    node = get_node_or_404(user, node_id, Role.OWNER)
    if node.parent_id is None:
        raise RootFolder
    return node


def links_for(user: User, node_id: uuid.UUID) -> QuerySet[ShareLink]:
    node = owned_node(user, node_id)
    return ShareLink.objects.filter(node=node)


def managed_link(user: User, link_id: uuid.UUID) -> ShareLink:
    link = ShareLink.objects.filter(pk=link_id).first()
    if link is None:
        raise Http404
    owned_node(user, link.node_id)
    return link


def public_link(token: str) -> ShareLink:
    link = (
        ShareLink.objects.filter(
            token=token,
            revoked_at__isnull=True,
            node__trashed_at__isnull=True,
            node__owner__is_active=True,
            node__owner__suspended_at__isnull=True,
        )
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now()))
        .first()
    )
    if link is None:
        raise Http404
    return link


def public_breadcrumb(link: ShareLink, node: Node) -> list[Node]:
    # Traverse only already scoped nodes, and never fetch an outside parent.
    sql = (
        _LINK_TREE  # noqa: S608 - constant SQL, bound UUIDs
        + """,
    ancestors(id, parent_id, depth) AS (
        SELECT n.id, n.parent_id, 0 FROM drive_node n JOIN linked t ON t.id = n.id WHERE n.id = %s
        UNION
        SELECT n.id, n.parent_id, a.depth + 1
        FROM drive_node n JOIN ancestors a ON n.id = a.parent_id
        JOIN linked t ON t.id = n.id WHERE a.id <> %s
    )
    SELECT n.id, n.name FROM ancestors a JOIN drive_node n ON n.id = a.id
    WHERE a.depth > 0 ORDER BY a.depth DESC
    """
    )
    with connection.cursor() as cursor:
        cursor.execute(sql, [link.pk, node.pk, link.node_id])
        return [Node(id=row[0], name=row[1]) for row in cursor.fetchall()]


def public_children(link: ShareLink, folder_id: uuid.UUID | None) -> QuerySet[Node]:
    folder = get_link_node_or_404(link, folder_id)
    if folder.kind != Node.Kind.FOLDER:
        raise NotAFolder
    return nodes_for_link(link).filter(parent=folder)
