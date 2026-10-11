import datetime
import uuid

from django.db import connection, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.crypto import salted_hmac
from rest_framework.exceptions import Throttled

from apps.accounts.models import User

from .link_selectors import public_link
from .models import Report
from .permissions import get_link_node_or_404
from .report_notifications import schedule_report_email


@transaction.atomic
def create_report(
    token: str,
    node_id: uuid.UUID,
    reason: str,
    *,
    message: str = "",
    email: str = "",
    user: User | None = None,
    client_ip: str,
) -> Report | None:
    ip_hash = salted_hmac("qloud.report.ip", client_ip, algorithm="sha256").hexdigest()
    lock_id = int.from_bytes(bytes.fromhex(ip_hash)[:8], signed=True)
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", [lock_id])
    link = public_link(token)
    get_object_or_404(User.objects.select_for_update(), pk=link.node.owner_id)
    link = public_link(token)
    node = get_link_node_or_404(link, node_id)
    now = timezone.now()
    recent = Report.objects.filter(reporter_ip_hash=ip_hash)
    if recent.filter(link_uuid=link.pk, created_at__gt=now - datetime.timedelta(hours=24)).exists():
        return None
    if recent.filter(created_at__gt=now - datetime.timedelta(hours=1)).count() >= 5:
        raise Throttled(wait=3600)
    report = Report.objects.create(
        share_link=link,
        link_uuid=link.pk,
        node=node,
        node_uuid=node.pk,
        node_name=node.name,
        owner_uuid=link.node.owner_id,
        root_node_uuid=link.node_id,
        reason=reason,
        message=message,
        reporter_email=email.lower(),
        reporter_user=user,
        reporter_ip_hash=ip_hash,
    )
    schedule_report_email(report)
    return report
