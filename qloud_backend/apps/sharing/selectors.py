import uuid

from django.db.models import Case, CharField, Exists, OuterRef, QuerySet, Value, When
from django.http import Http404

from apps.accounts.models import User
from apps.drive.errors import RootFolder
from apps.drive.models import Node
from apps.drive.selectors import breadcrumb

from .models import Share
from .permissions import Role, get_node_or_404, nodes_for


def editable_node(user: User, node_id: uuid.UUID) -> Node:
    node = get_node_or_404(user, node_id, Role.EDITOR)
    if node.parent_id is None:
        raise RootFolder
    return node


def shares_for(user: User, node_id: uuid.UUID) -> QuerySet[Share]:
    return shares_on(user, editable_node(user, node_id))


def shares_on(user: User, node: Node, *, include_inherited: bool = False) -> QuerySet[Share]:
    """Grants on `node` (from editable_node); with `include_inherited`, also on ancestors.

    Ancestors are the caller's breadcrumb: all of them for the owner, only the
    path the caller can see otherwise, so no hidden folder's grants leak.
    """
    node_ids = [node.pk]
    if include_inherited:
        node_ids += [ancestor.pk for ancestor in breadcrumb(node, user)]
    return Share.objects.filter(node_id__in=node_ids).select_related("grantee")


def share_for(user: User, share_id: uuid.UUID) -> Share:
    share = Share.objects.filter(pk=share_id).first()
    if share is None:
        raise Http404
    editable_node(user, share.node_id)
    return share


def shared_with_me(user: User) -> QuerySet[Node]:
    direct = Share.objects.filter(grantee=user, node_id=OuterRef("pk"))
    editable = nodes_for(user, Role.EDITOR).filter(pk=OuterRef("pk"))
    return (
        nodes_for(user)
        .exclude(owner=user)
        .filter(Exists(direct))
        .select_related("owner")
        .annotate(
            effective_role=Case(
                When(Exists(editable), then=Value("editor")),
                default=Value("viewer"),
                output_field=CharField(),
            )
        )
    )
