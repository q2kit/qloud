"""Access to nodes: the only way views and selectors may load them.

See architecture.md, "Phân quyền".

A user's role on a node is the highest of: owner, a Share on the node, a Share on an
ancestor folder (inherited). Shares arrive in M5; until then only the owner has a role.
No access and no such node look the same to the caller: a 404, never a 403.
"""

import enum
import uuid

from django.contrib.auth.models import AbstractBaseUser, AnonymousUser
from django.core.exceptions import ValidationError
from django.db.models import QuerySet
from django.http import Http404

from apps.accounts.models import User
from apps.drive.models import Node


class Role(enum.IntEnum):
    VIEWER = 1
    EDITOR = 2
    OWNER = 3


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
    # Owners have every role, so `role` filters nothing until shares exist.
    nodes = Node.objects.filter(owner=active)
    if trashed is not None:
        nodes = nodes.filter(trashed_at__isnull=not trashed)
    return nodes


def role_of(user: AbstractBaseUser | AnonymousUser, node: Node) -> Role | None:
    active = _active(user)
    if active is not None and node.owner_id == active.pk:
        return Role.OWNER
    return None


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
