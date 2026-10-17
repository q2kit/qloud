"""File type groups shared by search filters and the storage breakdown."""

from django.db.models import Q

DOCUMENT_MIMES = (
    "application/pdf",
    "application/msword",
    "application/rtf",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
)
ARCHIVE_MIMES = (
    "application/zip",
    "application/x-zip-compressed",
    "application/vnd.rar",
    "application/x-rar-compressed",
    "application/x-7z-compressed",
    "application/x-tar",
    "application/gzip",
    "application/x-gzip",
    "application/x-bzip2",
    "application/x-xz",
)
# Every MIME type falls into exactly one group; "other" takes what the rest leave.
FILE_GROUPS = ("document", "image", "video", "audio", "archive", "other")


def group_filters() -> dict[str, Q]:
    """One condition per group on `mime_type`, a column of both Node and FileVersion."""
    groups = {
        "document": (
            Q(mime_type__startswith="text/")
            | Q(mime_type__in=DOCUMENT_MIMES)
            | Q(mime_type__startswith="application/vnd.openxmlformats-officedocument.")
            | Q(mime_type__startswith="application/vnd.oasis.opendocument.")
        ),
        **{kind: Q(mime_type__startswith=f"{kind}/") for kind in ("image", "video", "audio")},
        "archive": Q(mime_type__in=ARCHIVE_MIMES),
    }
    known = Q()
    for condition in groups.values():
        known |= condition
    groups["other"] = ~known
    return groups
