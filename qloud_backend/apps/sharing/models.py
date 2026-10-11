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


class Report(BaseModel):
    class Reason(models.TextChoices):
        ILLEGAL = "illegal"
        COPYRIGHT = "copyright"
        MALWARE = "malware"
        ABUSE = "abuse"
        OTHER = "other"

    class Status(models.TextChoices):
        OPEN = "open"
        ACTIONED = "actioned"
        DISMISSED = "dismissed"

    share_link = models.ForeignKey(
        ShareLink, null=True, on_delete=models.SET_NULL, related_name="reports"
    )
    node = models.ForeignKey(
        "drive.Node", null=True, on_delete=models.SET_NULL, related_name="reports"
    )
    link_uuid = models.UUIDField(editable=False)
    node_uuid = models.UUIDField(editable=False)
    node_name = models.CharField(max_length=255)
    owner_uuid = models.UUIDField(editable=False)
    root_node_uuid = models.UUIDField(editable=False)
    reason = models.CharField(max_length=12, choices=Reason)
    message = models.TextField(blank=True, max_length=2000)
    reporter_email = models.EmailField(blank=True)
    reporter_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="reports"
    )
    reporter_ip_hash = models.CharField(max_length=64, editable=False)
    status = models.CharField(max_length=9, choices=Status, default=Status.OPEN)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        on_delete=models.SET_NULL,
        related_name="resolved_reports",
    )
    resolved_at = models.DateTimeField(null=True)
    resolution_note = models.TextField(blank=True, max_length=2000)

    class Meta:
        db_table = "moderation_report"
        indexes = [
            models.Index(fields=["reporter_ip_hash", "created_at"], name="report_ip_time"),
            models.Index(
                fields=["reporter_ip_hash", "link_uuid", "created_at"], name="report_duplicate"
            ),
            models.Index(fields=["status", "created_at", "id"], name="report_status_time"),
            models.Index(fields=["node_uuid", "status"], name="report_node_status"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(reason__in=["illegal", "copyright", "malware", "abuse", "other"]),
                name="report_reason",
            ),
            models.CheckConstraint(
                condition=Q(
                    status="open",
                    resolved_at__isnull=True,
                    resolved_by__isnull=True,
                    resolution_note="",
                )
                | (
                    Q(status__in=["actioned", "dismissed"], resolved_at__isnull=False)
                    & ~Q(resolution_note="")
                ),
                name="report_resolution",
            ),
        ]


class ModerationAction(BaseModel):
    class Action(models.TextChoices):
        REVOKE_LINK = "revoke_link"
        REVOKE_NODE = "revoke_node"
        SUSPEND_OWNER = "suspend_owner"
        DISMISS = "dismiss"

    report = models.OneToOneField(
        Report, null=True, on_delete=models.SET_NULL, related_name="resolution"
    )
    report_uuid = models.UUIDField(editable=False)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        on_delete=models.SET_NULL,
        related_name="moderation_actions",
    )
    actor_uuid = models.UUIDField(editable=False)
    action = models.CharField(max_length=13, choices=Action)
    note = models.TextField(max_length=2000)
    targets = models.JSONField(default=dict)

    class Meta:
        db_table = "moderation_action"
        constraints = [
            models.CheckConstraint(
                condition=Q(action__in=["revoke_link", "revoke_node", "suspend_owner", "dismiss"]),
                name="moderation_action_kind",
            )
        ]


ReportStatusChoices = Report.Status.choices
ReportReasonChoices = Report.Reason.choices
ModerationActionChoices = ModerationAction.Action.choices
