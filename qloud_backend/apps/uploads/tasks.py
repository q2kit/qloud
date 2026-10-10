import logging

from celery import shared_task

from . import services

logger = logging.getLogger(__name__)
BATCH = 200


@shared_task
def expire_uploads() -> int:
    """Hourly (CELERY_BEAT_SCHEDULE): close sessions past `expires_at`, abort their
    multipart uploads and return the reserved quota (upload.md, step 6).

    Each session is its own transaction, so a large backlog never holds many locks, and
    a crash part-way loses nothing: the next run picks up what is left.
    """
    expired = 0
    while ids := services.expired_session_ids(BATCH):
        done = sum(services.expire(session_id) for session_id in ids)
        expired += done
        if not done:
            break  # every one was closed meanwhile by someone else; no progress to make
    if expired:
        logger.info("Expired %d upload session(s)", expired)
    return expired
