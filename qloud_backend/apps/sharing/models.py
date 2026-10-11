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
