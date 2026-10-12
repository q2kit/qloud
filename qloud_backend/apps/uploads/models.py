from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import BaseModel
from apps.drive.names import validate_name


class UploadSession(BaseModel):
    """One file on its way to S3 (upload.md, ADR-0003). Part state lives in S3 (ListParts)."""

    class Status(models.TextChoices):
        ACTIVE = "active"
        COMPLETED = "completed"
        ABORTED = "aborted"
        EXPIRED = "expired"

    class OnConflict(models.TextChoices):
        FAIL = "fail"  # 409 when created, so the client can ask the user
        REPLACE = "replace"  # append a version to the resolved target UUID
        RENAME = "rename"  # "keep both": a ` (n)` suffix

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    # Whose quota holds the reservation: the owner of the target folder (data-model.md).
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    # SET_NULL: deleting the folder must not lose track of the reservation.
    parent = models.ForeignKey(
        "drive.Node", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    # [{"id", "name"}] from the root folder down to the target, taken at creation, so a
    # folder deleted meanwhile can be recreated on completion (upload.md).
    parent_path = models.JSONField(default=list)
    target_node = models.ForeignKey(
        "drive.Node", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    filename = models.CharField(max_length=255, validators=[validate_name])
    size = models.PositiveBigIntegerField()
    mime_type = models.CharField(max_length=255)
    fingerprint = models.CharField(max_length=128)
    on_conflict = models.CharField(max_length=7, choices=OnConflict, default=OnConflict.FAIL)
    storage_key = models.TextField(unique=True)
    s3_upload_id = models.TextField(blank=True)  # empty for 0-byte files
    part_size = models.PositiveIntegerField()
    status = models.CharField(max_length=9, choices=Status, default=Status.ACTIVE)
    expires_at = models.DateTimeField()
    node = models.ForeignKey(
        "drive.Node", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(status__in=["active", "completed", "aborted", "expired"]),
                name="upload_status",
            ),
            models.CheckConstraint(
                condition=Q(on_conflict__in=["fail", "rename", "replace"]),
                name="upload_on_conflict",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "status", "-created_at", "-id"], name="upload_user_list"),
            # M2-06: sweep expired sessions.
            models.Index(fields=["status", "expires_at"], name="upload_expiry"),
        ]

    def __str__(self) -> str:
        return f"{self.filename} ({self.status})"
