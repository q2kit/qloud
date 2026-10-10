from smtplib import SMTPException

from celery import shared_task
from django.core.mail import EmailMultiAlternatives


@shared_task(
    autoretry_for=(SMTPException, OSError),
    retry_backoff=True,
    retry_backoff_max=600,
    max_retries=5,
)
def send_email(
    *, subject: str, body: str, from_email: str, to: list[str], html: str | None = None
) -> None:
    """Send an already rendered email; SMTP failures are retried with backoff."""
    message = EmailMultiAlternatives(subject, body, from_email, to)
    if html:
        message.attach_alternative(html, "text/html")
    message.send()
