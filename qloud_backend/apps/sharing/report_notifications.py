from django.conf import settings
from django.db import transaction
from django.template.loader import render_to_string
from django.utils import translation

from apps.accounts.models import User
from apps.accounts.tasks import send_email

from .models import Report


def schedule_report_email(report: Report) -> None:
    if not settings.MODERATION_EMAIL:
        return
    context: dict[str, object] = {
        "name": report.node_name,
        "reason": report.reason,
        "message": report.message,
        "email": report.reporter_email,
        "url": f"{settings.APP_BASE_URL.rstrip('/')}/moderation?report={report.pk.hex}",
    }
    _schedule("report", context, settings.MODERATION_EMAIL, "vi")


def schedule_revocation_email(owner: User, name: str, note: str) -> None:
    _schedule("revoked", {"name": name, "note": note}, owner.email, owner.locale)


def _schedule(template: str, context: dict[str, object], recipient: str, locale: str) -> None:
    with translation.override(locale):
        payload = {
            "subject": render_to_string(f"sharing/email/{template}_subject.txt", context).strip(),
            "body": render_to_string(f"sharing/email/{template}.txt", context),
            "html": render_to_string(f"sharing/email/{template}.html", context),
            "from_email": settings.DEFAULT_FROM_EMAIL,
            "to": [recipient],
        }
    transaction.on_commit(lambda: send_email.delay(**payload))
