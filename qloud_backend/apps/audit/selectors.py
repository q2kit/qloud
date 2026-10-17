"""Read audit events through the shared permission layer (features/audit-log.md)."""

from django.db.models import Q, QuerySet
from django.db.models.expressions import RawSQL

from apps.accounts.models import User
from apps.drive.models import Node
from apps.sharing.permissions import Role, get_node_or_404, role_of

from .models import AuditEvent

# The folder and everything under it, trashed children included: their events
# happened in this folder. UNION guards against a malformed cycle.
_SUBTREE = """
WITH RECURSIVE subtree(id) AS (
    SELECT %s::uuid
    UNION
    SELECT n.id FROM drive_node n JOIN subtree s ON n.parent_id = s.id
)
SELECT id FROM subtree
"""


def activity_for(user: User, node_id: object) -> tuple[Node, Role, QuerySet[AuditEvent]]:
    """Events of a node the caller can view; for a folder, of its whole subtree.

    Access to a folder covers its subtree, so a recipient of a subfolder only reads
    from that subfolder down.
    """
    node = get_node_or_404(user, str(node_id))
    role = role_of(user, node)
    if role is None:  # cannot happen for a node loaded through the permission layer
        raise Node.DoesNotExist
    if node.kind == Node.Kind.FILE:
        scope = Q(node=node)
    else:
        subtree = RawSQL(_SUBTREE, [node.pk])  # noqa: S611 - fixed SQL, bound UUID
        scope = Q(node__in=subtree) | Q(parent__in=subtree) | Q(source_parent__in=subtree)
    events = AuditEvent.objects.filter(scope, owner_id=node.owner_id).select_related("actor")
    return node, role, events
