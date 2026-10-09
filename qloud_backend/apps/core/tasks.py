from celery import shared_task


@shared_task
def ping() -> str:
    """Used by health checks and tests to verify the worker pipeline."""
    return "pong"
