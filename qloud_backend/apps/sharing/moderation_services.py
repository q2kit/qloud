import uuid

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Q, QuerySet
from django.http import Http404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.models import User
from apps.accounts.services import suspend_user
from apps.core.errors import ModerationTargetUnavailable, ReportResolved

from .models import ModerationAction, Report, ShareLink
from .report_notifications import schedule_revocation_email


def require_superuser(user: User) -> None:
    if not user.is_superuser or not user.is_active or user.suspended_at is not None:
        raise PermissionDenied


def reports_for(user: User) -> QuerySet[Report]:
    require_superuser(user)
    return Report.objects.select_related("reporter_user", "resolved_by", "resolution")


def get_report(user: User, report_id: uuid.UUID) -> Report:
    report = reports_for(user).filter(pk=report_id).first()
    if report is None:
        raise Http404
    return report


@transaction.atomic
def resolve_report(user: User, report_id: uuid.UUID, action: str, note: str) -> Report:
    require_superuser(user)
    if action not in ModerationAction.Action.values or not note.strip() or len(note) > 2000:
        raise ValidationError({"note": ["An action and a non-empty note are required."]})
    initial = get_report(user, report_id)
    # Match account suspension's lock order, including its last-superuser guard.
    locked_users = list(
        User.objects.select_for_update()
        .filter(Q(pk__in=[initial.owner_uuid, user.pk]) | Q(is_superuser=True))
        .order_by("pk")
    )
    actor = next((item for item in locked_users if item.pk == user.pk), None)
    if actor is None:
        raise PermissionDenied
    require_superuser(actor)
    report = Report.objects.select_for_update().get(pk=report_id)
    if report.status != Report.Status.OPEN:
        raise ReportResolved
    owner = next((item for item in locked_users if item.pk == report.owner_uuid), None)
    targets: dict[str, object] = {
        "owner_id": str(report.owner_uuid),
        "node_id": str(report.root_node_uuid),
    }
    if action == ModerationAction.Action.SUSPEND_OWNER:
        if owner is None:
            raise ModerationTargetUnavailable
        was_suspended = owner.suspended_at is not None
        try:
            suspend_user(owner, reason=note.strip(), actor=actor)
        except DjangoValidationError as error:
            raise ValidationError({"non_field_errors": error.messages}) from error
        targets["changed"] = not was_suspended
    elif action != ModerationAction.Action.DISMISS:
        links = ShareLink.objects.select_related("node").select_for_update(of=("self",))
        links = (
            links.filter(pk=report.link_uuid)
            if action == ModerationAction.Action.REVOKE_LINK
            else links.filter(node_id=report.root_node_uuid)
        )
        changed = []
        for link in links.order_by("pk"):
            if link.revoked_at is not None:
                continue
            link.revoked_at, link.revoked_by = timezone.now(), actor
            link.revoke_reason = ShareLink.RevokeReason.MODERATION
            link.save(update_fields=["revoked_at", "revoked_by", "revoke_reason", "updated_at"])
            changed.append(str(link.pk))
            if owner is not None:
                schedule_revocation_email(owner, link.node.name, note.strip())
        targets["revoked_link_ids"] = changed
    report.status = (
        Report.Status.DISMISSED
        if action == ModerationAction.Action.DISMISS
        else Report.Status.ACTIONED
    )
    report.resolved_by, report.resolved_at, report.resolution_note = (
        actor,
        timezone.now(),
        note.strip(),
    )
    report.save(
        update_fields=["status", "resolved_by", "resolved_at", "resolution_note", "updated_at"]
    )
    ModerationAction.objects.create(
        report=report,
        report_uuid=report.pk,
        actor=actor,
        actor_uuid=actor.pk,
        action=action,
        note=note.strip(),
        targets=targets,
    )
    return get_report(actor, report.pk)
