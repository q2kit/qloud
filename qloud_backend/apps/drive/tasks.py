import logging
import uuid

from billiard.exceptions import SoftTimeLimitExceeded
from celery import shared_task
from django.conf import settings
from kombu.exceptions import KombuError

from apps.storage import s3

from . import thumbnails

logger = logging.getLogger(__name__)


@shared_task(
    autoretry_for=(s3.StorageError,),
    retry_backoff=True,
    retry_backoff_max=60,
    max_retries=3,
    soft_time_limit=settings.THUMBNAIL_SOFT_TIME_LIMIT,
    time_limit=settings.THUMBNAIL_TIME_LIMIT,
)
def generate_thumbnail(version_id: str) -> bool:
    try:
        return thumbnails.generate(uuid.UUID(version_id))
    except SoftTimeLimitExceeded:
        logger.warning("Thumbnail time limit reached for version %s", version_id)
        return False


def enqueue_thumbnail(version_id: str) -> None:
    # Upload has already committed; a broker outage must not turn success into 500.
    try:
        generate_thumbnail.delay(version_id)
    except KombuError, OSError:
        logger.exception("Could not enqueue thumbnail for version %s", version_id)


@shared_task(autoretry_for=(s3.StorageError,), retry_backoff=True, max_retries=5)
def delete_trash_objects() -> int:
    from django.db import transaction

    from .models import Blob, ObjectDeletion

    deleted = 0
    while True:
        with transaction.atomic():
            pending = list(
                ObjectDeletion.objects.select_for_update(skip_locked=True).order_by("id")[:1000]
            )
            if not pending:
                return deleted
            keys = [item.storage_key for item in pending]
            # Serialize workers and protect any blob still serving a version.
            blobs = list(Blob.objects.select_for_update().filter(storage_key__in=keys))
            referenced = set(
                Blob.objects.filter(
                    pk__in=[b.pk for b in blobs], versions__isnull=False
                ).values_list("storage_key", flat=True)
            )
            s3.delete_objects(key for key in keys if key not in referenced)
            Blob.objects.filter(pk__in=[b.pk for b in blobs], versions__isnull=True).delete()
            ObjectDeletion.objects.filter(pk__in=[item.pk for item in pending]).delete()
            deleted += len(pending)


def enqueue_object_cleanup() -> None:
    try:
        delete_trash_objects.delay()
    except KombuError, OSError:
        # The durable queue can be drained by the scheduled sweep after broker recovery.
        logger.exception("Could not enqueue trash object cleanup")


@shared_task
def expire_trash() -> int:
    from django.utils import timezone

    from . import trash

    now = timezone.now()
    expired = 0
    while roots := trash.expired_root_ids(now):
        done = sum(trash.expire_root(node_id, owner_id, now) for node_id, owner_id in roots)
        expired += done
        if not done:
            break
    enqueue_object_cleanup()
    if expired:
        logger.info("Expired %d trash group(s)", expired)
    return expired
