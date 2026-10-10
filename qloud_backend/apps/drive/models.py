from django.conf import settings
from django.db import models
from django.db.models import F, Q
from django.db.models.functions import Lower

from apps.core.models import BaseModel

from .names import validate_name

# Mirrors drive.names for raw writes: no `/`, no control characters, no padding.
_BAD_NAME = r"[\x01-\x1f\x7f/]|^\s|\s$"


class Node(BaseModel):
    """A folder or a file in one owner's tree (adjacency list on `parent`).

    Query nodes through `apps.sharing.permissions`, never `Node.objects` directly
    from a view or selector: that is where access is checked.
    """

    class Kind(models.TextChoices):
        FOLDER = "folder"
        FILE = "file"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.CASCADE)
    kind = models.CharField(max_length=6, choices=Kind, default=Kind.FOLDER)
    # ICU "natural" collation (migration 0003): file2 sorts before file10, accents and
    # case group together; cursor comparisons use the same collation as ORDER BY.
    name = models.CharField(max_length=255, db_collation="natural", validators=[validate_name])
    # File only: mirror the current version so listings need no join.
    mime_type = models.CharField(max_length=255, null=True, blank=True)  # noqa: DJ001
    size = models.PositiveBigIntegerField(default=0)
    current_version = models.ForeignKey(
        "FileVersion", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    # Soft delete (M4): every node of a trashed subtree carries the node the user deleted.
    trashed_at = models.DateTimeField(null=True, blank=True)
    trashed_root = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.CASCADE, related_name="+"
    )
    trashed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    thumbnail_key = models.TextField(null=True, blank=True)  # noqa: DJ001

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(kind__in=["folder", "file"]), name="node_kind"),
            models.CheckConstraint(
                condition=~Q(name__in=["", ".", ".."]) & ~Q(name__regex=_BAD_NAME),
                name="node_name",
            ),
            models.CheckConstraint(
                condition=Q(parent__isnull=False) | Q(kind="folder"), name="node_root_folder"
            ),
            models.CheckConstraint(
                condition=Q(kind="file")
                | Q(size=0, mime_type__isnull=True, current_version__isnull=True),
                name="node_folder_has_no_content",
            ),
            models.CheckConstraint(
                condition=Q(trashed_at__isnull=True, trashed_root__isnull=True)
                | Q(trashed_at__isnull=False, trashed_root__isnull=False),
                name="node_trashed_root",
            ),
            models.UniqueConstraint(
                fields=["owner"], condition=Q(parent__isnull=True), name="node_one_root"
            ),
            # Trashed nodes keep their names, so restoring may need a new suffix.
            models.UniqueConstraint(
                Lower("name"),
                "parent",
                condition=Q(trashed_at__isnull=True),
                name="node_sibling_name",
            ),
        ]
        indexes = [
            # Default listing order: folders first ("folder" > "file"), then name, then id.
            models.Index(F("parent"), F("kind").desc(), F("name"), F("id"), name="node_children"),
            models.Index(fields=["owner", "trashed_at"], name="node_owner_trashed"),
        ]

    def __str__(self) -> str:
        return self.name


class Blob(BaseModel):
    """An object in the bucket. Never deleted together with its versions:
    removing the object from S3 comes first (trash and version cleanup)."""

    storage_key = models.TextField(unique=True)
    size = models.PositiveBigIntegerField()
    checksum_sha256 = models.CharField(max_length=64, null=True, blank=True)  # noqa: DJ001
    etag = models.TextField(blank=True)

    def __str__(self) -> str:
        return self.storage_key


class FileVersion(BaseModel):
    node = models.ForeignKey(Node, on_delete=models.CASCADE, related_name="versions")
    blob = models.ForeignKey(Blob, on_delete=models.PROTECT, related_name="versions")
    version_number = models.PositiveIntegerField()
    size = models.PositiveBigIntegerField()
    mime_type = models.CharField(max_length=255)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    original_name = models.CharField(max_length=255)
    keep_forever = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["node", "version_number"], name="file_version_number"),
            models.CheckConstraint(
                condition=Q(version_number__gte=1), name="file_version_number_positive"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.original_name} v{self.version_number}"
