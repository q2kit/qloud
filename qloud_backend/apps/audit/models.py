"""Audit log of file, folder and sharing activity (features/audit-log.md, ADR-0012)."""

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class AuditEvent(models.Model):
    """One action on one node, written in the transaction of the action itself.

    Snapshots (names, kinds) keep the event readable after the node, its folder or
    the actor is gone; the foreign keys then turn null. `parent` is the folder the
    action happened in (the destination for a move), `source_parent` the folder a
    move left. A folder's activity covers events whose node or either folder lies
    in its subtree, so it still shows children that were trashed, purged or moved.
    """

    class Action(models.TextChoices):
        NODE_CREATE = "node.create"
        NODE_UPLOAD = "node.upload"
        NODE_RENAME = "node.rename"
        NODE_MOVE = "node.move"
        NODE_TRASH = "node.trash"
        NODE_RESTORE = "node.restore"
        NODE_PURGE = "node.purge"
        VERSION_CREATE = "version.create"
        VERSION_RESTORE = "version.restore"
        VERSION_DELETE = "version.delete"
        VERSION_EXPIRE = "version.expire"
        VERSION_LOCK = "version.lock"
        VERSION_UNLOCK = "version.unlock"
        SHARE_ADD = "share.add"
        SHARE_ROLE_CHANGE = "share.role_change"
        SHARE_REMOVE = "share.remove"
        LINK_CREATE = "link.create"
        LINK_REVOKE = "link.revoke"

    class ActorKind(models.TextChoices):
        USER = "user"
        # Maintenance jobs: trash and version cleanup.
        SYSTEM = "system"
        # Moderation; the moderator's identity stays in ModerationAction only.
        MODERATOR = "moderator"

    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    action = models.CharField(max_length=24, choices=Action)
    actor_kind = models.CharField(max_length=9, choices=ActorKind, default=ActorKind.USER)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    actor_name = models.CharField(max_length=150, blank=True)
    # The node's owner when it happened. Deleting the account deletes its history.
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    node = models.ForeignKey(
        "drive.Node", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    node_name = models.CharField(max_length=255)
    node_kind = models.CharField(max_length=6)
    parent = models.ForeignKey(
        "drive.Node", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    source_parent = models.ForeignKey(
        "drive.Node", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    # Small, per action. Never storage keys, presigned URLs, link tokens, IPs.
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("-created_at", "-id")
        indexes = [
            models.Index(fields=["node", "-created_at", "-id"], name="audit_node_time"),
            models.Index(fields=["parent", "-created_at", "-id"], name="audit_parent_time"),
            models.Index(fields=["source_parent", "-created_at", "-id"], name="audit_source_time"),
            models.Index(fields=["owner", "-created_at"], name="audit_owner_time"),
            # The daily cleanup of events older than the retention period.
            models.Index(fields=["created_at"], name="audit_created"),
        ]

    def __str__(self) -> str:
        return f"{self.action} {self.node_name}"
