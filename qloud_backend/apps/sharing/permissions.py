"""Access to nodes: the only way views and selectors may load them.

See architecture.md, "Phân quyền".

A user's role on a node is the highest of: owner, a Share on the node, a Share on an
ancestor folder (inherited). Shared access never includes trashed nodes.
No access and no such node look the same to the caller: a 404, never a 403.
"""

import enum
import uuid
from collections.abc import Sequence

from django.contrib.auth.models import AbstractBaseUser, AnonymousUser
from django.core.exceptions import ValidationError
from django.db import connection
from django.db.models import Q, QuerySet
from django.db.models.expressions import RawSQL
from django.http import Http404

from apps.accounts.models import User
from apps.drive.models import Node

from .models import ShareLink


class Role(enum.IntEnum):
    VIEWER = 1
    EDITOR = 2
    OWNER = 3


# Keep the granting root to enforce moves within one shared subtree. UNION also
# prevents a malformed cycle from recursing forever; no Python tree materialization.
_SHARED_TREE = """
WITH RECURSIVE shared(id, owner_id, kind, root_id, role) AS (
    SELECT n.id, n.owner_id, n.kind, n.id, s.role
    FROM sharing_share s JOIN drive_node n ON n.id = s.node_id
    WHERE s.grantee_id = %s AND n.trashed_at IS NULL
    UNION
    SELECT n.id, n.owner_id, n.kind, t.root_id, t.role
    FROM drive_node n JOIN shared t ON n.parent_id = t.id
    WHERE t.kind = 'folder' AND n.owner_id = t.owner_id AND n.trashed_at IS NULL
)
"""


def _active(user: AbstractBaseUser | AnonymousUser) -> User | None:
    # Suspended users are also refused at login and session load; checked again so
    # no code path that skipped authentication can reach their data.
    if isinstance(user, User) and user.is_active and user.suspended_at is None:
        return user
    return None


def nodes_for(
    user: AbstractBaseUser | AnonymousUser,
    role: Role = Role.VIEWER,
    *,
    trashed: bool | None = False,
) -> QuerySet[Node]:
    """Nodes on which `user` has at least `role`.

    `trashed`: False (default) only live nodes, True only trashed ones, None both.
    """
    active = _active(user)
    if active is None:
        return Node.objects.none()
    access = Q(owner=active)
    if role < Role.OWNER:
        allowed = ["editor"] if role == Role.EDITOR else ["viewer", "editor"]
        access |= Q(
            pk__in=RawSQL(  # noqa: S611 - fixed SQL, bound UUID and role parameters
                _SHARED_TREE + "SELECT id FROM shared WHERE role = ANY(%s::varchar[])",  # noqa: S608 - constants only
                [active.pk, allowed],
            )
        )
    nodes = Node.objects.filter(access)
    if trashed is not None:
        nodes = nodes.filter(trashed_at__isnull=not trashed)
    return nodes


def role_of(user: AbstractBaseUser | AnonymousUser, node: Node) -> Role | None:
    active = _active(user)
    if active is not None and node.owner_id == active.pk:
        return Role.OWNER
    if active is None:
        return None
    with connection.cursor() as cursor:
        cursor.execute(
            _SHARED_TREE + "SELECT MAX(CASE role WHEN 'editor' THEN 2 ELSE 1 END) "
            "FROM shared WHERE id = %s",
            [active.pk, node.pk],
        )
        row = cursor.fetchone()
    return Role(row[0]) if row and row[0] is not None else None


def can_move_within(user: User, nodes: Sequence[Node], target: Node) -> bool:
    """Editors may move descendants only inside a common editor grant's folder."""
    if _active(user) is None:
        return False
    if target.owner_id == user.pk and all(node.owner_id == user.pk for node in nodes):
        return True
    with connection.cursor() as cursor:
        cursor.execute(
            _SHARED_TREE  # noqa: S608 - constants only; IDs are bound parameters
            + """
            SELECT COUNT(DISTINCT source.id) = %s
            FROM shared source JOIN shared target USING (root_id)
            WHERE source.id = ANY(%s::uuid[]) AND target.id = %s
              AND source.role = 'editor' AND target.role = 'editor'
              AND source.id <> source.root_id
            """,
            [user.pk, len(nodes), [str(node.pk) for node in nodes], target.pk],
        )
        row = cursor.fetchone()
    return bool(row and row[0])


def get_node_or_404(
    user: AbstractBaseUser | AnonymousUser,
    node_id: uuid.UUID | str,
    role: Role = Role.VIEWER,
    *,
    trashed: bool | None = False,
) -> Node:
    try:
        return nodes_for(user, role, trashed=trashed).get(pk=node_id)
    except (Node.DoesNotExist, ValidationError) as error:  # ValidationError: not a UUID
        raise Http404 from error


# The token's scope is independent of any logged-in user's other grants. Joining
# the live link inside the CTE rechecks expiry, suspension and trash on every read.
_LINK_TREE = """
WITH RECURSIVE linked(id, owner_id, kind) AS (
    SELECT n.id, n.owner_id, n.kind
    FROM sharing_share_link l
    JOIN drive_node n ON n.id = l.node_id
    JOIN accounts_user u ON u.id = n.owner_id
    WHERE l.id = %s AND l.revoked_at IS NULL
      AND (l.expires_at IS NULL OR l.expires_at > STATEMENT_TIMESTAMP())
      AND u.is_active AND u.suspended_at IS NULL AND n.trashed_at IS NULL
    UNION
    SELECT n.id, n.owner_id, n.kind
    FROM drive_node n JOIN linked t ON n.parent_id = t.id
    WHERE t.kind = 'folder' AND n.owner_id = t.owner_id AND n.trashed_at IS NULL
)
"""


def nodes_for_link(link: ShareLink) -> QuerySet[Node]:
    return Node.objects.filter(
        pk__in=RawSQL(  # noqa: S611 - fixed SQL, bound UUID
            _LINK_TREE + "SELECT id FROM linked",  # noqa: S608 - constants only
            [link.pk],
        )
    )


def get_link_node_or_404(link: ShareLink, node_id: uuid.UUID | str | None = None) -> Node:
    try:
        return nodes_for_link(link).get(pk=node_id if node_id is not None else link.node_id)
    except (Node.DoesNotExist, ValidationError) as error:
        raise Http404 from error


def moderation_node_metadata(user: User, node_ids: Sequence[uuid.UUID]) -> list[dict[str, object]]:
    """Metadata for moderation only; grants no file access or download capability."""
    active = _active(user)
    if active is None or not active.is_superuser:
        from rest_framework.exceptions import PermissionDenied

        raise PermissionDenied
    return [
        dict(row)
        for row in Node.objects.filter(pk__in=node_ids).values(
            "id", "name", "kind", "size", "mime_type", "trashed_at"
        )
    ]
