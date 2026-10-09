from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower

from apps.core.models import BaseModel


class Node(BaseModel):
    class Kind(models.TextChoices):
        FOLDER = "folder"
        FILE = "file"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.CASCADE)
    kind = models.CharField(max_length=6, choices=Kind, default=Kind.FOLDER)
    name = models.CharField(max_length=255, validators=[RegexValidator(r"^[^/]+$")])

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(kind__in=["folder", "file"]), name="node_kind"),
            models.CheckConstraint(
                condition=~Q(name="") & ~Q(name__contains="/"), name="node_name"
            ),
            models.CheckConstraint(
                condition=Q(parent__isnull=False) | Q(kind="folder"), name="node_root_folder"
            ),
            models.UniqueConstraint(
                fields=["owner"], condition=Q(parent__isnull=True), name="node_one_root"
            ),
            models.UniqueConstraint(Lower("name"), "parent", name="node_sibling_name"),
        ]

    def __str__(self) -> str:
        return self.name
