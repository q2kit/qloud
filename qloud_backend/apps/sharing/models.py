from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import BaseModel


class Share(BaseModel):
    class Role(models.TextChoices):
        VIEWER = "viewer"
        EDITOR = "editor"

    node = models.ForeignKey("drive.Node", on_delete=models.CASCADE, related_name="shares")
    grantee = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="received_shares"
    )
    role = models.CharField(max_length=6, choices=Role)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="created_shares"
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["node", "grantee"], name="share_node_grantee"),
            models.CheckConstraint(condition=Q(role__in=["viewer", "editor"]), name="share_role"),
        ]


def new_link_token() -> str:
    import secrets

    return secrets.token_urlsafe(32)


class ShareLink(BaseModel):
    class Role(models.TextChoices):
        VIEWER = "viewer"

    class RevokeReason(models.TextChoices):
        OWNER = "owner"
        MODERATION = "moderation"

    node = models.ForeignKey("drive.Node", on_delete=models.CASCADE, related_name="share_links")
    token = models.CharField(max_length=43, unique=True, default=new_link_token, editable=False)
    role = models.CharField(max_length=6, choices=Role, default=Role.VIEWER)
    expires_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="revoked_links",
    )
    revoke_reason = models.CharField(max_length=30, choices=RevokeReason, null=True, blank=True)  # noqa: DJ001
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="created_links"
    )

    class Meta:
        db_table = "sharing_share_link"
        constraints = [
            models.CheckConstraint(condition=Q(role="viewer"), name="share_link_viewer"),
            models.CheckConstraint(
                condition=Q(
                    revoked_at__isnull=True, revoke_reason__isnull=True, revoked_by__isnull=True
                )
                | (
                    Q(revoked_at__isnull=False, revoke_reason__isnull=False)
                    & Q(revoke_reason__in=["owner", "moderation"])
                ),
                name="share_link_revocation",
            ),
        ]
