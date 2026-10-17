"""Write audit events (features/audit-log.md). Callers run inside the transaction of
the action, so a rolled-back action leaves no event."""

import uuid
from collections.abc import Iterable
from typing import Any

from apps.accounts.models import User
from apps.drive.models import Node

from .models import AuditEvent

Action = AuditEvent.Action
ActorKind = AuditEvent.ActorKind


def _actor_name(actor: User | None) -> str:
    # Never the email: viewers read this name (the API adds emails for editors only).
    return actor.display_name.strip() if actor is not None else ""


def event(
    action: str,
    node: Node,
    *,
    actor: User | None,
    actor_kind: str = ActorKind.USER,
    source_parent_id: uuid.UUID | None = None,
    **metadata: Any,
) -> AuditEvent:
    """An unsaved event for `node` as it is now (name, kind, folder)."""
    return AuditEvent(
        action=action,
        actor=actor if actor_kind == ActorKind.USER else None,
        actor_kind=actor_kind,
        actor_name=_actor_name(actor) if actor_kind == ActorKind.USER else "",
        owner_id=node.owner_id,
        node=node,
        node_name=node.name,
        node_kind=node.kind,
        parent_id=node.parent_id,
        source_parent_id=source_parent_id,
        metadata=metadata,
    )


def record(action: str, node: Node, *, actor: User | None, **kwargs: Any) -> None:
    event(action, node, actor=actor, **kwargs).save(force_insert=True)


def record_all(events: Iterable[AuditEvent]) -> None:
    """One INSERT for a batch (move, trash, restore, purge of several roots)."""
    AuditEvent.objects.bulk_create(list(events))


def person(user: User) -> dict[str, str]:
    """A grantee in share metadata; the API hides the email from viewers."""
    return {"id": str(user.pk), "name": user.display_name.strip(), "email": user.email}


def folder(node: Node | None) -> dict[str, str | bool] | None:
    """A folder in move metadata; the API hides names the reader cannot see."""
    if node is None:
        return None
    return {"id": str(node.pk), "name": node.name, "is_root": node.parent_id is None}
