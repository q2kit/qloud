from dataclasses import dataclass

from .models import User


@dataclass(frozen=True)
class Limits:
    quota_bytes: int
    max_file_size_bytes: int
    max_versions_per_file: int
    version_retention_days: int | None
    trash_retention_days: int


def get_limits(user: User) -> Limits:
    # Re-read so a previously loaded user sees admin changes immediately.
    current = User.objects.select_related("plan").get(pk=user.pk)
    plan = current.plan
    return Limits(
        quota_bytes=(
            current.quota_override_bytes
            if current.quota_override_bytes is not None
            else plan.quota_bytes
        ),
        max_file_size_bytes=plan.max_file_size_bytes,
        max_versions_per_file=plan.max_versions_per_file,
        version_retention_days=plan.version_retention_days,
        trash_retention_days=plan.trash_retention_days,
    )
