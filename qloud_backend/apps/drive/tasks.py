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
