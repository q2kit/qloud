"""How an owner's quota is spent (quota.md, S-14)."""

from dataclasses import dataclass

from django.db import connection
from django.db.models import Case, F, IntegerField, Max, Min, Q, QuerySet, Value, When

from apps.accounts.models import User
from apps.accounts.selectors import get_limits
from apps.sharing.permissions import nodes_for

from .mime import FILE_GROUPS, group_filters
from .models import FileVersion, Node

OLD_VERSIONS = "old_versions"
TRASH = "trash"
BREAKDOWN_KEYS = (*FILE_GROUPS, OLD_VERSIONS, TRASH)


@dataclass(frozen=True)
class StorageUsage:
    quota_bytes: int
    used_bytes: int
    reserved_bytes: int
    max_file_size_bytes: int
    breakdown: dict[str, int]


def breakdown(owner: User) -> dict[str, int]:
    """Bytes per group, each Blob counted once like `used_bytes` (data-model.md).

    A Blob goes to the first group that claims it: the type of the live file it is
    current for, then an old version of a live file, then the trash. The codes follow
    `BREAKDOWN_KEYS`, so the smallest code over a Blob's versions is its group.
    """
    live_current = Q(node__trashed_at__isnull=True, pk=F("node__current_version_id"))
    code = Case(
        When(node__trashed_at__isnull=False, then=Value(BREAKDOWN_KEYS.index(TRASH))),
        *(
            When(live_current & condition, then=Value(BREAKDOWN_KEYS.index(group)))
            for group, condition in group_filters().items()
        ),
        default=Value(BREAKDOWN_KEYS.index(OLD_VERSIONS)),
        output_field=IntegerField(),
    )
    blobs = (
        FileVersion.objects.filter(node__owner=owner)
        .values("blob_id")
        .annotate(code=Min(code), size=Max("blob__size"))
        .values("code", "size")
    )
    sql, params = blobs.query.sql_with_params()
    with connection.cursor() as cursor:
        # The ORM cannot aggregate over a grouped annotation; wrap it in one query.
        cursor.execute(
            f"SELECT code, SUM(size) FROM ({sql}) AS blobs GROUP BY code",  # noqa: S608 - ORM SQL with bound params
            params,
        )
        totals = {BREAKDOWN_KEYS[code]: int(total) for code, total in cursor.fetchall()}
    return {key: totals.get(key, 0) for key in BREAKDOWN_KEYS}


def usage(user: User) -> StorageUsage:
    limits = get_limits(user)
    counters = User.objects.values("used_bytes", "reserved_bytes").get(pk=user.pk)
    return StorageUsage(
        quota_bytes=limits.quota_bytes,
        used_bytes=counters["used_bytes"],
        reserved_bytes=counters["reserved_bytes"],
        max_file_size_bytes=limits.max_file_size_bytes,
        breakdown=breakdown(user),
    )


def largest_files(user: User) -> QuerySet[Node]:
    """The user's own live files; shared items count against someone else's quota."""
    return nodes_for(user).filter(owner=user, kind=Node.Kind.FILE)
