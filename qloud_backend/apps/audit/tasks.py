import logging
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from .models import AuditEvent

logger = logging.getLogger(__name__)

# Fixed and not part of any plan (features/audit-log.md).
RETENTION = timedelta(days=365)


@shared_task
def expire_events(batch: int = 5000) -> int:
    """Delete events older than the retention period, a batch per statement."""
    cutoff = timezone.now() - RETENTION
    expired = 0
    while ids := list(
        AuditEvent.objects.filter(created_at__lt=cutoff).values_list("pk", flat=True)[:batch]
    ):
        expired += AuditEvent.objects.filter(pk__in=ids).delete()[0]
    if expired:
        logger.info("Expired %d audit event(s)", expired)
    return expired
